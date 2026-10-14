import argparse
import os
import asyncio
import aiohttp
import aiofiles
import pandas as pd
from bs4 import BeautifulSoup
import random
import sys
from pathlib import Path
import logging
from collections import deque
from datetime import datetime, timedelta
from aiohttp import ClientTimeout
import re
from tqdm import tqdm
import checko_runtime_config

from common import CHECKO_RAW_DIR, ensure_artifacts_dirs, ensure_checko_config


project_root = Path(__file__).resolve().parent
log_folder = project_root / "logs"
os.makedirs(log_folder, exist_ok=True)

logger = logging.getLogger("CheckoParser")
logger.setLevel(logging.DEBUG)
formatter = logging.Formatter(
    fmt='%(asctime)s | %(levelname)s | %(name)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log_file = log_folder / "checko_parser.log"
file_handler = logging.FileHandler(log_file, encoding='utf-8-sig')
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)


class NoAvailableProxyError(Exception):
    pass


class ProxyManager:
    def __init__(self, proxies, slots_per_proxy=2, cooldown_minutes=0.5, max_failures=5):
        self.proxies = deque()
        for proxy in proxies:
            for _ in range(slots_per_proxy):
                self.proxies.append((proxy, datetime.min, 0))
        self.cooldown = timedelta(minutes=cooldown_minutes)
        self.max_failures = max_failures
        self.lock = asyncio.Lock()

    async def get_next_proxy(self):
        async with self.lock:
            current_time = datetime.now()
            available_proxies = []
            for idx in range(len(self.proxies)):
                proxy, last_used, failure_count = self.proxies[idx]
                if current_time - last_used > self.cooldown and failure_count < self.max_failures:
                    available_proxies.append((idx, proxy, failure_count))

            if available_proxies:
                idx, proxy, failure_count = random.choice(available_proxies)
                self.proxies[idx] = (proxy, current_time, failure_count)
                logger.info(f"Proxy selected: {proxy['ip']} | Failures: {failure_count}")
                return proxy

            all_failed = all(failure_count >= self.max_failures for _, _, failure_count in self.proxies)
            if all_failed:
                logger.warning("All proxies have reached max_failures. Resetting failure counts.")
                await self.reset_failures()
                return await self.get_next_proxy()

            return None

    async def release_proxy(self, proxy, success=True):
        async with self.lock:
            for idx in range(len(self.proxies)):
                current_proxy, last_used, failure_count = self.proxies[idx]
                if current_proxy == proxy:
                    if success:
                        self.proxies[idx] = (current_proxy, datetime.now(), 0)
                        logger.info(f"Proxy released successfully: {proxy['ip']}")
                    else:
                        new_failure_count = failure_count + 1
                        self.proxies[idx] = (current_proxy, datetime.now(), new_failure_count)
                        logger.warning(f"Proxy failed: {proxy['ip']} | New Failure Count: {new_failure_count}")
                    return

            logger.info(f"Proxy not found in queue, adding back: {proxy.get('ip', 'N/A')}")
            self.proxies.append((proxy, datetime.now(), 0))

    async def reset_failures(self):
        async with self.lock:
            for idx in range(len(self.proxies)):
                proxy, last_used, _ = self.proxies[idx]
                self.proxies[idx] = (proxy, last_used, 0)
            logger.info("All proxy failure counts have been reset.")


def get_headers_proxy() -> dict | None:
    try:
        return checko_runtime_config.USER_AGENTS_PROXY_LIST
    except Exception:
        return None


# Legacy fallback list kept empty intentionally.
# Main source should be checko_runtime_config.TARGET_OKVED_CODES
# or CHECKO_OKVED_CODES_FILE.
TARGET_OKVED_CODES = []


