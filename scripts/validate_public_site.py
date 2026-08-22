#!/usr/bin/env python3
"""Validate the bilingual public GitHub Pages artifact without dependencies."""
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Doc(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.runtime_assets: list[str] = []
        self.links: list[str] = []
        self.lang = ""
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        data = {k: v for k, v in attrs if v is not None}
        if tag == "html": self.lang = data.get("lang", "")
        if data.get("id"): self.ids.append(data["id"])
        if tag == "title": self._in_title = True
        if tag == "a" and data.get("href"): self.links.append(data["href"])
        if tag in {"script", "link", "img", "iframe", "source", "video", "audio"}:
            for key in ("src", "href", "poster"):
                value = data.get(key, "")
                if re.match(r"^(?:https?:)?//", value): self.runtime_assets.append(value)

    def handle_endtag(self, tag):
        if tag == "title": self._in_title = False

    def handle_data(self, data):
        if self._in_title: self.title += data


def validate_html(path: Path, language: str, required: list[str], alternate: str) -> list[str]:
    errors: list[str] = []
    raw = path.read_text(encoding="utf-8")
    parser = Doc(); parser.feed(raw)
    if parser.lang != language: errors.append(f"{path}: html lang={parser.lang!r}, expected {language!r}")
    if not parser.title.strip(): errors.append(f"{path}: missing title")
    duplicates = sorted({x for x in parser.ids if parser.ids.count(x) > 1})
    if duplicates: errors.append(f"{path}: duplicate ids {duplicates[:10]}")
    if parser.runtime_assets: errors.append(f"{path}: external runtime dependencies {parser.runtime_assets[:5]}")
    for text in required:
        if text not in raw: errors.append(f"{path}: missing required text {text!r}")
    if alternate not in raw: errors.append(f"{path}: missing language link {alternate!r}")
    if "2026-08-22" not in raw: errors.append(f"{path}: missing knowledge verification date")
    if not re.search(r"quarter|季度", raw, re.I): errors.append(f"{path}: missing quarterly review note")
    if re.search(r"\b(?:TODO|TBD|FIXME)\b", raw, re.I): errors.append(f"{path}: contains placeholder marker")
    return errors


def main() -> int:
    required_files = [
        ROOT / "index.html", ROOT / "en/index.html", ROOT / "README.md",
        ROOT / "README_EN.md", ROOT / "LICENSE", ROOT / "QUARTERLY_UPDATE_POLICY.md",
    ]
    errors = [f"missing file: {p}" for p in required_files if not p.is_file()]
    if errors:
        print("\n".join(errors)); return 1

    errors += validate_html(
        ROOT / "index.html", "zh-CN",
        ["生成式人工智能", "AI Agent", "通用 IT", "Hermes", "OpenClaw", "拓展学习"],
        "en/",
    )
    errors += validate_html(
        ROOT / "en/index.html", "en",
        ["Generative AI", "AI Agent", "general IT", "Hermes", "OpenClaw", "Further Learning"],
        "../",
    )

    public_text = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in required_files if p.suffix in {".html", ".md"})
    sensitive = {
        "OpenAI-like key": r"\bsk-[A-Za-z0-9_-]{20,}",
        "GitHub token": r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}",
        "Private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        "Bearer token": r"(?i)Bearer\s+[A-Za-z0-9._-]{24,}",
        "Private absolute path": r"/mnt/[a-z]/(?:Users|Documents)/|[A-Za-z]:\\\\(?:Users|Documents)\\\\",
    }
    for name, pattern in sensitive.items():
        if re.search(pattern, public_text): errors.append(f"sensitive pattern found: {name}")

    if errors:
        print("PUBLIC SITE VALIDATION FAILED")
        for error in errors: print(f"- {error}")
        return 1
    print("PUBLIC SITE VALIDATION PASSED")
    print("- Chinese and English standalone entries present")
    print("- No external runtime dependencies")
    print("- Knowledge date and quarterly policy present")
    print("- No blocked sensitive patterns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
