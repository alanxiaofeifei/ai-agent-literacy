#!/usr/bin/env python3
"""Build the development-time combined course_data.js."""
from __future__ import annotations

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
    meta: p.meta || {}, levels: p.levels || [], badges: p.badges || [],
    timeline: p.timeline || [],
    concepts: [...(p.conceptsFoundation || []), ...(p.conceptsAgent || [])],
    products: p.products || [], subscriptions: p.subscriptions || [],
    hermesModules: p.hermesModules || [], comparison: p.comparison || [],
    quizzes: p.quizzes || [], scenarios: p.scenarios || [],
    memoryExamples: p.memoryExamples || [], controlQuestions: p.controlQuestions || [],
    sources: p.sources || [], learningResources: p.learningResources || []
  };
  delete window.COURSE_PARTS;
})();
'''

body = "\n\n".join((ROOT / name).read_text(encoding="utf-8") for name in PARTS) + BOOTSTRAP
path = ROOT / "course_data.js"
path.write_text(body, encoding="utf-8", newline="\n")
print(f"built={path} bytes={path.stat().st_size}")
