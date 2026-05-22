# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
import json
import sys
import time
import urllib.parse
from pathlib import Path

import wasabi_inventory as inv


DEFAULT_MANIFEST = Path(".tmp") / "wasabi_inventory_full.json"
DEFAULT_OUT = Path(".tmp") / "wasabi_stage_all.sql"


def sql_str(value: object) -> str:
    return "'" + str(value if value is not None else "").replace("'", "''") + "'"


def source_group_for_key(key: str) -> str:
    if key.startswith("referrals/codes/"):
        return "referral_code"
    if key.startswith("imports/line-engine/users-"):
        return "line_engine_user_import"
    if key.startswith("tonyuse/imports/line-engine/cards-"):
        return "line_engine_card_import"
    if key == "shops/action/high-risk/users.json":
        return "member_user"
    if key == "shops/action/high-risk/orders.json":
        return "legacy_order"
    if key == "shops/action/high-risk/points.json":
        return "legacy_points"
    if key == "shops/action/high-risk/point-ledger.json":
        return "legacy_point_ledger"
    if key == "shops/action/data/courses.json":
        return "legacy_course"
    if key == "shops/action/data/products.json":
        return "legacy_product"
    if key == "shops/action/data/videos.json":
        return "legacy_video"
    if key.endswith("snapshot-manifest.json"):
        return "snapshot_manifest"
    return "json_object"


def load_manifest(path: Path) -> list[dict[str, object]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data.get("objects", []))


def get_json(config: dict[str, str], key: str) -> object:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            raw = inv.request_s3(config, "GET", "/" + urllib.parse.quote(key, safe="/"), {})
            return json.loads(raw.decode("utf-8-sig"))
        except Exception as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {key}: {last_error}")


def object_insert(key: str, group: str, raw_json: object, meta: dict[str, object], imported_at: str) -> str:
    raw_text = json.dumps(raw_json, ensure_ascii=False, separators=(",", ":"))
    return (
        "INSERT OR REPLACE INTO wasabi_import_objects "
        "(object_key, source_group, size, last_modified, sha256, imported_at) VALUES "
        f"({sql_str(key)}, {sql_str(group)}, {int(meta.get('size') or len(raw_text.encode('utf-8')))}, "
        f"{sql_str(meta.get('last_modified') or '')}, {sql_str(hashlib.sha256(raw_text.encode('utf-8')).hexdigest())}, "
        f"{sql_str(imported_at)});"
    )


def record_insert(record_id: str, object_key: str, group: str, source_id: str, record: object, imported_at: str, note: str = "") -> str:
    record_json = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    return (
        "INSERT OR REPLACE INTO wasabi_import_records "
        "(id, object_key, source_group, source_id, record_json, mapped_table, mapped_key, status, note, imported_at) VALUES "
        f"({sql_str(record_id)}, {sql_str(object_key)}, {sql_str(group)}, {sql_str(source_id)}, "
        f"{sql_str(record_json)}, '', '', 'staged', {sql_str(note)}, {sql_str(imported_at)});"
    )


def source_id_for_record(group: str, row: object, idx: int, key: str) -> str:
    if not isinstance(row, dict):
        return str(idx)
    if group == "referral_code":
        return str(row.get("ref_code") or Path(key).stem)
    if group == "member_user":
        data = row.get("data") if isinstance(row.get("data"), dict) else row
        return str(data.get("userId") or row.get("key") or idx)
    if group == "line_engine_user_import":
        return str(row.get("line_user_id") or row.get("user_id") or row.get("legacy_row_id") or idx)
    if group == "line_engine_card_import":
        return str(row.get("card_id") or row.get("id") or row.get("code") or idx)
    if group == "legacy_order":
        return str(row.get("orderId") or row.get("id") or idx)
    if group in {"legacy_course", "legacy_product", "legacy_video"}:
        return str(row.get("id") or row.get("code") or idx)
    if group in {"legacy_points", "legacy_point_ledger"}:
        return str(row.get("id") or row.get("userId") or row.get("orderId") or idx)
    return str(row.get("id") or row.get("key") or idx)


def records_for_object(key: str, group: str, data: object) -> list[tuple[str, object, str]]:
    if group == "line_engine_user_import" and isinstance(data, dict):
        imported = data.get("imported")
        if isinstance(imported, list):
            return [(source_id_for_record(group, row, idx, key), row, "line engine imported user row") for idx, row in enumerate(imported)]
    if isinstance(data, list):
        return [(source_id_for_record(group, row, idx, key), row, f"{group} array row") for idx, row in enumerate(data)]
    if isinstance(data, dict):
        return [(source_id_for_record(group, data, 0, key), data, f"{group} object")]
    return [("0", data, f"{group} scalar")]


def record_id(group: str, key: str, source_id: str, idx: int) -> str:
    if group == "referral_code":
        return f"referral:{source_id}"
    digest = hashlib.sha1(f"{group}:{key}:{source_id}:{idx}".encode("utf-8")).hexdigest()
    return f"{group}:{digest}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage all Wasabi JSON data into TravelKeeper D1 staging tables.")
    parser.add_argument("--docx", default=inv.DEFAULT_DOCX)
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--limit", type=int, default=0, help="Optional object limit for dry runs.")
    parser.add_argument("--workers", type=int, default=12, help="Concurrent Wasabi downloads.")
    args = parser.parse_args()

    config = inv.merge_config(inv.config_from_env(), inv.config_from_docx(args.docx))
    objects = load_manifest(Path(args.manifest))
    if args.limit:
        objects = objects[: args.limit]

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    sql: list[str] = [
        "-- Generated by scripts/wasabi_stage_all.py",
        "-- Staging-only import. Does not write production TravelKeeper tables.",
        "PRAGMA foreign_keys = ON;",
    ]
    summary: dict[str, int] = {}
    object_count = 0
    record_count = 0

    json_objects = [meta for meta in objects if str(meta.get("key") or "").lower().endswith(".json")]

    def fetch(meta: dict[str, object]) -> tuple[dict[str, object], object]:
        key = str(meta.get("key") or "")
        return meta, get_json(config, key)

    fetched: list[tuple[dict[str, object], object]] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(fetch, meta) for meta in json_objects]
        for future in as_completed(futures):
            fetched.append(future.result())

    fetched.sort(key=lambda pair: str(pair[0].get("key") or ""))

    for meta, data in fetched:
        key = str(meta.get("key") or "")
        group = source_group_for_key(key)
        sql.append(object_insert(key, group, data, meta, now))
        object_count += 1
        rows = records_for_object(key, group, data)
        for idx, (source_id, record, note) in enumerate(rows):
            sql.append(record_insert(record_id(group, key, source_id, idx), key, group, source_id, record, now, note))
            record_count += 1
        summary[group] = summary.get(group, 0) + len(rows)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(sql) + "\n", encoding="utf-8")
    print(json.dumps({
        "success": True,
        "out": str(out),
        "objects": object_count,
        "records": record_count,
        "by_group": dict(sorted(summary.items())),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
