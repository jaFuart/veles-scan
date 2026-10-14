from __future__ import annotations

import json
import re
import csv
import time
import uuid
from pathlib import Path
from typing import Any

from openai import OpenAI

import checko_runtime_config

from services.shared.settings import SETTINGS
from services.shared.storage import list_keys, download_file


OKVED_RE = re.compile(r"^\d{2}(?:\.\d+)*$")
OKVED_PREFIX_RE = re.compile(r"^\d{2}$")

KEYWORD_PREFIX_HINTS: dict[str, tuple[str, ...]] = {
    "образ": ("85",),
    "школ": ("85",),
    "колледж": ("85",),
    "универс": ("85",),
    "вуз": ("85",),
    "доп образ": ("85",),
    "детск": ("85",),
    "банк": ("64", "65", "66"),
    "финанс": ("64", "65", "66"),
    "кредит": ("64", "65", "66"),
    "страх": ("65", "66"),
    "инвест": ("64", "66"),
    "автокомпан": ("45",),
    "автосалон": ("45",),
    "автодилер": ("45",),
    "автобизнес": ("45",),
    "автомастер": ("45",),
    "автосервис": ("45",),
    "сто": ("45",),
    "техобслуж": ("45",),
    "ремонт авто": ("45",),
    "запчаст": ("45",),
}

_SNAPSHOT_COLUMNS_CACHE: dict[str, Any] = {"ts": 0.0, "columns": []}


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


def list_available_okved_codes() -> list[str]:
    keys = list_keys(SETTINGS.minio_bucket_checko, "checko/latest/")
    codes: set[str] = set()
    for key in keys:
        if not key.endswith(".csv"):
            continue
        code = key.split("/")[-1].removesuffix(".csv").strip()
        if OKVED_RE.fullmatch(code):
            codes.add(code)
    return sorted(codes)


def list_available_snapshot_columns(*, cache_ttl_sec: int = 300, max_files: int = 30) -> list[str]:
    now = time.time()
    if now - float(_SNAPSHOT_COLUMNS_CACHE.get("ts", 0.0)) < cache_ttl_sec:
        cached = _SNAPSHOT_COLUMNS_CACHE.get("columns", [])
        if isinstance(cached, list) and cached:
            return [str(item) for item in cached]

    keys = sorted([key for key in list_keys(SETTINGS.minio_bucket_checko, "checko/latest/") if key.endswith(".csv")])
    columns: set[str] = set()
    sample_keys = keys[: max(1, min(max_files, len(keys)))]
    for key in sample_keys:
        tmp_path = Path("/tmp") / f"okved-columns-{uuid.uuid4()}.csv"
        try:
            download_file(SETTINGS.minio_bucket_checko, key, tmp_path)
            with tmp_path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.reader(handle, delimiter=";")
                header = next(reader, [])
                for col in header:
                    value = str(col).strip()
                    if value:
                        columns.add(value)
        except Exception:
            continue
        finally:
            tmp_path.unlink(missing_ok=True)

    resolved = sorted(columns)
    _SNAPSHOT_COLUMNS_CACHE["ts"] = now
    _SNAPSHOT_COLUMNS_CACHE["columns"] = resolved
    return resolved


def list_configured_okved_codes() -> list[str]:
    raw_codes = getattr(checko_runtime_config, "TARGET_OKVED_CODES", None)
    if raw_codes is None:
        return []

    if isinstance(raw_codes, str):
        candidates = re.split(r"[,\n;\s]+", raw_codes)
    elif isinstance(raw_codes, (list, tuple, set)):
        candidates = list(raw_codes)
    else:
        return []

    codes: set[str] = set()
    for candidate in candidates:
        code = str(candidate).strip()
        if OKVED_RE.fullmatch(code):
            codes.add(code)
    return sorted(codes)


def _extract_codes_from_text(text: str) -> list[str]:
    matches = re.findall(r"\b\d{2}(?:\.\d+){0,4}\b", text or "")
    ordered: list[str] = []
    seen: set[str] = set()
    for code in matches:
        code = code.strip()
        if not OKVED_RE.fullmatch(code) or code in seen:
            continue
        seen.add(code)
        ordered.append(code)
    return ordered


