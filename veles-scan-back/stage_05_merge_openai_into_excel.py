from __future__ import annotations

import argparse
import json
import re
from collections import OrderedDict, defaultdict
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

from common import ARTIFACTS_DIR, require_file


DEFAULT_INPUT_XLSX = ARTIFACTS_DIR / "active_companies_for_gpt.xlsx"
DEFAULT_INPUT_JSON = ARTIFACTS_DIR / "company_info_gpt_dedup.json"
DEFAULT_OUTPUT_XLSX = ARTIFACTS_DIR / "enriched.xlsx"


EMPTY_MARKERS = {"", "nan", "none", "null", "nat", "<na>"}


def _clean_cell(value):
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except Exception:
        pass
    text = str(value).strip()
    return "" if text.lower() in EMPTY_MARKERS else text


def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    # pandas 3.x no longer guarantees DataFrame.applymap availability in all builds.
    # Apply scalar cleaner via Series.map for compatibility.
    return df.apply(lambda col: col.map(_clean_cell))


def normalize_url_key(url: str) -> str:
    if not url or not isinstance(url, str):
        return ""
    u = url.strip()
    if not u:
        return ""
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", u):
        u = "http://" + u
    parsed = urlparse(u)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = (parsed.path or "").rstrip("/")
    return f"{host}{path}" if path else host


