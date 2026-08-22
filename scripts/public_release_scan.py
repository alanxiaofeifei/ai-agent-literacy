#!/usr/bin/env python3
"""Fail closed if tracked public files contain credential-like data or private paths."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve()


def tracked_files() -> list[Path]:
    raw = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    return [ROOT / part.decode() for part in raw.split(b"\0") if part]


def main() -> int:
    patterns = {
        "OpenAI-like key": re.compile(rb"\b" + b"sk" + rb"-[A-Za-z0-9_-]{20,}"),
        "GitHub token": re.compile(rb"\b(?:" + b"ghp" + b"|" + b"github_pat" + rb")_[A-Za-z0-9_]{20,}"),
        "AWS access key": re.compile(rb"\b" + b"AKIA" + rb"[A-Z0-9]{16}\b"),
        "Private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        "Bearer token": re.compile(rb"(?i)Bearer\s+[A-Za-z0-9._-]{24,}"),
        "Telegram bot token": re.compile(rb"\b\d{8,10}:[A-Za-z0-9_-]{30,}"),
        "Private WSL/home path": re.compile(rb"/home/[A-Za-z0-9._-]+/|/mnt/[a-z]/(?:Users|Documents)/"),
        "Private Windows path": re.compile(rb"[A-Za-z]:\\(?:Users|Documents)\\"),
    }
    suspicious_name_parts = (".env", "auth.json", "credentials", "cookies", "browser-profile", "session.log")
    hits: list[dict[str, str]] = []
    suspicious_names: list[str] = []
    oversized: list[str] = []
    files = tracked_files()

    for path in files:
        rel = str(path.relative_to(ROOT))
        if any(part in path.name.lower() for part in suspicious_name_parts):
            suspicious_names.append(rel)
        if path.stat().st_size > 50_000_000:
            oversized.append(rel)
        if path.resolve() == SELF:
            continue
        data = path.read_bytes()
        for label, pattern in patterns.items():
            if pattern.search(data):
                hits.append({"file": rel, "pattern": label})

    report = {
        "passed": not (hits or suspicious_names or oversized),
        "tracked_files": len(files),
        "total_bytes": sum(path.stat().st_size for path in files),
        "sensitive_pattern_hits": hits,
        "suspicious_filenames": suspicious_names,
        "oversized_files": oversized,
    }
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