def _extract_prefixes_from_codes(codes: list[str]) -> list[str]:
    prefixes: set[str] = set()
    for code in codes:
        if len(code) >= 2 and code[:2].isdigit():
            prefixes.add(code[:2])
    return sorted(prefixes)


def _pick_codes_by_prefixes(available_codes: list[str], prefixes: list[str], *, limit: int) -> list[str]:
    if not prefixes:
        return available_codes[:limit]
    prefix_set = set(prefixes)
    ranked = sorted(
        [code for code in available_codes if len(code) >= 2 and code[:2] in prefix_set],
        key=lambda code: (len(code), code),
    )
    if ranked:
        return ranked[:limit]
    return available_codes[:limit]


def _resolve_prefixes_with_llm(intent: str, available_codes: list[str]) -> list[str]:
    if not SETTINGS.openai_api_key:
        return []
    available_prefixes = _extract_prefixes_from_codes(available_codes)
    if not available_prefixes:
        return []

    client = OpenAI(api_key=SETTINGS.openai_api_key)
    prompt = f"""
You classify business intent into OKVED two-digit prefixes.

User intent:
{intent}

Allowed two-digit prefixes:
{", ".join(available_prefixes)}

Return STRICT JSON:
{{"okved_prefixes": ["85", "64"]}}

Rules:
- Use ONLY allowed prefixes.
- Return 1..4 prefixes.
- Prefer narrow and relevant prefixes.
- No markdown, no comments.
""".strip()
    response = client.chat.completions.create(
        model=SETTINGS.openai_model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
        timeout=30,
    )
    payload = _extract_json_object(response.choices[0].message.content or "")
    if not payload:
        return []
    raw_prefixes = payload.get("okved_prefixes", [])
    if not isinstance(raw_prefixes, list):
        return []
    allowed = set(available_prefixes)
    picked: list[str] = []
    seen: set[str] = set()
    for item in raw_prefixes:
        prefix = str(item).strip()
        if prefix in allowed and prefix not in seen and OKVED_PREFIX_RE.fullmatch(prefix):
            seen.add(prefix)
            picked.append(prefix)
        if len(picked) >= 4:
            break
    return picked


def _resolve_with_llm(intent: str, available_codes: list[str], max_okved_codes: int) -> list[str]:
    if not SETTINGS.openai_api_key:
        return []

    client = OpenAI(api_key=SETTINGS.openai_api_key)
    llm_prefixes: list[str] = []
    try:
        llm_prefixes = _resolve_prefixes_with_llm(intent, available_codes)
    except Exception:
        llm_prefixes = []

    candidate_codes = _pick_codes_by_prefixes(
        available_codes,
        llm_prefixes,
        limit=min(max(500, max_okved_codes * 20), len(available_codes)),
    )
    codes_blob = ", ".join(candidate_codes)
    finance_hint = [
        "64: financial services (banking, lending, microfinance, financial leasing)",
        "65: insurance and reinsurance",
        "66: auxiliary financial and insurance activities",
        "85: education (schools, colleges, universities, training centers)",
    ]
    prompt = f"""
You are an OKVED classifier.
Task: map user intent to relevant OKVED codes from the allowed list only.

User intent:
{intent}

Allowed OKVED codes:
{codes_blob}

Domain hints for common intents:
{", ".join(finance_hint)}

Return STRICT JSON with this schema:
{{"okved_codes": ["..", ".."]}}

Rules:
- Use ONLY codes from the allowed list.
- Return no more than {max_okved_codes} codes.
- Prefer precision over recall.
- No comments, no markdown.
""".strip()
    response = client.chat.completions.create(
        model=SETTINGS.openai_model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
        timeout=45,
    )
    payload = _extract_json_object(response.choices[0].message.content or "")
    if not payload:
        return []
    raw_codes = payload.get("okved_codes", [])
    if not isinstance(raw_codes, list):
        return []

    allowed = set(candidate_codes)
    result: list[str] = []
    seen: set[str] = set()
    for code in raw_codes:
        normalized = str(code).strip()
        if normalized in allowed and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
        if len(result) >= max_okved_codes:
            break
    return result