def _normalize_okved_codes(raw_codes) -> list[str]:
    if raw_codes is None:
        return []

    if isinstance(raw_codes, str):
        candidates = re.split(r"[,\n;\s]+", raw_codes)
    elif isinstance(raw_codes, (list, tuple, set)):
        candidates = list(raw_codes)
    else:
        return []

    seen: set[str] = set()
    result: list[str] = []
    for item in candidates:
        code = str(item).strip()
        if not code:
            continue
        # Accept forms like "01", "01.1", "01.11.12"
        if not re.fullmatch(r"\d{2}(?:\.\d+)*", code):
            continue
        if code in seen:
            continue
        seen.add(code)
        result.append(code)
    return result


def load_target_okved_codes() -> list[str]:
    # 1) Explicit list in runtime config (highest priority)
    cfg_codes = _normalize_okved_codes(getattr(checko_runtime_config, "TARGET_OKVED_CODES", None))
    if cfg_codes:
        logger.info("Using TARGET_OKVED_CODES from checko_runtime_config.py (%s codes).", len(cfg_codes))
        return cfg_codes

    # 2) External file with one code per line (or comma-separated)
    okved_file = os.getenv("CHECKO_OKVED_CODES_FILE", "").strip()
    if okved_file:
        path = Path(okved_file)
        if path.exists():
            file_codes = _normalize_okved_codes(path.read_text(encoding="utf-8", errors="ignore"))
            if file_codes:
                logger.info("Using OKVED list from file %s (%s codes).", path, len(file_codes))
                return file_codes
            logger.warning("OKVED file %s is present but no valid codes were found.", path)
        else:
            logger.warning("CHECKO_OKVED_CODES_FILE is set, but file does not exist: %s", path)

    # 3) Built-in fallback list
    fallback_codes = _normalize_okved_codes(TARGET_OKVED_CODES)
    if fallback_codes:
        logger.info("Using built-in TARGET_OKVED_CODES (%s codes).", len(fallback_codes))
    return fallback_codes


def format_okved(okved):
    formatted_okved = okved.replace('.', '')
    while len(formatted_okved) < 6:
        formatted_okved += '0'
    return formatted_okved


async def make_request(
    session, url, params=None, proxy_manager=None,
    retries=10, backoff_factor=0.5, max_no_proxy=20
):
    attempt = 0
    proxy_wait_count = 0
    last_exc = None

    while attempt < retries:
        proxy = await proxy_manager.get_next_proxy() if proxy_manager else None
        if proxy is None:
            proxy_wait_count += 1
            logger.info(
                f"No available proxy (wait #{proxy_wait_count}). Waiting 30s (not counting as attempt)."
            )

            if proxy_wait_count > max_no_proxy:
                last_exc = NoAvailableProxyError(f"No proxies after {proxy_wait_count} consecutive checks.")
                logger.error(str(last_exc))
                break

            await asyncio.sleep(31)
            continue

        proxy_wait_count = 0
        headers = {"User-Agent": proxy["user-agent"]} if proxy.get("user-agent") else None
        proxy_url = f"http://{proxy['ip']}" if proxy.get("ip") else None

        try:
            if params:
                async with session.get(
                    url, headers=headers, params=params, proxy=proxy_url,
                    timeout=ClientTimeout(total=20)
                ) as response:
                    if response.status == 200:
                        content = await response.read()
                        await proxy_manager.release_proxy(proxy, success=True)
                        logger.info(f"Successful request: {url} | Proxy: {proxy.get('ip')}")
                        return content
                    if response.status in (429, 403):
                        logger.warning(
                            f"Received status code {response.status} for URL: {url} | Proxy: {proxy.get('ip')}. "
                            f"Sleeping extra due to rate-limit/forbidden."
                        )
                        await proxy_manager.release_proxy(proxy, success=False)
                        await asyncio.sleep(10 + random.uniform(0, 5))
                    else:
                        logger.error(
                            f"Received status code {response.status} for URL: {url} | Proxy: {proxy.get('ip')}"
                        )
                        await proxy_manager.release_proxy(proxy, success=False)
            else:
                async with session.get(
                    url, headers=headers, proxy=proxy_url, timeout=ClientTimeout(total=20)
                ) as response:
                    if response.status == 200:
                        content = await response.read()
                        await proxy_manager.release_proxy(proxy, success=True)
                        logger.info(f"Successful request: {url} | Proxy: {proxy.get('ip')}")
                        return content
                    if response.status in (429, 403):
                        logger.warning(
                            f"Received status code {response.status} for URL: {url} | Proxy: {proxy.get('ip')}. "
                            f"Sleeping extra due to rate-limit/forbidden."
                        )
                        await proxy_manager.release_proxy(proxy, success=False)
                        await asyncio.sleep(10 + random.uniform(0, 5))
                    else:
                        logger.error(
                            f"Received status code {response.status} for URL: {url} | Proxy: {proxy.get('ip')}"
                        )
                        await proxy_manager.release_proxy(proxy, success=False)

        except aiohttp.ClientError as e:
            last_exc = e
            logger.error(f"ClientError при запросе {url} с прокси {proxy.get('ip')}: {e}")
            await proxy_manager.release_proxy(proxy, success=False)
        except asyncio.TimeoutError as e:
            last_exc = e
            logger.error(f"TimeoutError при запросе {url} с прокси {proxy.get('ip')}: {e}")
            await proxy_manager.release_proxy(proxy, success=False)

        attempt += 1
        backoff = backoff_factor * (2 ** (attempt - 1))
        await asyncio.sleep(backoff + random.uniform(0, 1))

    if attempt >= retries:
        logger.error(f"Failed to fetch {url} after {retries} attempts. Last error: {last_exc}")
        raise Exception(f"Не удалось выполнить запрос {url} после {retries} попыток. Last error: {last_exc}")
    if last_exc and isinstance(last_exc, NoAvailableProxyError):
        raise last_exc
    return None


