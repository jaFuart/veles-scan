# request.py

import json
import time
import os
import sys
import logging
import re
from urllib.parse import urlparse, urljoin, urlunparse
from pathlib import Path
from typing import Any

import openai
from tiktoken import get_encoding
import urllib3
from seleniumbase import Driver
import pandas as pd
from dotenv import load_dotenv
import requests  # оставляем импорт, если понадобится

from common import ARTIFACTS_DIR, PIPELINE_ENV_FILE, ensure_infoscraper_env

os.makedirs(ARTIFACTS_DIR, exist_ok=True)


logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(ARTIFACTS_DIR / "scraping_debug.log", encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
load_dotenv(dotenv_path=PIPELINE_ENV_FILE)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    logging.error("Переменная OPENAI_API_KEY не найдена в окружении.")
    sys.exit(1)
openai.api_key = OPENAI_API_KEY
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

OPENAI_PROXY = os.getenv("OPENAI_PROXY")
openai_client = None

if OPENAI_PROXY:
    try:
        from openai import OpenAI
        try:
            import httpx
            http_client = httpx.Client(proxies=OPENAI_PROXY, timeout=60.0)
            openai_client = OpenAI(api_key=OPENAI_API_KEY, http_client=http_client)
            logging.info(f"OpenAI будет использовать прокси (httpx): {OPENAI_PROXY}")
        except Exception as e:
            logging.warning(f"Не удалось настроить httpx для OpenAI: {e}")
    except Exception as e:
        logging.debug(f"SDK OpenAI v1.x недоступен: {e}")

    if openai_client is None:
        try:
            openai.proxy = {
                "http": OPENAI_PROXY,
                "https": OPENAI_PROXY,
            }
            os.environ.setdefault("http_proxy", OPENAI_PROXY)
            os.environ.setdefault("https_proxy", OPENAI_PROXY)
            logging.info(f"OpenAI будет использовать прокси через openai.proxy: {OPENAI_PROXY}")
        except Exception as e:
            logging.error(f"Ошибка при настройке прокси для старого SDK OpenAI: {e}")

if openai_client is None:
    openai_client = openai

USE_FILE = True
DATA_FILE = str(ARTIFACTS_DIR / "active_companies_for_gpt.xlsx")
START_URLS = [
    "https://www.15web.ru/",
]
KEYWORDS = [
    "Контакты", "О компании", "О нас", "Связаться", "Реквизиты",
    "Contact", "Contact Us", "About", "About Us"
]

RELATIONS_KEYWORDS = [
    "Клиенты", "Наши клиенты", "Партнеры", "Партнёры", "Портфолио",
    "Проекты", "Кейсы", "Отзывы",
    "Clients", "Our clients", "Partners", "Portfolio", "Projects",
    "Cases", "Case studies", "Testimonials"
]
RELATIONS_URL_HINTS = [
    "client", "clients", "partner", "partners", "portfolio",
    "project", "projects", "case", "cases", "testimonial",
    "otzyv", "otzyvy", "klient", "partn", "proek", "портфолио",
    "клиент", "партнер", "партн", "проекты", "кейсы", "отзывы"
]
RELATIONS_RE = re.compile(
    r"\b(клиент|клиенты|партн|портфолио|проек|кейсы|отзыв|"
    r"clients?|partners?|portfolio|projects?|cases?|testimonials?)\b",
    re.I
)


def is_relevant_link(link_text: str) -> bool:
    return any(keyword.lower() in (link_text or "").lower() for keyword in KEYWORDS)


def is_relations_link(link_text: str) -> bool:
    return any(kw.lower() in (link_text or "").lower() for kw in RELATIONS_KEYWORDS)


MAX_PAGES = 8
MAX_DEPTH = 2
TOKEN_LIMIT = 1_000_000
SAFE_MARGIN = 1_000
OPENAI_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "2400"))
OUTPUT_FILE = str(ARTIFACTS_DIR / "company_info_gpt_raw.json")

