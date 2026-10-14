from __future__ import annotations

import json
import re

from openai import OpenAI

from output_field_catalog import CATALOG_BY_KEY, OUTPUT_FIELD_CATALOG
from services.shared.settings import SETTINGS


def _normalize_text(value: str) -> str:
    value = value.strip().lower().replace("ё", "е")
    value = re.sub(r"\s+", " ", value)
    return value


def _dedup_keep_order(keys: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def _catalog_prompt_blob() -> str:
    lines: list[str] = []
    for field in OUTPUT_FIELD_CATALOG:
        aliases = ", ".join(field["aliases"])
        lines.append(f'- key: "{field["key"]}", label: "{field["label"]}", aliases: {aliases}')
    return "\n".join(lines)


def _resolve_explicit_fields(response_format: str, max_output_fields: int) -> list[str]:
    chunks = [part.strip() for part in re.split(r"[,\n;]+", response_format or "") if part.strip()]
    if not chunks:
        return []

    resolved: list[str] = []
    for chunk in chunks:
        normalized_chunk = _normalize_text(chunk)
        for field in OUTPUT_FIELD_CATALOG:
            haystack = [_normalize_text(field["label"]), *[_normalize_text(alias) for alias in field["aliases"]]]
            if any(needle and needle in normalized_chunk for needle in haystack):
                resolved.append(field["key"])
                break
    return _dedup_keep_order(resolved)[:max_output_fields]


def _to_output_fields(keys: list[str]) -> list[dict[str, str]]:
    return [{"key": key, "label": CATALOG_BY_KEY[key]["label"]} for key in keys if key in CATALOG_BY_KEY]


def _resolve_with_llm(intent: str, response_format: str, max_output_fields: int) -> list[str]:
    if not SETTINGS.openai_api_key:
        return []

    client = OpenAI(api_key=SETTINGS.openai_api_key)
    prompt = f"""
You are a strict data schema mapper.
Task: map requested output columns to available canonical output fields.

Project intent:
{intent}

Requested output format:
{response_format}

Canonical output fields:
{_catalog_prompt_blob()}

Return STRICT JSON:
{{"output_field_keys": ["key1", "key2"]}}

Rules:
- Use ONLY keys from the canonical list.
- Return no more than {max_output_fields} keys.
- Keep requested order as much as possible.
- No comments, no markdown.
""".strip()

    response = client.chat.completions.create(
        model=SETTINGS.openai_model,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
        timeout=45,
    )
    content = (response.choices[0].message.content or "").strip()
    match = re.search(r"\{.*\}", content, re.S)
    if not match:
        return []
    payload = json.loads(match.group())
    raw = payload.get("output_field_keys", [])
    if not isinstance(raw, list):
        return []
    keys = [str(item).strip() for item in raw if str(item).strip() in CATALOG_BY_KEY]
    return _dedup_keep_order(keys)[:max_output_fields]


def resolve_output_fields_for_intent(
    intent: str,
    response_format: str | None,
    max_output_fields: int = 20,
) -> tuple[list[dict[str, str]], str]:
    normalized_format = (response_format or "").strip()
    if not normalized_format:
        return [], "not_provided"

    explicit_keys = _resolve_explicit_fields(normalized_format, max_output_fields=max_output_fields)
    if explicit_keys:
        return _to_output_fields(explicit_keys), "explicit_alias"

    try:
        llm_keys = _resolve_with_llm(intent, normalized_format, max_output_fields=max_output_fields)
        if llm_keys:
            return _to_output_fields(llm_keys), "openai_intent"
    except Exception:
        pass

    return [], "unresolved"

