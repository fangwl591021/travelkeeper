# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


DEFAULT_DOCX = r"D:\服務客戶\LINE商機引擎\外站直接串接Wasabi空間讀寫API文件.docx"


def read_docx_text(path: str) -> str:
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    parts: list[str] = []
    for para in root.findall(".//w:p", ns):
        text = "".join(t.text or "" for t in para.findall(".//w:t", ns)).strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


def first_match(text: str, pattern: str) -> str:
    match = re.search(pattern, text, re.I)
    return match.group(1).strip() if match else ""


def config_from_docx(path: str) -> dict[str, str]:
    text = read_docx_text(path)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    start = next((i for i, line in enumerate(lines) if line.startswith("3. 基本連線參數")), 0)

    def table_value(label: str) -> str:
        for i in range(start, min(len(lines), start + 80)):
            if lines[i] == label and i + 1 < len(lines):
                return lines[i + 1].strip()
        return ""

    return {
        "bucket": table_value("Bucket") or first_match(text, r"Bucket\s*\n([A-Za-z0-9._-]+)"),
        "region": table_value("Region") or first_match(text, r"Region\s*\n([a-z0-9-]+)"),
        "endpoint": table_value("Endpoint") or first_match(text, r"Endpoint\s*\n(https://[^\s]+)"),
        "access_key": table_value("Access Key ID") or first_match(text, r"Access Key ID\s*\n([A-Z0-9]+)"),
        "secret_key": table_value("Secret Access Key") or first_match(text, r"Secret Access Key\s*\n([A-Za-z0-9/+_=.-]+)"),
    }


def config_from_env() -> dict[str, str]:
    return {
        "bucket": os.getenv("WASABI_BUCKET", ""),
        "region": os.getenv("WASABI_REGION", ""),
        "endpoint": os.getenv("WASABI_ENDPOINT", ""),
        "access_key": os.getenv("WASABI_ACCESS_KEY_ID", ""),
        "secret_key": os.getenv("WASABI_SECRET_ACCESS_KEY", ""),
    }


def merge_config(env: dict[str, str], doc: dict[str, str]) -> dict[str, str]:
    return {key: env.get(key) or doc.get(key) or "" for key in ["bucket", "region", "endpoint", "access_key", "secret_key"]}


def sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def signing_key(secret_key: str, date_stamp: str, region: str) -> bytes:
    k_date = sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = sign(k_date, region)
    k_service = sign(k_region, "s3")
    return sign(k_service, "aws4_request")


def request_s3(config: dict[str, str], method: str, canonical_uri: str, query: dict[str, str]) -> bytes:
    endpoint = config["endpoint"].rstrip("/")
    region = config["region"]
    bucket = config["bucket"]
    access_key = config["access_key"]
    secret_key = config["secret_key"]

    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.netloc
    params = {k: v for k, v in query.items() if v != ""}
    canonical_query = urllib.parse.urlencode(sorted((k, v) for k, v in params.items() if v != ""), quote_via=urllib.parse.quote)

    canonical_headers = f"host:{host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([
        method,
        f"/{bucket}{canonical_uri}",
        canonical_query,
        canonical_headers,
        signed_headers,
        "UNSIGNED-PAYLOAD",
    ])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    signature = hmac.new(signing_key(secret_key, date_stamp, region), string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    auth = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )
    url = f"{endpoint}/{bucket}{canonical_uri}?{canonical_query}"
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": auth,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def list_objects(config: dict[str, str], prefix: str, max_keys: int) -> list[dict[str, object]]:
    token = ""
    objects: list[dict[str, object]] = []
    while True:
        query = {"list-type": "2", "prefix": prefix, "max-keys": str(min(max_keys, 1000))}
        if token:
            query["continuation-token"] = token
        raw = request_s3(config, "GET", "/", query)
        root = ET.fromstring(raw)
        ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        for item in root.findall("s3:Contents", ns):
            key = item.findtext("s3:Key", default="", namespaces=ns)
            size = int(item.findtext("s3:Size", default="0", namespaces=ns))
            last_modified = item.findtext("s3:LastModified", default="", namespaces=ns)
            objects.append({
                "key": key,
                "size": size,
                "last_modified": last_modified,
                "ext": Path(key).suffix.lower().lstrip("."),
                "kind": classify_key(key),
            })
            if len(objects) >= max_keys:
                return objects
        truncated = root.findtext("s3:IsTruncated", default="false", namespaces=ns).lower() == "true"
        token = root.findtext("s3:NextContinuationToken", default="", namespaces=ns)
        if not truncated or not token:
            return objects


def classify_key(key: str) -> str:
    lower = key.lower()
    ext = Path(lower).suffix
    if ext in [".json", ".csv", ".xlsx", ".xls", ".tsv", ".sqlite", ".db"]:
        return "candidate_data"
    if any(part in lower for part in ["/orders/", "/members/", "/customers/", "/itineraries/", "/products/", "/line/"]):
        return "business_bucket"
    if ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"]:
        return "asset"
    return "unknown"


def summarize(objects: list[dict[str, object]]) -> dict[str, object]:
    by_ext: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for obj in objects:
        ext = str(obj.get("ext") or "(none)")
        kind = str(obj.get("kind") or "unknown")
        by_ext[ext] = by_ext.get(ext, 0) + 1
        by_kind[kind] = by_kind.get(kind, 0) + 1
    candidates = [obj for obj in objects if obj.get("kind") == "candidate_data"]
    return {
        "total": len(objects),
        "by_ext": dict(sorted(by_ext.items())),
        "by_kind": dict(sorted(by_kind.items())),
        "candidate_data_files": candidates[:80],
    }


def safe_config(config: dict[str, str]) -> dict[str, str]:
    return {
        "bucket": config.get("bucket", ""),
        "region": config.get("region", ""),
        "endpoint": config.get("endpoint", ""),
        "access_key": mask(config.get("access_key", "")),
        "secret_key": "(hidden)" if config.get("secret_key") else "",
    }


def mask(value: str) -> str:
    if len(value) <= 8:
        return "(set)" if value else ""
    return value[:4] + "..." + value[-4:]


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory Wasabi objects before migrating data into TravelKeeper D1.")
    parser.add_argument("--docx", default=DEFAULT_DOCX, help="Optional docx containing Wasabi connection notes.")
    parser.add_argument("--prefix", default=os.getenv("WASABI_PREFIX", ""), help="Object prefix to list, e.g. shops/216/")
    parser.add_argument("--max", type=int, default=500, help="Maximum objects to list.")
    parser.add_argument("--out", default=str(Path(".tmp") / "wasabi_inventory.json"), help="Output JSON manifest.")
    parser.add_argument("--no-docx", action="store_true", help="Use env vars only.")
    args = parser.parse_args()

    doc_cfg: dict[str, str] = {}
    if not args.no_docx and args.docx and Path(args.docx).exists():
        doc_cfg = config_from_docx(args.docx)
    config = merge_config(config_from_env(), doc_cfg)
    missing = [key for key in ["bucket", "region", "endpoint", "access_key", "secret_key"] if not config.get(key)]
    if missing:
        print(json.dumps({"success": False, "missing": missing, "config": safe_config(config)}, ensure_ascii=False, indent=2))
        return 2

    objects = list_objects(config, args.prefix, args.max)
    result = {
        "success": True,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "config": safe_config(config),
        "prefix": args.prefix,
        "summary": summarize(objects),
        "objects": objects,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "success": True,
        "out": str(out),
        "config": result["config"],
        "summary": result["summary"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
