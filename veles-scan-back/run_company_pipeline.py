from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import run_python


STEPS: list[tuple[int, str, str]] = [
    (1, "Сбор компаний с Checko", "stage_01_collect_from_checko.py"),
    (2, "Подготовка активных компаний с сайтами", "stage_02_prepare_active_sites_input.py"),
    (3, "OpenAI-обогащение сайтов", "stage_03_enrich_sites_with_openai.py"),
    (4, "Дедупликация OpenAI JSON", "stage_04_deduplicate_openai_json.py"),
    (5, "Слияние OpenAI данных в Excel", "stage_05_merge_openai_into_excel.py"),
    (6, "Дедупликация контактных колонок", "stage_06_deduplicate_contacts.py"),
    (7, "Нормализация сотрудников", "stage_07_normalize_employee_names.py"),
    (8, "Добавление листов клиентов и партнеров", "stage_08_add_clients_and_partners_sheets.py"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Единый конвейер обогащения компаний.")
    parser.add_argument(
        "--from-step",
        type=int,
        default=2,
        help="Номер шага старта (по умолчанию: 2).",
    )
    parser.add_argument(
        "--to-step",
        type=int,
        default=8,
        help="Номер шага завершения (по умолчанию: 8).",
    )
    parser.add_argument(
        "--batch",
        type=str,
        default=None,
        help="Опциональный batch для шага 1.",
    )
    args = parser.parse_args()

    if args.from_step > args.to_step:
        raise ValueError("--from-step не может быть больше --to-step")

    valid_ids = {step_id for step_id, _, _ in STEPS}
    if args.from_step not in valid_ids or args.to_step not in valid_ids:
        raise ValueError(f"Шаг должен быть в диапазоне {min(valid_ids)}..{max(valid_ids)}")

    base_dir = Path(__file__).resolve().parent
    for step_id, title, script_name in STEPS:
        if step_id < args.from_step or step_id > args.to_step:
            continue
        script = base_dir / script_name
        print(f"\n=== Шаг {step_id}: {title} ===")
        if step_id == 1 and args.batch:
            run_python(script, "--batch", args.batch, cwd=base_dir)
        else:
            run_python(script, cwd=base_dir)

    print("\n[OK] Конвейер завершен.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}")
        sys.exit(1)
