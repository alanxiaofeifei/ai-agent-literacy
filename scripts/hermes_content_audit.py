#!/usr/bin/env python3
"""Independent Hermes acceptance audit for the final offline course HTML."""
from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


class TextAndLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.links: list[str] = []
        self.ids: list[str] = []
        self.testids: list[str] = []
        self.external_assets: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        data = {key: value for key, value in attrs if value is not None}
        element_id = data.get("id")
        if element_id:
            self.ids.append(element_id)
        testid = data.get("data-testid")
        if testid:
            self.testids.append(testid)
        href = data.get("href")
        if tag == "a" and href:
            self.links.append(href)
        if tag in {"script", "link", "img", "iframe", "source", "video", "audio"}:
            for key in ("src", "href", "poster"):
                value = data.get(key)
                if value and re.match(r"^(?:https?:)?//", value):
                    self.external_assets.append(value)

    def handle_data(self, data: str) -> None:
        self.text.append(data)


CORE_TERMS = [
    "Generative AI", "Foundation Model", "Large Language Model", "Token",
    "Context Window", "Prompt", "System Prompt", "Temperature", "Hallucination",
    "Multimodal", "Embedding", "Vector Database", "Retrieval-Augmented Generation",
    "Fine-tuning", "Inference", "Reasoning Model", "Function Calling", "Tool Calling",
    "Workflow", "AI Agent", "Agent Loop", "Planning", "Reflection", "Memory",
    "Short-term Memory", "Long-term Memory", "Multi-Agent", "Subagent", "Plugin",
    "Model Context Protocol", "Agent Skills", "Harness", "Harness Engineering",
    "Loop Engineering", "Context Engineering", "Sandbox", "Guardrail",
    "Human-in-the-loop", "Observability", "Evaluation", "Prompt Injection",
    "Application Programming Interface", "Command-Line Interface", "Browser Automation",
    "Chrome DevTools Protocol", "Document Object Model", "Accessibility Tree",
    "Computer Use", "Webhook", "Cron", "Gateway", "Profile", "OAuth", "API Key",
    "Rate Limit", "Concurrency",
]

REQUIRED_TEXT = [
    "2022-11-30", "2026-08-22", "零 IT", "通用 IT 技术背景", "IT 技术类比",
    "OpenClaw", "Hermes Agent", "普通个人", "不是绝对", "Session Search",
    "USER.md", "MEMORY.md", "一次 Prompt", "5 小时", "每 7 天",
    "订阅 Key", "普通 API", "教学模拟", "实际以控制台为准",
    "UIPI", "Accessibility", "Screen Recording", "WSL", "dry-run", "rollback",
    "每季度复核一次", "Reviewed quarterly", "English edition",
    "拓展学习", "非官方转载", "可用性、字幕与价格可能变化",
]

FACT_GROUPS = {
    "aliyun_coding": ["¥200", "6,000", "45,000", "90,000"],
    "aliyun_token": ["¥39", "¥139", "¥499", "2,500", "10,000", "40,000"],
    "tencent": ["¥40", "¥200", "1,200", "9,000", "18,000"],
    "kimi": ["Andante", "¥49", "Moderato", "¥99", "Allegretto", "¥199", "Allegro", "¥699"],
    "minimax": ["Plus", "¥49", "Max", "¥119", "Ultra", "¥469"],
    "glm_cn": ["¥118", "¥538", "¥1,078", "2,000", "12,000", "28,000", "140,000"],
    "zai": ["$18", "$80", "$168", "$12.6", "$56", "$117.6"],
}

INTERACTION_MARKERS = [
    "localStorage", "data-testid", "prefers-reduced-motion", "aria-live",
    "role=\"dialog\"", "window.print", "modal-reset-confirm",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--json-out")
    args = ap.parse_args()
    path = Path(args.html)
    raw = path.read_text(encoding="utf-8")
    parser = TextAndLinks()
    parser.feed(raw)
    text = re.sub(r"\s+", " ", " ".join(parser.text))

    missing_terms = [term for term in CORE_TERMS if term.lower() not in text.lower()]
    missing_required = [item for item in REQUIRED_TEXT if item.lower() not in text.lower()]
    missing_facts = {
        name: [item for item in items if item not in text]
        for name, items in FACT_GROUPS.items()
    }
    missing_facts = {k: v for k, v in missing_facts.items() if v}
    missing_markers = [item for item in INTERACTION_MARKERS if item not in raw]
    duplicate_ids = sorted({x for x in parser.ids if parser.ids.count(x) > 1})
    placeholders = sorted(set(re.findall(r"(?i)\b(?:TODO|TBD|FIXME|lorem ipsum)\b", raw)))
    http_links = sorted(set(
        [x for x in parser.links if x.startswith(("http://", "https://"))]
        + re.findall(r"https?://[A-Za-z0-9./?&_=:%+#@~(),;-]+", raw)
    ))
    year_dates = sorted(set(re.findall(r"20(?:22|23|24|25|26)-\d{2}-\d{2}", text)))

    report = {
        "path": str(path.resolve()),
        "bytes": path.stat().st_size,
        "core_terms_present": len(CORE_TERMS) - len(missing_terms),
        "core_terms_total": len(CORE_TERMS),
        "missing_terms": missing_terms,
        "missing_required_text": missing_required,
        "missing_fact_values": missing_facts,
        "missing_interaction_markers": missing_markers,
        "duplicate_ids": duplicate_ids,
        "placeholders": placeholders,
        "external_runtime_assets": parser.external_assets,
        "http_source_links": len(http_links),
        "data_testids": len(set(parser.testids)),
        "dated_timeline_values": len(year_dates),
    }
    report["passed"] = not any([
        missing_terms, missing_required, missing_facts, missing_markers,
        duplicate_ids, placeholders, parser.external_assets,
    ]) and len(http_links) >= 25 and len(set(parser.testids)) >= 12

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.json_out:
        Path(args.json_out).write_text(rendered + "\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