def _resolve_keyword_prefixes(intent: str, available_codes: list[str], max_okved_codes: int) -> tuple[list[str], str] | None:
    lowered = (intent or "").lower()
    picked_prefixes: set[str] = set()
    for marker, prefixes in KEYWORD_PREFIX_HINTS.items():
        if marker in lowered:
            picked_prefixes.update(prefixes)
    if not picked_prefixes:
        return None
    picked = _pick_codes_by_prefixes(available_codes, sorted(picked_prefixes), limit=max_okved_codes)
    if picked:
        return picked[:max_okved_codes], "keyword_prefix_fallback"
    return None


def validate_intent_scope_with_llm(intent: str) -> tuple[bool, str | None, str | None]:
    """
    Returns: (is_allowed, reason_for_user, refusal_kind)
    refusal_kind: "too_broad" | "too_diverse" | None
    """
    if not SETTINGS.openai_api_key:
        return True, None, None
    lowered = (intent or "").lower()
    broad_markers = ("все компании", "все организации", "любые компании", "все подряд", "максимум компаний")
    has_broad_marker = any(marker in lowered for marker in broad_markers)
    matched_prefixes: set[str] = set()
    for marker, prefixes in KEYWORD_PREFIX_HINTS.items():
        if marker in lowered:
            matched_prefixes.update(prefixes)
    # Focused single-domain requests like "образовательные учреждения" should pass.
    focused_single_domain = bool(matched_prefixes) and len(matched_prefixes) <= 2 and not has_broad_marker

    client = OpenAI(api_key=SETTINGS.openai_api_key)
    prompt = f"""
You are a strict request-scope validator for lead-generation projects.

User request:
{intent}

Decide if this request is acceptable for one focused build.

Reject when:
- request is too broad / mass-download style (example: "дай все компании");
- request mixes distant categories that should be separate builds (example: "школы и банки").

Return STRICT JSON:
{{
  "decision": "allow" | "reject",
  "refusal_kind": "too_broad" | "too_diverse" | null,
  "user_message": "short Russian message for UI"
}}

Rules:
- For allow: refusal_kind must be null.
- For reject: refusal_kind must be non-null and user_message must explain what to do next.
- No markdown, no comments.
""".strip()
    try:
        response = client.chat.completions.create(
            model=SETTINGS.openai_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
            timeout=30,
        )
        payload = _extract_json_object(response.choices[0].message.content or "")
        if not payload:
            return True, None, None
        decision = str(payload.get("decision", "")).strip().lower()
        refusal_kind_raw = payload.get("refusal_kind")
        refusal_kind = str(refusal_kind_raw).strip().lower() if refusal_kind_raw is not None else None
        user_message = str(payload.get("user_message", "")).strip()
        if decision == "reject" and refusal_kind in {"too_broad", "too_diverse"}:
            if focused_single_domain and refusal_kind == "too_broad":
                return True, None, None
            return (
                False,
                user_message
                or (
                    "Запрос слишком общий, уточните нишу и ограничения."
                    if refusal_kind == "too_broad"
                    else "Категории в запросе слишком разные; разделите на несколько отдельных сборок."
                ),
                refusal_kind,
            )
    except Exception:
        return True, None, None
    return True, None, None


def resolve_okved_for_intent(intent: str, available_codes: list[str], max_okved_codes: int = 30) -> tuple[list[str], str]:
    allowed = set(available_codes)
    explicit = [code for code in _extract_codes_from_text(intent) if code in allowed]
    if explicit:
        return explicit[:max_okved_codes], "explicit_codes"

    try:
        llm_codes = _resolve_with_llm(intent, available_codes, max_okved_codes=max_okved_codes)
        if llm_codes:
            return llm_codes, "openai_intent"
    except Exception:
        # Keep API resilient: return empty result, UI can ask user to clarify.
        pass

    keyword_fallback = _resolve_keyword_prefixes(intent, available_codes, max_okved_codes)
    if keyword_fallback:
        return keyword_fallback
    return [], "unresolved"
