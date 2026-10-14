from __future__ import annotations

import json
import os
import re
from urllib.parse import urlparse

import pandas as pd

from common import ARTIFACTS_DIR
from output_field_catalog import CATALOG_BY_KEY


EMPTY_MARKERS = {"", "nan", "none", "null", "nat", "<na>"}


def _clean_scalar(value: object) -> str:
    if value is None:
        return ""
    if pd.isna(value):
        return ""
    text = str(value).strip()
    return "" if text.lower() in EMPTY_MARKERS else text


def normalize_url_key(url: object) -> str:
    raw = _clean_scalar(url)
    if not raw:
        return ""
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
        raw = "http://" + raw
    parsed = urlparse(raw)
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = (parsed.path or "").rstrip("/")
    return f"{host}{path}" if path else host


def relation_rows_from_json(data: list[dict], relation_key: str) -> list[dict]:
    rows: list[dict] = []
    for entry in data:
        start_url = entry.get("start_url")
        for company_info in entry.get("company_info", []) or []:
            relations = company_info.get("relations", {}) or {}
            items = relations.get(relation_key, []) or []
            for item in items:
                if isinstance(item, dict):
                    name = item.get("name")
                    rel_url = item.get("url")
                    note = item.get("note")
                else:
                    name = str(item).strip() if item is not None else None
                    rel_url = None
                    note = None
                if not name:
                    continue
                rows.append(
                    {
                        "company_start_url": start_url,
                        "company_url_key": normalize_url_key(start_url),
                        "relation_name": name,
                        "relation_url": rel_url,
                        "relation_note": note,
                    }
                )
    return rows


def _first_non_empty(row: pd.Series, candidates: list[str]) -> str:
    for col in candidates:
        if col not in row:
            continue
        value = _clean_scalar(row.get(col))
        if value:
            return value
    return ""


def _join_prefixed(row: pd.Series, prefix: str) -> str:
    values: list[str] = []
    for col in row.index:
        if not str(col).startswith(prefix):
            continue
        value = _clean_scalar(row.get(col))
        if value:
            values.append(value)
    return "; ".join(values)


def _split_multi(value: str) -> list[str]:
    if not value:
        return []
    return [chunk.strip() for chunk in re.split(r"[,\n;]+", value) if chunk.strip()]


def _merge_multi_values(*raw_values: str) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for raw in raw_values:
        for item in _split_multi(_clean_scalar(raw)):
            norm = item.lower()
            if norm in seen:
                continue
            seen.add(norm)
            out.append(item)
    return "; ".join(out)


