from __future__ import annotations

import json
import argparse
import sys
import os
import glob
from typing import Any, List, Dict, Tuple

from common import ARTIFACTS_DIR


def load_records(path: str) -> List[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return [data]
        raise ValueError("JSON не является ни списком, ни объектом.")
    except json.JSONDecodeError:
        records = []
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                s = line.strip()
                if not s:
                    continue
                try:
                    rec = json.loads(s)
                    if isinstance(rec, dict):
                        records.append(rec)
                    else:
                        raise ValueError(f"Строка {i}: запись не является объектом JSON.")
                except json.JSONDecodeError as e:
                    raise ValueError(f"Не удалось распарсить JSON на строке {i}: {e}") from e
        return records


def measure_element(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value)
    try:
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    except Exception:  # noqa: BLE001
        return len(str(value))


def best_element_score(ci_value: Any) -> int:
    if isinstance(ci_value, list):
        return max((measure_element(e) for e in ci_value), default=0)
    return measure_element(ci_value)


def dedup(records: List[Dict[str, Any]], key_field: str = "start_url", info_field: str = "company_info") -> List[Dict[str, Any]]:
    best: Dict[Any, Tuple[int, int, Dict[str, Any]]] = {}
    for idx, rec in enumerate(records):
        key = rec.get(key_field, None)
        if key is None:
            key = ("__MISSING__", idx)
        score = best_element_score(rec.get(info_field))
        if key not in best:
            best[key] = (score, idx, rec)
            continue
        cur_score, cur_idx, _ = best[key]
        if score > cur_score:
            best[key] = (score, cur_idx, rec)
    selected = sorted(best.values(), key=lambda t: t[1])
    return [rec for _, first_idx, rec in selected]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Дедупликация OpenAI JSON по start_url по максимальной полноте company_info."
    )
    parser.add_argument(
        "-i",
        "--input",
        default=str(ARTIFACTS_DIR / "company_info_gpt_raw.json"),
        help="Входной файл или маска",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=str(ARTIFACTS_DIR / "company_info_gpt_dedup.json"),
        help="Выходной JSON-файл",
    )
    parser.add_argument("--key", default="start_url")
    parser.add_argument("--info", default="company_info")
    args = parser.parse_args()

    pattern = args.input
    files = sorted(glob.glob(pattern)) if any(ch in pattern for ch in ["*", "?", "["]) else ([pattern] if os.path.exists(pattern) else [])
    if not files:
        print(f"Файлы по шаблону/пути не найдены: {pattern}", file=sys.stderr)
        sys.exit(1)
    files = [fp for fp in files if os.path.abspath(fp) != os.path.abspath(args.output)]
    if not files:
        print("Нет входных файлов (после исключения файла вывода).", file=sys.stderr)
        sys.exit(1)

    all_records: List[Dict[str, Any]] = []
    for fp in files:
        try:
            all_records.extend(load_records(fp))
        except Exception as e:  # noqa: BLE001
            print(f"Пропуск файла {fp}: {e}", file=sys.stderr)

    before = len(all_records)
    result = dedup(all_records, key_field=args.key, info_field=args.info)
    after = len(result)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Готово. Исходных записей: {before}, после дедупликации: {after}, удалено дублей: {before - after}.")
    print(f"Обновлённый файл: {args.output}")
    print("[OK] Stage 04 completed.")


if __name__ == "__main__":
    main()
