(() => {
  "use strict";

  const DATA = window.COURSE_DATA || {};
  const STORAGE_KEY = "aiAgentCourse.v1";
  const DEFAULT_STATE = Object.freeze({
    audience: "beginner",
    theme: "dark",
    completed: [],
    xp: 0,
    earnedIds: [],
    badges: [],
    wrongAnswers: [],
    reviewItems: []
  });

  let state;
  let storageAvailable = false;
  let toastTimer = 0;
  let modalReturnFocus = null;
  let loopTimer = 0;
  let timelineYear = "all";
  let conceptQuery = "";
  let conceptCategory = "";
  let mobileNavLockUntil = 0;
  let mobileNavRequested = "";
  const productFilter = { region: "", category: "", action: "" };
  const learningFilter = { platform: "", level: "", language: "", keyword: "" };
  const loop = { index: 0, retries: 0, fault: false, stopped: false, logs: ["[ready] 等待开始单步演示…"] };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const asArray = value => Array.isArray(value) ? value : [];
  const uniqueStrings = value => [...new Set(asArray(value).filter(item => typeof item === "string"))];
  const text = value => value == null ? "" : String(value);

  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attributes).forEach(([name, value]) => {
      if (value == null || value === false) return;
      if (name === "className") node.className = value;
      else if (name === "text") node.textContent = text(value);
      else if (name === "dataset") Object.entries(value).forEach(([key, item]) => { node.dataset[key] = text(item); });
      else if (name === "checked") node.checked = Boolean(value);
      else if (name === "selected") node.selected = Boolean(value);
      else if (name in node && !name.startsWith("aria-")) node[name] = value;
      else node.setAttribute(name, text(value));
    });
    const list = Array.isArray(children) ? children : [children];
    list.forEach(child => {
      if (child == null) return;
      node.append(child instanceof Node ? child : document.createTextNode(text(child)));
    });
    return node;
  }

  function appendTextBlock(parent, tag, value, className) {
    if (!value) return null;
    const node = element(tag, { className: className || "", text: value });
    parent.append(node);
    return node;
  }

  function focusSoon(selector, openParent = false) {
    window.setTimeout(() => {
      const node = $(selector);
      if (!node) return;
      if (openParent) {
        const details = node.closest("details");
        if (details) details.open = true;
      }
      node.focus({ preventScroll: true });
    }, 0);
  }

  function button(label, action, value, className = "button") {
    return element("button", {
      type: "button",
      className,
      text: label,
      dataset: { action, value: value == null ? "" : value }
    });
  }

  function link(label, href) {
    return element("a", { href, target: "_blank", rel: "noopener noreferrer", text: label });
  }

  function safeState(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const next = {
      audience: source.audience === "engineer" ? "engineer" : "beginner",
      theme: source.theme === "light" ? "light" : "dark",
      completed: uniqueStrings(source.completed),
      xp: Number.isFinite(source.xp) && source.xp >= 0 ? Math.floor(source.xp) : 0,
      earnedIds: uniqueStrings(source.earnedIds),
      badges: uniqueStrings(source.badges),
      wrongAnswers: uniqueStrings(source.wrongAnswers),
      reviewItems: asArray(source.reviewItems).filter(item => item && typeof item === "object" && typeof item.id === "string").map(item => ({
        id: item.id,
        type: item.type === "scenario" ? "scenario" : "quiz",
        title: text(item.title)
      }))
    };
    if (typeof source.certificateName === "string") next.certificateName = source.certificateName.slice(0, 100);
    return next;
  }

  function initializeStorage() {
    try {
      const probe = `${STORAGE_KEY}.probe`;
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      storageAvailable = true;
    } catch (_error) {
      storageAvailable = false;
    }
    if (!storageAvailable) return safeState(DEFAULT_STATE);
    try {
      return safeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch (_error) {
      return safeState(DEFAULT_STATE);
    }
  }

  function persist() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      storageAvailable = false;
      announce("本地进度暂时无法保存；当前页面内仍可继续学习。");
    }
  }

  function announce(message) {
    const region = $("#app-live-region");
    if (!region) return;
    region.textContent = "";
    window.setTimeout(() => { region.textContent = text(message); }, 20);
  }

  function showToast(points, message) {
    const toast = $("#reward-toast");
    if (!toast) return;
    const strong = $("strong", toast);
    const detail = $("span", toast);
    if (strong) strong.textContent = points > 0 ? `学习光点 +${points} XP` : "学习记录已更新";
    if (detail) detail.textContent = message;
    toast.dataset.state = "visible";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.dataset.state = "idle"; }, 3200);
    announce(`${points > 0 ? `获得 ${points} XP。` : ""}${message}`);
  }

  function earn(id, points, message) {
    if (state.earnedIds.includes(id)) return false;
    state.earnedIds.push(id);
    state.xp += points;
    persist();
    updateRewards();
    showToast(points, message);
    return true;
  }

  function complete(id) {
    if (!state.completed.includes(id)) state.completed.push(id);
  }

  function completeRouteUnit(type, id) {
    complete(`route:${state.audience}:${type}:${id}`);
  }

  function routeProgress() {
    const values = audience => new Set(state.completed.filter(item => item.startsWith(`route:${audience}:`)).map(item => item.slice(`route:${audience}:`.length)));
    const beginner = values("beginner");
    const engineer = values("engineer");
    const beginnerDistinct = [...beginner].filter(item => !engineer.has(item)).length;
    const engineerDistinct = [...engineer].filter(item => !beginner.has(item)).length;
    return { beginner, engineer, beginnerDistinct, engineerDistinct };
  }

  function certificateRequirements() {
    const count = prefix => state.completed.filter(id => id.startsWith(prefix)).length;
    const safetyQuizzes = asArray(DATA.quizzes).filter(item => item.category === "安全");
    const safetyDone = safetyQuizzes.filter(item => state.completed.includes(`quiz:${item.id}`)).length;
    const routes = routeProgress();
    return [
      { label: "标记至少 5 个时间轴节点", done: count("timeline:") >= 5 },
      { label: "掌握至少 8 个核心概念", done: count("concept:") >= 8 },
      { label: "完成至少 5 个 Hermes 模块", done: count("hermes:") >= 5 },
      { label: "完成 Agent Loop 并达到验证停止条件", done: state.completed.includes("loop:complete") },
      { label: `答对至少 ${Math.min(5, safetyQuizzes.length)} 道安全题`, done: safetyDone >= Math.min(5, safetyQuizzes.length) },
      { label: "答对至少 3 个情境挑战", done: count("scenario:") >= 3 },
      { label: "零 IT 基础路线完成至少 3 个单元，且至少 2 个不与 IT 技术路线重复", done: routes.beginner.size >= 3 && routes.beginnerDistinct >= 2 },
      { label: "通用 IT 背景路线完成至少 3 个单元，且至少 2 个不与零基础路线重复", done: routes.engineer.size >= 3 && routes.engineerDistinct >= 2 }
    ];
  }

  function updateCertificateEligibility() {
    const requirements = certificateRequirements();
    const missing = requirements.filter(item => !item.done);
    const buttonNode = $('[data-testid="certificate-print"]');
    const statusNode = $("#certificate-status");
    const requirementsMount = $("#certificate-requirements");
    if (requirementsMount) {
      const list = element("ul");
      requirements.forEach(item => list.append(element("li", { text: `${item.done ? "✓" : "○"} ${item.label}` })));
      requirementsMount.replaceChildren(list);
    }
    if (buttonNode) {
      buttonNode.disabled = missing.length > 0;
      buttonNode.textContent = missing.length ? `完成必修项后可打印（还差 ${missing.length} 项）` : "打印结业证书";
    }
    if (statusNode) statusNode.textContent = missing.length ? `结业门槛：${requirements.filter(item => item.done).length}/${requirements.length} 项完成。` : "已达到结业门槛，可以打印证书。";
    return { requirements, missing };
  }

  function addReview(id, type, title) {
    if (!state.wrongAnswers.includes(id)) state.wrongAnswers.push(id);
    if (!state.reviewItems.some(item => item.id === id)) state.reviewItems.push({ id, type, title });
    persist();
    renderReview();
  }

  function removeReview(id) {
    state.reviewItems = state.reviewItems.filter(item => item.id !== id);
    persist();
    renderReview();
  }

  function currentLevel() {
    const levels = asArray(DATA.levels).slice().sort((a, b) => Number(a.xpMin) - Number(b.xpMin));
    return levels.reduce((found, level) => state.xp >= Number(level.xpMin) ? level : found, levels[0] || { title: "AI 探路者" });
  }

  function totalCompletionUnits() {
    return asArray(DATA.timeline).length + asArray(DATA.concepts).length + asArray(DATA.hermesModules).length +
      asArray(DATA.quizzes).length + asArray(DATA.scenarios).length + 6;
  }

  function updateRewards() {
    evaluateBadges();
    const progressCompleted = state.completed.filter(id => !id.startsWith("route:")).length;
    const percent = Math.min(100, Math.round((progressCompleted / Math.max(1, totalCompletionUnits())) * 100));
    $$('[data-xp]').forEach(node => { node.textContent = `${state.xp} XP`; });
    $$('[data-level]').forEach(node => { node.textContent = currentLevel().title; });
    $$('[data-progress-label]').forEach(node => { node.textContent = `${percent}%`; });
    $$('[data-progress-fill]').forEach(node => { node.style.width = `${percent}%`; });
    $$('.progress-track[role="progressbar"]').forEach(node => node.setAttribute("aria-valuenow", String(percent)));
    renderBadges();
    updateCertificateEligibility();
  }

  function awardBadge(id) {
    if (!asArray(DATA.badges).some(item => item.id === id) || state.badges.includes(id)) return;
    state.badges.push(id);
    persist();
    const badge = asArray(DATA.badges).find(item => item.id === id);
    showToast(0, `解锁徽章：${badge ? badge.title : id}`);
  }

  function evaluateBadges() {
    const countPrefix = prefix => state.completed.filter(id => id.startsWith(prefix)).length;
    const safetyQuizzes = asArray(DATA.quizzes).filter(item => item.category === "安全");
    const safetyDone = safetyQuizzes.filter(item => state.completed.includes(`quiz:${item.id}`)).length;
    const routes = routeProgress();
    if (countPrefix("timeline:") >= Math.min(3, asArray(DATA.timeline).length)) awardBadge("time-traveler");
    if (countPrefix("concept:") >= Math.min(5, asArray(DATA.concepts).length)) awardBadge("term-collector");
    if (state.completed.includes("quota:run")) awardBadge("quota-detective");
    if (safetyDone >= Math.min(5, safetyQuizzes.length) && countPrefix("scenario:") >= 2) awardBadge("safety-keeper");
    if (countPrefix("hermes:") >= Math.min(3, asArray(DATA.hermesModules).length)) awardBadge("hermes-navigator");
    if (state.completed.includes("loop:complete")) awardBadge("loop-architect");
    if (routes.beginner.size >= 3 && routes.engineer.size >= 3 && routes.beginnerDistinct >= 2 && routes.engineerDistinct >= 2) awardBadge("dual-track-graduate");
    if (state.completed.includes("memory:correct")) awardBadge("memory-curator");
  }

  function renderBadges() {
    const badges = asArray(DATA.badges);
    const strip = $(".badge-strip");
    if (strip) {
      strip.replaceChildren(...badges.map((badge, index) => {
        const earned = state.badges.includes(badge.id);
        return element("span", {
          className: "badge-dot",
          title: badge.title,
          "aria-label": `${badge.title}：${earned ? "已解锁" : "未解锁"}`,
          text: String(index + 1).padStart(2, "0"),
          dataset: { earned: earned ? "true" : "false" }
        });
      }));
    }
    const grid = $(".badges-grid");
    if (grid) {
      grid.replaceChildren(...badges.map(badge => {
        const card = element("div", { className: "badge-card", dataset: { earned: state.badges.includes(badge.id) ? "true" : "false" } });
        card.append(element("b", { text: `${state.badges.includes(badge.id) ? "✓ " : "○ "}${badge.title}` }), document.createTextNode(badge.description));
        return card;
      }));
    }
  }

  function setAudience(audience, reward = true) {
    state.audience = audience === "engineer" ? "engineer" : "beginner";
    complete(`audience:${state.audience}`);
    $$('[data-testid^="audience-"]').forEach(node => node.setAttribute("aria-pressed", String(node.dataset.testid === `audience-${state.audience}`)));
    document.documentElement.dataset.audience = state.audience;
    renderTimeline();
    renderConcepts();
    renderHermes();
    persist();
    updateRewards();
    if (reward) earn(`audience:${state.audience}`, 5, state.audience === "engineer" ? "已切换到 IT 技术视角。" : "已切换到零基础视角。");
  }

  function setTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    const toggle = $('[data-testid="theme-toggle"]');
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(state.theme === "light"));
      toggle.setAttribute("aria-label", state.theme === "light" ? "切换为深色主题" : "切换为浅色主题");
    }
    persist();
    announce(`已切换为${state.theme === "light" ? "浅色" : "深色"}主题。`);
  }

  function renderTimelineFilters() {
    const mount = $("#timeline-year-filter");
    if (!mount) return;
    const years = [...new Set(asArray(DATA.timeline).map(item => item.year))].sort();
    const controls = [button("全部年份", "timeline-year", "all", "button button-quiet")];
    years.forEach(year => controls.push(button(String(year), "timeline-year", String(year), "button button-quiet")));
    controls.forEach(control => control.setAttribute("aria-pressed", String(control.dataset.value === String(timelineYear))));
    mount.replaceChildren(...controls);
  }

  function renderTimeline() {
    const mount = $("#timeline-list");
    if (!mount) return;
    const items = asArray(DATA.timeline).filter(item => timelineYear === "all" || String(item.year) === String(timelineYear));
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const article = element("article", { className: "panel", dataset: { timelineId: item.id } });
      appendTextBlock(article, "div", `${item.date} · ${item.phase}`, "status-label");
      appendTextBlock(article, "h3", item.title);
      appendTextBlock(article, "p", item.what);
      appendTextBlock(article, "p", state.audience === "engineer" ? item.engineer : item.plain);
      const controls = element("div", { className: "loop-controls" }, [
        button("查看详情与来源", "timeline-detail", item.id),
        button(state.completed.includes(`timeline:${item.id}`) ? "✓ 已学会" : "标记学会", "timeline-learn", item.id, "button button-primary")
      ]);
      article.append(controls);
      fragment.append(article);
    });
    if (!items.length) fragment.append(element("p", { text: "没有符合当前年份的事件。" }));
    mount.replaceChildren(fragment);
  }

  function showTimelineDetail(id, trigger) {
    const item = asArray(DATA.timeline).find(event => String(event.id) === String(id));
    if (!item) return;
    openModal(item.title, content => {
      appendTextBlock(content, "p", item.what);
      appendTextBlock(content, "h3", "为什么重要");
      appendTextBlock(content, "p", item.why);
      appendTextBlock(content, "h3", "零基础视角");
      appendTextBlock(content, "p", item.plain);
      appendTextBlock(content, "h3", "IT 技术视角");
      appendTextBlock(content, "p", item.engineer);
      appendTextBlock(content, "h3", "官方来源");
      asArray(item.source).forEach((url, index) => content.append(element("p", {}, [link(`来源 ${index + 1}`, url)])));
      content.append(button(state.completed.includes(`timeline:${item.id}`) ? "已标记学会" : "标记学会", "modal-timeline-learn", item.id, "button button-primary"));
    }, trigger);
  }

  function renderConceptCategoryOptions() {
    const select = $("#concept-category-filter");
    if (!select) return;
    const options = [element("option", { value: "", text: "全部类别" })];
    [...new Set(asArray(DATA.concepts).map(item => item.category))].sort().forEach(category => options.push(element("option", { value: category, text: category })));
    select.replaceChildren(...options);
    select.value = conceptCategory;
  }

  function renderConcepts() {
    const mount = $("#concept-list");
    if (!mount) return;
    const query = conceptQuery.trim().toLocaleLowerCase();
    const items = asArray(DATA.concepts).filter(item => {
      const matchesCategory = !conceptCategory || item.category === conceptCategory;
      const haystack = [item.cn, item.en, item.oneLine, item.plain, item.professional].join(" ").toLocaleLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
    mount.replaceChildren(...items.map(item => {
      const article = element("article", { className: "panel", dataset: { conceptId: item.id } });
      appendTextBlock(article, "div", item.category, "status-label");
      appendTextBlock(article, "h3", `${item.cn} · ${item.en}`);
      appendTextBlock(article, "p", item.oneLine);
      const views = [
        ["专业定义", item.professional], ["白话解释", item.plain], ["生活类比", item.life], ["IT 技术类比", item.engineer]
      ];
      const viewGrid = element("div", { className: "grid-2" });
      views.forEach(([title, body]) => {
        const engineerDefault = title === "专业定义" || title === "IT 技术类比";
        const beginnerDefault = title === "白话解释" || title === "生活类比";
        const panel = element("details", {
          className: "panel",
          open: state.audience === "engineer" ? engineerDefault : beginnerDefault,
          dataset: { conceptView: title }
        });
        panel.append(element("summary", { text: title }), element("p", { text: body }));
        viewGrid.append(panel);
      });
      article.append(viewGrid);
      const details = element("details");
      details.append(element("summary", { text: "误区、安全与关联概念" }));
      appendTextBlock(details, "p", item.misconception);
      appendTextBlock(details, "p", `安全提示：${item.safety}`);
      appendTextBlock(details, "p", `关联：${asArray(item.related).join(" · ")}`);
      article.append(details, button(state.completed.includes(`concept:${item.id}`) ? "✓ 已掌握" : "标记掌握", "concept-learn", item.id, "button button-primary"));
      return article;
    }));
    if (!items.length) mount.append(element("p", { text: "没有匹配的概念；请缩短关键词或清除类别筛选。" }));
  }

  function renderProductFilters() {
    const mount = $("#product-filters");
    if (!mount) return;
    const makeSelect = (labelText, key, values, testid) => {
      const labelNode = element("label", { className: "field" });
      labelNode.append(element("span", { className: "field-label", text: labelText }));
      const select = element("select", { dataset: { productFilter: key, testid } });
      select.append(element("option", { value: "", text: `全部${labelText}` }));
      values.forEach(value => select.append(element("option", { value, text: value })));
      select.value = productFilter[key];
      labelNode.append(select);
      return labelNode;
    };
    const products = asArray(DATA.products);
    mount.replaceChildren(
      makeSelect("地区", "region", [...new Set(products.map(item => item.region))].sort(), "product-region-filter"),
      makeSelect("类型", "category", [...new Set(products.map(item => item.category))].sort(), "product-category-filter"),
      makeSelect("执行级别", "action", [...new Set(products.map(item => item.actionLevel))].sort(), "product-action-filter")
    );
  }

  function renderProducts() {
    const mount = $("#product-list");
    if (!mount) return;
    const items = asArray(DATA.products).filter(item => (!productFilter.region || item.region === productFilter.region) &&
      (!productFilter.category || item.category === productFilter.category) && (!productFilter.action || item.actionLevel === productFilter.action));
    mount.replaceChildren(...items.map(item => {
      const article = element("article", { className: "panel" });
      appendTextBlock(article, "div", `${item.region} · ${item.category} · ${item.actionLevel}`, "status-label");
      appendTextBlock(article, "h3", item.name);
      appendTextBlock(article, "p", `${item.company}｜${item.strength}`);
      appendTextBlock(article, "p", `部署：${item.deployment}｜适合：${item.audience}`);
      appendTextBlock(article, "p", `安全边界：${item.safety}`);
      article.append(link("官方页面", item.url));
      return article;
    }));
    if (!items.length) mount.append(element("p", { text: "没有符合当前组合的产品。" }));
  }

  function renderSubscriptions() {
    const mount = $("#subscription-list");
    if (!mount) return;
    const table = element("table");
    const head = element("thead");
    const row = element("tr");
    ["平台 / 套餐", "当前价格", "额度与单位", "重置窗口", "订阅与 API", "限制 / 核实"].forEach(label => row.append(element("th", { scope: "col", text: label })));
    head.append(row);
    const body = element("tbody");
    asArray(DATA.subscriptions).forEach(item => {
      const tr = element("tr");
      const sourceCell = element("td");
      sourceCell.append(document.createTextNode(`${item.restriction}；核实：${item.verified}。 `));
      asArray(item.source).forEach((url, index) => {
        if (index) sourceCell.append(document.createTextNode(" · "));
        sourceCell.append(link(`来源 ${index + 1}`, url));
      });
      tr.append(
        element("td", { text: item.name }),
        element("td", { text: `${item.currentPrice}；${item.promo}` }),
        element("td", { text: `${item.quotas}（${item.unit}）` }),
        element("td", { text: item.reset }),
        element("td", { text: item.apiDifference }),
        sourceCell
      );
      body.append(tr);
    });
    table.append(head, body);
    mount.replaceChildren(table);
    renderQuotaPlatforms();
  }

  function renderQuotaPlatforms() {
    const platform = $('[data-testid="quota-platform"]');
    if (!platform) return;
    const previous = platform.value;
    platform.replaceChildren(element("option", { value: "", text: "请选择平台" }), ...asArray(DATA.subscriptions).map(item => element("option", { value: item.id, text: item.name })));
    if (asArray(DATA.subscriptions).some(item => item.id === previous)) platform.value = previous;
    renderQuotaPlans();
  }

  function renderQuotaPlans() {
    const platform = $('[data-testid="quota-platform"]');
    const plan = $('[data-testid="quota-plan"]');
    if (!platform || !plan) return;
    const selected = asArray(DATA.subscriptions).find(item => item.id === platform.value);
    const previous = plan.value;
    plan.replaceChildren(element("option", { value: "", text: "请选择档位" }), ...asArray(selected && selected.plans).map((item, index) => element("option", { value: String(index), text: item.name })));
    if (selected && selected.plans && selected.plans[Number(previous)]) plan.value = previous;
  }

  function quotaWindowExplanation(reset) {
    const rules = [];
    if (/滚动|动态释放/.test(reset)) rules.push("滚动窗口：用量随每次使用时间逐步释放，不是整点一次清零。");
    if (/固定/.test(reset)) rules.push("固定窗口：平台按固定起止区间统计，窗口结束后才刷新。");
    if (/自然周|每周一/.test(reset)) rules.push("自然周：按日历周计算，常见为周一在指定时区重置。");
    if (/每\s*7\s*天|7\s*天刷新|订阅日起/.test(reset)) rules.push("滚动 7 天／订阅日起 7 天：从平台规定的起点连续计算七天，不等同自然周。");
    if (!rules.length) rules.push("窗口类型：公开说明未能归入单一标准模式，请以平台控制台当前倒计时为准。");
    return rules;
  }

  function runQuotaSimulation() {
    const platformSelect = $('[data-testid="quota-platform"]');
    const planSelect = $('[data-testid="quota-plan"]');
    const intensity = $('[data-testid="quota-intensity"]');
    const output = $("#quota-result");
    if (!platformSelect || !planSelect || !intensity || !output) return;
    const subscription = asArray(DATA.subscriptions).find(item => item.id === platformSelect.value);
    const plan = subscription && asArray(subscription.plans)[Number(planSelect.value)];
    if (!subscription || !plan) {
      output.replaceChildren(element("div", { className: "status-label", text: "Simulation output" }), element("h3", { text: "请先选择平台与档位" }), element("p", { text: "模拟不会猜测缺少的官方额度。" }));
      announce("请先选择额度平台与档位。");
      return;
    }
    const amplification = { light: 5, medium: 15, heavy: 30 }[intensity.value] || 5;
    const title = `${subscription.name} · ${plan.name}`;
    output.replaceChildren(element("div", { className: "status-label", text: "Teaching simulation · 不修改官方事实" }), element("h3", { text: title }));
    output.append(element("p", { text: `教学估算：1 次用户 Prompt 可能放大为约 ${amplification} 次底层模型调用（轻量 5 / 中等 15 / 高强度 30）。` }));
    quotaWindowExplanation(subscription.reset).forEach(rule => output.append(element("p", { text: rule })));
    output.append(element("p", { text: `官方原文摘要：${subscription.quotas}` }));
    output.append(element("p", { text: `免责声明：这是理解调用放大的教学模拟，不是余额、账单或可用次数预测；实际扣减、限额、模型系数与重置时间以官方控制台和当前条款为准。` }));
    const meter = element("div", { className: "meter", "aria-hidden": "true" }, [element("span")]);
    $("span", meter).style.width = `${Math.min(100, amplification * 3)}%`;
    output.append(meter);
    complete("quota:run");
    earn("quota:run", 15, "已理解 Prompt 如何放大为多次模型调用。") || updateRewards();
  }

  function renderComparison() {
    const mount = $("#comparison-list");
    if (!mount) return;
    mount.replaceChildren(...asArray(DATA.comparison).map(item => {
      const article = element("article", { className: "panel" });
      appendTextBlock(article, "h3", item.dimension);
      appendTextBlock(article, "p", `Hermes：${item.hermes}`);
      appendTextBlock(article, "p", `OpenClaw：${item.openclaw}`);
      appendTextBlock(article, "p", `结论：${item.takeaway}`);
      return article;
    }));
  }

  function renderHermes() {
    const mount = $("#hermes-modules");
    if (!mount) return;
    mount.replaceChildren(...asArray(DATA.hermesModules).map(module => {
      const details = element("details", { className: "panel", dataset: { moduleId: module.id } });
      details.append(element("summary", { text: module.title }));
      appendTextBlock(details, "p", state.audience === "engineer" ? module.engineer : module.plain);
      const steps = element("ol");
      asArray(module.steps).forEach(step => steps.append(element("li", { text: step })));
      details.append(steps);
      asArray(module.commands).forEach(command => {
        const row = element("div", { className: "loop-controls" });
        row.append(element("code", { text: command }), button("复制命令", "copy-command", command, "button button-quiet"));
        details.append(row);
      });
      appendTextBlock(details, "p", `注意：${module.warning}`);
      details.append(link("官方文档", module.source));
      details.append(button(state.completed.includes(`hermes:${module.id}`) ? "✓ 模块完成" : "标记模块完成", "hermes-complete", module.id, "button button-primary"));
      return details;
    }));
  }

  async function copyText(value, trigger) {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch (_error) {
        copied = false;
      }
    }
    if (!copied) {
      const area = element("textarea", { value, readonly: true, "aria-hidden": "true" });
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.focus();
      area.select();
      try { copied = Boolean(document.execCommand && document.execCommand("copy")); } catch (_error) { copied = false; }
      area.remove();
    }
    if (trigger) {
      const original = trigger.textContent;
      trigger.textContent = copied ? "已复制" : "请手动复制";
      window.setTimeout(() => { trigger.textContent = original; }, 1800);
    }
    announce(copied ? "命令已复制。" : "浏览器阻止自动复制，请选中命令手动复制。");
  }

  function categoryToValue(category) {
    if (category === "USER") return "user";
    if (category === "MEMORY") return "memory";
    if (category === "Session Search") return "session";
    if (category === "Skill" || category === "Cron") return "skill";
    return "never";
  }

  function classifyMemory(input) {
    const normalized = input.trim();
    const exact = asArray(DATA.memoryExamples).find(item => item.input === normalized);
    if (exact) return exact;
    if (/api\s*key|密码|私钥|助记词|验证码|token|令牌|cookie|密钥|secret|redacted|脱敏|已遮盖/i.test(normalized) ||
        /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|ssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{16,})/i.test(normalized) ||
        /(?:sk-|ghp_|github_pat_|AKIA|Bearer|ssh-(?:rsa|ed25519))[^\s]{0,24}(?:…|\.\.\.)/i.test(normalized) ||
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(normalized)) {
      return { category: "不保存", reason: "检测到凭据、令牌、密钥或秘密形态；不要保存到聊天、长期记忆、Skill 或 Cron。若已暴露，应立即撤销或轮换。" };
    }
    if (/每(天|周|月)|提醒|\d{1,2}:\d{2}|定时/.test(normalized)) return { category: "Cron", reason: "内容含明确时间触发，先交互验证流程，再保存任务和时间；不要保存秘密。" };
    if (/步骤|流程|操作手册|沉淀|每次都/.test(normalized)) return { category: "Skill", reason: "可重复、经过核验的程序性流程适合 Skill，并应保留失败分支和验证方法。" };
    if (/以前|上次|三周前|对话|聊天记录|日志是什么/.test(normalized)) return { category: "Session Search", reason: "具体历史片段适合按需检索，找到后还要核对日期与上下文。" };
    if (/偏好|我喜欢|我的时区|请用|回答先/.test(normalized)) return { category: "USER", reason: "稳定的个人表达或环境偏好适合 USER；如果只是本次要求则无需长期保存。" };
    return { category: "MEMORY", reason: "看起来像可复用事实；只在来源已核验、未来确有用途且允许纠错删除时写入 MEMORY。" };
  }

  function renderMemoryExamples() {
    const prompt = $('[data-testid="memory-prompt"]');
    if (!prompt || $("[data-memory-examples]")) return;
    const container = element("div", { className: "view-tabs", dataset: { memoryExamples: "true" }, "aria-label": "载入数据集示例" });
    asArray(DATA.memoryExamples).forEach((item, index) => container.append(button(`示例 ${index + 1} · ${item.category}`, "memory-example", item.id, "button button-quiet")));
    prompt.closest(".field").after(container);
  }

  function checkMemory() {
    const prompt = $('[data-testid="memory-prompt"]');
    const selected = $('input[name="memory-place"]:checked');
    const output = $("#memory-result");
    if (!prompt || !output) return;
    if (!prompt.value.trim() || !selected) {
      output.replaceChildren(element("div", { className: "status-label", text: "Placement review" }), element("h3", { text: "请填写内容并选择归档位置" }), element("p", { text: "判断前不应默认保存任何输入。" }));
      announce("请填写待判断内容并选择归档位置。");
      return;
    }
    const recommendation = classifyMemory(prompt.value);
    const expected = categoryToValue(recommendation.category);
    const correct = selected.value === expected;
    output.replaceChildren(element("div", { className: "status-label", text: correct ? "Placement correct" : "Placement needs review" }), element("h3", { text: `${correct ? "判断正确" : "建议调整"}：${recommendation.category}` }), element("p", { text: recommendation.reason }), element("p", { text: recommendation.category === "不保存" ? "保留时长：不写入；若已暴露秘密，应撤销或轮换。" : "写入前：确认必要性、来源、保留期限、纠错与删除方式。" }));
    if (correct) {
      complete("memory:correct");
      earn("memory:correct", 20, "已正确区分 USER、MEMORY、搜索、Skill/Cron 与不保存。") || updateRewards();
    } else {
      showToast(0, "归档判断已解释；秘密默认不保存。长期写入前需确认必要性；如需逐次审批，应主动开启 memory.write_approval。 ");
    }
  }

  function controlRoute(capabilities) {
    if (capabilities.includes("desktop")) return { name: "Desktop Accessibility，Vision 仅作最后选择", index: 7 };
    if (capabilities.includes("login")) return { name: "优先受限 API/MCP；否则隔离 Browser DOM/CDP + 专用低权限账号", index: 4 };
    if (capabilities.includes("write")) return { name: "优先最小作用域 API/MCP/CLI + dry-run、diff、确认与回滚", index: 0 };
    return { name: "只读 API；无 API 时依次检查 MCP、CLI、Browser DOM", index: 0 };
  }

  function renderDecision() {
    const taskInput = $('input[name="decision-task"]');
    const output = $("#decision-result");
    if (!output) return;
    const capabilities = $$('input[name="capability"]:checked').map(node => node.value);
    const task = taskInput ? taskInput.value.trim() : "";
    const route = controlRoute(capabilities);
    output.replaceChildren(element("div", { className: "status-label", text: "Minimum-permission result" }), element("h3", { text: route.name }));
    output.append(element("p", { text: task ? `任务：${task}` : "未填写任务目标；以下仅按已选能力给出保守路线。" }));
    const routeList = element("div", { className: "decision-route" });
    asArray(DATA.controlQuestions).forEach((question, index) => {
      const step = element("details", { className: "route-step", open: index === route.index });
      step.append(element("summary", { text: `${String(index + 1).padStart(2, "0")} · ${question.question}` }), element("p", { text: `是：${question.ifYes}` }), element("p", { text: `否：${question.ifNo}` }), element("p", { text: `原因：${question.why}` }));
      routeList.append(step);
    });
    output.append(routeList, element("p", { text: "最低共同控制：只开必要工具和数据范围；写入、登录态、发布、删除、付款、身份权限与生产网络变更必须显示影响、人工确认，并准备真实回滚。" }));
    complete("decision:run");
    earn("decision:run", 15, "已生成一条从结构化接口到桌面控制的最小权限路线。") || updateRewards();
  }

  const LOOP_STEPS = [
    { key: "reason", tool: "无", line: "[reason] 读取目标：核对一份配置是否满足要求。" },
    { key: "tool", tool: "只读配置检查器", line: "[tool] 选择只读检查器；不授予写入权限。" },
    { key: "act", tool: "只读配置检查器", line: "[act] 执行受控检查。" },
    { key: "observe", tool: "只读配置检查器", line: "[observe] 收到退出码 0 与结构化检查结果。" },
    { key: "verify", tool: "验收规则", line: "[verify] 独立比对完成标准；结果通过。" },
    { key: "memory-stop", tool: "精选记忆", line: "[memory/stop] 记录必要结论并停止；未保存原始秘密。" }
  ];

  function renderLoop() {
    $$('[data-loop-node]').forEach((node, index) => {
      node.dataset.state = loop.stopped ? (index === Math.min(loop.index, 5) ? "active" : "idle") : (index === Math.min(loop.index, 5) ? "active" : index < loop.index ? "done" : "idle");
    });
    const log = $("#loop-log");
    if (log) log.textContent = loop.logs.join("\n");
    const status = $("#loop-status");
    if (status) {
      const step = loop.stopped ? Math.min(loop.index + 1, 6) : Math.min(loop.index, 6);
      const tool = loop.index > 0 ? (LOOP_STEPS[Math.min(loop.index, 5)] || LOOP_STEPS[5]).tool : "待选择";
      const stop = loop.stopped ? (loop.index >= 5 ? "任务已验证，正常停止" : "重试达到上限，安全停止") : "未满足";
      status.replaceChildren(
        statusLine("步骤", `${step} / 6`),
        statusLine("工具", tool),
        statusLine("重试", `${loop.retries} / 2`),
        statusLine("停止条件", stop)
      );
    }
    const auto = $('[data-testid="loop-auto"]');
    if (auto) auto.setAttribute("aria-pressed", String(Boolean(loopTimer)));
    const fault = $('[data-testid="loop-fault"]');
    if (fault) fault.setAttribute("aria-pressed", String(loop.fault));
  }

  function statusLine(label, value) {
    return element("div", { className: "status-line" }, [element("span", { text: label }), element("b", { text: value })]);
  }

  function loopStep() {
    if (loop.stopped) {
      announce("循环已停止；请重置后重新开始。");
      stopLoopAuto();
      return;
    }
    const step = LOOP_STEPS[loop.index];
    if (!step) return;
    if (step.key === "act" && loop.fault) {
      loop.retries += 1;
      loop.logs.push(`[act:error] 工具返回暂时性失败；重试 ${loop.retries} / 2。`);
      if (loop.retries >= 2) {
        loop.logs.push("[stop] 达到最多 2 次重试；保留证据并安全停止。 ");
        loop.stopped = true;
        stopLoopAuto();
      } else {
        loop.index = 1;
      }
      renderLoop();
      return;
    }
    loop.logs.push(step.line);
    loop.index += 1;
    if (loop.index >= LOOP_STEPS.length) {
      loop.index = LOOP_STEPS.length - 1;
      loop.stopped = true;
      loop.logs.push("[stop] 完成标准已满足；循环结束。 ");
      stopLoopAuto();
      complete("loop:complete");
      earn("loop:complete", 25, "已完成 Reason → Tool → Act → Observe → Verify → Memory/Stop。") || updateRewards();
    }
    renderLoop();
  }

  function toggleLoopAuto() {
    if (loopTimer) {
      stopLoopAuto();
      announce("自动演示已暂停。");
      return;
    }
    if (loop.stopped) resetLoop();
    loopTimer = window.setInterval(loopStep, 850);
    renderLoop();
    loopStep();
  }

  function stopLoopAuto() {
    if (loopTimer) window.clearInterval(loopTimer);
    loopTimer = 0;
    const auto = $('[data-testid="loop-auto"]');
    if (auto) auto.setAttribute("aria-pressed", "false");
  }

  function resetLoop() {
    stopLoopAuto();
    loop.index = 0;
    loop.retries = 0;
    loop.fault = false;
    loop.stopped = false;
    loop.logs = ["[ready] 循环已重置；等待 Reason。"];
    renderLoop();
  }

  function renderQuizzes() {
    const mount = $("#quiz-list");
    if (!mount) return;
    mount.replaceChildren(...asArray(DATA.quizzes).map((quiz, index) => questionCard(quiz, index, "quiz")));
  }

  function renderScenarios() {
    const mount = $("#scenario-list");
    if (!mount) return;
    mount.replaceChildren(...asArray(DATA.scenarios).map((scenario, index) => questionCard(scenario, index, "scenario")));
  }

  function questionCard(item, index, type) {
    const card = element("article", { className: "panel", dataset: { questionId: item.id, questionType: type } });
    appendTextBlock(card, "div", `${type === "quiz" ? "测验" : "情境"} ${String(index + 1).padStart(2, "0")}${item.category ? ` · ${item.category}` : ""}`, "status-label");
    appendTextBlock(card, "h3", type === "quiz" ? item.question : item.title);
    if (type === "scenario") appendTextBlock(card, "p", item.situation);
    const options = element("div", { className: "option-list" });
    asArray(type === "quiz" ? item.options : item.choices).forEach((choice, optionIndex) => {
      const option = button(choice, "answer", `${type}|${item.id}|${optionIndex}`, "button button-quiet");
      option.dataset.testid = `${type}-${item.id}-option-${optionIndex}`;
      options.append(option);
    });
    card.append(options, element("div", { dataset: { explanation: item.id }, "aria-live": "polite" }));
    return card;
  }

  function answerQuestion(value) {
    const [type, id, indexText] = value.split("|");
    const list = type === "scenario" ? asArray(DATA.scenarios) : asArray(DATA.quizzes);
    const item = list.find(entry => entry.id === id);
    const card = $(`[data-question-id="${CSS.escape(id)}"][data-question-type="${type}"]`);
    if (!item || !card) return;
    const selected = Number(indexText);
    const correct = selected === Number(item.answer);
    const explanation = $(`[data-explanation="${CSS.escape(id)}"]`, card);
    if (explanation) {
      explanation.replaceChildren(element("p", { text: `${correct ? "✓ 回答正确。" : "✗ 回答不正确。"}${item.explanation}` }));
      if (item.safety) explanation.append(element("p", { text: `安全边界：${item.safety}` }));
    }
    $$('[data-action="answer"]', card).forEach((option, optionIndex) => {
      option.setAttribute("aria-pressed", String(optionIndex === selected));
      if (optionIndex === Number(item.answer)) option.dataset.correct = "true";
    });
    if (correct) {
      complete(`${type}:${id}`);
      completeRouteUnit(type, id);
      removeReview(id);
      earn(`${type}:${id}`, type === "scenario" ? 20 : 10, type === "scenario" ? `完成情境：${item.title}` : `答对：${item.question}`) || updateRewards();
    } else {
      addReview(id, type, type === "scenario" ? item.title : item.question);
      showToast(0, "错题已加入个性化复习清单；解释已立即显示。");
    }
  }

  function renderReview() {
    const mount = $("#review-list");
    if (!mount) return;
    if (!state.reviewItems.length) {
      mount.replaceChildren(element("p", { text: "暂无错题。继续完成测验；回答错误的项目会自动出现在这里。" }));
      return;
    }
    mount.replaceChildren(...state.reviewItems.map(item => {
      const source = item.type === "scenario" ? asArray(DATA.scenarios).find(entry => entry.id === item.id) : asArray(DATA.quizzes).find(entry => entry.id === item.id);
      const article = element("article", { className: "panel" });
      appendTextBlock(article, "div", item.type === "scenario" ? "情境复习" : "错题复习", "status-label");
      appendTextBlock(article, "h3", item.title || (source && (source.title || source.question)) || item.id);
      appendTextBlock(article, "p", source ? source.explanation : "回到对应题目重新作答。");
      article.append(button("前往重新作答", "review-jump", `${item.type}|${item.id}`, "button button-primary"));
      return article;
    }));
  }

  function renderSources() {
    const mount = $("#source-list");
    if (!mount) return;
    const list = element("ol");
    asArray(DATA.sources).forEach(source => {
      const item = element("li");
      item.append(link(source.title, source.url), document.createTextNode(` · 核实于 ${source.verifiedAt || DATA.meta.verifiedAt || "未注明"}`));
      list.append(item);
    });
    mount.replaceChildren(list);
  }

  function matchesLearningLevel(level, filter) {
    if (!filter) return true;
    const patterns = { 入门: /入门|零基础|Beginner/i, 中级: /中级|Intermediate/i, 高级: /高级|Advanced/i };
    return patterns[filter].test(text(level));
  }

  function matchesLearningLanguage(language, filter) {
    if (!filter) return true;
    const patterns = {
      中文: /中文|普通话|Chinese/i,
      英语: /英语|English/i,
      多语言: /多语言|中英|字幕|翻译|Multiple|translations|localizations|subtitles/i
    };
    return patterns[filter].test(text(language));
  }

  function renderLearningResources() {
    const mount = $("#learning-resource-list");
    if (!mount) return;
    const query = learningFilter.keyword.trim().toLocaleLowerCase("zh-CN");
    const items = asArray(DATA.learningResources).filter(item => {
      const searchable = [item.titleZh, item.titleEn, item.provider, item.language, item.level, item.format,
        ...asArray(item.topics), item.authority, item.officiality].map(text).join(" ").toLocaleLowerCase("zh-CN");
      return (!learningFilter.platform || item.platform === learningFilter.platform) &&
        matchesLearningLevel(item.level, learningFilter.level) &&
        matchesLearningLanguage(item.language, learningFilter.language) &&
        (!query || searchable.includes(query));
    });

    mount.replaceChildren(...items.map(item => {
      const article = element("article", { className: "panel learning-resource-card", dataset: { resourceId: item.id, platform: item.platform } });
      appendTextBlock(article, "div", `${item.platform} · ${item.officiality}`, "status-label");
      appendTextBlock(article, "h3", item.titleZh);
      appendTextBlock(article, "div", item.titleEn, "resource-title-en");
      appendTextBlock(article, "p", `提供方：${item.provider}`);
      const meta = element("div", { className: "resource-meta", ariaLabel: "资源属性" });
      [item.level, item.language, item.format].forEach(value => meta.append(element("span", { className: "resource-chip", text: value })));
      meta.append(element("span", { className: "resource-chip resource-chip-officiality", text: item.officiality }));
      article.append(meta);
      const topics = element("div", { className: "resource-topics", ariaLabel: "主题" });
      asArray(item.topics).forEach(topic => topics.append(element("span", { className: "resource-chip", text: topic })));
      article.append(topics);
      const evidence = element("div", { className: "resource-evidence" });
      appendTextBlock(evidence, "div", "权威性与访问说明", "field-label");
      appendTextBlock(evidence, "p", item.authority);
      appendTextBlock(evidence, "p", `访问说明：${item.accessNote}`);
      appendTextBlock(evidence, "p", `核实日期：${item.accessed}`);
      article.append(evidence);
      const external = link("打开学习资源 ↗", item.url);
      external.className = "resource-link";
      article.append(external);
      return article;
    }));
    if (!items.length) mount.append(element("p", { text: "没有符合当前筛选条件的资源；请减少条件或更换关键词。" }));
    const count = $("#learning-resource-count");
    if (count) count.textContent = `显示 ${items.length} / ${asArray(DATA.learningResources).length} 项资源`;
  }

  function openModal(title, render, trigger) {
    const modal = $("#course-modal");
    const heading = $("#modal-title");
    const content = $("#modal-content");
    if (!modal || !heading || !content) return;
    modalReturnFocus = trigger || document.activeElement;
    heading.textContent = title;
    content.replaceChildren();
    render(content);
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
    const first = $("button, a, input, select, textarea", modal);
    if (first) first.focus();
  }

  function closeModal() {
    const modal = $("#course-modal");
    if (!modal) return;
    if (typeof modal.close === "function" && modal.open) modal.close();
    else modal.removeAttribute("open");
    if (modalReturnFocus && typeof modalReturnFocus.focus === "function") modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function confirmReset(trigger) {
    openModal("清除本地学习进度？", content => {
      content.append(element("p", { text: "这会清除受众视角、主题、完成记录、XP、徽章、错题、复习清单，以及你明确选择保存的证书姓名。操作无法在课程内撤销。" }));
      const controls = element("div", { className: "loop-controls" });
      controls.append(button("取消", "modal-cancel", "", "button"), button("确认清除", "modal-reset-confirm", "", "button button-danger"));
      content.append(controls);
    }, trigger);
  }

  function resetState(removeStorage = true) {
    stopLoopAuto();
    if (removeStorage && storageAvailable) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_error) { storageAvailable = false; }
    }
    state = safeState(DEFAULT_STATE);
    timelineYear = "all";
    conceptQuery = "";
    conceptCategory = "";
    productFilter.region = "";
    productFilter.category = "";
    productFilter.action = "";
    resetLoop();
    renderAll();
    announce("本地学习进度已清除。");
  }

  function initializeCertificate() {
    const input = $('[data-testid="certificate-name"]');
    const checkbox = $('input[name="save-certificate-name"]');
    const preview = $('[data-certificate-preview]');
    if (!input || !checkbox || !preview) return;
    input.value = state.certificateName || "";
    checkbox.checked = Boolean(state.certificateName);
    preview.textContent = input.value.trim() || "学习者";
  }

  function renderAll() {
    setTheme(state.theme);
    document.documentElement.dataset.audience = state.audience;
    $$('[data-testid^="audience-"]').forEach(node => node.setAttribute("aria-pressed", String(node.dataset.testid === `audience-${state.audience}`)));
    renderTimelineFilters();
    renderTimeline();
    renderConceptCategoryOptions();
    const search = $("#concept-search");
    if (search) search.value = conceptQuery;
    renderConcepts();
    renderLoop();
    renderProductFilters();
    renderProducts();
    renderSubscriptions();
    renderComparison();
    renderHermes();
    renderMemoryExamples();
    renderQuizzes();
    renderScenarios();
    renderReview();
    renderLearningResources();
    renderSources();
    initializeCertificate();
    updateRewards();
  }

  function setupNavigationObserver() {
    if (!("IntersectionObserver" in window)) return;
    const links = $$(".nav-links a");
    const sections = links.map(item => $(item.getAttribute("href"))).filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach(linkNode => {
        if (linkNode.getAttribute("href") === `#${visible.target.id}`) linkNode.setAttribute("aria-current", "location");
        else linkNode.removeAttribute("aria-current");
      });
      const mobileSelect = $("#mobile-section-select");
      if (mobileSelect && Date.now() >= mobileNavLockUntil && [...mobileSelect.options].some(option => option.value === visible.target.id)) mobileSelect.value = visible.target.id;
    }, { rootMargin: "-20% 0px -65%", threshold: [0, 0.15, 0.5] });
    sections.forEach(section => observer.observe(section));
  }

  function handleClick(event) {
    const target = event.target.closest("button, [data-action]");
    if (!target) return;
    const testid = target.dataset.testid;
    const action = target.dataset.action;
    if (testid === "theme-toggle") setTheme(state.theme === "dark" ? "light" : "dark");
    else if (testid === "progress-reset") confirmReset(target);
    else if (testid === "audience-beginner") setAudience("beginner");
    else if (testid === "audience-engineer") setAudience("engineer");
    else if (testid === "loop-step") loopStep();
    else if (testid === "loop-auto") toggleLoopAuto();
    else if (testid === "loop-fault") { loop.fault = !loop.fault; renderLoop(); announce(loop.fault ? "已注入工具失败；Act 阶段最多重试 2 次。" : "已取消工具失败注入。"); }
    else if (testid === "loop-reset") resetLoop();
    else if (testid === "quota-run") runQuotaSimulation();
    else if (testid === "memory-check") checkMemory();
    else if (testid === "decision-start") renderDecision();
    else if (testid === "certificate-print") {
      const gate = updateCertificateEligibility();
      if (gate.missing.length) {
        openModal("尚未达到结业门槛", content => {
          appendTextBlock(content, "p", "请先完成以下必修项；证书不会用少量点击替代真实学习。 ");
          const list = element("ul");
          gate.missing.forEach(item => list.append(element("li", { text: item.label })));
          content.append(list);
        }, target);
        return;
      }
      const checkbox = $('input[name="save-certificate-name"]');
      const nameInput = $('[data-testid="certificate-name"]');
      if (checkbox && checkbox.checked && nameInput) state.certificateName = nameInput.value.trim().slice(0, 100);
      else delete state.certificateName;
      persist();
      window.print();
    } else if (testid === "modal-close") closeModal();
    else if (action === "timeline-year") {
      timelineYear = target.dataset.value;
      renderTimelineFilters();
      renderTimeline();
      const count = $$("#timeline-list article").length;
      announce(`时间轴已筛选，显示 ${count} 个节点。`);
      focusSoon(`[data-action="timeline-year"][data-value="${CSS.escape(timelineYear)}"]`);
    }
    else if (action === "timeline-detail") showTimelineDetail(target.dataset.value, target);
    else if (action === "timeline-learn" || action === "modal-timeline-learn") {
      const id = target.dataset.value;
      complete(`timeline:${id}`);
      completeRouteUnit("timeline", id);
      earn(`timeline:${id}`, 5, "已把一个关键交互范式节点加入学习进度。") || updateRewards();
      renderTimeline();
      if (action === "modal-timeline-learn") closeModal();
      focusSoon(`[data-timeline-id="${CSS.escape(id)}"] [data-action="timeline-learn"]`);
    } else if (action === "concept-learn") {
      complete(`concept:${target.dataset.value}`);
      completeRouteUnit("concept", target.dataset.value);
      earn(`concept:${target.dataset.value}`, 5, "已掌握一个概念的四种解释视角。") || updateRewards();
      renderConcepts();
      focusSoon(`[data-concept-id="${CSS.escape(target.dataset.value)}"] [data-action="concept-learn"]`);
    } else if (action === "hermes-complete") {
      complete(`hermes:${target.dataset.value}`);
      completeRouteUnit("hermes", target.dataset.value);
      earn(`hermes:${target.dataset.value}`, 8, "已完成一个 Hermes 学习模块。") || updateRewards();
      renderHermes();
      focusSoon(`[data-module-id="${CSS.escape(target.dataset.value)}"] [data-action="hermes-complete"]`, true);
    } else if (action === "copy-command") copyText(target.dataset.value, target);
    else if (action === "memory-example") {
      const example = asArray(DATA.memoryExamples).find(item => item.id === target.dataset.value);
      const prompt = $('[data-testid="memory-prompt"]');
      if (example && prompt) { prompt.value = example.input; prompt.focus(); }
    } else if (action === "answer") answerQuestion(target.dataset.value);
    else if (action === "review-jump") {
      const [type, id] = target.dataset.value.split("|");
      const card = $(`[data-question-id="${CSS.escape(id)}"][data-question-type="${type}"]`);
      if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); const first = $("button", card); if (first) first.focus(); }
    } else if (action === "modal-cancel") closeModal();
    else if (action === "modal-reset-confirm") { closeModal(); resetState(true); showToast(0, "本地学习进度已清除。"); }
  }

  function handleInput(event) {
    if (event.target.id === "concept-search") {
      conceptQuery = event.target.value;
      renderConcepts();
    } else if (event.target.id === "learning-keyword-search") {
      learningFilter.keyword = event.target.value;
      renderLearningResources();
    } else if (event.target.matches('[data-testid="certificate-name"]')) {
      const preview = $('[data-certificate-preview]');
      if (preview) preview.textContent = event.target.value.trim() || "学习者";
    }
  }

  function handleChange(event) {
    if (event.target.id === "concept-category-filter") {
      conceptCategory = event.target.value;
      renderConcepts();
      announce(`概念类别已更新，显示 ${$$("#concept-list article").length} 个概念。`);
    } else if (event.target.matches("[data-product-filter]")) {
      productFilter[event.target.dataset.productFilter] = event.target.value;
      renderProducts();
      announce(`产品筛选已更新，显示 ${$$("#product-list article").length} 个项目。`);
    } else if (event.target.id === "learning-platform-filter" || event.target.id === "learning-level-filter" || event.target.id === "learning-language-filter") {
      learningFilter[event.target.id.replace("learning-", "").replace("-filter", "")] = event.target.value;
      renderLearningResources();
      announce(`拓展学习筛选已更新，显示 ${$$("#learning-resource-list article").length} 项资源。`);
    } else if (event.target.matches('[data-testid="mobile-section-nav"]')) {
      const section = document.getElementById(event.target.value);
      if (section) {
        mobileNavRequested = event.target.value;
        mobileNavLockUntil = Date.now() + 2000;
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        section.setAttribute("tabindex", "-1");
        window.setTimeout(() => {
          section.focus({ preventScroll: true });
          const mobileSelect = $("#mobile-section-select");
          if (mobileSelect && mobileNavRequested) mobileSelect.value = mobileNavRequested;
        }, 500);
        announce(`已跳转到${event.target.options[event.target.selectedIndex].textContent}。`);
      }
    } else if (event.target.matches('[data-testid="quota-platform"]')) {
      renderQuotaPlans();
    } else if (event.target.matches('input[name="save-certificate-name"]')) {
      const input = $('[data-testid="certificate-name"]');
      if (event.target.checked && input) state.certificateName = input.value.trim().slice(0, 100);
      else delete state.certificateName;
      persist();
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);
    const modal = $("#course-modal");
    if (modal) {
      modal.addEventListener("close", () => {
        if (modalReturnFocus && typeof modalReturnFocus.focus === "function") modalReturnFocus.focus();
        modalReturnFocus = null;
      });
      modal.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });
    }
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && modal && modal.hasAttribute("open")) {
        event.preventDefault();
        closeModal();
      }
    });
  }

  function publicState() {
    return JSON.parse(JSON.stringify(state));
  }

  function counts() {
    return {
      timeline: asArray(DATA.timeline).length,
      concepts: asArray(DATA.concepts).length,
      products: asArray(DATA.products).length,
      subscriptions: asArray(DATA.subscriptions).length,
      hermesModules: asArray(DATA.hermesModules).length,
      comparison: asArray(DATA.comparison).length,
      quizzes: asArray(DATA.quizzes).length,
      scenarios: asArray(DATA.scenarios).length,
      memoryExamples: asArray(DATA.memoryExamples).length,
      controlQuestions: asArray(DATA.controlQuestions).length,
      learningResources: asArray(DATA.learningResources).length,
      sources: asArray(DATA.sources).length,
      badges: asArray(DATA.badges).length
    };
  }

  function init() {
    state = initializeStorage();
    bindEvents();
    renderAll();
    setupNavigationObserver();
    window.__COURSE_TEST__ = {
      getState: publicState,
      resetForTest: () => { resetState(true); return publicState(); },
      getCertificateRequirements: () => certificateRequirements().map(item => ({ ...item })),
      counts
    };
  }

  window.addEventListener("error", () => announce("页面遇到一个问题；你的本地学习进度仍会尽可能保留。请刷新后重试。"));
  window.addEventListener("unhandledrejection", () => announce("一项浏览器操作未能完成；请检查当前选择并重试。"));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