def _prepare_requested_companies_sheet(
    df_companies: pd.DataFrame,
    df_employees: pd.DataFrame,
    df_clients: pd.DataFrame,
    df_partners: pd.DataFrame,
    requested_fields: list[dict[str, str]],
) -> pd.DataFrame:
    if not requested_fields:
        return df_companies

    employee_by_id: dict[str, pd.Series] = {}
    if "Id" in df_employees.columns:
        for _, emp_row in df_employees.iterrows():
            company_id = str(emp_row.get("Id") or "").strip()
            if company_id and company_id not in employee_by_id:
                employee_by_id[company_id] = emp_row

    clients_by_id: dict[str, str] = {}
    partners_by_id: dict[str, str] = {}
    if "Id" in df_clients.columns:
        for company_id, group in df_clients.groupby("Id"):
            names = [str(value).strip() for value in group.get("relation_name", []) if str(value).strip()]
            clients_by_id[str(company_id)] = "; ".join(dict.fromkeys(names))
    if "Id" in df_partners.columns:
        for company_id, group in df_partners.groupby("Id"):
            names = [str(value).strip() for value in group.get("relation_name", []) if str(value).strip()]
            partners_by_id[str(company_id)] = "; ".join(dict.fromkeys(names))

    rows: list[dict[str, str]] = []
    for _, company_row in df_companies.iterrows():
        company_id = str(company_row.get("Id") or "").strip()
        emp_row = employee_by_id.get(company_id)

        def field_value(field_key: str) -> str:
            if field_key == "company_name":
                return _first_non_empty(company_row, ["Наименование", "Название", "Company", "json_organization_name"])
            if field_key == "legal_company_name":
                return _first_non_empty(company_row, ["Юридическое наименование"])
            if field_key == "status":
                return _first_non_empty(company_row, ["Статус"])
            if field_key == "inn":
                return _first_non_empty(company_row, ["ИНН", "Inn", "json_inn"])
            if field_key == "manager_inn":
                return _first_non_empty(company_row, ["ИНН управляющего"])
            if field_key == "manager_full_name":
                return _first_non_empty(company_row, ["ФИО управляющего"])
            if field_key == "manager_position":
                return _first_non_empty(company_row, ["Должность управляющего"])
            if field_key == "ogrn":
                return _first_non_empty(company_row, ["ОГРН"])
            if field_key == "kpp":
                return _first_non_empty(company_row, ["КПП"])
            if field_key == "okpo":
                return _first_non_empty(company_row, ["ОКПО"])
            if field_key == "registration_date":
                return _first_non_empty(company_row, ["Дата регистрации"])
            if field_key == "okved":
                return _first_non_empty(company_row, ["ОКВЭД", "OKVED", "Код ОКВЭД"])
            if field_key == "legal_address":
                return _first_non_empty(company_row, ["Юридический адрес", "Address", "json_address"])
            if field_key == "city":
                return _first_non_empty(company_row, ["Город", "City", "json_city"])
            if field_key == "website":
                return _first_non_empty(company_row, ["Web", "web", "Сайт", "Website"])
            if field_key == "general_phone":
                return _merge_multi_values(
                    _first_non_empty(company_row, ["Телефон", "Phone"]),
                    _join_prefixed(company_row, "json_general_phone_"),
                )
            if field_key == "general_email":
                return _merge_multi_values(
                    _first_non_empty(company_row, ["Email", "E-mail"]),
                    _join_prefixed(company_row, "json_general_email_"),
                )
            if field_key == "revenue":
                return _first_non_empty(company_row, ["Выручка"])
            if field_key == "net_profit":
                return _first_non_empty(company_row, ["Чистая прибыль"])
            if field_key == "capital":
                return _first_non_empty(company_row, ["Капитал"])
            if field_key == "company_description":
                return _first_non_empty(company_row, ["json_company_description", "Описание"])
            if field_key == "is_working_site":
                return _first_non_empty(company_row, ["json_is_working_site"])
            if field_key == "employee_name":
                return "" if emp_row is None else _first_non_empty(emp_row, ["employee_name", "ФИО"])
            if field_key == "employee_job_title":
                return "" if emp_row is None else _first_non_empty(emp_row, ["employee_job_title", "Должность"])
            if field_key == "employee_phone":
                return "" if emp_row is None else _join_prefixed(emp_row, "employee_phone_")
            if field_key == "employee_email":
                return "" if emp_row is None else _join_prefixed(emp_row, "employee_email_")
            if field_key == "clients":
                return clients_by_id.get(company_id, "")
            if field_key == "partners":
                return partners_by_id.get(company_id, "")
            return ""

        out_row: dict[str, str] = {}
        for requested in requested_fields:
            field_key = str(requested.get("key") or "").strip()
            if not field_key:
                continue
            fallback_label = CATALOG_BY_KEY.get(field_key, {}).get("label", field_key)
            label = str(requested.get("label") or fallback_label).strip() or fallback_label
            out_row[label] = field_value(field_key)
        rows.append(out_row)
    return pd.DataFrame(rows)


