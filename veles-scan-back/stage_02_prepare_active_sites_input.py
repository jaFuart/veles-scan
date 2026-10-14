from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import pandas as pd

from common import ARTIFACTS_DIR, CHECKO_RAW_DIR, ensure_artifacts_dirs


DEFAULT_INPUT_DIR = CHECKO_RAW_DIR
DEFAULT_OUTPUT_XLSX = ARTIFACTS_DIR / "active_companies_for_gpt.xlsx"


def _is_active(status: object) -> bool:
    if status is None or pd.isna(status):
        return False
    text = str(status).strip().lower()
    return "действ" in text


def _extract_first_website(raw: object) -> str:
    if raw is None or pd.isna(raw):
        return ""
    text = str(raw).strip()
    if not text:
        return ""
    if text.lower() in {"n/a", "na", "none", "null", "-", "—"}:
        return ""

    parts = re.split(r"[,\n;]+", text)
    for part in parts:
        candidate = part.strip()
        if not candidate:
            continue
        if candidate.lower() in {"n/a", "na", "none", "null", "-", "—"}:
            continue
        if " " in candidate:
            candidate = candidate.split()[0].strip()
        if not candidate:
            continue
        if not candidate.startswith(("http://", "https://")):
            candidate = "http://" + candidate
        return candidate
    return ""


def _normalize_text(value: object) -> str:
    text = str(value or "").strip().lower().replace("ё", "е")
    text = re.sub(r"\s+", " ", text)
    return text


def _find_column(df: pd.DataFrame, patterns: tuple[str, ...]) -> str | None:
    normalized = {str(col): _normalize_text(col) for col in df.columns}
    for pattern in patterns:
        norm_pattern = _normalize_text(pattern)
        for col, norm_col in normalized.items():
            if norm_pattern in norm_col:
                return col
    return None


def _resolve_column(df: pd.DataFrame, requested: str) -> str | None:
    needle = _normalize_text(requested)
    if not needle:
        return None
    normalized = {str(col): _normalize_text(col) for col in df.columns}
    # Exact normalized match first.
    for col, norm in normalized.items():
        if norm == needle:
            return col
    # Then partial match both ways.
    for col, norm in normalized.items():
        if needle in norm or norm in needle:
            return col
    return None