def parse_company_page(content):
    soup = BeautifulSoup(content, 'html.parser')
    company_data = {}

    def _get_company_inn() -> str | None:
        inn_tag_local = soup.find('strong', id='copy-inn')
        if not inn_tag_local:
            return None
        inn_val = inn_tag_local.get_text(strip=True)
        return inn_val if inn_val and inn_val.isdigit() else None

    def _find_director_inn_tag():
        company_inn_local = _get_company_inn()
        candidates = []
        for tag in soup.find_all('span', attrs={'id': re.compile(r'^copy-x-')}):
            val = tag.get_text(strip=True)
            if val and val.isdigit() and len(val) in (10, 12):
                if company_inn_local and val == company_inn_local:
                    continue
                candidates.append((len(val), tag))

        if not candidates:
            return None

        for ln, tag in candidates:
            if ln == 12:
                return tag
        return candidates[0][1]

    def _looks_like_person_name(text: str) -> bool:
        t = (text or "").strip()
        if not t:
            return False
        if t.lower() in {"адрес", "контакты"}:
            return False
        has_letter = any(ch.isalpha() for ch in t)
        has_digit = any(ch.isdigit() for ch in t)
        if not has_letter or has_digit:
            return False
        if "," in t:
            return False
        return True

    try:
        name_tag = soup.find('h1')
        company_data['Наименование'] = name_tag.text.strip() if name_tag else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге наименования: {e}")
        company_data['Наименование'] = 'N/A'

    try:
        legal_name_tag = name_tag.find_next('div') if name_tag else None
        company_data['Юридическое наименование'] = legal_name_tag.text.strip() if legal_name_tag else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге юридического наименования: {e}")
        company_data['Юридическое наименование'] = 'N/A'

    try:
        main_section = soup.find('div', class_='main-section')
        if main_section:
            status_tag = main_section.find('div', class_='text-success')
            if status_tag:
                company_data['Статус'] = status_tag.text.strip()
            else:
                status_tag = main_section.find('div', class_='text-danger')
                if status_tag:
                    status_text = status_tag.get_text().lower()
                    if "ликвидировано" in status_text:
                        company_data['Статус'] = 'Ликвидировано'
                    elif "банкротом" in status_text:
                        company_data['Статус'] = 'Банкрот'
                    else:
                        company_data['Статус'] = 'N/A'
                else:
                    company_data['Статус'] = 'N/A'
        else:
            company_data['Статус'] = 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге статуса: {e}")
        company_data['Статус'] = 'N/A'

    try:
        if soup.find('a', string=re.compile(r'^Управляющая организация$')):
            company_data['ИНН управляющего'] = 'N/A'
            director_inn = None
        else:
            director_inn = _find_director_inn_tag()
            company_data['ИНН управляющего'] = director_inn.get_text().strip() if director_inn else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге ИНН управляющего: {e}")
        company_data['ИНН управляющего'] = 'N/A'
        director_inn = None

    try:
        director_name = director_inn.find_previous().find_previous() if director_inn else None
        director_name_text = director_name.get_text().strip() if director_name else ''
        company_data['ФИО управляющего'] = director_name_text if _looks_like_person_name(director_name_text) else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге ФИО управляющего: {e}")
        company_data['ФИО управляющего'] = 'N/A'

    try:
        if 'director_name' in locals() and director_name:
            director_position = director_name.find_previous_sibling()
        else:
            director_position = None
        director_position_text = director_position.get_text().strip() if director_position else ''
        if director_position_text.lower() in {"адрес", "контакты"}:
            director_position_text = ''
        company_data['Должность управляющего'] = director_position_text if director_position_text else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге должности управляющего: {e}")
        company_data['Должность управляющего'] = 'N/A'

    try:
        inn_tag = soup.find('strong', id='copy-inn')
        company_data['ИНН'] = inn_tag.text.strip() if inn_tag else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге ИНН: {e}")
        company_data['ИНН'] = 'N/A'

    try:
        ogrn_tag = soup.find('strong', id='copy-ogrn')
        company_data['ОГРН'] = ogrn_tag.text.strip() if ogrn_tag else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге ОГРН: {e}")
        company_data['ОГРН'] = 'N/A'

    try:
        kpp_tag = soup.find('strong', id='copy-kpp')
        company_data['КПП'] = kpp_tag.text.strip() if kpp_tag else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге КПП: {e}")
        company_data['КПП'] = 'N/A'

    try:
        okpo_tag = soup.find('strong', id='copy-okpo')
        company_data['ОКПО'] = okpo_tag.text.strip() if okpo_tag else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге ОКПО: {e}")
        company_data['ОКПО'] = 'N/A'

    try:
        registration_date_section = (
            soup.find('div', string=re.compile('Дата регистрации')).find_next_sibling('div')
            if soup.find('div', string=re.compile('Дата регистрации')) else None
        )
        company_data['Дата регистрации'] = (
            registration_date_section.text.strip() if registration_date_section else 'N/A'
        )
    except Exception as e:
        logger.error(f"Ошибка при парсинге даты регистрации: {e}")
        company_data['Дата регистрации'] = 'N/A'

    try:
        phones_section = (
            (soup.find('strong', string='Телефоны') or soup.find('strong', string='Телефон')).find_parent('div')
            if (soup.find('strong', string='Телефоны') or soup.find('strong', string='Телефон')) else None
        )
        if phones_section:
            phone_links = phones_section.find_all('a', href=re.compile('tel:'))
            company_data['Телефоны'] = ', '.join(a_tag.text.strip() for a_tag in phone_links) if phone_links else 'N/A'
        else:
            company_data['Телефоны'] = 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге телефонов: {e}")
        company_data['Телефоны'] = 'N/A'

    try:
        email_strong = soup.find('strong', string='Электронная почта')
        if email_strong:
            email_links = email_strong.find_all_next('a', href=re.compile(r'^mailto:'))
            if email_links:
                company_data['E-mail'] = ', '.join(email_link.text.strip() for email_link in email_links)
            else:
                company_data['E-mail'] = 'N/A'
        else:
            company_data['E-mail'] = 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге электронной почты: {e}")
        company_data['E-mail'] = 'N/A'

    try:
        website_strong = soup.find('strong', string='Веб-сайт')
        if website_strong:
            next_element = website_strong.find_next()
            if next_element and next_element.name == 'a':
                company_data['Веб-сайты'] = next_element.text.strip()
            else:
                company_data['Веб-сайты'] = 'N/A'
        else:
            company_data['Веб-сайты'] = 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге веб-сайтов: {e}")
        company_data['Веб-сайты'] = 'N/A'

    try:
        address_section = soup.find('span', id='copy-address')
        company_data['Юридический адрес'] = address_section.text.strip() if address_section else 'N/A'
    except Exception as e:
        logger.error(f"Ошибка при парсинге юридического адреса: {e}")
        company_data['Юридический адрес'] = 'N/A'

    try:
        financials_section = soup.find('section', id='finances')
        if financials_section:
            financials_table = financials_section.find('div', class_='attention')
            if financials_table:
                selected_year = financials_table.find('i', id='ah')
                selected_year_value = selected_year.get_text().strip() if selected_year else None

                revenue_mark = financials_table.find('em', string='Выручка')
                revenue_value_link = revenue_mark.find_next('a') if revenue_mark else None
                revenue_value = revenue_value_link.get_text().strip() if revenue_value_link else None

                profit_mark = financials_table.find('em', string='Чистая прибыль')
                profit_value_link = profit_mark.find_next('a') if profit_mark else None
                profit_value = profit_value_link.get_text().strip() if profit_value_link else None

                capital_mark = financials_table.find('em', string='Капитал')
                capital_value_link = capital_mark.find_next('a') if capital_mark else None
                capital_value = capital_value_link.get_text().strip() if capital_value_link else None

                company_data['Выручка'] = (
                    f"{revenue_value} за {selected_year_value}"
                    if revenue_value and selected_year_value else "N/A"
                )
                company_data['Чистая прибыль'] = (
                    f"{profit_value} за {selected_year_value}"
                    if profit_value and selected_year_value else "N/A"
                )
                company_data['Капитал'] = (
                    f"{capital_value} за {selected_year_value}"
                    if capital_value and selected_year_value else "N/A"
                )
            else:
                company_data['Выручка'] = "N/A"
                company_data['Чистая прибыль'] = "N/A"
                company_data['Капитал'] = "N/A"
        else:
            company_data['Выручка'] = "N/A"
            company_data['Чистая прибыль'] = "N/A"
            company_data['Капитал'] = "N/A"
    except Exception as e:
        logger.error(f"Ошибка при парсинге финансовых показателей: {e}")
        company_data['Выручка'] = "N/A"
        company_data['Чистая прибыль'] = "N/A"
        company_data['Капитал'] = "N/A"

    return company_data


