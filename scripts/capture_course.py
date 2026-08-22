#!/usr/bin/env python3
"""Capture responsive course screenshots through a running CDP endpoint."""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import urllib.parse
from pathlib import Path

import requests

from test_course_cdp import CDP, wait_for


async def capture(args):
    endpoint = f"http://127.0.0.1:{args.port}"
    url = "file://" + str(args.html.resolve())
    target = requests.put(f"{endpoint}/json/new?{urllib.parse.quote(url, safe=':/')}", timeout=10).json()
    async with CDP(target["webSocketDebuggerUrl"]) as cdp:
        await cdp.call("Page.enable")
        await cdp.call("Emulation.setDeviceMetricsOverride", {
            "width": args.width,
            "height": args.height,
            "deviceScaleFactor": 1,
            "mobile": False,
        })
        await cdp.call("Page.reload", {"ignoreCache": True})
        await wait_for(cdp, "Boolean(window.__COURSE_TEST__ && document.querySelector('#concept-list article'))")
        layout = await cdp.evaluate("({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,viewport:[innerWidth,innerHeight],nav:document.querySelector('.course-nav')?.getBoundingClientRect().width||0})")
        shot = await cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(base64.b64decode(shot["data"]))
        print(json.dumps({"output": str(args.output), "width": args.width, "height": args.height, "layout": layout, "passed": layout["scrollWidth"] <= layout["clientWidth"] + 1}, ensure_ascii=False))
        if layout["scrollWidth"] > layout["clientWidth"] + 1:
            raise SystemExit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--port", type=int, default=9333)
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    args = ap.parse_args()
    asyncio.run(capture(args))


if __name__ == "__main__":
    main()
