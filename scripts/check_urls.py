#!/usr/bin/env python3
"""Extract HTTP(S) URLs from a text file and check reachability with curl."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

URL_RE = re.compile(r"https?://[^\s<>()`\]\[\"']+")


def check(url: str) -> dict:
    clean = url.rstrip(".,;:，。；：")
    proc = subprocess.run(
        [
            "curl", "-L", "--compressed", "-A", "Mozilla/5.0",
            "--silent", "--show-error", "--output", "/dev/null",
            "--max-time", "35", "--write-out", "%{http_code}\t%{url_effective}", clean,
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    parts = proc.stdout.strip().split("\t", 1)
    status = int(parts[0]) if parts and parts[0].isdigit() else 0
    final_url = parts[1] if len(parts) > 1 else clean
    reachable = proc.returncode == 0 and (200 <= status < 400 or status in {401, 403, 405, 429})
    return {
        "url": clean,
        "status": status,
        "final_url": final_url,
        "reachable": reachable,
        "curl_exit": proc.returncode,
        "error": proc.stderr.strip()[:300],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--out", default="url-check.json")
    args = parser.parse_args()
    text = Path(args.path).read_text(encoding="utf-8")
    urls = sorted(set(URL_RE.findall(text)))
    results = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(check, url): url for url in urls}
        for future in as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda row: row["url"])
    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    bad = [row for row in results if not row["reachable"]]
    print(f"urls={len(results)} reachable={len(results)-len(bad)} failed={len(bad)}")
    for row in bad:
        print(f"FAIL {row['status']} exit={row['curl_exit']} {row['url']} {row['error']}")
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