def _parse_numeric(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    text = str(value).strip().replace(" ", "")
    if not text:
        return None
    text = text.replace(",", ".")
    text = re.sub(r"[^0-9.\-]", "", text)
    if not text or text in {"-", ".", "-."}:
        return None
    try:
        return float(text)
    except Exception:
        return None


def _normalize_boolean_mode(item: dict) -> str:
    raw = str(
        item.get("boolean", "")
        or item.get("logic", "")
        or item.get("combine", "")
        or item.get("logical_operator", "")
    ).strip().lower()
    if bool(item.get("negated")) and not raw:
        raw = "must_not"
    if raw in {"must", "and", "all", "required"}:
        return "must"
    if raw in {"should", "or", "any", "optional"}:
        return "should"
    if raw in {"must_not", "not", "exclude", "without", "exclude_if"}:
        return "must_not"
    return "must"


def _build_filter_mask(df: pd.DataFrame, item: dict) -> tuple[pd.Series | None, str | None, str | None, str | None]:
    requested_column = str(item.get("column", "")).strip() or str(item.get("field_key", "")).strip()
    operator = str(item.get("operator", "")).strip().lower()
    if not requested_column:
        print("[WARN] Filter without column skipped.")
        return None, None, None, None

    resolved_col = _resolve_column(df, requested_column)
    if not resolved_col:
        print(f"[WARN] Filter column '{requested_column}' not found; skipped.")
        return None, None, None, None

    raw_value = item.get("value")
    value_type = str(item.get("value_type", "")).strip().lower()
    if operator in {"contains", "not_contains"}:
        value = str(raw_value or "").strip()
        if not value:
            print(f"[WARN] Empty text value for column '{resolved_col}'; skipped.")
            return None, None, None, None
        needle = _normalize_text(value)
        contains_mask = df[resolved_col].map(lambda v: needle in _normalize_text(v))
        mask = contains_mask if operator == "contains" else ~contains_mask
        return mask, resolved_col, operator, f"'{value}'"

    if operator in {"gt", "gte", "lt", "lte", "eq", "neq"}:
        threshold = _parse_numeric(raw_value)
        if threshold is not None and (value_type == "number" or operator in {"gt", "gte", "lt", "lte"}):
            numeric = df[resolved_col].map(_parse_numeric)
            if operator == "gt":
                mask = numeric.map(lambda v: v is not None and v > threshold)
            elif operator == "gte":
                mask = numeric.map(lambda v: v is not None and v >= threshold)
            elif operator == "lt":
                mask = numeric.map(lambda v: v is not None and v < threshold)
            elif operator == "lte":
                mask = numeric.map(lambda v: v is not None and v <= threshold)
            elif operator == "eq":
                mask = numeric.map(lambda v: v is not None and v == threshold)
            else:
                mask = numeric.map(lambda v: v is not None and v != threshold)
            return mask, resolved_col, operator, f"{threshold:g}"

        if operator in {"eq", "neq"}:
            # Empty-string comparison is valid and used by LLM for presence checks, e.g. neq "".
            raw_text = "" if raw_value is None else str(raw_value)
            text_value = _normalize_text(raw_text)
            equal_mask = df[resolved_col].map(lambda v: _normalize_text(v) == text_value)
            mask = equal_mask if operator == "eq" else ~equal_mask
            rendered = "''" if text_value == "" else f"'{text_value}'"
            return mask, resolved_col, operator, rendered

        print(f"[WARN] Numeric value required for operator '{operator}' on column '{resolved_col}'.")
        return None, None, None, None

    print(f"[WARN] Unsupported filter skipped: column={requested_column}, operator={operator}")
    return None, None, None, None


def _apply_filter_set(df: pd.DataFrame, prepared_filters: list[dict], *, log_prefix: str = "[INFO]") -> pd.DataFrame:
    if not prepared_filters:
        return df

    base_size = len(df)
    must_mask = pd.Series(True, index=df.index)
    should_group_masks: dict[str, pd.Series] = {}
    exclude_mask = pd.Series(True, index=df.index)
    applied_filters = 0

    for item in prepared_filters:
        boolean_mode = _normalize_boolean_mode(item)
        mask, resolved_col, operator, rendered_value = _build_filter_mask(df, item)
        if mask is None or resolved_col is None or operator is None or rendered_value is None:
            continue

        applied_filters += 1
        matched = int(mask.sum())
        print(
            f"{log_prefix} Filter [{boolean_mode}] {resolved_col} {operator} {rendered_value}: "
            f"matched {matched}/{base_size}"
        )

        if boolean_mode == "must":
            must_mask &= mask
        elif boolean_mode == "should":
            raw_group = str(item.get("group", "")).strip().lower()
            group = raw_group or "__default__"
            if group not in should_group_masks:
                should_group_masks[group] = pd.Series(False, index=df.index)
            should_group_masks[group] |= mask
        else:
            exclude_mask &= ~mask

    if applied_filters == 0:
        return df

    combined = must_mask & exclude_mask
    for group_name, group_mask in should_group_masks.items():
        print(f"{log_prefix} Should-group '{group_name}' combined by OR.")
        combined &= group_mask

    out = df[combined].copy()
    print(f"{log_prefix} Combined intent filters result: {base_size} -> {len(out)}")
    return out


def _apply_intent_filters(df: pd.DataFrame) -> pd.DataFrame:
    raw = os.getenv("PIPELINE_INTENT_FILTERS_JSON", "").strip()
    if not raw:
        return df
    try:
        filters = json.loads(raw)
    except Exception:
        print("[WARN] Could not parse PIPELINE_INTENT_FILTERS_JSON; skipping filters.")
        return df
    if not isinstance(filters, list) or not filters:
        return df

    prepared_filters = [item for item in filters if isinstance(item, dict)]
    print(f"[INFO] Applying intent filters before enrichment: {len(prepared_filters)}")
    result = _apply_filter_set(df, prepared_filters)

    ignored_raw = os.getenv("PIPELINE_IGNORED_CONDITIONS_JSON", "").strip()
    if ignored_raw:
        try:
            ignored = json.loads(ignored_raw)
            if isinstance(ignored, list) and ignored:
                print("[WARN] Ignored intent conditions (not supported by columns): " + "; ".join(str(v) for v in ignored[:5]))
        except Exception:
            pass

    return result


def _load_checko_csvs(input_dir: Path) -> pd.DataFrame:
    csv_files = sorted(input_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in: {input_dir}")

    frames = []
    for csv_file in csv_files:
        df = pd.read_csv(csv_file, sep=";", dtype=str, encoding="utf-8-sig")
        df["__source_file"] = csv_file.name
        frames.append(df)

    merged = pd.concat(frames, ignore_index=True)
    merged = merged.drop_duplicates(subset=["ИНН", "Наименование"], keep="first")
    return merged


def build_input_excel(input_dir: Path, output_xlsx: Path) -> Path:
    ensure_artifacts_dirs()
    df = _load_checko_csvs(input_dir)

    if "Статус" not in df.columns:
        raise ValueError("Column 'Статус' is missing in checko CSV files.")
    if "Веб-сайты" not in df.columns:
        raise ValueError("Column 'Веб-сайты' is missing in checko CSV files.")

    df_active = df[df["Статус"].map(_is_active)].copy()
    df_active = _apply_intent_filters(df_active)
    if df_active.empty:
        raise ValueError("No rows left after applying intent filters.")
    df_active["Web"] = df_active["Веб-сайты"].map(_extract_first_website)
    # Keep ALL filtered active companies in the final output.
    # Enrichment stage will process only rows with non-empty Web,
    # but rows without website must remain in the dataset as source data.
    with_web = df_active[df_active["Web"].str.len() > 0].copy()
    with_web = with_web.drop_duplicates(subset=["Web"], keep="first")
    without_web = df_active[df_active["Web"].str.len() == 0].copy()
    df_active = pd.concat([with_web, without_web], ignore_index=True)

    # Keep both "Web" and "web" for compatibility across old scripts
    df_active["web"] = df_active["Web"]
    if "Id" not in df_active.columns:
        df_active["Id"] = df_active.index + 1

    output_xlsx.parent.mkdir(parents=True, exist_ok=True)
    df_active.to_excel(output_xlsx, index=False)

    print(f"[OK] Saved prepared input: {output_xlsx}")
    print(f"[INFO] Active companies with website: {len(with_web)}")
    return output_xlsx


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Stage 02: фильтр активных компаний и подготовка входного Excel."
    )
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_XLSX)
    args = parser.parse_args()

    build_input_excel(args.input_dir, args.output)


if __name__ == "__main__":
    main()
