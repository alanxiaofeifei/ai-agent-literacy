#!/usr/bin/env python3
"""Real Chromium interaction test for the English course over CDP."""
from __future__ import annotations

import argparse
import asyncio
import json
import urllib.parse

import requests
import websockets


class CDP:
    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self.ws = None
        self.seq = 0
        self.pending = {}
        self.events = asyncio.Queue()
        self.reader = None

    async def __aenter__(self):
        self.ws = await websockets.connect(self.ws_url, max_size=20 * 1024 * 1024)
        self.reader = asyncio.create_task(self._read())
        return self

    async def __aexit__(self, *_):
        if self.reader:
            self.reader.cancel()
        if self.ws:
            await self.ws.close()

    async def _read(self):
        assert self.ws is not None
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg and msg["id"] in self.pending:
                fut = self.pending.pop(msg["id"])
                if not fut.done():
                    fut.set_result(msg)
            elif "method" in msg:
                await self.events.put(msg)

    async def call(self, method: str, params: dict | None = None):
        self.seq += 1
        ident = self.seq
        fut = asyncio.get_running_loop().create_future()
        self.pending[ident] = fut
        assert self.ws is not None
        await self.ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
        msg = await asyncio.wait_for(fut, 20)
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg.get("result", {})

    async def evaluate(self, expression: str):
        result = await self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
            "userGesture": True,
        })
        if result.get("exceptionDetails"):
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")


async def wait_for(cdp: CDP, expression: str, timeout: float = 15):
    start = asyncio.get_running_loop().time()
    while asyncio.get_running_loop().time() - start < timeout:
        try:
            if await cdp.evaluate(expression):
                return
        except Exception:
            pass
        await asyncio.sleep(0.15)
    raise TimeoutError(expression)


