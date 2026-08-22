#!/usr/bin/env python3
"""Deterministically assemble the offline single-file course."""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [
    "data_concepts_foundation.js",
    "data_concepts_agent.js",
    "data_ecosystem.js",
    "data_learning.js",
    "data_resources.js",
]
BOOTSTRAP = r'''
(() => {
  const p = window.COURSE_PARTS || {};
  window.COURSE_DATA = {
    meta: p.meta || {},
    levels: p.levels || [],
    badges: p.badges || [],
    timeline: p.timeline || [],
    concepts: [...(p.conceptsFoundation || []), ...(p.conceptsAgent || [])],
    products: p.products || [],
    subscriptions: p.subscriptions || [],
    hermesModules: p.hermesModules || [],
    comparison: p.comparison || [],
    quizzes: p.quizzes || [],
    scenarios: p.scenarios || [],
    memoryExamples: p.memoryExamples || [],
    controlQuestions: p.controlQuestions || [],
    sources: p.sources || [],
    learningResources: p.learningResources || []
  };
  delete window.COURSE_PARTS;
})();
'''


def safe_inline(js: str) -> str:
    return js.replace("</script", "<\\/script")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="index.html")
    args = ap.parse_args()
    shell = (ROOT / "course_shell.html").read_text(encoding="utf-8")
    data = "\n\n".join((ROOT / name).read_text(encoding="utf-8") for name in PARTS) + BOOTSTRAP
    logic = (ROOT / "course_logic.js").read_text(encoding="utf-8")
    data_tag = '<script src="course_data.js"></script>'
    logic_tag = '<script src="course_logic.js"></script>'
    if shell.count(data_tag) != 1 or shell.count(logic_tag) != 1:
        raise SystemExit("Expected exactly one data and one logic script marker in course_shell.html")
    final = shell.replace(data_tag, f"<script>\n{safe_inline(data)}\n</script>")
    final = final.replace(logic_tag, f"<script>\n{safe_inline(logic)}\n</script>")
    out = ROOT / args.output
    out.write_text(final, encoding="utf-8", newline="\n")
    print(f"built={out} bytes={out.stat().st_size}")


if __name__ == "__main__":
    main()
