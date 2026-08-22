#!/usr/bin/env python3
"""Quarterly content/resource deduplication and release preflight."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
RESOURCE_FILES = ["resources.official.json", "resources.youtube.json", "resources.bilibili.json"]


def canonical_url(raw: str) -> str:
    p = urlsplit(raw.strip())
    host = p.netloc.lower().removeprefix("www.")
    path = re.sub(r"/{2,}", "/", p.path)
    if path != "/": path = path.rstrip("/")
    keep = []
    for key, value in parse_qsl(p.query, keep_blank_values=True):
        if key.lower().startswith(("utm_", "ref", "source", "spm")): continue
        if host.endswith("youtube.com") and key != "v": continue
        if host.endswith("bilibili.com") and key not in {"p"}: continue
        keep.append((key, value))
    return urlunsplit((p.scheme.lower() or "https", host, path, urlencode(sorted(keep)), ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--expected-date", default="2026-08-22")
    args = ap.parse_args()
    errors: list[str] = []
    seen: dict[str, str] = {}
    counts: dict[str, int] = {}

    for filename in RESOURCE_FILES:
        path = ROOT / filename
        if not path.is_file(): errors.append(f"missing {filename}"); continue
        data = json.loads(path.read_text(encoding="utf-8"))
        items = data.get("items", [])
        counts[filename] = len(items)
        for index, item in enumerate(items):
            for field in ("name_zh", "name_en", "url", "accessed"):
                if not item.get(field): errors.append(f"{filename}[{index}] missing {field}")
            canonical = canonical_url(item.get("url", ""))
            if canonical in seen: errors.append(f"duplicate canonical URL: {filename}[{index}] and {seen[canonical]}")
            else: seen[canonical] = f"{filename}[{index}]"
            if item.get("accessed") != args.expected_date:
                errors.append(f"{filename}[{index}] accessed={item.get('accessed')}, expected {args.expected_date}")

    for page in (ROOT / "index.html", ROOT / "en/index.html"):
        if not page.is_file(): errors.append(f"missing {page.relative_to(ROOT)}"); continue
        raw = page.read_text(encoding="utf-8")
        if args.expected_date not in raw: errors.append(f"{page.relative_to(ROOT)} missing {args.expected_date}")
        if not re.search(r"quarter|季度", raw, re.I): errors.append(f"{page.relative_to(ROOT)} missing quarterly note")

    report = {
        "passed": not errors,
        "expected_date": args.expected_date,
        "resource_counts": counts,
        "unique_canonical_urls": len(seen),
        "errors": errors,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
