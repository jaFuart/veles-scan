from __future__ import annotations

from typing import TypedDict


class OutputFieldSpec(TypedDict):
    key: str
    label: str
    aliases: list[str]


OUTPUT_FIELD_CATALOG: list[OutputFieldSpec] = [
    {"key": "company_name", "label": "Название компании", "aliases": ["название", "компания", "organization name", "company name"]},
    {
        "key": "legal_company_name",
        "label": "Юридическое наименование",
        "aliases": ["юридическое наименование", "полное наименование", "официальное наименование"],
    },
    {"key": "status", "label": "Статус", "aliases": ["статус", "status"]},
    {"key": "inn", "label": "ИНН", "aliases": ["инн", "tax id", "inn"]},
    {
        "key": "manager_inn",
        "label": "ИНН управляющего",
        "aliases": ["инн управляющего", "inn управляющего", "inn manager"],
    },
    {
        "key": "manager_full_name",
        "label": "ФИО управляющего",
        "aliases": ["фио управляющего", "управляющий", "директор", "manager name"],
    },
    {
        "key": "manager_position",
        "label": "Должность управляющего",
        "aliases": ["должность управляющего", "должность руководителя", "manager position"],
    },
    {"key": "ogrn", "label": "ОГРН", "aliases": ["огрн", "ogrn"]},
    {"key": "kpp", "label": "КПП", "aliases": ["кпп", "kpp"]},
    {"key": "okpo", "label": "ОКПО", "aliases": ["окпо", "okpo"]},
    {"key": "registration_date", "label": "Дата регистрации", "aliases": ["дата регистрации", "registration date"]},
    {"key": "okved", "label": "ОКВЭД", "aliases": ["оквэд", "okved", "вид деятельности"]},
    {"key": "legal_address", "label": "Юридический адрес", "aliases": ["юридический адрес", "адрес", "legal address"]},
    {"key": "city", "label": "Город", "aliases": ["город", "city"]},
    {"key": "website", "label": "Сайт", "aliases": ["сайт", "website", "web", "url"]},
    {"key": "general_phone", "label": "Телефон", "aliases": ["телефон", "phone", "контактный телефон"]},
    {"key": "general_email", "label": "Email", "aliases": ["email", "e-mail", "почта", "электронная почта"]},
    {"key": "revenue", "label": "Выручка", "aliases": ["выручка", "revenue"]},
    {"key": "net_profit", "label": "Чистая прибыль", "aliases": ["чистая прибыль", "прибыль", "net profit"]},
    {"key": "capital", "label": "Капитал", "aliases": ["капитал", "capital"]},
    {"key": "company_description", "label": "Описание компании", "aliases": ["описание", "description", "о компании"]},
    {"key": "is_working_site", "label": "Сайт работает", "aliases": ["сайт работает", "рабочий сайт", "is working site"]},
    {"key": "employee_name", "label": "Контактное лицо", "aliases": ["контактное лицо", "фио", "employee name", "name"]},
    {"key": "employee_job_title", "label": "Должность", "aliases": ["должность", "job title", "position"]},
    {"key": "employee_phone", "label": "Телефон контактного лица", "aliases": ["телефон контактного лица", "employee phone"]},
    {"key": "employee_email", "label": "Email контактного лица", "aliases": ["email контактного лица", "employee email"]},
    {"key": "clients", "label": "Клиенты", "aliases": ["клиенты", "clients", "портфолио"]},
    {"key": "partners", "label": "Партнёры", "aliases": ["партнеры", "партнёры", "partners"]},
]


CATALOG_BY_KEY = {field["key"]: field for field in OUTPUT_FIELD_CATALOG}