def domain_only_key(url: str) -> str:
    if not url or not isinstance(url, str):
        return ""
    u = url.strip()
    if not u:
        return ""
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", u):
        u = "http://" + u
    host = urlparse(u).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def split_multi(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out = []
        for v in value:
            out.extend(split_multi(v))
        return out
    s = str(value).replace("mailto:", "").replace("MAILTO:", "")
    return [p.strip() for p in re.split(r"[,\n;]+", s) if p.strip()]


def dedup_preserve_order(seq):
    seen = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def richness_score(agg):
    score = 0
    for k in ("organization_name", "company_description", "address", "city", "inn"):
        if agg.get(k):
            score += 1
    if agg.get("is_working_site") is not None:
        score += 1
    score += len(agg.get("general_phones", []))
    score += len(agg.get("general_emails", []))
    score += len(agg.get("employees", []))
    return score


def prefer_longer(cur, new):
    if not new:
        return cur
    if not cur:
        return new
    return new if len(str(new)) > len(str(cur)) else cur


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Stage 05: слияние OpenAI JSON в Excel."
    )
    parser.add_argument("--excel", type=Path, default=DEFAULT_INPUT_XLSX)
    parser.add_argument("--json", type=Path, default=DEFAULT_INPUT_JSON)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_XLSX)
    args = parser.parse_args()

    in_excel = require_file(args.excel)
    in_json = require_file(args.json)
    output = args.output

    df = pd.read_excel(in_excel, dtype=str)
    with open(in_json, "r", encoding="utf-8") as f:
        json_data = json.load(f)

    by_exact = defaultdict(
        lambda: {
            "start_urls": set(),
            "organization_name": None,
            "is_working_site": None,
            "company_description": None,
            "address": None,
            "city": None,
            "inn": None,
            "general_phones": [],
            "general_emails": [],
            "employees": [],
        }
    )
    domain_to_exact_keys = defaultdict(set)

    for rec in json_data:
        start_url = rec.get("start_url")
        exact_key = normalize_url_key(start_url)
        domain_key = domain_only_key(start_url)
        domain_to_exact_keys[domain_key].add(exact_key)

        agg = by_exact[exact_key]
        agg["start_urls"].add(start_url)
        for ci in rec.get("company_info") or []:
            agg["organization_name"] = prefer_longer(agg["organization_name"], ci.get("organization_name"))
            iws = ci.get("is_working_site")
            if iws is not None and agg["is_working_site"] is None:
                agg["is_working_site"] = iws
            agg["company_description"] = prefer_longer(agg["company_description"], ci.get("company_description"))
            agg["address"] = prefer_longer(agg["address"], ci.get("address"))
            agg["city"] = prefer_longer(agg["city"], ci.get("city"))
            agg["inn"] = prefer_longer(agg["inn"], ci.get("inn"))

            contacts = ci.get("contact_information") or {}
            general = contacts.get("general") or {}
            agg["general_phones"].extend(split_multi(general.get("phone")))
            agg["general_emails"].extend(split_multi(general.get("email")))

            employees_raw = []
            if isinstance(contacts.get("employee_contacts"), list):
                employees_raw.extend(contacts["employee_contacts"])
            if isinstance(contacts.get("employee_contact"), dict):
                employees_raw.append(contacts["employee_contact"])

            for e in employees_raw:
                name = e.get("name")
                job = e.get("job_title")
                phs = split_multi(e.get("phone"))
                ems = split_multi(e.get("email"))
                if not name or str(name).strip().lower() in {"", "none", "null"}:
                    agg["general_phones"].extend(phs)
                    agg["general_emails"].extend(ems)
                else:
                    agg["employees"].append({"name": name, "job_title": job, "phones": phs, "emails": ems})

    for _, agg in by_exact.items():
        agg["general_phones"] = dedup_preserve_order([x.strip() for x in agg["general_phones"] if str(x).strip()])
        agg["general_emails"] = dedup_preserve_order([x.strip() for x in agg["general_emails"] if str(x).strip()])

    domain_unique = {dom: (len(exacts) == 1) for dom, exacts in domain_to_exact_keys.items()}

    def explode_web_cell(value):
        if value is None:
            return [], []
        s = str(value).strip()
        if not s:
            return [], []
        raw_parts = [p.strip() for p in re.split(r"[,\n; \t]+", s) if p.strip()]
        return [normalize_url_key(p) for p in raw_parts], raw_parts

    max_general_phones = 0
    max_general_emails = 0
    employees_rows = []
    enriched_records = []

    web_col = "Web" if "Web" in df.columns else "web"
    id_col = "Id" if "Id" in df.columns else None

    for _, row in df.iterrows():
        exact_candidates, raw_candidates = explode_web_cell(row.get(web_col))
        chosen = None
        chosen_key = None

        for ek in exact_candidates:
            if ek in by_exact:
                cand = by_exact[ek]
                if chosen is None or richness_score(cand) > richness_score(chosen):
                    chosen, chosen_key = cand, ek
        if chosen is None:
            for raw in raw_candidates:
                dom = domain_only_key(raw)
                if dom and domain_unique.get(dom, False):
                    only = list(domain_to_exact_keys[dom])[0]
                    cand = by_exact.get(only)
                    if cand and (chosen is None or richness_score(cand) > richness_score(chosen)):
                        chosen, chosen_key = cand, only

        add = OrderedDict()
        if chosen:
            any_start = normalize_url_key(next(iter(chosen["start_urls"]))) if chosen["start_urls"] else chosen_key
            add["json_start_url"] = any_start
            add["json_organization_name"] = chosen.get("organization_name")
            add["json_is_working_site"] = chosen.get("is_working_site")
            add["json_company_description"] = chosen.get("company_description")
            add["json_address"] = chosen.get("address")
            add["json_city"] = chosen.get("city")
            add["json_inn"] = chosen.get("inn")

            g_phones = chosen.get("general_phones", [])
            g_emails = chosen.get("general_emails", [])
            max_general_phones = max(max_general_phones, len(g_phones))
            max_general_emails = max(max_general_emails, len(g_emails))
            for i, p in enumerate(g_phones, 1):
                add[f"json_general_phone_{i}"] = p
            for i, e in enumerate(g_emails, 1):
                add[f"json_general_email_{i}"] = e

            company_id = row.get(id_col) if id_col else None
            for emp in chosen.get("employees", []):
                emp_row = OrderedDict()
                emp_row["Id"] = company_id
                emp_row["json_start_url"] = any_start
                emp_row["employee_name"] = emp.get("name")
                emp_row["employee_job_title"] = emp.get("job_title")
                for i, p in enumerate(emp.get("phones", []), 1):
                    emp_row[f"employee_phone_{i}"] = p
                for i, e in enumerate(emp.get("emails", []), 1):
                    emp_row[f"employee_email_{i}"] = e
                employees_rows.append(emp_row)
        else:
            add["json_start_url"] = None
            add["json_organization_name"] = None
            add["json_is_working_site"] = None
            add["json_company_description"] = None
            add["json_address"] = None
            add["json_city"] = None
            add["json_inn"] = None

        enriched_records.append(add)

    df_add = pd.DataFrame(enriched_records)
    for i in range(1, max_general_phones + 1):
        col = f"json_general_phone_{i}"
        if col not in df_add.columns:
            df_add[col] = None
    for i in range(1, max_general_emails + 1):
        col = f"json_general_email_{i}"
        if col not in df_add.columns:
            df_add[col] = None

    base_cols = [
        "json_start_url",
        "json_organization_name",
        "json_is_working_site",
        "json_company_description",
        "json_address",
        "json_city",
        "json_inn",
    ]
    phone_cols = [c for c in df_add.columns if c.startswith("json_general_phone_")]
    email_cols = [c for c in df_add.columns if c.startswith("json_general_email_")]
    ordered = list(df.columns) + base_cols + phone_cols + email_cols
    df_out = pd.concat([df.reset_index(drop=True), df_add.reindex(columns=base_cols + phone_cols + email_cols)], axis=1)
    df_out = df_out.reindex(columns=ordered)

    if employees_rows:
        all_emp_cols = OrderedDict()
        for r in employees_rows:
            for k in r.keys():
                all_emp_cols[k] = True
        df_emp = pd.DataFrame(employees_rows, columns=list(all_emp_cols.keys()))
    else:
        df_emp = pd.DataFrame(columns=["Id", "json_start_url", "employee_name", "employee_job_title"])

    output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df_out = _clean_dataframe(df_out)
        df_emp = _clean_dataframe(df_emp)
        df_out.to_excel(writer, index=False, sheet_name="Companies")
        df_emp.to_excel(writer, index=False, sheet_name="Employees")
    print("[OK] Stage 05 completed.")


if __name__ == "__main__":
    main()
