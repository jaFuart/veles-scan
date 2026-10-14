from __future__ import annotations

import re
from typing import Callable

import pandas as pd

from common import ARTIFACTS_DIR, require_file


INPUT_FILE = ARTIFACTS_DIR / "enriched.xlsx"
OUTPUT_FILE = ARTIFACTS_DIR / "enriched_dedup_contacts.xlsx"
PHONE_COLUMNS = [
    "Phone",
    "AdditionalPhone",
    "AdditionalPhone_1",
    "AdditionalPhone_2",
    "AdditionalPhone_3",
    "AdditionalPhone_4",
    "json_general_phone_1",
    "json_general_phone_2",
    "json_general_phone_3",
    "json_general_phone_4",
]
EMAIL_COLUMNS = [
    "Email",
    "Email_1",
    "Email_2",
    "json_general_email_1",
    "json_general_email_2",
]


def normalize_phone(value: str) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def dedup_and_shift_left(values: list[str], normalizer: Callable[[str], str]) -> list[str]:
    unique = []
    seen = set()
    for raw in values:
        text = str(raw or "").strip()
        if not text:
            continue
        key = normalizer(text)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(text)
    total = len(values)
    if len(unique) < total:
        unique.extend([""] * (total - len(unique)))
    return unique[:total]


def main() -> None:
    in_path = require_file(INPUT_FILE)
    sheets = pd.read_excel(in_path, sheet_name=None, dtype=str, keep_default_na=False, engine="openpyxl")
    first_name = "Companies" if "Companies" in sheets else list(sheets.keys())[0]
    df = sheets[first_name].copy()

    existing_phone_cols = [c for c in PHONE_COLUMNS if c in df.columns]
    existing_email_cols = [c for c in EMAIL_COLUMNS if c in df.columns]

    if existing_phone_cols:
        phone_dedup = df[existing_phone_cols].apply(
            lambda row: dedup_and_shift_left(row.tolist(), normalize_phone),
            axis=1,
            result_type="expand",
        )
        phone_dedup.columns = existing_phone_cols
        for col in existing_phone_cols:
            df[col] = phone_dedup[col].astype(str)

    if existing_email_cols:
        email_dedup = df[existing_email_cols].apply(
            lambda row: dedup_and_shift_left(row.tolist(), normalize_email),
            axis=1,
            result_type="expand",
        )
        email_dedup.columns = existing_email_cols
        for col in existing_email_cols:
            df[col] = email_dedup[col].astype(str)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
        for name, src_df in sheets.items():
            if name == first_name:
                df.to_excel(writer, index=False, sheet_name=name)
            else:
                src_df.to_excel(writer, index=False, sheet_name=name)
    print("[OK] Stage 06 completed.")


if __name__ == "__main__":
    main()
