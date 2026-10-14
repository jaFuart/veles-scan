from __future__ import annotations

import json
import re
from typing import Any

from openai import OpenAI

from services.shared.settings import SETTINGS


SUPPORTED_OPERATORS = ["contains", "not_contains", "eq", "neq", "gt", "gte", "lt", "lte"]
SUPPORTED_BOOLEAN_MODES = ["must", "should", "must_not"]
NEGATION_MARKERS = (
    " не ",
    " без ",
    " кроме ",
    " исключая ",
    " excluding ",
    " without ",
    " not ",
)
OR_MARKERS = (" или ", " либо ", " or ")


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().replace("ё", "е")).strip()


def _normalize_boolean_mode(raw: str) -> str | None:
    value = str(raw or "").strip().lower()
    if value in {"and", "must", "all", "required"}:
        return "must"
    if value in {"or", "should", "any", "optional"}:
        return "should"
    if value in {"not", "must_not", "exclude", "exclude_if", "without"}:
        return "must_not"
    return None


def _looks_related_to_intent(fragment: str, intent: str) -> bool:
    fragment_norm = _normalize_text(fragment)
    intent_norm = _normalize_text(intent)
    if not fragment_norm or not intent_norm:
        return False
    if fragment_norm in intent_norm or intent_norm in fragment_norm:
        return True
    fragment_tokens = [tok for tok in re.findall(r"[a-zа-я0-9-]+", fragment_norm, flags=re.I) if len(tok) >= 4]
    return any(tok in intent_norm for tok in fragment_tokens)


def _collect_context_windows(intent: str, fragments: list[str]) -> list[str]:
    normalized_intent = f" {_normalize_text(intent)} "
    windows: list[str] = []
    for fragment in fragments:
        normalized_fragment = _normalize_text(fragment)
        if len(normalized_fragment) < 3:
            continue
        start = 0
        while True:
            idx = normalized_intent.find(normalized_fragment, start)
            if idx < 0:
                break
            left = max(0, idx - 48)
            right = min(len(normalized_intent), idx + len(normalized_fragment) + 48)
            windows.append(normalized_intent[left:right])
            start = idx + len(normalized_fragment)
    return windows


def _window_has_any_marker(window: str, markers: tuple[str, ...]) -> bool:
    text = f" {window.strip()} "
    return any(marker in text for marker in markers)


def _infer_boolean_mode_from_context(item: dict[str, Any], intent: str) -> str | None:
    # Negation markers ("без", "не", "кроме" ...) appear immediately BEFORE the negated
    # value in Russian. Only check left context (≤30 chars) to avoid false positives from
    # unrelated parts of the same intent. Also try a stem variant (last 2 chars stripped)
    # to handle Russian inflection (e.g. "ликвидации" vs stored value "ликвидация").
    normalized_intent = f" {_normalize_text(intent)} "
    fragments = [
        str(item.get("_source_phrase") or ""),
        str(item.get("value") or ""),
    ]
    for fragment in fragments:
        normalized_fragment = _normalize_text(fragment)
        if len(normalized_fragment) < 3:
            continue
        candidates = [normalized_fragment]
        if len(normalized_fragment) > 5:
            candidates.append(normalized_fragment[:-2])  # stem: strip inflection ending
        for candidate in candidates:
            start = 0
            while True:
                idx = normalized_intent.find(candidate, start)
                if idx < 0:
                    break
                left_context = normalized_intent[max(0, idx - 30): idx]
                if _window_has_any_marker(left_context, NEGATION_MARKERS):
                    return "must_not"
                start = idx + len(candidate)
    return None


def _intent_has_or_marker(intent: str) -> bool:
    normalized = f" {_normalize_text(intent)} "
    return any(marker in normalized for marker in OR_MARKERS)


