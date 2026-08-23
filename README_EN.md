# AI & AI Agent Interactive Knowledge Atlas

[![Deploy bilingual course to GitHub Pages](https://github.com/alanxiaofeifei/ai-agent-literacy/actions/workflows/pages.yml/badge.svg)](https://github.com/alanxiaofeifei/ai-agent-literacy/actions/workflows/pages.yml)

[中文 README](README.md) · [Live Course](https://alanxiaofeifei.github.io/ai-agent-literacy/) · [Chinese Edition](https://alanxiaofeifei.github.io/ai-agent-literacy/) · [Quarterly Update Policy](QUARTERLY_UPDATE_POLICY.md)

An open-source, bilingual, offline-capable interactive course about generative AI and AI Agents.

## Audience

- **Learners with no IT background** start with plain-language explanations, everyday analogies, and safety boundaries; their route prioritizes model basics, hallucinations, agent loops, tools, memory, and prompt injection.
- **Learners with general IT foundations but limited AI knowledge** use familiar software, systems, networking, cloud, data, security, automation, and operations concepts; their route prioritizes APIs, tool calling, workflows vs. agents, harnesses, MCP, context engineering, evals, and observability.

The routes do more than rename the same page. Switching changes the four-step roadmap, default explanation layers, concept priority order, Hermes module order, and timeline perspective. Both routes still retain all 64 concepts and all 25 Hermes modules so learners can cross-reference the complete atlas.

## Course size

| Module | Count |
|---|---:|
| Core concepts | 64 |
| AI timeline nodes | 33 |
| Major products/frameworks | 56 |
| Coding/Token Plan groups | 8 |
| Hermes learning modules | 25 |
| Hermes/OpenClaw comparison dimensions | 14 |
| Quizzes and scenarios | 24 |
| Official/YouTube/Bilibili learning resources | 43 |
| Official source-ledger entries | 86 |

## What the course covers

- A timeline from the public launch of ChatGPT on 2022-11-30 to the current knowledge date
- LLMs, tokens, context windows, RAG, embeddings, tool calling, and memory
- AI Agents, agent loops, MCP, Agent Skills, plugins, Harness Engineering, and Loop Engineering
- APIs, CLIs, browser automation, CDP, accessibility trees, and computer use
- Major global and Chinese models, chat products, coding agents, personal agent runtimes, and frameworks
- A conditional and fair comparison of Hermes Agent and OpenClaw
- The difference between Chinese Coding/Token Plan subscriptions and production APIs
- Quizzes, scenario challenges, a memory-placement lab, a least-privilege decision guide, XP, badges, and a completion certificate
- Curated official courses plus YouTube and Bilibili extension resources

## Bilingual and offline-capable

- Chinese: `index.html`
- English: `en/index.html`
- Neither edition requires a CDN, remote fonts, remote JavaScript, or remote CSS.
- Official references and extension resources require a network only when the learner opens them.

## Knowledge maintenance

- **Current knowledge verification date: 2026-08-22**
- **Review cadence: quarterly** (January, April, July, and October)
- Updates prioritize official specifications, vendor documentation, product/pricing pages, and first-party engineering posts.
- New terminology and learning resources are normalized and deduplicated against existing names and canonical URLs.
- Prices, quotas, model availability, and permission behavior carry a verification date. Unavailable official evidence is never replaced by a guess.

See the [Quarterly Update Policy](QUARTERLY_UPDATE_POLICY.md).

## Run locally

Open `index.html` directly, or start a static server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

## Validation

```bash
python3 scripts/validate_public_site.py
```

The validator checks both language entries, standalone runtime dependencies, required copy, the knowledge date, language links, source-link presence, sensitive patterns, and basic document structure. Online reachability is checked separately with `python3 scripts/check_urls.py index.html` and the equivalent command for the English page.

## Contributing

Issues and pull requests are welcome for:

- New official learning materials
- New or revised terminology
- Product and subscription changes
- Translation corrections
- Accessibility, interaction, and responsive design improvements

Please include a first-party source, a verification date, and a concise rationale. Never commit real API keys, cookies, tokens, passwords, account screenshots, or private filesystem paths.

## Disclaimer

This project is educational material, not product procurement, financial, legal, or security advice. AI products, prices, quotas, and capabilities change quickly; always check official pages and dashboards.

## License

[MIT License](LICENSE)