async def main_async(args):
    endpoint = f"http://127.0.0.1:{args.port}"
    url = "file://" + str(args.html.resolve())
    target = requests.put(f"{endpoint}/json/new?{urllib.parse.quote(url, safe=':/')}" , timeout=10).json()
    checks = {}
    async with CDP(target["webSocketDebuggerUrl"]) as cdp:
        await cdp.call("Page.enable")
        await cdp.call("Runtime.enable")
        await wait_for(cdp, "Boolean(window.__COURSE_TEST__ && document.querySelector('#timeline-list article'))")

        counts = await cdp.evaluate("window.__COURSE_TEST__.counts()")
        checks["counts"] = counts
        assert counts["timeline"] == 33 and counts["concepts"] >= 60 and counts["quizzes"] >= 16 and counts["learningResources"] >= 35
        resources = await cdp.evaluate("""(()=>{
          const all=window.COURSE_DATA.learningResources;
          const direct=['https://www.youtube.com/watch?v=wjZofJX0v4M','https://www.bilibili.com/video/BV1yC4y127uj'];
          const linksPresent=all.every(item=>{
            const card=document.querySelector(`[data-resource-id="${CSS.escape(item.id)}"]`);
            return card && [...card.querySelectorAll('a')].some(a=>a.href===item.url);
          });
          const platform=document.querySelector('[data-testid=learning-platform-filter]');
          platform.value='Bilibili';
          platform.dispatchEvent(new Event('change',{bubbles:true}));
          const cards=[...document.querySelectorAll('#learning-resource-list article')];
          const repost=cards.find(card=>card.innerText.includes('AI for Everyone'));
          const result={total:all.length,linksPresent,directPresent:direct.every(url=>all.some(item=>item.url===url)),cards:cards.length,platforms:cards.map(card=>card.dataset.platform),repostText:repost?.innerText||'',safeLinks:cards.every(card=>{const a=card.querySelector('a');return a?.target==='_blank'&&a?.rel==='noopener noreferrer';})};
          platform.value='';
          platform.dispatchEvent(new Event('change',{bubbles:true}));
          return result;
        })()""")
        checks["learning_resources"] = resources
        assert resources["total"] >= 35 and resources["linksPresent"] and resources["directPresent"]
        assert resources["cards"] == 10 and all(platform == "Bilibili" for platform in resources["platforms"])
        assert "Non-official repost" in resources["repostText"] and resources["safeLinks"]
        await cdp.evaluate("window.__COURSE_TEST__.resetForTest()")

        initial = await cdp.evaluate("window.__COURSE_TEST__.getState()")
        checks["initial_state"] = initial
        certificate_initial = await cdp.evaluate("({disabled:document.querySelector('[data-testid=certificate-print]').disabled,status:document.querySelector('#certificate-status').textContent,requirements:window.__COURSE_TEST__.getCertificateRequirements()})")
        checks["certificate_initial_gate"] = certificate_initial
        assert certificate_initial["disabled"] and len(certificate_initial["requirements"]) == 8 and any(not item["done"] for item in certificate_initial["requirements"])
        beginner_views = await cdp.evaluate("[...document.querySelectorAll('#concept-list article:first-child details[data-concept-view][open]')].map(x=>x.dataset.conceptView)")
        checks["beginner_default_views"] = beginner_views
        if initial["audience"] == "beginner":
            assert beginner_views == ["Plain-language explanation", "Everyday analogy"]

        audience = await cdp.evaluate("document.querySelector('[data-testid=audience-engineer]').click(); ({audience:document.documentElement.dataset.audience,state:window.__COURSE_TEST__.getState().audience,views:[...document.querySelectorAll('#concept-list article:first-child details[data-concept-view][open]')].map(x=>x.dataset.conceptView)})")
        checks["audience_switch"] = audience
        assert audience["audience"] == "engineer" and audience["state"] == "engineer" and audience["views"] == ["Professional definition", "IT analogy"]

        theme = await cdp.evaluate("document.querySelector('[data-testid=theme-toggle]').click(); ({theme:document.documentElement.dataset.theme,state:window.__COURSE_TEST__.getState().theme})")
        checks["theme_switch"] = theme
        assert theme["theme"] == theme["state"]

        timeline = await cdp.evaluate("document.querySelector('[data-action=timeline-year][data-value=\"2024\"]').click(); ({cards:document.querySelectorAll('#timeline-list article').length, years:[...document.querySelectorAll('#timeline-list [class=status-label]')].map(x=>x.textContent.slice(0,4))})")
        checks["timeline_filter"] = timeline
        assert timeline["cards"] > 0 and timeline["cards"] < 33 and all(y == "2024" for y in timeline["years"])

        modal = await cdp.evaluate("document.querySelector('#timeline-list [data-action=timeline-detail]').click(); ({open:document.querySelector('#course-modal').open,title:document.querySelector('#modal-title').textContent,links:document.querySelectorAll('#modal-content a').length})")
        checks["timeline_modal"] = modal
        assert modal["open"] and modal["links"] >= 1
        await cdp.evaluate("document.querySelector('[data-testid=modal-close]').click()")

        xp = await cdp.evaluate("document.querySelector('#timeline-list [data-action=timeline-learn]').click(); const a=window.__COURSE_TEST__.getState().xp; document.querySelector('#timeline-list [data-action=timeline-learn]').click(); ({first:a,second:window.__COURSE_TEST__.getState().xp})")
        checks["xp_dedupe"] = xp
        assert xp["first"] == xp["second"]

        concepts = await cdp.evaluate("const x=document.querySelector('[data-testid=concept-search]'); x.value='MCP'; x.dispatchEvent(new Event('input',{bubbles:true})); ({cards:document.querySelectorAll('#concept-list article').length,text:document.querySelector('#concept-list').innerText.slice(0,300)})")
        checks["concept_search"] = concepts
        assert 0 < concepts["cards"] < counts["concepts"] and "MCP" in concepts["text"]

        loop = await cdp.evaluate("document.querySelector('[data-testid=loop-reset]').click(); document.querySelector('[data-testid=loop-fault]').click(); for(let i=0;i<5;i++) document.querySelector('[data-testid=loop-step]').click(); ({log:document.querySelector('#loop-log').textContent,status:document.querySelector('#loop-status').textContent})")
        checks["loop_fault"] = loop
        assert "retry 2 / 2" in loop["log"].lower() and "stop safely" in loop["log"].lower()

        quota = await cdp.evaluate("const p=document.querySelector('[data-testid=quota-platform]'); p.selectedIndex=1; p.dispatchEvent(new Event('change',{bubbles:true})); const q=document.querySelector('[data-testid=quota-plan]'); if(q.options.length>1) q.selectedIndex=1; document.querySelector('[data-testid=quota-intensity]').value='heavy'; document.querySelector('[data-testid=quota-run]').click(); document.querySelector('#quota-result').innerText")
        checks["quota_simulator"] = quota
        assert "30" in quota and "teaching simulation" in quota.lower() and "official console" in quota.lower()

        memory = await cdp.evaluate("document.querySelector('[data-action=memory-example]').click(); document.querySelector('input[name=memory-place][value=user]').click(); document.querySelector('[data-testid=memory-check]').click(); document.querySelector('#memory-result').innerText")
        checks["memory_sandbox"] = memory
        assert "placement correct" in memory.lower() and "USER" in memory
        secret_memory = await cdp.evaluate("(()=>{const prompt=document.querySelector('[data-testid=memory-prompt]'); prompt.value='ghp_'+'0123456789abcdefTOKEN'; document.querySelector('input[name=memory-place][value=memory]').click(); document.querySelector('[data-testid=memory-check]').click(); return document.querySelector('#memory-result').innerText})()")
        checks["memory_secret_shape"] = secret_memory
        assert "do not save" in secret_memory.lower() and "revoke or rotate" in secret_memory.lower()
        redacted_memory = await cdp.evaluate("(()=>{const prompt=document.querySelector('[data-testid=memory-prompt]'); prompt.value='«redacted:ghp_…»'; document.querySelector('input[name=memory-place][value=memory]').click(); document.querySelector('[data-testid=memory-check]').click(); return document.querySelector('#memory-result').innerText})()")
        checks["memory_redacted_secret"] = redacted_memory
        assert "do not save" in redacted_memory.lower() and "revoke or rotate" in redacted_memory.lower()

        decision = await cdp.evaluate("const t=document.querySelector('input[name=decision-task]'); t.value='Read a public webpage and summarize it'; document.querySelector('[data-testid=decision-start]').click(); ({text:document.querySelector('#decision-result').innerText,steps:document.querySelectorAll('#decision-result details').length})")
        checks["control_decision"] = decision
        assert decision["steps"] == counts["controlQuestions"] and "minimum" in decision["text"].lower()

        quiz = await cdp.evaluate("const card=document.querySelector('#quiz-list article'); const id=card.dataset.questionId; const option=card.querySelector('[data-action=answer]'); option.click(); ({id,feedback:card.innerText,state:window.__COURSE_TEST__.getState()})")
        checks["quiz_feedback"] = {"id": quiz["id"], "has_explanation": "Correct" in quiz["feedback"] or "Incorrect" in quiz["feedback"] or "Safety boundary" in quiz["feedback"]}
        assert checks["quiz_feedback"]["has_explanation"]

        before_reload = await cdp.evaluate("window.__COURSE_TEST__.getState()")
        await cdp.call("Page.reload", {"ignoreCache": True})
        await wait_for(cdp, "Boolean(window.__COURSE_TEST__)")
        after_reload = await cdp.evaluate("window.__COURSE_TEST__.getState()")
        checks["persistence"] = {"before": before_reload, "after": after_reload}
        assert before_reload["audience"] == after_reload["audience"] and before_reload["xp"] == after_reload["xp"]

        reset = await cdp.evaluate("document.querySelector('[data-testid=progress-reset]').click(); ({open:document.querySelector('#course-modal').open,hasConfirm:Boolean(document.querySelector('[data-action=modal-reset-confirm]'))})")
        checks["reset_confirmation"] = reset
        assert reset == {"open": True, "hasConfirm": True}

        layout = await cdp.evaluate("({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyWidth:document.body.getBoundingClientRect().width})")
        checks["layout"] = layout
        assert layout["scrollWidth"] <= layout["clientWidth"] + 1

        await cdp.evaluate("document.querySelector('[data-testid=modal-close]').click()")
        await cdp.call("Emulation.setDeviceMetricsOverride", {"width": 360, "height": 800, "deviceScaleFactor": 1, "mobile": False})
        await cdp.call("Page.reload", {"ignoreCache": True})
        await wait_for(cdp, "Boolean(window.__COURSE_TEST__ && document.querySelector('[data-testid=mobile-section-nav]'))")
        mobile_nav = await cdp.evaluate("const n=document.querySelector('[data-testid=mobile-section-nav]'); n.value='sources'; n.dispatchEvent(new Event('change',{bubbles:true})); ({options:n.options.length,bottom:getComputedStyle(document.querySelector('.bottom-progress')).display,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})")
        await asyncio.sleep(0.8)
        mobile_focus = await cdp.evaluate("({active:document.activeElement.id,selected:document.querySelector('[data-testid=mobile-section-nav]').value})")
        checks["mobile_navigation"] = {"layout": mobile_nav, "focus": mobile_focus}
        assert mobile_nav["options"] == 15 and mobile_nav["bottom"] == "none" and mobile_nav["scrollWidth"] <= mobile_nav["clientWidth"] + 1 and mobile_focus["active"] == "sources"

        certificate_complete = await cdp.evaluate("""(()=>{
          window.__COURSE_TEST__.resetForTest();
          document.querySelector('[data-testid=audience-beginner]').click();
          for (const item of window.COURSE_DATA.timeline.slice(0,5)) document.querySelector(`[data-timeline-id="${item.id}"] [data-action="timeline-learn"]`).click();
          for (const item of window.COURSE_DATA.concepts.slice(0,8)) document.querySelector(`[data-concept-id="${CSS.escape(item.id)}"] [data-action="concept-learn"]`).click();
          for (const item of window.COURSE_DATA.hermesModules.slice(0,5)) document.querySelector(`[data-module-id="${CSS.escape(item.id)}"] [data-action="hermes-complete"]`).click();
          document.querySelector('[data-testid=loop-reset]').click();
          for (let i=0;i<6;i++) document.querySelector('[data-testid=loop-step]').click();
          for (const item of window.COURSE_DATA.quizzes.filter(x=>x.category==='Safety').slice(0,5)) {
            const card=document.querySelector(`[data-question-id="${CSS.escape(item.id)}"][data-question-type="quiz"]`);
            [...card.querySelectorAll('[data-action="answer"]')].find(x=>Number(x.dataset.value.split('|').at(-1))===Number(item.answer)).click();
          }
          for (const item of window.COURSE_DATA.scenarios.slice(0,3)) {
            const card=document.querySelector(`[data-question-id="${CSS.escape(item.id)}"][data-question-type="scenario"]`);
            [...card.querySelectorAll('[data-action="answer"]')].find(x=>Number(x.dataset.value.split('|').at(-1))===Number(item.answer)).click();
          }
          document.querySelector('[data-testid=audience-engineer]').click();
          for (const item of window.COURSE_DATA.timeline.slice(5,8)) document.querySelector(`[data-timeline-id="${item.id}"] [data-action="timeline-learn"]`).click();
          return {disabled:document.querySelector('[data-testid=certificate-print]').disabled,requirements:window.__COURSE_TEST__.getCertificateRequirements(),badges:window.__COURSE_TEST__.getState().badges};
        })()""")
        checks["certificate_completion_gate"] = certificate_complete
        assert not certificate_complete["disabled"] and all(item["done"] for item in certificate_complete["requirements"]) and "dual-track-graduate" in certificate_complete["badges"] and "safety-keeper" in certificate_complete["badges"]
        certificate_print = await cdp.evaluate("window.__printed=0; window.print=()=>window.__printed++; document.querySelector('[data-testid=certificate-print]').click(); window.__printed")
        checks["certificate_print"] = certificate_print
        assert certificate_print == 1

    print(json.dumps({"passed": True, "checks": checks}, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=lambda x: __import__("pathlib").Path(x))
    ap.add_argument("--port", type=int, default=9333)
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
