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
  const loop = { index: 0, retries: 0, fault: false, stopped: false, logs: ["[ready] Waiting to begin the step-by-step demonstration..."] };

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
      announce("Local progress cannot be saved right now; you can still continue learning on this page.");
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
    if (strong) strong.textContent = points > 0 ? `Learning points +${points} XP` : "Learning record updated";
    if (detail) detail.textContent = message;
    toast.dataset.state = "visible";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.dataset.state = "idle"; }, 3200);
    announce(`${points > 0 ? `Earned ${points} XP. ` : ""}${message}`);
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
    const safetyQuizzes = asArray(DATA.quizzes).filter(item => item.category === "Safety");
    const safetyDone = safetyQuizzes.filter(item => state.completed.includes(`quiz:${item.id}`)).length;
    const routes = routeProgress();
    return [
      { label: "Mark at least 5 timeline events as learned", done: count("timeline:") >= 5 },
      { label: "Master at least 8 core concepts", done: count("concept:") >= 8 },
      { label: "Complete at least 5 Hermes modules", done: count("hermes:") >= 5 },
      { label: "Complete the Agent Loop and reach its verified stopping condition", done: state.completed.includes("loop:complete") },
      { label: `Answer at least ${Math.min(5, safetyQuizzes.length)} safety questions correctly`, done: safetyDone >= Math.min(5, safetyQuizzes.length) },
      { label: "Answer at least 3 scenario challenges correctly", done: count("scenario:") >= 3 },
      { label: "Complete at least 3 No IT background units, including at least 2 not shared with the General IT foundations track", done: routes.beginner.size >= 3 && routes.beginnerDistinct >= 2 },
      { label: "Complete at least 3 General IT foundations units, including at least 2 not shared with the No IT background track", done: routes.engineer.size >= 3 && routes.engineerDistinct >= 2 }
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
      buttonNode.textContent = missing.length ? `Complete the requirements to print (${missing.length} remaining)` : "Print certificate";
    }
    if (statusNode) statusNode.textContent = missing.length ? `Certificate requirements: ${requirements.filter(item => item.done).length}/${requirements.length} complete.` : "All certificate requirements are complete. You may print your certificate.";
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
    return levels.reduce((found, level) => state.xp >= Number(level.xpMin) ? level : found, levels[0] || { title: "AI Explorer" });
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
    showToast(0, `Badge unlocked: ${badge ? badge.title : id}`);
  }

  function evaluateBadges() {
    const countPrefix = prefix => state.completed.filter(id => id.startsWith(prefix)).length;
    const safetyQuizzes = asArray(DATA.quizzes).filter(item => item.category === "Safety");
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
          "aria-label": `${badge.title}: ${earned ? "unlocked" : "locked"}`,
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
    if (reward) earn(`audience:${state.audience}`, 5, state.audience === "engineer" ? "Switched to the IT perspective." : "Switched to the No IT background perspective.");
  }

  function setTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    const toggle = $('[data-testid="theme-toggle"]');
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(state.theme === "light"));
      toggle.setAttribute("aria-label", state.theme === "light" ? "Switch to dark theme" : "Switch to light theme");
    }
    persist();
    announce(`Switched to the ${state.theme === "light" ? "light" : "dark"} theme.`);
  }

  function renderTimelineFilters() {
    const mount = $("#timeline-year-filter");
    if (!mount) return;
    const years = [...new Set(asArray(DATA.timeline).map(item => item.year))].sort();
    const controls = [button("All years", "timeline-year", "all", "button button-quiet")];
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
        button("View details and sources", "timeline-detail", item.id),
        button(state.completed.includes(`timeline:${item.id}`) ? "✓ Learned" : "Mark as learned", "timeline-learn", item.id, "button button-primary")
      ]);
      article.append(controls);
      fragment.append(article);
    });
    if (!items.length) fragment.append(element("p", { text: "No events match the selected year." }));
    mount.replaceChildren(fragment);
  }

  function showTimelineDetail(id, trigger) {
    const item = asArray(DATA.timeline).find(event => String(event.id) === String(id));
    if (!item) return;
    openModal(item.title, content => {
      appendTextBlock(content, "p", item.what);
      appendTextBlock(content, "h3", "Why it matters");
      appendTextBlock(content, "p", item.why);
      appendTextBlock(content, "h3", "No IT background perspective");
      appendTextBlock(content, "p", item.plain);
      appendTextBlock(content, "h3", "IT perspective");
      appendTextBlock(content, "p", item.engineer);
      appendTextBlock(content, "h3", "Official sources");
      asArray(item.source).forEach((url, index) => content.append(element("p", {}, [link(`Source ${index + 1}`, url)])));
      content.append(button(state.completed.includes(`timeline:${item.id}`) ? "Marked as learned" : "Mark as learned", "modal-timeline-learn", item.id, "button button-primary"));
    }, trigger);
  }

  function renderConceptCategoryOptions() {
    const select = $("#concept-category-filter");
    if (!select) return;
    const options = [element("option", { value: "", text: "All categories" })];
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
        ["Professional definition", item.professional], ["Plain-language explanation", item.plain], ["Everyday analogy", item.life], ["IT analogy", item.engineer]
      ];
      const viewGrid = element("div", { className: "grid-2" });
      views.forEach(([title, body]) => {
        const engineerDefault = title === "Professional definition" || title === "IT analogy";
        const beginnerDefault = title === "Plain-language explanation" || title === "Everyday analogy";
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
      details.append(element("summary", { text: "Misconceptions, safety, and related concepts" }));
      appendTextBlock(details, "p", item.misconception);
      appendTextBlock(details, "p", `Safety note: ${item.safety}`);
      appendTextBlock(details, "p", `Related: ${asArray(item.related).join(" · ")}`);
      article.append(details, button(state.completed.includes(`concept:${item.id}`) ? "✓ Mastered" : "Mark as mastered", "concept-learn", item.id, "button button-primary"));
      return article;
    }));
    if (!items.length) mount.append(element("p", { text: "No concepts match. Shorten the search term or clear the category filter." }));
  }

  function renderProductFilters() {
    const mount = $("#product-filters");
    if (!mount) return;
    const makeSelect = (labelText, key, values, testid) => {
      const labelNode = element("label", { className: "field" });
      labelNode.append(element("span", { className: "field-label", text: labelText }));
      const select = element("select", { dataset: { productFilter: key, testid } });
      select.append(element("option", { value: "", text: `All ${labelText.toLocaleLowerCase()}` }));
      values.forEach(value => select.append(element("option", { value, text: value })));
      select.value = productFilter[key];
      labelNode.append(select);
      return labelNode;
    };
    const products = asArray(DATA.products);
    mount.replaceChildren(
      makeSelect("Regions", "region", [...new Set(products.map(item => item.region))].sort(), "product-region-filter"),
      makeSelect("Categories", "category", [...new Set(products.map(item => item.category))].sort(), "product-category-filter"),
      makeSelect("Action levels", "action", [...new Set(products.map(item => item.actionLevel))].sort(), "product-action-filter")
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
      appendTextBlock(article, "p", `${item.company} | ${item.strength}`);
      appendTextBlock(article, "p", `Deployment: ${item.deployment} | Best for: ${item.audience}`);
      appendTextBlock(article, "p", `Safety boundary: ${item.safety}`);
      article.append(link("Official page", item.url));
      return article;
    }));
    if (!items.length) mount.append(element("p", { text: "No products match the selected filters." }));
  }

  function renderSubscriptions() {
    const mount = $("#subscription-list");
    if (!mount) return;
    const table = element("table");
    const head = element("thead");
    const row = element("tr");
    ["Platform / plan", "Current price", "Quota and unit", "Reset window", "Subscription and API", "Restrictions / verification"].forEach(label => row.append(element("th", { scope: "col", text: label })));
    head.append(row);
    const body = element("tbody");
    asArray(DATA.subscriptions).forEach(item => {
      const tr = element("tr");
      const sourceCell = element("td");
      sourceCell.append(document.createTextNode(`${item.restriction}; verified: ${item.verified}. `));
      asArray(item.source).forEach((url, index) => {
        if (index) sourceCell.append(document.createTextNode(" · "));
        sourceCell.append(link(`Source ${index + 1}`, url));
      });
      tr.append(
        element("td", { text: item.name }),
        element("td", { text: `${item.currentPrice}; ${item.promo}` }),
        element("td", { text: `${item.quotas} (${item.unit})` }),
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
    platform.replaceChildren(element("option", { value: "", text: "Select a platform" }), ...asArray(DATA.subscriptions).map(item => element("option", { value: item.id, text: item.name })));
    if (asArray(DATA.subscriptions).some(item => item.id === previous)) platform.value = previous;
    renderQuotaPlans();
  }

  function renderQuotaPlans() {
    const platform = $('[data-testid="quota-platform"]');
    const plan = $('[data-testid="quota-plan"]');
    if (!platform || !plan) return;
    const selected = asArray(DATA.subscriptions).find(item => item.id === platform.value);
    const previous = plan.value;
    plan.replaceChildren(element("option", { value: "", text: "Select a plan" }), ...asArray(selected && selected.plans).map((item, index) => element("option", { value: String(index), text: item.name })));
    if (selected && selected.plans && selected.plans[Number(previous)]) plan.value = previous;
  }

  function quotaWindowExplanation(reset) {
    const rules = [];
    if (/rolling|released (?:dynamically|minute by minute)/i.test(reset)) rules.push("Rolling window: usage becomes available gradually according to when it was consumed; it does not reset all at once on the hour.");
    if (/fixed/i.test(reset)) rules.push("Fixed window: the platform measures usage within a fixed start and end period, then refreshes it after that period ends.");
    if (/calendar week|every Monday/i.test(reset)) rules.push("Calendar week: usage is measured by calendar week, commonly resetting on Monday in a stated time zone.");
    if (/every 7 days|fixed 7-day|from (?:the )?(?:subscription|order) date/i.test(reset)) rules.push("Seven-day window: the platform counts seven continuous days from its specified starting point; this is not necessarily a calendar week.");
    if (!rules.length) rules.push("Window type: the public description does not fit one standard pattern. Use the current countdown in the platform console as the source of truth.");
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
      output.replaceChildren(element("div", { className: "status-label", text: "Simulation output" }), element("h3", { text: "Select a platform and plan first" }), element("p", { text: "The simulation will not invent missing official quota figures." }));
      announce("Select a quota platform and plan first.");
      return;
    }
    const amplification = { light: 5, medium: 15, heavy: 30 }[intensity.value] || 5;
    const title = `${subscription.name} · ${plan.name}`;
    output.replaceChildren(element("div", { className: "status-label", text: "Teaching simulation · Does not alter official facts" }), element("h3", { text: title }));
    output.append(element("p", { text: `Teaching estimate: one user prompt may expand into about ${amplification} underlying model calls (light 5 / medium 15 / heavy 30).` }));
    quotaWindowExplanation(subscription.reset).forEach(rule => output.append(element("p", { text: rule })));
    output.append(element("p", { text: `Summary of the official wording: ${subscription.quotas}` }));
    output.append(element("p", { text: "Disclaimer: this simulation explains call amplification. It does not predict your balance, bill, or remaining requests. Actual deductions, limits, model multipliers, and reset times are governed by the official console and current terms." }));
    const meter = element("div", { className: "meter", "aria-hidden": "true" }, [element("span")]);
    $("span", meter).style.width = `${Math.min(100, amplification * 3)}%`;
    output.append(meter);
    complete("quota:run");
    earn("quota:run", 15, "You explored how one prompt can expand into multiple model calls.") || updateRewards();
  }

  function renderComparison() {
    const mount = $("#comparison-list");
    if (!mount) return;
    mount.replaceChildren(...asArray(DATA.comparison).map(item => {
      const article = element("article", { className: "panel" });
      appendTextBlock(article, "h3", item.dimension);
      appendTextBlock(article, "p", `Hermes: ${item.hermes}`);
      appendTextBlock(article, "p", `OpenClaw: ${item.openclaw}`);
      appendTextBlock(article, "p", `Takeaway: ${item.takeaway}`);
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
        row.append(element("code", { text: command }), button("Copy command", "copy-command", command, "button button-quiet"));
        details.append(row);
      });
      appendTextBlock(details, "p", `Caution: ${module.warning}`);
      details.append(link("Official documentation", module.source));
      details.append(button(state.completed.includes(`hermes:${module.id}`) ? "✓ Module complete" : "Mark module complete", "hermes-complete", module.id, "button button-primary"));
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
      trigger.textContent = copied ? "Copied" : "Copy manually";
      window.setTimeout(() => { trigger.textContent = original; }, 1800);
    }
    announce(copied ? "Command copied." : "The browser blocked automatic copying. Select and copy the command manually.");
  }

  function categoryToValue(category) {
    if (category === "USER") return "user";
    if (category === "MEMORY") return "memory";
    if (category === "Session Search") return "session";
    if (category === "Skill" || category === "Cron") return "skill";
    if (category === "Do not save") return "never";
    return "never";
  }

  function classifyMemory(input) {
    const normalized = input.trim();
    const exact = asArray(DATA.memoryExamples).find(item => item.input === normalized);
    if (exact) return exact;
    if (/api\s*key|password|private\s*key|seed\s*phrase|mnemonic|verification\s*code|one[- ]time\s*(?:code|password)|token|cookie|credential|secret|redacted|masked|\u5bc6\u7801|\u79c1\u94a5|\u52a9\u8bb0\u8bcd|\u9a8c\u8bc1\u7801|\u4ee4\u724c|\u5bc6\u94a5|\u8131\u654f|\u5df2\u906e\u76d6/i.test(normalized) ||
        /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|ssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{16,})/i.test(normalized) ||
        /(?:sk-|ghp_|github_pat_|AKIA|Bearer|ssh-(?:rsa|ed25519))[^\s]{0,24}(?:\u2026|\.\.\.)/i.test(normalized) ||
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(normalized)) {
      return { category: "Do not save", reason: "A credential, token, key, or secret pattern was detected. Do not save it in chat, long-term memory, a Skill, or Cron. If it was exposed, revoke or rotate it immediately." };
    }
    if (/every\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|remind|schedule|at\s+\d{1,2}:\d{2}|\d{1,2}:\d{2}|\u6bcf(?:\u5929|\u5468|\u6708)|\u63d0\u9192|\u5b9a\u65f6/i.test(normalized)) return { category: "Cron", reason: "This content has a clear time trigger. Verify the workflow interactively before saving the task and schedule, and never save secrets." };
    if (/steps?|procedure|workflow|runbook|playbook|every\s+time|\u6b65\u9aa4|\u6d41\u7a0b|\u64cd\u4f5c\u624b\u518c|\u6c89\u6dc0|\u6bcf\u6b21\u90fd/i.test(normalized)) return { category: "Skill", reason: "A repeatable, verified procedure belongs in a Skill and should retain failure branches and verification methods." };
    if (/previously|last\s+(?:time|week|month)|weeks?\s+ago|conversation|chat\s+history|what\s+was\s+the\s+log|\u4ee5\u524d|\u4e0a\u6b21|\u4e09\u5468\u524d|\u5bf9\u8bdd|\u804a\u5929\u8bb0\u5f55|\u65e5\u5fd7\u662f\u4ec0\u4e48/i.test(normalized)) return { category: "Session Search", reason: "A specific historical passage belongs in on-demand search. After finding it, verify its date and context." };
    if (/\b(?:preference|i\s+(?:prefer|like)|my\s+time\s*zone|please\s+use|answer\s+first)\b|\u504f\u597d|\u6211\u559c\u6b22|\u6211\u7684\u65f6\u533a|\u8bf7\u7528|\u56de\u7b54\u5148/i.test(normalized)) return { category: "USER", reason: "A stable communication or environment preference belongs in USER. A one-off request does not need long-term storage." };
    return { category: "MEMORY", reason: "This looks like a reusable fact. Save it to MEMORY only when its source is verified, it will be useful later, and it can be corrected or deleted." };
  }

  function renderMemoryExamples() {
    const prompt = $('[data-testid="memory-prompt"]');
    if (!prompt || $("[data-memory-examples]")) return;
    const container = element("div", { className: "view-tabs", dataset: { memoryExamples: "true" }, "aria-label": "Load a dataset example" });
    asArray(DATA.memoryExamples).forEach((item, index) => container.append(button(`Example ${index + 1} · ${item.category}`, "memory-example", item.id, "button button-quiet")));
    prompt.closest(".field").after(container);
  }

  function checkMemory() {
    const prompt = $('[data-testid="memory-prompt"]');
    const selected = $('input[name="memory-place"]:checked');
    const output = $("#memory-result");
    if (!prompt || !output) return;
    if (!prompt.value.trim() || !selected) {
      output.replaceChildren(element("div", { className: "status-label", text: "Placement review" }), element("h3", { text: "Enter content and select a destination" }), element("p", { text: "Nothing should be saved by default before it is classified." }));
      announce("Enter the content to classify and select a destination.");
      return;
    }
    const recommendation = classifyMemory(prompt.value);
    const expected = categoryToValue(recommendation.category);
    const correct = selected.value === expected;
    output.replaceChildren(element("div", { className: "status-label", text: correct ? "Placement correct" : "Placement needs review" }), element("h3", { text: `${correct ? "Correct" : "Suggested change"}: ${recommendation.category}` }), element("p", { text: recommendation.reason }), element("p", { text: recommendation.category === "Do not save" ? "Retention: do not write it. If a secret was exposed, revoke or rotate it." : "Before writing: confirm necessity, source, retention period, and how the record can be corrected or deleted." }));
    if (correct) {
      complete("memory:correct");
      earn("memory:correct", 20, "You correctly distinguished USER, MEMORY, search, Skill/Cron, and Do not save.") || updateRewards();
    } else {
      showToast(0, "The placement has been explained. Secrets are not saved by default. Confirm necessity before long-term storage; enable memory.write_approval when every write needs approval.");
    }
  }

  function controlRoute(capabilities) {
    if (capabilities.includes("desktop")) return { name: "Desktop Accessibility; use Vision only as a last resort", index: 7 };
    if (capabilities.includes("login")) return { name: "Prefer a restricted API/MCP; otherwise use an isolated Browser DOM/CDP route with a dedicated low-privilege account", index: 4 };
    if (capabilities.includes("write")) return { name: "Prefer a minimally scoped API/MCP/CLI with a dry run, diff, confirmation, and rollback", index: 0 };
    return { name: "Use a read-only API; if none exists, check MCP, CLI, then Browser DOM", index: 0 };
  }

  function renderDecision() {
    const taskInput = $('input[name="decision-task"]');
    const output = $("#decision-result");
    if (!output) return;
    const capabilities = $$('input[name="capability"]:checked').map(node => node.value);
    const task = taskInput ? taskInput.value.trim() : "";
    const route = controlRoute(capabilities);
    output.replaceChildren(element("div", { className: "status-label", text: "Minimum-permission result" }), element("h3", { text: route.name }));
    output.append(element("p", { text: task ? `Task: ${task}` : "No task goal was entered; this conservative route is based only on the selected capabilities." }));
    const routeList = element("div", { className: "decision-route" });
    asArray(DATA.controlQuestions).forEach((question, index) => {
      const step = element("details", { className: "route-step", open: index === route.index });
      step.append(element("summary", { text: `${String(index + 1).padStart(2, "0")} · ${question.question}` }), element("p", { text: `Yes: ${question.ifYes}` }), element("p", { text: `No: ${question.ifNo}` }), element("p", { text: `Why: ${question.why}` }));
      routeList.append(step);
    });
    output.append(routeList, element("p", { text: "Minimum controls for every route: enable only the tools and data scope needed. Writes, logged-in sessions, publishing, deletion, payments, identity permissions, and production network changes must show their impact, require human confirmation, and have a real rollback." }));
    complete("decision:run");
    earn("decision:run", 15, "Generated a least-privilege route from structured interfaces to desktop control.") || updateRewards();
  }

  const LOOP_STEPS = [
    { key: "reason", tool: "None", line: "[reason] Read the goal: check whether a configuration meets the requirements." },
    { key: "tool", tool: "Read-only configuration checker", line: "[tool] Select a read-only checker; do not grant write access." },
    { key: "act", tool: "Read-only configuration checker", line: "[act] Run the controlled check." },
    { key: "observe", tool: "Read-only configuration checker", line: "[observe] Received exit code 0 and structured check results." },
    { key: "verify", tool: "Acceptance rules", line: "[verify] Independently compare the result with the completion criteria; it passes." },
    { key: "memory-stop", tool: "Curated memory", line: "[memory/stop] Record the necessary conclusion and stop; no raw secrets were saved." }
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
      const tool = loop.index > 0 ? (LOOP_STEPS[Math.min(loop.index, 5)] || LOOP_STEPS[5]).tool : "Not selected";
      const stop = loop.stopped ? (loop.index >= 5 ? "Task verified; stopped normally" : "Retry limit reached; stopped safely") : "Not met";
      status.replaceChildren(
        statusLine("Step", `${step} / 6`),
        statusLine("Tool", tool),
        statusLine("Retries", `${loop.retries} / 2`),
        statusLine("Stopping condition", stop)
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
      announce("The loop has stopped. Reset it before starting again.");
      stopLoopAuto();
      return;
    }
    const step = LOOP_STEPS[loop.index];
    if (!step) return;
    if (step.key === "act" && loop.fault) {
      loop.retries += 1;
      loop.logs.push(`[act:error] The tool returned a transient failure; retry ${loop.retries} / 2.`);
      if (loop.retries >= 2) {
        loop.logs.push("[stop] Maximum of two retries reached; preserve the evidence and stop safely.");
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
      loop.logs.push("[stop] Completion criteria met; the loop is finished.");
      stopLoopAuto();
      complete("loop:complete");
      earn("loop:complete", 25, "Completed Reason → Tool → Act → Observe → Verify → Memory/Stop.") || updateRewards();
    }
    renderLoop();
  }

  function toggleLoopAuto() {
    if (loopTimer) {
      stopLoopAuto();
      announce("Automatic demonstration paused.");
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
    loop.logs = ["[ready] Loop reset; waiting for Reason."];
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
    appendTextBlock(card, "div", `${type === "quiz" ? "Quiz" : "Scenario"} ${String(index + 1).padStart(2, "0")}${item.category ? ` · ${item.category}` : ""}`, "status-label");
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
      explanation.replaceChildren(element("p", { text: `${correct ? "✓ Correct. " : "✗ Incorrect. "}${item.explanation}` }));
      if (item.safety) explanation.append(element("p", { text: `Safety boundary: ${item.safety}` }));
    }
    $$('[data-action="answer"]', card).forEach((option, optionIndex) => {
      option.setAttribute("aria-pressed", String(optionIndex === selected));
      if (optionIndex === Number(item.answer)) option.dataset.correct = "true";
    });
    if (correct) {
      complete(`${type}:${id}`);
      completeRouteUnit(type, id);
      removeReview(id);
      earn(`${type}:${id}`, type === "scenario" ? 20 : 10, type === "scenario" ? `Scenario complete: ${item.title}` : `Correct answer: ${item.question}`) || updateRewards();
    } else {
      addReview(id, type, type === "scenario" ? item.title : item.question);
      showToast(0, "This question was added to your review list; the explanation is shown now.");
    }
  }

  function renderReview() {
    const mount = $("#review-list");
    if (!mount) return;
    if (!state.reviewItems.length) {
      mount.replaceChildren(element("p", { text: "Nothing to review yet. Continue with the quizzes; incorrect answers will appear here automatically." }));
      return;
    }
    mount.replaceChildren(...state.reviewItems.map(item => {
      const source = item.type === "scenario" ? asArray(DATA.scenarios).find(entry => entry.id === item.id) : asArray(DATA.quizzes).find(entry => entry.id === item.id);
      const article = element("article", { className: "panel" });
      appendTextBlock(article, "div", item.type === "scenario" ? "Scenario review" : "Question review", "status-label");
      appendTextBlock(article, "h3", item.title || (source && (source.title || source.question)) || item.id);
      appendTextBlock(article, "p", source ? source.explanation : "Return to the corresponding question and answer it again.");
      article.append(button("Go to question", "review-jump", `${item.type}|${item.id}`, "button button-primary"));
      return article;
    }));
  }

  function renderSources() {
    const mount = $("#source-list");
    if (!mount) return;
    const list = element("ol");
    asArray(DATA.sources).forEach(source => {
      const item = element("li");
      item.append(link(source.title, source.url), document.createTextNode(` · Verified ${source.verifiedAt || DATA.meta.verifiedAt || "date not stated"}`));
      list.append(item);
    });
    mount.replaceChildren(list);
  }

  function matchesLearningLevel(level, filter) {
    if (!filter) return true;
    const patterns = { Beginner: /Beginner/i, Intermediate: /Intermediate/i, Advanced: /Advanced/i };
    return Boolean(patterns[filter] && patterns[filter].test(text(level)));
  }

  function matchesLearningLanguage(language, filter) {
    if (!filter) return true;
    const patterns = {
      Chinese: /Chinese/i,
      English: /English/i,
      Multilingual: /Multilingual/i
    };
    return Boolean(patterns[filter] && patterns[filter].test(text(language)));
  }

  function renderLearningResources() {
    const mount = $("#learning-resource-list");
    if (!mount) return;
    const query = learningFilter.keyword.trim().toLocaleLowerCase("en");
    const items = asArray(DATA.learningResources).filter(item => {
      const searchable = [item.titleZh, item.titleEn, item.provider, item.language, item.level, item.format,
        ...asArray(item.topics), item.authority, item.officiality].map(text).join(" ").toLocaleLowerCase("en");
      return (!learningFilter.platform || item.platform === learningFilter.platform) &&
        matchesLearningLevel(item.level, learningFilter.level) &&
        matchesLearningLanguage(item.language, learningFilter.language) &&
        (!query || searchable.includes(query));
    });

    mount.replaceChildren(...items.map(item => {
      const article = element("article", { className: "panel learning-resource-card", dataset: { resourceId: item.id, platform: item.platform } });
      appendTextBlock(article, "div", `${item.platform} · ${item.officiality}`, "status-label");
      appendTextBlock(article, "h3", item.titleEn || item.titleZh);
      if (item.titleZh && item.titleZh !== item.titleEn) article.append(element("div", { className: "resource-title-en", text: `Original title: ${item.titleZh}`, lang: "zh-CN" }));
      appendTextBlock(article, "p", `Provider: ${item.provider}`);
      const meta = element("div", { className: "resource-meta", ariaLabel: "Resource attributes" });
      [item.level, item.language, item.format].forEach(value => meta.append(element("span", { className: "resource-chip", text: value })));
      meta.append(element("span", { className: "resource-chip resource-chip-officiality", text: item.officiality }));
      article.append(meta);
      const topics = element("div", { className: "resource-topics", ariaLabel: "Topics" });
      asArray(item.topics).forEach(topic => topics.append(element("span", { className: "resource-chip", text: topic })));
      article.append(topics);
      const evidence = element("div", { className: "resource-evidence" });
      appendTextBlock(evidence, "div", "Authority and access", "field-label");
      appendTextBlock(evidence, "p", item.authority);
      appendTextBlock(evidence, "p", `Access: ${item.accessNote}`);
      appendTextBlock(evidence, "p", `Verified: ${item.accessed}`);
      article.append(evidence);
      const external = link("Open learning resource ↗", item.url);
      external.className = "resource-link";
      article.append(external);
      return article;
    }));
    if (!items.length) mount.append(element("p", { text: "No resources match the current filters. Remove a filter or try another keyword." }));
    const count = $("#learning-resource-count");
    if (count) count.textContent = `Showing ${items.length} of ${asArray(DATA.learningResources).length} resources`;
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
    openModal("Clear local learning progress?", content => {
      content.append(element("p", { text: "This clears your audience perspective, theme, completion records, XP, badges, incorrect answers, review list, and any certificate name you explicitly chose to save. This action cannot be undone within the course." }));
      const controls = element("div", { className: "loop-controls" });
      controls.append(button("Cancel", "modal-cancel", "", "button"), button("Clear progress", "modal-reset-confirm", "", "button button-danger"));
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
    announce("Local learning progress cleared.");
  }

  function initializeCertificate() {
    const input = $('[data-testid="certificate-name"]');
    const checkbox = $('input[name="save-certificate-name"]');
    const preview = $('[data-certificate-preview]');
    if (!input || !checkbox || !preview) return;
    input.value = state.certificateName || "";
    checkbox.checked = Boolean(state.certificateName);
    preview.textContent = input.value.trim() || "Learner";
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
    else if (testid === "loop-fault") { loop.fault = !loop.fault; renderLoop(); announce(loop.fault ? "Tool failure injected; the Act stage will retry at most twice." : "Tool failure injection removed."); }
    else if (testid === "loop-reset") resetLoop();
    else if (testid === "quota-run") runQuotaSimulation();
    else if (testid === "memory-check") checkMemory();
    else if (testid === "decision-start") renderDecision();
    else if (testid === "certificate-print") {
      const gate = updateCertificateEligibility();
      if (gate.missing.length) {
        openModal("Certificate requirements not yet met", content => {
          appendTextBlock(content, "p", "Complete the following required work first; a few clicks cannot substitute for the course learning requirements.");
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
      announce(`Timeline filtered; showing ${count} events.`);
      focusSoon(`[data-action="timeline-year"][data-value="${CSS.escape(timelineYear)}"]`);
    }
    else if (action === "timeline-detail") showTimelineDetail(target.dataset.value, target);
    else if (action === "timeline-learn" || action === "modal-timeline-learn") {
      const id = target.dataset.value;
      complete(`timeline:${id}`);
      completeRouteUnit("timeline", id);
      earn(`timeline:${id}`, 5, "Added a key interaction-paradigm event to your learning progress.") || updateRewards();
      renderTimeline();
      if (action === "modal-timeline-learn") closeModal();
      focusSoon(`[data-timeline-id="${CSS.escape(id)}"] [data-action="timeline-learn"]`);
    } else if (action === "concept-learn") {
      complete(`concept:${target.dataset.value}`);
      completeRouteUnit("concept", target.dataset.value);
      earn(`concept:${target.dataset.value}`, 5, "Mastered four perspectives on one concept.") || updateRewards();
      renderConcepts();
      focusSoon(`[data-concept-id="${CSS.escape(target.dataset.value)}"] [data-action="concept-learn"]`);
    } else if (action === "hermes-complete") {
      complete(`hermes:${target.dataset.value}`);
      completeRouteUnit("hermes", target.dataset.value);
      earn(`hermes:${target.dataset.value}`, 8, "Completed one Hermes learning module.") || updateRewards();
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
    else if (action === "modal-reset-confirm") { closeModal(); resetState(true); showToast(0, "Local learning progress cleared."); }
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
      if (preview) preview.textContent = event.target.value.trim() || "Learner";
    }
  }

  function handleChange(event) {
    if (event.target.id === "concept-category-filter") {
      conceptCategory = event.target.value;
      renderConcepts();
      announce(`Concept category updated; showing ${$$("#concept-list article").length} concepts.`);
    } else if (event.target.matches("[data-product-filter]")) {
      productFilter[event.target.dataset.productFilter] = event.target.value;
      renderProducts();
      announce(`Product filters updated; showing ${$$("#product-list article").length} products.`);
    } else if (event.target.id === "learning-platform-filter" || event.target.id === "learning-level-filter" || event.target.id === "learning-language-filter") {
      learningFilter[event.target.id.replace("learning-", "").replace("-filter", "")] = event.target.value;
      renderLearningResources();
      announce(`Further Learning filters updated; showing ${$$("#learning-resource-list article").length} resources.`);
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
        announce(`Moved to ${event.target.options[event.target.selectedIndex].textContent}.`);
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

  window.addEventListener("error", () => announce("The page encountered a problem. Your local learning progress will be preserved where possible; refresh and try again."));
  window.addEventListener("unhandledrejection", () => announce("A browser operation could not be completed. Check the current selection and try again."));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
