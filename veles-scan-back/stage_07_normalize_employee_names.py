from __future__ import annotations

import json
import re

import pandas as pd
from openai import OpenAI

from common import ARTIFACTS_DIR, ensure_infoscraper_env, get_env_var, require_file


INPUT_FILE = ARTIFACTS_DIR / "enriched_dedup_contacts.xlsx"
OUTPUT_FILE = ARTIFACTS_DIR / "enriched_processed.xlsx"


def normalize_employee_name(client: OpenAI, model: str, name: str, job_title: str) -> dict:
    if not isinstance(name, str) or not name.strip():
        return {"normalized": None, "last": None, "first": None, "patronymic": None}
    prompt = f"""
Ты получаешь два поля: employee_name и employee_job_title.
Правила:
1. Если employee_name — это ФИО, верни в формате "Фамилия Имя Отчество" (если отчества нет -> null).
2. Если employee_name похоже на должность/отдел/контакты, верни null.
3. Верни строго JSON:
{{
  "normalized": "... или null",
  "last": "... или null",
  "first": "... или null",
  "patronymic": "... или null"
}}
employee_name: "{name}"
employee_job_title: "{job_title}"
"""
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            timeout=30,
        )
        text = response.choices[0].message.content.strip()
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError(f"Model returned non-JSON: {text}")
        return json.loads(m.group())
    except Exception:  # noqa: BLE001
        return {"normalized": None, "last": None, "first": None, "patronymic": None}


def main() -> None:
    ensure_infoscraper_env(require_openai=True)
    api_key = get_env_var("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required in environment (.env)")
    model = get_env_var("OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    client = OpenAI(api_key=api_key)

    in_path = require_file(INPUT_FILE)
    sheets = pd.read_excel(in_path, sheet_name=None, dtype=str)
    if "Employees" not in sheets:
        # If no Employees sheet, copy original file as-is
        with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
            for name, df in sheets.items():
                df.fillna("").astype(str).to_excel(writer, index=False, sheet_name=name)
        print("[INFO] Employees sheet not found, copied input to output.")
        print("[OK] Stage 07 completed.")
        return

    df_emp = sheets["Employees"].copy()
    df_emp["employee_name_normalized"] = None
    df_emp["last_name"] = None
    df_emp["first_name"] = None
    df_emp["patronymic"] = None
    for idx, row in df_emp.iterrows():
        name = row.get("employee_name", "")
        job = row.get("employee_job_title", "")
        parsed = normalize_employee_name(client, model, str(name or ""), str(job or ""))
        df_emp.at[idx, "employee_name_normalized"] = parsed.get("normalized")
        df_emp.at[idx, "last_name"] = parsed.get("last")
        df_emp.at[idx, "first_name"] = parsed.get("first")
        df_emp.at[idx, "patronymic"] = parsed.get("patronymic")

    with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
        for name, df in sheets.items():
            if name == "Employees":
                df_emp.fillna("").astype(str).to_excel(writer, index=False, sheet_name=name)
            else:
                df.fillna("").astype(str).to_excel(writer, index=False, sheet_name=name)
    print("[OK] Stage 07 completed.")


if __name__ == "__main__":
    main()
