"""
Отправляет запрос в LLM с тем же системным промптом, что и intent_data_filters.py.
Выводит RAW ответ от LLM без какой-либо постобработки.
"""
import json
from openai import OpenAI
from services.shared.settings import SETTINGS

SUPPORTED_OPERATORS = ["contains", "not_contains", "eq", "neq", "gt", "gte", "lt", "lte"]
SUPPORTED_BOOLEAN_MODES = ["must", "should", "must_not"]

intent = (
    "Требуется база автошкол по городам с населением от 500 тыс. человек. "
    "Источники: Реестр ГИБДД, 2ГИС, Яндекс Карты, Яндекс Услуги, Авито Услуги, сайты региональных ГИБДД. "
    "Требования: наличие лицензии Минобразования, категории B и выше. "
    "Исключать: компании с одним только адресом и без сайта"
)

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

print("=" * 70)
print("INTENT:")
print(intent)
print("=" * 70)
print(f"MODEL: {SETTINGS.openai_model}")
print("=" * 70)

client = OpenAI(api_key=SETTINGS.openai_api_key)
response = client.chat.completions.create(
    model=SETTINGS.openai_model,
    response_format={"type": "json_object"},
    messages=[{"role": "user", "content": prompt}],
    timeout=35,
)

raw = response.choices[0].message.content or ""
print("RAW LLM RESPONSE:")
print("-" * 70)
try:
    parsed = json.loads(raw)
    print(json.dumps(parsed, ensure_ascii=False, indent=2))
except Exception:
    print(raw)
print("=" * 70)