async def parse_company_page_async(session, url, proxy_manager, okved_code):
    try:
        content = await make_request(
            session, url, proxy_manager=proxy_manager,
            retries=10, backoff_factor=0.5, max_no_proxy=20
        )
        if not content:
            return None
        company_data = parse_company_page(content)
        company_data['OKVED'] = okved_code
        await asyncio.sleep(random.uniform(1, 2))
        logger.info(f"Parsed company data from: {url}")
        return company_data
    except Exception as e:
        logger.error(f"Error parsing company page {url}: {e}")
        return None


async def collect_and_enqueue_links(session, OKVED_2, proxy_manager, queue, link_collection_semaphore):
    async with link_collection_semaphore:
        logger.info(f"[OKVED: {OKVED_2}] Starting link collection.")
        try:
            base_url = "https://checko.ru/company/select"
            formatted_okved = format_okved(OKVED_2)
            params = {
                'code': formatted_okved,
                'active': 'true',
                'page': 1
            }

            content = await make_request(
                session, base_url, params=params, proxy_manager=proxy_manager,
                retries=7, backoff_factor=0.5, max_no_proxy=20
            )
            if not content:
                logger.error(f"[OKVED: {OKVED_2}] First page content is None. Link collection aborted.")
                return
            soup = BeautifulSoup(content, 'html.parser')

            pagination = soup.find('ul', class_='pagination')
            if pagination:
                page_links = pagination.find_all('a', href=True)
                page_numbers = []
                for link in page_links:
                    href = link['href']
                    match = re.search(r'page=(\d+)', href)
                    if match:
                        page_numbers.append(int(match.group(1)))
                total_pages = max(page_numbers) if page_numbers else 1
            else:
                total_pages = 1

            logger.info(f"[OKVED: {OKVED_2}] Total pages: {total_pages}")

            company_links = extract_company_links(soup)
            for link in company_links:
                await queue.put((link, OKVED_2))
            logger.info(f"[OKVED: {OKVED_2}] Enqueued {len(company_links)} links from page 1.")

            tasks = []
            for page in range(2, total_pages + 1):
                tasks.append(
                    asyncio.create_task(
                        process_okved_page(session, base_url, formatted_okved,
                                           page, proxy_manager, queue, OKVED_2)
                    )
                )

            if tasks:
                await asyncio.gather(*tasks)

            logger.info(f"[OKVED: {OKVED_2}] Link collection completed.")

        except Exception as e:
            logger.error(f"[OKVED: {OKVED_2}] Error during link collection: {e}")