def main() -> None:
    excel_in = ARTIFACTS_DIR / "enriched_processed.xlsx"
    if not excel_in.exists():
        excel_in = ARTIFACTS_DIR / "enriched_dedup_contacts.xlsx"
    if not excel_in.exists():
        raise FileNotFoundError("Final Excel was not found in artifacts.")

    json_in = ARTIFACTS_DIR / "company_info_gpt_dedup.json"
    if not json_in.exists():
        raise FileNotFoundError("Dedup JSON was not found in artifacts.")

    with open(json_in, "r", encoding="utf-8") as f:
        data = json.load(f)

    sheets = pd.read_excel(excel_in, sheet_name=None, dtype=str)
    companies_sheet_name = "Companies" if "Companies" in sheets else list(sheets.keys())[0]
    df_companies = sheets[companies_sheet_name].copy()

    if "Web" in df_companies.columns:
        df_companies["company_url_key"] = df_companies["Web"].map(normalize_url_key)
    else:
        df_companies["company_url_key"] = ""

    id_col = "Id" if "Id" in df_companies.columns else None
    url_to_id = {}
    if id_col:
        for _, row in df_companies.iterrows():
            key = row.get("company_url_key", "")
            if key and key not in url_to_id:
                url_to_id[key] = row.get(id_col)

    clients = relation_rows_from_json(data, "clients")
    partners = relation_rows_from_json(data, "partners")

    df_clients = pd.DataFrame(clients)
    df_partners = pd.DataFrame(partners)

    for df_rel in (df_clients, df_partners):
        if df_rel.empty:
            continue
        if id_col:
            df_rel["Id"] = df_rel["company_url_key"].map(url_to_id)
        df_rel.drop(columns=["company_url_key"], inplace=True, errors="ignore")
        df_rel.drop_duplicates(
            subset=["company_start_url", "relation_name", "relation_url"],
            keep="first",
            inplace=True,
        )

    requested_fields_raw = os.getenv("PIPELINE_OUTPUT_FIELDS_JSON", "").strip()
    requested_fields: list[dict[str, str]] = []
    if requested_fields_raw:
        try:
            parsed = json.loads(requested_fields_raw)
            if isinstance(parsed, list):
                requested_fields = [item for item in parsed if isinstance(item, dict)]
        except Exception:
            requested_fields = []

    employees_sheet_name = "Employees" if "Employees" in sheets else None
    df_employees = sheets[employees_sheet_name].copy() if employees_sheet_name else pd.DataFrame()

    final_companies = _prepare_requested_companies_sheet(
        df_companies=df_companies.drop(columns=["company_url_key"], errors="ignore"),
        df_employees=df_employees,
        df_clients=df_clients,
        df_partners=df_partners,
        requested_fields=requested_fields,
    )

    final_output = ARTIFACTS_DIR / "final_pipeline_output.xlsx"
    with pd.ExcelWriter(final_output, engine="openpyxl") as writer:
        for name, df in sheets.items():
            if name == companies_sheet_name:
                final_companies.to_excel(writer, index=False, sheet_name=name)
            else:
                df.to_excel(writer, index=False, sheet_name=name)

        if df_clients.empty:
            pd.DataFrame(
                columns=["Id", "company_start_url", "relation_name", "relation_url", "relation_note"]
            ).to_excel(writer, index=False, sheet_name="Clients")
        else:
            cols = ["Id", "company_start_url", "relation_name", "relation_url", "relation_note"]
            existing_cols = [c for c in cols if c in df_clients.columns]
            df_clients.reindex(columns=existing_cols).to_excel(
                writer, index=False, sheet_name="Clients"
            )

        if df_partners.empty:
            pd.DataFrame(
                columns=["Id", "company_start_url", "relation_name", "relation_url", "relation_note"]
            ).to_excel(writer, index=False, sheet_name="Partners")
        else:
            cols = ["Id", "company_start_url", "relation_name", "relation_url", "relation_note"]
            existing_cols = [c for c in cols if c in df_partners.columns]
            df_partners.reindex(columns=existing_cols).to_excel(
                writer, index=False, sheet_name="Partners"
            )

    print(f"[OK] Stage 08 completed. Final file: {final_output}")


if __name__ == "__main__":
    main()
