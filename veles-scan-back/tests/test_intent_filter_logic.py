from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.api.intent_data_filters import _rebalance_boolean_modes
from stage_02_prepare_active_sites_input import _apply_filter_set


class IntentFilterLogicTests(unittest.TestCase):
    def test_rebalance_boolean_modes_infers_or_and_not(self) -> None:
        filters = [
            {
                "column": "Категория",
                "operator": "contains",
                "value": "банк",
                "value_type": "text",
                "boolean": "must",
                "_boolean_explicit": False,
            },
            {
                "column": "Категория",
                "operator": "contains",
                "value": "страх",
                "value_type": "text",
                "boolean": "must",
                "_boolean_explicit": False,
            },
            {
                "column": "Статус",
                "operator": "contains",
                "value": "ликвидация",
                "value_type": "text",
                "boolean": "must",
                "_boolean_explicit": False,
            },
        ]

        result = _rebalance_boolean_modes(
            "банки или страховые компании без ликвидации",
            filters,
        )

        self.assertEqual(result[0]["boolean"], "should")
        self.assertEqual(result[1]["boolean"], "should")
        self.assertEqual(result[2]["boolean"], "must_not")

    def test_apply_filter_set_supports_must_should_and_must_not(self) -> None:
        df = pd.DataFrame(
            [
                {"Наименование": "Альфа Банк", "Город": "Москва", "Категория": "банк", "Статус": "действующая"},
                {"Наименование": "Омега Страхование", "Город": "Москва", "Категория": "страховая", "Статус": "действующая"},
                {"Наименование": "Торговый Дом", "Город": "Москва", "Категория": "ритейл", "Статус": "действующая"},
                {"Наименование": "Банк Ликвидация", "Город": "Москва", "Категория": "банк", "Статус": "ликвидация"},
                {"Наименование": "Банк Север", "Город": "Санкт-Петербург", "Категория": "банк", "Статус": "действующая"},
            ]
        )
        filters = [
            {"column": "Город", "operator": "contains", "value": "Москва", "value_type": "text", "boolean": "must"},
            {"column": "Категория", "operator": "contains", "value": "банк", "value_type": "text", "boolean": "should"},
            {"column": "Категория", "operator": "contains", "value": "страх", "value_type": "text", "boolean": "should"},
            {"column": "Статус", "operator": "contains", "value": "ликвидация", "value_type": "text", "boolean": "must_not"},
        ]

        result = _apply_filter_set(df, filters, log_prefix="[TEST]")

        self.assertEqual(list(result["Наименование"]), ["Альфа Банк", "Омега Страхование"])

    def test_apply_filter_set_supports_grouped_should_clauses(self) -> None:
        df = pd.DataFrame(
            [
                {"Наименование": "Альфа Банк", "Город": "Москва", "Категория": "банк", "Статус": "действующая"},
                {"Наименование": "Омега Страхование", "Город": "Москва", "Категория": "страховая", "Статус": "действующая"},
                {"Наименование": "Бета Банк", "Город": "Санкт-Петербург", "Категория": "банк", "Статус": "действующая"},
                {"Наименование": "Гамма Ритейл", "Город": "Москва", "Категория": "ритейл", "Статус": "действующая"},
            ]
        )
        filters = [
            {"column": "Категория", "operator": "contains", "value": "банк", "value_type": "text", "boolean": "should", "group": "industry"},
            {"column": "Категория", "operator": "contains", "value": "страх", "value_type": "text", "boolean": "should", "group": "industry"},
            {"column": "Город", "operator": "contains", "value": "москва", "value_type": "text", "boolean": "should", "group": "city"},
            {"column": "Город", "operator": "contains", "value": "санкт", "value_type": "text", "boolean": "should", "group": "city"},
            {"column": "Статус", "operator": "contains", "value": "действ", "value_type": "text", "boolean": "must"},
        ]

        result = _apply_filter_set(df, filters, log_prefix="[TEST]")

        self.assertEqual(
            list(result["Наименование"]),
            ["Альфа Банк", "Омега Страхование", "Бета Банк"],
        )


if __name__ == "__main__":
    unittest.main()