EXCLUDED_EXTENSIONS = [
    '.mp4', '.docx', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.zip',
    '.exe', '.xls', '.xlsx', '.ppt', '.pptx', '.avi', '.mov', '.wmv',
    '.flv', '.mkv', '.rar', '.7z', '.tar', '.gz', '.bmp', '.svg',
    '.txt', '.rtf', '.csv', '.json', '.xml'
]

error_domains = []
ENCODING = get_encoding("cl100k_base")


def split_multi(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for part in value:
            out.extend(split_multi(part))
        return out
    text = str(value).replace("mailto:", "").replace("MAILTO:", "")
    return [chunk.strip() for chunk in re.split(r"[,\n;]+", text) if chunk.strip()]


def _normalize_phone(value: str) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _dedup_preserve(values: list[str], normalizer) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = str(item or "").strip()
        if not text:
            continue
        key = normalizer(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _pick_first(row: dict[str, Any], candidates: tuple[str, ...]) -> str:
    lowered = {str(k).strip().lower().replace("ё", "е"): k for k in row.keys()}
    for candidate in candidates:
        key = lowered.get(candidate.lower().replace("ё", "е"))
        if key is None:
            continue
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def _collect_prefixed(row: dict[str, Any], prefixes: tuple[str, ...]) -> list[str]:
    values: list[str] = []
    for raw_key, raw_value in row.items():
        key = str(raw_key).strip().lower().replace("ё", "е")
        if any(key.startswith(prefix.lower().replace("ё", "е")) for prefix in prefixes):
            text = str(raw_value or "").strip()
            if text:
                values.extend(split_multi(text))
    return values


def is_file_link(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in EXCLUDED_EXTENSIONS)


def split_text_by_tokens(text: str) -> list[str]:
    tokens = ENCODING.encode(text)
    chunks = []
    while tokens:
        chunk = tokens[: TOKEN_LIMIT - SAFE_MARGIN]
        chunks.append(ENCODING.decode(chunk))
        tokens = tokens[len(chunk):]
    logging.debug(f"Разбито на {len(chunks)} частей по токенам.")
    return chunks


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    parsed = parsed._replace(fragment='', query='')
    parsed = parsed._replace(path=parsed.path.rstrip('/'))
    normalized = urlunparse(parsed)
    logging.debug(f"Нормализованный URL: {normalized}")
    return normalized


def extract_text(driver: Driver) -> str:
    try:
        body = driver.find_element("tag name", "body")
        text = body.text or ""
        logging.debug(f"Извлечённый текст длиной {len(text)} символов.")
        return text
    except Exception as e:
        logging.error(f"Ошибка при извлечении текста: {e}")
        return ""


def normalize_host_idna(host: str) -> str:
    host = (host or "").split(":", 1)[0].strip().lower()
    if not host:
        return ""
    try:
        return host.encode("idna").decode("ascii")
    except Exception:
        return host


def host_idna_to_unicode(host_idna: str) -> str:
    try:
        return (host_idna or "").encode("ascii").decode("idna")
    except Exception:
        return host_idna or ""


def is_same_domain(start_domain: str, current_url: str) -> bool:
    netloc = urlparse(current_url).netloc
    cur_idna = normalize_host_idna(netloc)
    base_idna = normalize_host_idna(start_domain)
    same = (cur_idna == base_idna) or cur_idna.endswith("." + base_idna) or base_idna.endswith("." + cur_idna)
    cur_u = host_idna_to_unicode(cur_idna)
    base_u = host_idna_to_unicode(base_idna)
    logging.debug(f"Проверка домена: {cur_u} vs {base_u} -> {'Да' if same else 'Нет'}")
    return same


def is_site_unavailable(text: str) -> bool:
    keywords = [
        "временно недоступен", "на стоянке", "parked", "under construction",
        "site is down", "temporarily unavailable", "maintenance", "access denied"
    ]
    t = text.lower()
    for kw in keywords:
        if kw in t:
            logging.debug(f"Ключевое слово '{kw}' указывает на недоступность сайта.")
            return True
    return False


def page_likely_relations(url: str, text: str) -> bool:
    u = (url or "").lower()
    if any(h in u for h in RELATIONS_URL_HINTS):
        return True
    return bool(RELATIONS_RE.search((text or "")[:5000]))


def extract_relation_items(driver: Driver) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for a in driver.find_elements("css selector", "a[href]"):
        txt = (a.text or a.get_attribute("title") or "").strip()
        href = a.get_attribute("href") or ""
        if txt and len(txt) <= 120 and re.search(r"[A-Za-zА-Яа-яЁё]", txt):
            items.append((txt, href))
    for img in driver.find_elements("css selector", "img[alt]"):
        alt = (img.get_attribute("alt") or "").strip()
        if alt and len(alt) <= 120 and re.search(r"[A-Za-zА-Яа-яЁё]", alt):
            items.append((alt, ""))
    seen, deduped = set(), []
    for name, url in items:
        key = name.lower()
        if key not in seen:
            seen.add(key)
            deduped.append((name, url))
    return deduped


def process_text_with_openai(
    text: str,
    known_fields: dict[str, Any],
    fields_to_enrich: list[str],
    max_tokens: int,
):
    compact_known = {
        "organization_name": known_fields.get("organization_name"),
        "inn": known_fields.get("inn"),
        "city": known_fields.get("city"),
        "address": known_fields.get("address"),
        "general_phones": known_fields.get("general_phones", []),
        "general_emails": known_fields.get("general_emails", []),
    }
    system_prompt = (
        "You are a universal company parser and translator.\n\n"
        "Goal: enrich company data, but do not waste output on fields that are already known.\n\n"
        f"Known fields (already in dataset, prefer reusing):\n{json.dumps(compact_known, ensure_ascii=False)}\n\n"
        f"Priority fields to enrich now:\n{json.dumps(fields_to_enrich, ensure_ascii=False)}\n\n"
        "Rules:\n"
        "- Focus on finding NEW phones/emails/employee contacts/clients/partners.\n"
        "- If known INN/name/city/address already provided, return null for them unless website has a clear correction.\n"
        "- If site seems parked/unavailable, set is_working_site=false and keep others null/empty.\n"
        "- Avoid duplicates in phone/email values.\n"
        "- Return STRICT JSON only.\n\n"
        "Return schema:\n"
        "{\n"
        '  "organization_name": null or string,\n'
        '  "is_working_site": bool,\n'
        '  "contact_information": {\n'
        '    "general": {"phone": null or string, "email": null or string},\n'
        '    "employee_contacts": [\n'
        '      {"name": null or string, "job_title": null or string, "phone": null or string, "email": null or string}\n'
        "    ]\n"
        "  },\n"
        '  "company_description": null or string,\n'
        '  "address": null or string,\n'
        '  "city": null or string,\n'
        '  "inn": null or string,\n'
        '  "relations": {\n'
        '    "clients": [ { "name": string, "url": null or string, "note": null or string } ],\n'
        '    "partners": [ { "name": string, "url": null or string, "note": null or string } ]\n'
        "  }\n"
        "}"
    )
    try:
        return openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": text}
            ],
            temperature=0,
            max_tokens=max_tokens
        )
    except Exception as e:
        logging.error(f"Ошибка при запросе к OpenAI: {e}")
        return None