async def process_okved_page(session, base_url, formatted_okved, page, proxy_manager, queue, OKVED_2):
    params = {
        'code': formatted_okved,
        'active': 'true',
        'page': page
    }
    try:
        content = await make_request(
            session, base_url, params=params, proxy_manager=proxy_manager,
            retries=7, backoff_factor=0.5, max_no_proxy=20
        )
        if not content:
            logger.error(f"[OKVED: {OKVED_2}] Page {page} content is None. Skipping.")
            return

        soup = BeautifulSoup(content, 'html.parser')
        stop_element = soup.find('p', class_='mt-4')
        if stop_element and "не найдено ни одной организации" in stop_element.get_text().lower():
            logger.info(f"[OKVED: {OKVED_2}] No organizations found on page {page}.")
            return

        company_links = extract_company_links(soup)
        for link in company_links:
            await queue.put((link, OKVED_2))

        logger.info(f"[OKVED: {OKVED_2}] Enqueued {len(company_links)} links from page {page}.")

    except Exception as e:
        logger.error(f"[OKVED: {OKVED_2}] Error processing page {page}: {e}")


def extract_company_links(soup):
    company_links = []
    data_table = soup.find_all('td', class_='count')
    for count_tag in data_table:
        company_tag = count_tag.find_next_sibling('td').find('a', class_='link')
        if company_tag and 'href' in company_tag.attrs:
            link = company_tag['href']
            full_link = f"https://checko.ru{link}"
            company_links.append(full_link)
    return company_links


