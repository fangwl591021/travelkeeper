# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


DEFAULT_SQL = Path(".tmp") / "wasabi_stage_all.sql"
DEFAULT_OUT = Path("docs") / "wasabi-field-profile.md"


CREATE_SCHEMA = """
CREATE TABLE IF NOT EXISTS wasabi_import_objects (
  object_key TEXT PRIMARY KEY,
  source_group TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  last_modified TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wasabi_import_records (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  source_group TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  record_json TEXT NOT NULL DEFAULT '{}',
  mapped_table TEXT NOT NULL DEFAULT '',
  mapped_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'staged',
  note TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT ''
);
"""


GROUP_NOTES = {
    "referral_code": "可參照 distributors.invite_code，但必須先確認 owner_user_id 是否等於 TravelKeeper 經銷商 uid。",
    "member_user": "可參照 customers 或 distributors；data.role / isAdmin / crmRole 可協助判斷身份。",
    "line_engine_user_import": "偏身份對照資料，可用於 LINE user id 去重與舊資料追蹤。",
    "line_engine_card_import": "偏 LINE 商機卡片資料，目前不直接對應旅遊訂單。",
    "legacy_course": "可參照 itineraries 欄位，但需確認這些 course 是否真的是旅遊行程。",
    "legacy_product": "偏商品資料，不直接等於 TravelKeeper itinerary。",
    "legacy_order": "舊商品/點數訂單，不可直接寫入 TravelKeeper orders，可作歷史參考。",
    "legacy_points": "點數餘額/狀態資料，TravelKeeper 目前沒有等價正式表。",
    "legacy_point_ledger": "點數流水資料，TravelKeeper 目前沒有等價正式表。",
    "legacy_video": "內容素材資料，目前不直接對應正式表。",
    "snapshot_manifest": "快照清單，只做稽核參考。",
    "json_object": "其他 JSON 物件，需人工再分類。",
}


TARGET_HINTS = {
    "distributors": ["uid", "name", "phone", "company", "invite_code", "status", "can_upload", "sales_revenue"],
    "customers": ["owner_uid", "customer_line_uid", "name", "phone", "total_orders", "total_spent"],
    "itineraries": ["id", "title", "region", "days", "price", "image", "description", "owner_uid", "review_status"],
    "orders": ["order_id", "itinerary_id", "distributor_uid", "customer_name", "customer_phone", "total_amount", "status"],
}


def load_rows(sql_path: Path) -> list[tuple[str, str, str]]:
    db = sqlite3.connect(":memory:")
    db.executescript(CREATE_SCHEMA)
    db.executescript(sql_path.read_text(encoding="utf-8"))
    return list(db.execute("SELECT source_group, source_id, record_json FROM wasabi_import_records ORDER BY source_group, source_id"))


def profile(rows: list[tuple[str, str, str]]) -> dict[str, dict[str, object]]:
    groups: dict[str, dict[str, object]] = {}
    counts = Counter(group for group, _, _ in rows)
    top_keys: dict[str, Counter[str]] = defaultdict(Counter)
    nested_data_keys: dict[str, Counter[str]] = defaultdict(Counter)
    examples: dict[str, list[str]] = defaultdict(list)
    for group, source_id, raw in rows:
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if isinstance(obj, dict):
            for key in obj.keys():
                top_keys[group][key] += 1
            data = obj.get("data")
            if isinstance(data, dict):
                for key in data.keys():
                    nested_data_keys[group][key] += 1
        if len(examples[group]) < 5:
            examples[group].append(source_id)

    for group in sorted(counts):
        groups[group] = {
            "count": counts[group],
            "top_keys": [k for k, _ in top_keys[group].most_common()],
            "nested_data_keys": [k for k, _ in nested_data_keys[group].most_common()],
            "example_source_ids": examples[group],
        }
    return groups


def render_markdown(groups: dict[str, dict[str, object]]) -> str:
    lines: list[str] = [
        "# Wasabi field profile for TravelKeeper D1 migration",
        "",
        "Generated from `.tmp/wasabi_stage_all.sql` after full Wasabi inventory.",
        "",
        "This report lists field names only. It intentionally avoids printing customer values or secret material.",
        "",
        "## Summary by source group",
        "",
        "| Source group | Records | Top-level fields | Nested `data` fields | Migration note |",
        "| --- | ---: | --- | --- | --- |",
    ]
    for group, info in groups.items():
        top = ", ".join(info["top_keys"][:16]) or "-"
        nested = ", ".join(info["nested_data_keys"][:16]) or "-"
        note = GROUP_NOTES.get(group, "Needs review.")
        lines.append(f"| `{group}` | {info['count']} | {top} | {nested} | {note} |")

    lines.extend([
        "",
        "## TravelKeeper target fields to protect",
        "",
    ])
    for table, fields in TARGET_HINTS.items():
        lines.append(f"### `{table}`")
        lines.append("")
        lines.append(", ".join(f"`{field}`" for field in fields))
        lines.append("")

    lines.extend([
        "## Recommended next migration order",
        "",
        "1. `referral_code` -> preview against `distributors.uid`; only update `invite_code` after owner UID matches.",
        "2. `member_user` -> preview possible `customers` rows; do not create distributors automatically unless role confirms it.",
        "3. `legacy_course` -> preview possible `itineraries`; keep separate because these may be courses, not travel products.",
        "4. `legacy_order` -> keep as historical staging until a real TravelKeeper order mapping is approved.",
        "",
        "## Safe rule",
        "",
        "Nothing from Wasabi should be upserted into production tables until the preview report shows exact row counts and field mapping.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Profile staged Wasabi JSON fields without exposing values.")
    parser.add_argument("--sql", default=str(DEFAULT_SQL))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    groups = profile(load_rows(Path(args.sql)))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_markdown(groups), encoding="utf-8")
    print(json.dumps({"success": True, "out": str(out), "groups": {k: v["count"] for k, v in groups.items()}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