def _rebalance_boolean_modes(intent: str, filters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not filters:
        return []

    rebalanced: list[dict[str, Any]] = []
    for item in filters:
        updated = dict(item)
        if not bool(updated.get("_boolean_explicit")):
            inferred = _infer_boolean_mode_from_context(updated, intent)
            if inferred:
                updated["boolean"] = inferred
        rebalanced.append(updated)

    if _intent_has_or_marker(intent):
        groups: dict[tuple[str, str, str], list[int]] = {}
        for index, item in enumerate(rebalanced):
            if bool(item.get("_boolean_explicit")) or str(item.get("boolean", "must")) == "must_not":
                continue
            operator = str(item.get("operator", "")).strip().lower()
            if operator not in {"contains", "eq"}:
                continue
            column = _normalize_text(str(item.get("column", "")))
            value_type = str(item.get("value_type", "")).strip().lower()
            if not column:
                continue
            groups.setdefault((column, operator, value_type), []).append(index)

        for indexes in groups.values():
            if len(indexes) < 2:
                continue
            for index in indexes:
                if str(rebalanced[index].get("boolean", "must")) == "must":
                    rebalanced[index]["boolean"] = "should"

    finalized: list[dict[str, Any]] = []
    for item in rebalanced:
        finalized.append({key: value for key, value in item.items() if not str(key).startswith("_")})
    return finalized


def _is_city_like_column(column_name: str) -> bool:
    norm = _normalize_text(column_name)
    return (
        ("город" in norm)
        or ("населен" in norm and "пункт" in norm)
        or ("юридическ" in norm and "адрес" in norm)
        or ("адрес" in norm)
        or ("регион" in norm)
    )


def _to_city_search_value(raw_city: str) -> str:
    city = raw_city.strip()
    if len(city) < 3:
        return city
    lower = city.lower()
    # Prefer nominative-like normalization so logs and filters are human-friendly:
    # "Ухты" -> "Ухта", "Пензы" -> "Пенза", "Москве" -> "Москва".
    rules: list[tuple[str, str]] = [
        ("ии", "ия"),
        ("ой", "ая"),
        ("ей", "ея"),
        ("ы", "а"),
        ("и", "а"),
        ("е", "а"),
        ("у", "а"),
        ("ю", "я"),
    ]
    for suffix, replacement in rules:
        if lower.endswith(suffix) and len(city) > len(suffix) + 1:
            normalized = city[: -len(suffix)] + replacement
            return normalized[:1].upper() + normalized[1:]

    # Fallback: slightly stem ending vowels to survive case forms.
    stem = re.sub(r"[аеёиоуыэюяйь]+$", "", city, flags=re.I).strip()
    if len(stem) >= 4:
        return stem[:1].upper() + stem[1:]
    return city[:1].upper() + city[1:]


def _extract_json_object(content: str) -> dict[str, Any] | None:
    if not content:
        return None
    content = content.strip()
    try:
        payload = json.loads(content)
        return payload if isinstance(payload, dict) else None
    except Exception:
        pass
    match = re.search(r"\{.*\}", content, re.S)
    if not match:
        return None
    try:
        payload = json.loads(match.group())
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _to_safe_filter(item: dict[str, Any], available_columns: list[str], intent: str) -> dict[str, Any] | None:
    operator = str(item.get("operator", "")).strip().lower()
    if operator not in set(SUPPORTED_OPERATORS):
        return None

    # LLM may return either {"column": "..."} or legacy {"field_key": "..."}.
    raw_column = str(item.get("column", "")).strip() or str(item.get("field_key", "")).strip()
    if not raw_column:
        return None
    value = item.get("value")
    if value is None:
        return None

    raw_boolean = str(
        item.get("boolean", "")
        or item.get("logic", "")
        or item.get("combine", "")
        or item.get("logical_operator", "")
    ).strip().lower()
    if bool(item.get("negated")) and not raw_boolean:
        raw_boolean = "must_not"
    normalized_boolean = _normalize_boolean_mode(raw_boolean)
    boolean_mode = normalized_boolean or "must"
    boolean_explicit = normalized_boolean is not None or bool(item.get("negated"))

    value_type = str(item.get("value_type", "")).strip().lower()
    if value_type not in {"text", "number"}:
        if isinstance(value, (int, float)):
            value_type = "number"
        else:
            value_type = "text"

    if value_type == "number":
        try:
            numeric = float(value)
        except Exception:
            return None
        if numeric != numeric:  # NaN
            return None
        safe_value: Any = numeric
    else:
        text_value = str(value).strip()
        # Allow empty string only for explicit eq/neq checks (e.g. website exists: neq "").
        if not text_value and operator not in {"eq", "neq"}:
            return None
        safe_value = text_value

    raw_group = str(item.get("group", "")).strip().lower()
    group = ""
    if raw_group:
        group = re.sub(r"[^a-z0-9_-]+", "_", raw_group)[:32].strip("_")

    # Keep original "column" token. Real dataframe column resolution happens in stage_02.
    # We still check that this request references something plausible to reduce noise.
    normalized_request = raw_column.lower().replace("ё", "е")
    plausible = any(
        normalized_request in str(col).lower().replace("ё", "е")
        or str(col).lower().replace("ё", "е") in normalized_request
        for col in available_columns
    )
    if not plausible and len(available_columns) > 0:
        return None

    # Normalize Russian city forms for contains filters: "Ухты" -> "Ухт".
    if value_type == "text" and operator == "contains" and _is_city_like_column(raw_column):
        safe_value = _to_city_search_value(str(safe_value))

    safe_filter = {
        "column": raw_column,
        "operator": operator,
        "value": safe_value,
        "value_type": value_type,
        "boolean": boolean_mode,
        "_boolean_explicit": boolean_explicit,
        "_source_phrase": str(
            item.get("source_phrase", "")
            or item.get("condition_text", "")
            or item.get("user_fragment", "")
        ).strip(),
    }
    if group:
        safe_filter["group"] = group
    return safe_filter


def resolve_data_filters_for_intent(
    intent: str,
    available_columns: list[str],
) -> tuple[list[dict[str, Any]], list[str], str | None, str]:
    """
    Returns:
      (applicable_filters, ignored_conditions, warning_for_user, source)
    """
    if not SETTINGS.openai_api_key:
        return [], [], None, "disabled_no_openai"

    client = OpenAI(api_key=SETTINGS.openai_api_key)
    columns_for_prompt = available_columns[:180]
    prompt = f"""
You are a strict query-to-filter mapper.
Convert user intent into MINIMAL and LOGICALLY VALID dataset filters.

User intent:
{intent}

Allowed dataset columns:
[
  "Название компании",
  "Юридическое наименование",
  "Статус",
  "ИНН",
  "ИНН управляющего",
  "ФИО управляющего",
  "Должность управляющего",
  "ОГРН",
  "КПП",
  "ОКПО",
  "Дата регистрации",
  "ОКВЭД",
  "Юридический адрес",
  "Город",
  "Сайт",
  "Телефон",
  "Email",
  "Выручка",
  "Чистая прибыль",
  "Капитал",
  "Описание компании",
  "Сайт работает",
  "Контактное лицо",
  "Должность",
  "Телефон контактного лица",
  "Email контактного лица",
  "Клиенты",
  "Партнёры"
]

Supported operators:
{", ".join(SUPPORTED_OPERATORS)}

Supported boolean modes:
{", ".join(SUPPORTED_BOOLEAN_MODES)}

Main rule:
Extract only filters that can be mapped DIRECTLY, EXPLICITLY and RELIABLY to allowed columns.
If there is no exact supported field, do not create a filter.

Rules:
- Return only minimal applicable filters.
- One filter = one column + one operator + one atomic value.
- If a filtering instruction is not explicitly stated in user intent, do not include it in applicable_filters.
- Put only the core value into value.
- Never put large fragments of the request into value.
- Never invent filters from section words like: "источники", "требования", "исключать", "наличие".
- If a condition cannot be mapped directly to a column, put it into ignored_conditions.
- ignored_conditions must be short and in Russian.
- If nothing is applicable, return empty applicable_filters.
- No speculative mapping.
- No semantic expansion.
- No inferred filters.

Strict field rules:
- "Юридическое наименование" use only if the user explicitly asks for legal name or gives a legal-form name fragment like ООО, АО, ПАО, ЗАО, ИП.
- "Название компании" use only for explicit company-name search.
- "ОКВЭД" use only if the user explicitly mentions ОКВЭД or provides an ОКВЭД code.
- Never map business type/activity words like "автошколы", "строительные", "медицинские", "банки" to "ОКВЭД".
- Never map business type/activity words to "Описание компании" unless the user explicitly asks to search in description/company text.
- All geographic filters may go only to "Юридический адрес", and only if the request contains a concrete place name.
- Do not convert derived geographic logic like population thresholds into filters.
- Do not use "Город" for automatic geography extraction.
- Use "Город" only if the user explicitly asks to filter by the dataset field "Город".
- "ИНН", "ИНН управляющего", "ОГРН", "КПП", "ОКПО" are exact identifiers.
- "ФИО управляющего" and "Контактное лицо" are only for person names.
- "Должность управляющего" and "Должность" are only for job titles.
- "Сайт", "Телефон", "Email", "Телефон контактного лица", "Email контактного лица" use only for explicit contact-related conditions.
- "Дата регистрации" only for explicit registration-date conditions.
- "Выручка", "Чистая прибыль", "Капитал" only for numeric conditions.
- "Сайт работает" only for explicit site availability conditions.
- "Клиенты" and "Партнёры" only for explicit matching in these fields.

Presence/absence rules:
- If the user requires that a website must exist, use:
  column = "Сайт", operator = "neq", value = "", value_type = "text", boolean = "must"
- If the user excludes records without a website, map only to "Сайт".
- Do not invent filters for "только один адрес", "без филиалов", "один офис" unless there is an exact field for that.

Ignore these when no exact field exists:
- source lists and source requirements
- registries and marketplaces
- license/accreditation requirements
- education categories
- external validation requirements
- population thresholds
- derived business classification

Operator rules:
- contains / not_contains = substring text match
- eq / neq = exact text, exact identifier, exact number, or empty value check
- gt / gte / lt / lte = numeric only

Boolean rules:
- must = required
- should = OR alternative
- must_not = exclusion
- If unsure, use must.
- Use group only for OR conditions within the same dimension.

Return STRICT JSON only:
{{
  "applicable_filters": [
    {{
      "column": "string",
      "operator": "string",
      "value": "string|number|boolean",
      "value_type": "text|number|date|identifier|boolean",
      "boolean": "must|should|must_not",
      "group": "string optional",
      "source_phrase": "string optional"
    }}
  ],
  "ignored_conditions": ["string"]
}}

Output rules:
- No explanations.
- No markdown.
- No comments.
- No extra keys.
""".strip()
    try:
        response = client.chat.completions.create(
            model=SETTINGS.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
            timeout=35,
        )
    except Exception:
        return [], [], None, "llm_error"

    payload = _extract_json_object(response.choices[0].message.content or "")
    if not payload:
        return [], [], None, "unresolved"

    raw_filters = payload.get("applicable_filters", [])
    raw_ignored = payload.get("ignored_conditions", [])
    safe_filters: list[dict[str, Any]] = []
    if isinstance(raw_filters, list):
        for item in raw_filters:
            if not isinstance(item, dict):
                continue
            safe = _to_safe_filter(item, available_columns=available_columns, intent=intent)
            if safe:
                safe_filters.append(safe)
    safe_filters = _rebalance_boolean_modes(intent, safe_filters)

    ignored: list[str] = []
    if isinstance(raw_ignored, list):
        for item in raw_ignored:
            text = str(item).strip()
            if text:
                ignored.append(text)
    ignored = list(dict.fromkeys(ignored))[:10]
    ignored = [item for item in ignored if _looks_related_to_intent(item, intent)]
    domain_markers = (
        "финанс",
        "банк",
        "образ",
        "школ",
        "автошкол",
        "автомастер",
        "автосервис",
        "медицин",
        "стомат",
    )
    ignored = [item for item in ignored if not any(marker in item.lower() for marker in domain_markers)]

    warning = None
    if ignored:
        joined = "; ".join(ignored[:3])
        suffix = " и др." if len(ignored) > 3 else ""
        warning = f"Некоторые условия не будут учтены, так как для них нет поддерживаемых столбцов: {joined}{suffix}"

    return safe_filters, ignored, warning, "openai_intent_filters"