async def worker_parse(session, proxy_manager, queue, semaphore, results, pbar, pbar_lock):
    while True:
        item = await queue.get()
        if item is None:
            queue.task_done()
            break

        url, okved_code = item
        async with semaphore:
            company_data = await parse_company_page_async(session, url, proxy_manager, okved_code)
            if company_data:
                results.append(company_data)

        queue.task_done()

        async with pbar_lock:
            pbar.update(1)
            pbar.refresh()


async def pipeline_main(batch_number=None):
    persona = get_headers_proxy()
    proxies = persona["ip"] if persona and "ip" in persona else []
    user_agents = persona["user-agent"] if persona and "user-agent" in persona else []

    if not proxies or not user_agents:
        logger.error("No available proxies or User-Agent. Please check the configuration.")
        sys.exit(1)

    proxy_manager = ProxyManager(
        [{"ip": ip, "user-agent": random.choice(user_agents)} for ip in proxies],
        slots_per_proxy=2,
        cooldown_minutes=0.5,
        max_failures=5,
    )

    total_start_time = datetime.now()
    logger.info("Parser started.")

    okved_codes = load_target_okved_codes()
    if okved_codes:
        logger.info(f"Processing selected OKVED codes: {', '.join(okved_codes)}")
    else:
        logger.error("Список ОКВЭД пустой. Заполните TARGET_OKVED_CODES в checko_runtime_config.py или укажите CHECKO_OKVED_CODES_FILE.")
        sys.exit(1)

    if batch_number is not None:
        try:
            batch_number = int(batch_number)
        except ValueError:
            logger.error(f"Invalid batch number format: {batch_number}. It should be an integer.")
            sys.exit(1)
        total_companies = len(okved_codes)
        batch_size = total_companies // 50 + (total_companies % 50 > 0)
        batches = [okved_codes[i:i + batch_size] for i in range(0, total_companies, batch_size)]
        if batch_number < 1 or batch_number > len(batches):
            logger.error(f"Invalid batch number. It should be between 1 and {len(batches)}.")
            sys.exit(1)
        batch_okved_codes = batches[batch_number - 1]
        logger.info(f"Processing batch {batch_number}/{len(batches)} with {len(batch_okved_codes)} codes.")
    else:
        batch_okved_codes = okved_codes

    timeout = ClientTimeout(total=90)
    connector = aiohttp.TCPConnector(limit=100)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        company_queue = asyncio.Queue()
        semaphore = asyncio.Semaphore(100)
        results = []
        link_collection_semaphore = asyncio.Semaphore(20)

        collector_tasks = [
            asyncio.create_task(
                collect_and_enqueue_links(session, okved_code, proxy_manager, company_queue, link_collection_semaphore)
            )
            for okved_code in batch_okved_codes
        ]
        await asyncio.gather(*collector_tasks)

        total_links = company_queue.qsize()
        pbar = tqdm(
            total=total_links,
            desc="Parsing progress",
            unit="link",
            dynamic_ncols=True
        )
        pbar_lock = asyncio.Lock()

        num_workers = 100
        workers = [
            asyncio.create_task(
                worker_parse(session, proxy_manager, company_queue, semaphore, results, pbar, pbar_lock)
            )
            for _ in range(num_workers)
        ]

        for _ in workers:
            await company_queue.put(None)

        await company_queue.join()
        await asyncio.gather(*workers)
        pbar.close()

        ensure_artifacts_dirs()
        output_dir = CHECKO_RAW_DIR
        os.makedirs(output_dir, exist_ok=True)

        if results:
            df = pd.DataFrame(results)
            grouped = df.groupby('OKVED')
            for okved, group in grouped:
                file_path = output_dir / f"{okved}.csv"

                if os.path.exists(file_path):
                    try:
                        existing_df = pd.read_csv(file_path, encoding="utf-8-sig", sep=';')
                        combined_df = pd.concat([existing_df, group]).drop_duplicates(
                            subset=["ИНН", "Наименование"], keep='last'
                        )
                        logger.info(f"[OKVED: {okved}] Combined data with existing file successfully.")
                    except Exception as e:
                        logger.error(f"[OKVED: {okved}] Error processing existing CSV: {e}")
                        combined_df = group
                else:
                    combined_df = group

                await asyncio.to_thread(
                    combined_df.to_csv, file_path, index=False, encoding="utf-8-sig", sep=';'
                )
                logger.info(f"[OKVED: {okved}] Data saved to {file_path}")
        else:
            logger.warning("No company data collected.")

    total_end_time = datetime.now()
    elapsed_time = (total_end_time - total_start_time).total_seconds()
    logger.info(f"Parser finished. Total execution time: {elapsed_time:.2f} seconds.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Stage 01: сбор компаний с агрегатора Checko.")
    parser.add_argument(
        "--batch",
        type=str,
        default=None,
        help="Опциональный номер batch для checko.ru.py",
    )
    args = parser.parse_args()

    ensure_checko_config()
    ensure_artifacts_dirs()
    asyncio.run(pipeline_main(args.batch))
    print("[OK] Stage 01 completed.")


if __name__ == "__main__":
    main()
