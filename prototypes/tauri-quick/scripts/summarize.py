#!/usr/bin/env python3
"""Сводка по CSV лаборатории: доля чистых попыток и перцентили задержек."""
import csv
import sys
from collections import defaultdict


def percentile(values, share):
    if not values:
        return None
    ordered = sorted(values)
    index = min(int(round(share * (len(ordered) - 1))), len(ordered) - 1)
    return ordered[index]


def main(path):
    rows = list(csv.DictReader(open(path)))
    if not rows:
        print("пусто")
        return 1

    by_strategy = defaultdict(list)
    for row in rows:
        by_strategy[row["strategy"]].append(row)

    for strategy, group in by_strategy.items():
        # Столбец extra появился позже; старые CSV читаются без него.
        extra = lambda row: row.get("extra") or "0"
        clean = sum(1 for row in group if row["lost"] == "0" and extra(row) == "0")
        polluted = sum(1 for row in group if row["lost"] == "0" and extra(row) != "0")
        # Пустая ячейка означает, что метка не пришла; она не считается нулём.
        first = [float(row["ms_first_char"]) for row in group if row["ms_first_char"]]
        focus = [float(row["ms_os_focus"]) for row in group if row["ms_os_focus"]]

        print(f"\n{strategy}")
        print(f"  чисто:             {clean}/{len(group)}")
        print(f"  с посторонним вводом: {polluted} (попытка негодна, не потеря)")
        print(f"  символов потеряно: {sum(int(row['lost']) for row in group)}")
        print(f"  первый символ, мс: p50 {percentile(first, 0.5)} "
              f"p95 {percentile(first, 0.95)} (получено {len(first)}/{len(group)})")
        print(f"  фокус ОС, мс:      p50 {percentile(focus, 0.5)} "
              f"p95 {percentile(focus, 0.95)} (получено {len(focus)}/{len(group)})")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/lab.csv"))
