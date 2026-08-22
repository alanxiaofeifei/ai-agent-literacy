#!/usr/bin/env python3
"""Verify bilingual links over file:// with a running CDP browser."""
from __future__ import annotations
import argparse, asyncio, json, urllib.parse
import requests
from test_course_cdp import CDP, wait_for


async def run(args):
    endpoint = f"http://127.0.0.1:{args.port}"
    url = "file://" + str(args.root.resolve() / "index.html")
    target = requests.put(f"{endpoint}/json/new?{urllib.parse.quote(url, safe=':/')}", timeout=10).json()
    result = {}
    async with CDP(target["webSocketDebuggerUrl"]) as cdp:
        await cdp.call("Page.enable"); await cdp.call("Runtime.enable")
        await wait_for(cdp, "Boolean(window.__COURSE_TEST__ && document.querySelector('[data-testid=lang-switch]'))")
        zh_href = await cdp.evaluate("document.querySelector('[data-testid=lang-switch]').href")
        await cdp.evaluate("document.querySelector('[data-testid=lang-switch]').click()")
        await wait_for(cdp, "location.pathname.endsWith('/en/index.html') && document.documentElement.lang==='en'")
        en_url = await cdp.evaluate("location.href")
        en_href = await cdp.evaluate("document.querySelector('[data-testid=lang-switch]').href")
        await cdp.evaluate("document.querySelector('[data-testid=lang-switch]').click()")
        await wait_for(cdp, "location.pathname.endsWith('/index.html') && !location.pathname.endsWith('/en/index.html') && document.documentElement.lang==='zh-CN'")
        zh_url = await cdp.evaluate("location.href")
        result = {"passed": True, "zh_href": zh_href, "en_url": en_url, "en_href": en_href, "zh_url": zh_url}
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("root", type=lambda x: __import__("pathlib").Path(x)); ap.add_argument("--port", type=int, default=9333)
    asyncio.run(run(ap.parse_args()))


if __name__ == "__main__": main()