def extract_useful_information(response) -> dict | None:
    try:
        content = response.choices[0].message.content or ""
        logging.debug(f"Содержимое ответа: {content}")

        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL | re.IGNORECASE)
        if m:
            raw = m.group(1)
        else:
            i1, i2 = content.find("{"), content.rfind("}")
            if i1 != -1 and i2 != -1 and i2 > i1:
                raw = content[i1:i2+1]
            else:
                raw = content.strip()

        try:
            data = json.loads(raw)
        except Exception:
            no_line_comments = re.sub(r"^\s*//.*$", "", raw, flags=re.MULTILINE)
            no_trailing_commas = re.sub(r",\s*([}\]])", r"\1", no_line_comments)
            cleaned = no_trailing_commas.strip()
            data = json.loads(cleaned)

        data.setdefault("relations", {"clients": [], "partners": []})
        if not isinstance(data["relations"], dict):
            data["relations"] = {"clients": [], "partners": []}
        data["relations"].setdefault("clients", [])
        data["relations"].setdefault("partners", [])
        if not isinstance(data["relations"]["clients"], list):
            data["relations"]["clients"] = []
        if not isinstance(data["relations"]["partners"], list):
            data["relations"]["partners"] = []

        ci = data.get("contact_information", {})
        if not isinstance(ci, dict):
            ci = {}
            data["contact_information"] = ci
        general = ci.get("general", {})
        if not isinstance(general, dict):
            general = {}
            ci["general"] = general
        # Remove duplicate separators and duplicated values right after LLM response.
        phones = _dedup_preserve(split_multi(general.get("phone")), _normalize_phone)
        emails = _dedup_preserve(split_multi(general.get("email")), _normalize_email)
        general["phone"] = "; ".join(phones) if phones else None
        general["email"] = "; ".join(emails) if emails else None
        if "employee_contacts" not in ci or not isinstance(ci["employee_contacts"], list):
            ci["employee_contacts"] = []
        normalized_employees = []
        for emp in ci["employee_contacts"]:
            if not isinstance(emp, dict):
                continue
            emp_phones = _dedup_preserve(split_multi(emp.get("phone")), _normalize_phone)
            emp_emails = _dedup_preserve(split_multi(emp.get("email")), _normalize_email)
            emp["phone"] = "; ".join(emp_phones) if emp_phones else None
            emp["email"] = "; ".join(emp_emails) if emp_emails else None
            normalized_employees.append(emp)
        ci["employee_contacts"] = normalized_employees

        logging.debug(f"Извлечённые данные: {data}")
        return data

    except Exception as e:
        logging.error(f"Ошибка при извлечении информации: {e}")
        try:
            with open(ARTIFACTS_DIR / "last_model_response_raw.txt", "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass
        return None


def save_to_json(data: list, path: str) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        logging.info(f"Данные успешно сохранены в файл: {path}")
    except Exception as e:
        logging.error(f"Ошибка при сохранении файла: {e}")


def load_targets_from_file(path: str) -> list[dict[str, Any]]:
    try:
        df = pd.read_excel(path)
        if "Web" not in df.columns:
            logging.error(f"Столбец 'Web' не найден в файле {path}.")
            sys.exit(1)
        targets: list[dict[str, Any]] = []
        for _, row in df.fillna("").iterrows():
            row_dict = {str(k): v for k, v in row.to_dict().items()}
            web = str(row_dict.get("Web") or "").strip()
            if not web:
                continue
            if not web.startswith(("http://", "https://")):
                web = f"http://{web}"
            known_fields = {
                "organization_name": _pick_first(
                    row_dict, ("Наименование", "Название", "Название компании", "Company", "Организация")
                ),
                "inn": _pick_first(row_dict, ("ИНН", "Inn", "INN")),
                "city": _pick_first(row_dict, ("Город", "City")),
                "address": _pick_first(row_dict, ("Адрес", "Юридический адрес", "Address")),
                "general_phones": _dedup_preserve(
                    _collect_prefixed(
                        row_dict,
                        (
                            "Телефон",
                            "Phone",
                            "AdditionalPhone",
                            "json_general_phone_",
                        ),
                    ),
                    _normalize_phone,
                ),
                "general_emails": _dedup_preserve(
                    _collect_prefixed(
                        row_dict,
                        (
                            "Email",
                            "E-mail",
                            "json_general_email_",
                        ),
                    ),
                    _normalize_email,
                ),
            }
            targets.append({"url": web, "known_fields": known_fields})
        logging.info(f"Загружено {len(targets)} URL из файла {path}.")
        return targets
    except Exception as e:
        logging.error(f"Ошибка при загрузке файла {path}: {e}")
        sys.exit(1)


def scrape_and_process():
    driver = Driver(
        uc=True,
        headless2=True,
        disable_gpu=True,
        block_images=True,
        page_load_strategy='eager',
    )
    driver.maximize_window()
    all_companies_info = []
    try:
        targets = load_targets_from_file(DATA_FILE) if USE_FILE else [{"url": u, "known_fields": {}} for u in START_URLS]
        for target in targets:
            start_url = target["url"]
            known_fields = target.get("known_fields", {}) or {}
            logging.info(f"\nОбработка компании: {start_url}")
            attempt = 0
            while attempt < 3:
                attempt += 1
                try:
                    norm_url = normalize_url(start_url)
                    domain = urlparse(norm_url).netloc
                    visited, to_visit, to_visit_set = set(), [(norm_url, 0)], {norm_url}
                    collected, page_count = [], 0
                    site_unavailable = False
                    relation_items: list[tuple[str, str]] = []

                    while to_visit and page_count < MAX_PAGES:
                        url, depth = to_visit.pop(0)
                        to_visit_set.discard(url)
                        if url in visited or depth > MAX_DEPTH:
                            continue
                        try:
                            driver.get(url)
                            time.sleep(2)
                            cur = driver.current_url
                            if not is_same_domain(domain, cur):
                                visited.add(url)
                                continue
                            text = extract_text(driver)
                            if not text:
                                visited.add(url)
                                continue
                            if is_site_unavailable(text):
                                site_unavailable = True
                                break

                            if page_likely_relations(cur, text):
                                try:
                                    relation_items.extend(extract_relation_items(driver))
                                except Exception as _e:
                                    logging.debug(f"Не удалось извлечь relation_items: {_e}")

                            collected.append(text)
                            page_count += 1

                            for link in driver.find_elements("css selector", "a[href]"):
                                href = link.get_attribute("href") or ""
                                txt = (link.get_attribute("textContent") or "").strip()
                                if href and txt and (is_relevant_link(txt) or is_relations_link(txt)):
                                    full = normalize_url(urljoin(url, href))
                                    if is_same_domain(domain, full) and not is_file_link(full):
                                        if full not in visited and full not in to_visit_set:
                                            to_visit.append((full, depth + 1))
                                            to_visit_set.add(full)
                            visited.add(url)
                        except Exception as e:
                            logging.error(f"Ошибка при загрузке {url}: {e}")

                    if site_unavailable or len("".join(collected)) < 50:
                        info = {
                            "start_url": start_url,
                            "company_info": [{
                                "organization_name": None,
                                "is_working_site": False,
                                "contact_information": {
                                    "general": {"phone": None, "email": None},
                                    "employee_contacts": []
                                },
                                "company_description": None,
                                "address": None,
                                "city": None,
                                "inn": None,
                                "relations": {"clients": [], "partners": []}
                            }]
                        }
                        all_companies_info.append(info)
                        save_to_json(all_companies_info, OUTPUT_FILE)
                        break

                    collected_text = "\n".join(collected)
                    if relation_items:
                        rel_lines = [f"{name} | {url}" if url else name for name, url in relation_items]
                        collected_text += "\n\n[RELATION_ITEMS]\n" + "\n".join(rel_lines[:400])

                    chunks = split_text_by_tokens(collected_text)
                    fields_to_enrich = ["contact_information", "relations", "is_working_site", "company_description"]
                    if not str(known_fields.get("organization_name") or "").strip():
                        fields_to_enrich.append("organization_name")
                    if not str(known_fields.get("inn") or "").strip():
                        fields_to_enrich.append("inn")
                    if not str(known_fields.get("city") or "").strip():
                        fields_to_enrich.append("city")
                    if not str(known_fields.get("address") or "").strip():
                        fields_to_enrich.append("address")
                    token_budget = min(OPENAI_MAX_TOKENS, 1200)
                    if "company_description" in fields_to_enrich:
                        token_budget = min(OPENAI_MAX_TOKENS, 1600)
                    if "organization_name" in fields_to_enrich or "address" in fields_to_enrich or "city" in fields_to_enrich:
                        token_budget = min(OPENAI_MAX_TOKENS, 1900)
                    logging.info(
                        "Known fields: inn=%s city=%s address=%s phones=%d emails=%d; enrich=%s",
                        "yes" if known_fields.get("inn") else "no",
                        "yes" if known_fields.get("city") else "no",
                        "yes" if known_fields.get("address") else "no",
                        len(known_fields.get("general_phones", []) or []),
                        len(known_fields.get("general_emails", []) or []),
                        ",".join(fields_to_enrich),
                    )
                    logging.info("OpenAI token budget for this site: %d", token_budget)
                    resp = process_text_with_openai(
                        chunks[0],
                        known_fields=known_fields,
                        fields_to_enrich=fields_to_enrich,
                        max_tokens=token_budget,
                    )
                    data = extract_useful_information(resp) if resp else None

                    if data:
                        meaningful = any([
                            data.get("organization_name"),
                            data.get("contact_information", {}).get("general", {}).get("phone"),
                            data.get("contact_information", {}).get("general", {}).get("email"),
                            data.get("company_description"),
                            data.get("address"),
                            data.get("city"),
                            data.get("inn"),
                        ])
                        if meaningful:
                            data["is_working_site"] = True
                        else:
                            data = {
                                "organization_name": None,
                                "is_working_site": False,
                                "contact_information": {
                                    "general": {"phone": None, "email": None},
                                    "employee_contacts": []
                                },
                                "company_description": None,
                                "address": None,
                                "city": None,
                                "inn": None,
                                "relations": {"clients": [], "partners": []}
                            }
                        data.setdefault("relations", {"clients": [], "partners": []})
                        if "clients" not in data["relations"] or not isinstance(data["relations"]["clients"], list):
                            data["relations"]["clients"] = []
                        if "partners" not in data["relations"] or not isinstance(data["relations"]["partners"], list):
                            data["relations"]["partners"] = []
                        ci = data.get("contact_information", {})
                        if "employee_contacts" in ci and not isinstance(ci.get("employee_contacts"), list):
                            ci["employee_contacts"] = []
                            data["contact_information"] = ci
                    else:
                        raise ValueError("Не удалось получить структурированные данные")

                    all_companies_info.append({
                        "start_url": start_url,
                        "company_info": [data]
                    })
                    save_to_json(all_companies_info, OUTPUT_FILE)
                    logging.info(f"Успешно обработано: {start_url}")
                    break

                except Exception as e:
                    logging.error(f"Попытка {attempt} для {start_url} провалилась: {e}")
                    if attempt >= 3:
                        error_domains.append(start_url)
                    else:
                        time.sleep(5)

    finally:
        driver.quit()
        logging.info("WebDriver закрыт.")

    save_to_json(all_companies_info, OUTPUT_FILE)
    if error_domains:
        logging.warning("Ошибки при обработке доменов:")
        for d in error_domains:
            logging.warning(f" - {d}")
    else:
        logging.info("Обработка завершена без ошибок.")


if __name__ == "__main__":
    ensure_infoscraper_env(require_openai=True)
    start = time.time()
    scrape_and_process()
    logging.info(f"Время выполнения: {time.time() - start:.2f} сек.")
