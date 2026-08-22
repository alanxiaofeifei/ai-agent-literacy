# Quarterly Update Runbook / 季度更新执行手册

This repository is reviewed every quarter. The live Hermes scheduled job owns the automated run; this document keeps the process auditable for contributors.

本仓库每季度复核一次。实际自动执行由 Alan 的 Hermes 定时任务负责；本文档记录公开、可审计的更新流程。

## Schedule / 时间

- January 1, April 1, July 1, October 1
- 09:00 Asia/Shanghai when the scheduler host uses Asia/Shanghai

## Required update lanes / 必查范围

1. New or materially changed generative-AI and Agent terminology.
2. Major interaction paradigms and engineering practices, not every model release.
3. Hermes Agent and OpenClaw official capability/security documentation.
4. Chinese Coding/Token Plan prices, quotas, time windows, and API boundaries.
5. Major global/Chinese models, chat products, coding agents, personal agents, and frameworks.
6. Official learning courses and verified YouTube/Bilibili extension resources.
7. Broken, redirected, removed, or duplicated links.

## Source and deduplication rules / 来源与去重

- Prefer specifications and first-party vendor pages.
- Search snippets are discovery leads, not evidence.
- Normalize canonical URLs and concept/product IDs before adding anything.
- Update an existing entry when the concept already exists; do not add aliases as separate concepts.
- Add a timeline node only when it changes the user interaction or engineering paradigm.
- Prices, quotas, availability, and permission behavior need a new verification date.
- Keep Chinese and English facts synchronized.

## Release gates / 发布门

```bash
python3 scripts/build_data.py
python3 scripts/build_course.py --output index.html
python3 scripts/build_data_en.py
python3 scripts/build_course_en.py
python3 scripts/validate_public_site.py
python3 scripts/quarterly_update_check.py --expected-date YYYY-MM-DD
```

Then run JavaScript syntax checks, Chromium interactions in both languages, responsive screenshots, URL checks, and a sensitive-pattern scan. Commit and push only when all gates pass. Verify both the GitHub repository and public Pages URL after deployment.

随后还要执行中英文 JavaScript 语法检查、Chromium 交互、响应式截图、URL 检查和敏感信息扫描。全部通过后才提交推送，并回读 GitHub 仓库和 Pages 网站。
