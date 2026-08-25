"use strict";

const ORDER_STORAGE_KEY = "slim-dashboard.agent-order.v1";
const GROUP_STORAGE_KEY = "slim-dashboard.model-groups.v1";

const elements = {
  tableBody: document.querySelector("#agentTableBody"),
  tableFrame: document.querySelector("#tableFrame"),
  presetBadge: document.querySelector("#presetBadge"),
  agentCount: document.querySelector("#agentCount"),
  providerSummary: document.querySelector("#providerSummary"),
  priceBanner: document.querySelector("#priceBanner"),
  stateIndicator: document.querySelector("#stateIndicator"),
  stateLabel: document.querySelector("#stateLabel"),
  refreshButton: document.querySelector("#refreshButton"),
  tokenButton: document.querySelector("#tokenButton"),
  chromeButton: document.querySelector("#chromeButton"),
  saveButton: document.querySelector("#saveButton"),
  saveLabel: document.querySelector("#saveLabel"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateMessage: document.querySelector("#emptyStateMessage"),
  retryButton: document.querySelector("#retryButton"),
  geiliModelBody: document.querySelector("#geiliModelBody"),
  geiliModelCount: document.querySelector("#geiliModelCount"),
  geiliEmptyState: document.querySelector("#geiliEmptyState"),
  healthFrame: document.querySelector("#healthFrame"),
  catalogBody: document.querySelector("#catalogBody"),
  catalogCount: document.querySelector("#catalogCount"),
  catalogEmptyState: document.querySelector("#catalogEmptyState"),
  catalogFrame: document.querySelector("#catalogFrame"),
  relayBar: document.querySelector("#relayBar"),
  addRelayButton: document.querySelector("#addRelayButton"),
  relayModal: document.querySelector("#relayModal"),
  relayNameInput: document.querySelector("#relayNameInput"),
  relayBaseURLInput: document.querySelector("#relayBaseURLInput"),
  relayTokenInput: document.querySelector("#relayTokenInput"),
  relayTokenEnvInput: document.querySelector("#relayTokenEnvInput"),
  relayCancelButton: document.querySelector("#relayCancelButton"),
  relaySaveButton: document.querySelector("#relaySaveButton"),
  noticesList: document.querySelector("#noticesList"),
  catalogToggleButton: document.querySelector("#catalogToggleButton"),
  keyModal: document.querySelector("#keyModal"),
  keyModalRelay: document.querySelector("#keyModalRelay"),
  keyInput: document.querySelector("#keyInput"),
  keyCancelButton: document.querySelector("#keyCancelButton"),
  keySaveButton: document.querySelector("#keySaveButton"),
  toast: document.querySelector("#toast"),
  toastIcon: document.querySelector("#toastIcon"),
  toastTitle: document.querySelector("#toastTitle"),
  toastMessage: document.querySelector("#toastMessage"),
};

let dashboardState = null;
let loadedModels = new Map();
let loadedOrder = [];
let draggedRow = null;
let toastTimer = null;
let isBusy = false;

function getStoredOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY));
    return Array.isArray(value) ? value.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

function getStoredGroups() {
  try {
    const value = JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function getGroupKey(provider, modelId) {
  return `${provider}/${modelId}`;
}

function getSelectedGroup(provider, modelId, mapping) {
  const groups = dashboardState?.price?.prices?.[modelId] || {};
  const selected = getStoredGroups()[getGroupKey(provider, modelId)];
  return selected && groups[selected] ? selected : mapping?.priceGroup;
}

function setSelectedGroup(provider, modelId, groupId) {
  const groups = getStoredGroups();
  groups[getGroupKey(provider, modelId)] = groupId;
  localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groups));
}

function persistOrder() {
  const order = getCurrentAgents().map((agent) => agent.name);
  localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
}

function applyStoredOrder(agents) {
  const positions = new Map(getStoredOrder().map((name, index) => [name, index]));
  return agents
    .map((agent, sourceIndex) => ({ ...agent, sourceIndex }))
    .sort((a, b) => {
      const aPosition = positions.has(a.name) ? positions.get(a.name) : Number.MAX_SAFE_INTEGER;
      const bPosition = positions.has(b.name) ? positions.get(b.name) : Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition || a.sourceIndex - b.sourceIndex;
    })
    .map(({ sourceIndex, ...agent }) => agent);
}

function setStatus(status, label) {
  elements.stateIndicator.dataset.state = status;
  elements.stateLabel.textContent = label;
}

function setBusy(busy, kind = "loading") {
  isBusy = busy;
  elements.refreshButton.disabled = busy || !dashboardState;
  elements.saveButton.disabled = busy || !dashboardState || !isDirty();
  elements.refreshButton.classList.toggle("is-spinning", busy && kind === "loading");

  if (kind === "saving") {
    elements.saveLabel.textContent = busy ? "Saving..." : "Save changes";
  }
}

function isDirty() {
  if (!dashboardState) return false;
  const agents = getCurrentAgents();
  const modelsChanged = agents.some((agent) => loadedModels.get(agent.name) !== agent.model);
  const orderChanged = agents.some((agent, index) => loadedOrder[index] !== agent.name);
  return modelsChanged || orderChanged;
}

function updateDirtyState() {
  const dirty = isDirty();
  elements.saveButton.disabled = isBusy || !dirty;
  setStatus(dirty ? "dirty" : "live", dirty ? "Unsaved changes" : "Loaded");

  elements.tableBody.querySelectorAll(".agent-row").forEach((row) => {
    const select = row.querySelector(".model-select");
    row.classList.toggle("is-modified", loadedModels.get(row.dataset.agent) !== select.value);
  });
}

function getCurrentAgents() {
  return Array.from(elements.tableBody.querySelectorAll(".agent-row")).map((row) => ({
    name: row.dataset.agent,
    model: row.querySelector(".model-select").value,
  }));
}

function getModelId(modelReference) {
  const slashIndex = modelReference.indexOf("/");
  return slashIndex === -1 ? modelReference : modelReference.slice(slashIndex + 1);
}

function getProviderId(modelReference) {
  const slashIndex = modelReference.indexOf("/");
  return slashIndex === -1 ? "" : modelReference.slice(0, slashIndex);
}

function findStabilityChannel(stability, channel) {
  if (!stability || !channel) return null;
  if (stability[channel]) return stability[channel];
  const key = Object.keys(stability).find((name) => name.startsWith(channel) || channel.startsWith(name));
  return key ? stability[key] : null;
}

function computeAgentValue(modelReference) {
  const provider = getProviderId(modelReference);
  const modelId = getModelId(modelReference);
  const mapping = dashboardState?.providerMap?.[provider];
  let price = null;
  let groupName = null;
  if (mapping) {
    const groupId = getSelectedGroup(provider, modelId, mapping);
    const p = dashboardState?.price?.prices?.[modelId]?.[groupId];
    if (p && p.in != null) {
      price = { in: p.in, out: p.out, cache: p.cache, mult: p.mult, officialIn: p.officialIn, officialOut: p.officialOut, currency: p.currency || "USD", tiered: p.tiered };
      groupName = `${mapping.groupName} / group ${groupId}`;
    }
  }
  const stability = mapping ? findStabilityChannel(dashboardState?.stability?.channels, mapping.channel) : null;
  return { provider, modelId, price, groupName, stability };
}

function formatPrice(price) {
  if (!price || price.in == null) return "\u2013";
  const cur = price.currency === "CNY" ? "\u00a5" : "$";
  return `${cur}${price.in} / ${cur}${price.out}`;
}

function priceTitle(price, groupName) {
  if (!price) return "No price available";
  const cur = price.currency === "CNY" ? "\u00a5" : "$";
  const tierNote = price.tiered ? " | 分档计费，此处为基础档（超出长度阈值后单价上浮）" : "";
  return `Multiplier \u00d7${price.mult ?? "\u2013"} \u2014 In ${cur}${price.in} / Out ${cur}${price.out} / Cache ${cur}${price.cache !== null && price.cache !== undefined ? price.cache : "\u2013"} per 1M tokens (group ${groupName || ""}, ${price.currency || "USD"})${tierNote}`;
}

function priceTier(price) {
  if (!price || price.in == null) return null;
  const raw = Number(price.in);
  if (!Number.isFinite(raw)) return null;
  if (raw < 0.2) return "low";
  if (raw < 0.5) return "low-mid";
  if (raw < 1) return "mid";
  if (raw < 2) return "mid-high";
  return "high";
}

function priceTierName(tier) {
  return (
    {
      low: "budget",
      "low-mid": "cheap",
      mid: "standard",
      "mid-high": "premium",
      high: "flagship",
    }[tier] || tier
  );
}

function priceTierTitle(price, groupName) {
  const tier = priceTier(price);
  return `${priceTitle(price, groupName)}${tier ? ` | Price tier: ${priceTierName(tier)}` : ""}`;
}

function createPricePill(price) {
  if (!price) return null;
  const pill = document.createElement("span");
  pill.className = "price-pill";
  const tier = priceTier(price);
  if (tier) pill.classList.add(`price-pill--${tier}`);
  pill.textContent = formatPrice(price);
  return pill;
}

function updateRowPrice(row, modelReference) {
  const value = computeAgentValue(modelReference);
  const cell = row.querySelector(".price-column");
  cell.replaceChildren();
  const pill = createPricePill(value.price);
  if (pill) cell.append(pill);
  else cell.textContent = formatPrice(value.price);
  cell.classList.toggle("price-missing", !value.price);
  cell.title = priceTierTitle(value.price, value.groupName);
  updateRowStability(row, value.stability);
  return value;
}

function updateRowStability(row, stability) {
  const cell = row.querySelector(".stability-column");
  if (!cell) return;
  cell.replaceChildren();
  if (!stability) {
    cell.textContent = "\u2013";
    cell.title = "No stability data";
    return;
  }
  const status = document.createElement("span");
  status.className = `stable-badge stable-badge--${stability.status || "unknown"}`;
  status.textContent = stability.status || "unknown";

  const avail = document.createElement("span");
  avail.className = "stable-avail";
  const pct = stability.availability7d;
  avail.textContent = pct != null ? `${pct < 100 ? "" : ""}${Number(pct).toFixed(1)}%` : "\u2013";

  const meta = document.createElement("span");
  meta.className = "stable-meta";
  const lat = stability.latencyMs;
  meta.textContent = lat != null && lat < 30000 ? Math.round(lat).toLocaleString() + "ms" : "";

  const top = document.createElement("div");
  top.className = "stable-top";
  top.append(status, avail, meta);
  cell.append(top);

  cell.title = `Status: ${stability.status || "unknown"}  |  7-day availability: ${pct != null ? Number(pct).toFixed(2) + "%" : "\u2013"}  |  Latency: ${lat != null && lat < 30000 ? Math.round(lat).toLocaleString() + "ms" : "n/a"}`;

  if (stability.last60) {
    const c = stability.last60.counts || {};
    const op = c.operational || 0;
    const deg = c.degraded || 0;
    const err = c.error || 0;
    const last = document.createElement("div");
    last.className = "stable-last60";
    last.textContent = `Last 60: ${op} ok / ${deg} degraded / ${err} error`;
    cell.append(last);
    cell.title += `\nLast 60 checks: ${op} ok, ${deg} degraded, ${err} error`;
  }
}

function createModelSelect(currentModel) {
  const wrapper = document.createElement("div");
  wrapper.className = "model-select-wrap";

  const select = document.createElement("select");
  select.className = "model-select";
  select.setAttribute("aria-label", "Assigned model");

  let currentModelFound = false;
  for (const provider of dashboardState.providers) {
    const group = document.createElement("optgroup");
    group.label = provider.name || provider.id;

    for (const model of provider.models || []) {
      const value = `${provider.id}/${model.id}`;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${provider.name || provider.id}/${model.name || model.id}`;
      if (value === currentModel) currentModelFound = true;
      group.append(option);
    }

    if (group.children.length) select.append(group);
  }

  if (currentModel && !currentModelFound) {
    const group = document.createElement("optgroup");
    group.label = "Current assignment";
    const option = document.createElement("option");
    option.value = currentModel;
    option.textContent = `${currentModel} (unavailable)`;
    group.append(option);
    select.prepend(group);
  }

  select.value = currentModel;
  wrapper.append(select);
  return wrapper;
}

function createDragIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 14 18");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");

  for (const [cx, cy] of [[4, 4], [10, 4], [4, 9], [10, 9], [4, 14], [10, 14]]) {
    const circle = document.createElementNS(namespace, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", "1.25");
    svg.append(circle);
  }
  return svg;
}

function createAgentRow(agent, index) {
  const row = document.createElement("tr");
  row.className = "agent-row";
  row.dataset.agent = agent.name;
  row.style.animationDelay = `${index * 32}ms`;

  const dragCell = document.createElement("td");
  dragCell.className = "drag-column";
  const dragHandle = document.createElement("button");
  dragHandle.className = "drag-handle";
  dragHandle.type = "button";
  dragHandle.draggable = true;
  dragHandle.title = `Drag to reorder ${agent.name}`;
  dragHandle.setAttribute("aria-label", `Drag to reorder ${agent.name}`);
  dragHandle.append(createDragIcon());
  dragCell.append(dragHandle);

  const agentCell = document.createElement("td");
  const identity = document.createElement("div");
  identity.className = "agent-identity";
  const agentIndex = document.createElement("span");
  agentIndex.className = "agent-index";
  agentIndex.textContent = String(index + 1).padStart(2, "0");
  const agentName = document.createElement("span");
  agentName.className = "agent-name";
  agentName.textContent = agent.name;
  identity.append(agentIndex, agentName);
  agentCell.append(identity);

  const modelCell = document.createElement("td");
  modelCell.append(createModelSelect(agent.model));

  const priceCell = document.createElement("td");
  priceCell.className = "price-column";

  const stabilityCell = document.createElement("td");
  stabilityCell.className = "stability-column";

  row.append(dragCell, agentCell, modelCell, priceCell, stabilityCell);
  updateRowPrice(row, agent.model);
  return row;
}

function renumberRows() {
  elements.tableBody.querySelectorAll(".agent-row").forEach((row, index) => {
    row.querySelector(".agent-index").textContent = String(index + 1).padStart(2, "0");
    row.style.animationDelay = "0ms";
  });
}

function deployedModelRefs(state) {
  const refs = new Set();
  for (const provider of state?.providers || []) {
    for (const model of provider.models || []) {
      refs.add(`${provider.id}/${model.id}`);
    }
  }
  return refs;
}

async function deployModelToOpencode(providerId, modelId, relay) {
  try {
    const response = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ provider: providerId, model: modelId, relay }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "deploy rejected");
    showToast("success", "Model deployed", `${modelId} is now available in opencode. Reloading...`);
    setTimeout(() => loadState(), 1200);
  } catch (error) {
    showToast("error", "Deploy failed", error.message || "Could not write to the opencode config.");
  }
}

function createGeiliRow(provider, model) {
  const row = document.createElement("tr");
  row.className = "geili-row";

  const modelCell = document.createElement("td");
  const identity = document.createElement("div");
  identity.className = "agent-identity";
  const name = document.createElement("span");
  name.className = "agent-name";
  name.textContent = model.name || model.id;
  identity.append(name);
  modelCell.append(identity);

  const groupCell = document.createElement("td");
  const ref = `${provider.id}/${model.id}`;
  const value = computeAgentValue(ref);
  const groups = dashboardState?.price?.prices?.[model.id] || {};
  const mapping = dashboardState?.providerMap?.[provider.id];
  const groupSelect = document.createElement("select");
  groupSelect.className = "group-select";
  groupSelect.setAttribute("aria-label", `Price group for ${model.name || model.id}`);
  for (const groupId of Object.keys(groups)) {
    const option = document.createElement("option");
    option.value = groupId;
    const groupName = dashboardState?.priceGroupNames?.[groupId] || "未命名渠道";
    option.textContent = `${groupId} · ${groupName}${groupId === mapping?.priceGroup ? " (默认)" : ""}`;
    option.selected = groupId === getSelectedGroup(provider.id, model.id, mapping);
    groupSelect.append(option);
  }
  groupCell.append(groupSelect);

  const priceCell = document.createElement("td");
  priceCell.className = "price-column";
  const pill = createPricePill(value.price);
  if (pill) priceCell.append(pill);
  else priceCell.textContent = formatPrice(value.price);
  priceCell.title = priceTierTitle(value.price, value.groupName);

  const stabilityCell = document.createElement("td");
  stabilityCell.className = "stability-column";

  const actionCell = document.createElement("td");
  actionCell.className = "action-column";
  const isDeployed = deployedModelRefs(dashboardState).has(`${provider.id}/${model.id}`);
  if (!isDeployed) {
    const deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "deploy-btn";
    deployBtn.textContent = "Deploy";
    deployBtn.title = `Add ${provider.id}/${model.id} to opencode.jsonc`;
    deployBtn.addEventListener("click", () => {
      deployBtn.disabled = true;
      deployModelToOpencode(provider.id, model.id, mapping?.relay);
    });
    actionCell.append(deployBtn);
  } else {
    actionCell.innerHTML = `<span class="deployed-mark" title="Already configured in opencode.jsonc">Deployed</span>`;
  }

  row.append(modelCell, groupCell, priceCell, stabilityCell, actionCell);
  updateRowStability(row, value.stability);
  groupSelect.addEventListener("change", () => {
    setSelectedGroup(provider.id, model.id, groupSelect.value);
    renderGeiliModels(dashboardState);
    elements.tableBody.querySelectorAll(".agent-row").forEach((agentRow) => {
      const select = agentRow.querySelector(".model-select");
      updateRowPrice(agentRow, select.value);
    });
  });
  return row;
}

function renderGeiliModels(state) {
  const rows = [];
  for (const provider of state.providers || []) {
    if (!state.providerMap?.[provider.id]) continue;
    for (const model of provider.models || []) {
      rows.push(createGeiliRow(provider, model));
    }
  }
  elements.geiliModelBody.replaceChildren(...rows);
  elements.healthFrame.setAttribute("aria-busy", "false");
  elements.geiliEmptyState.hidden = rows.length > 0;
  elements.geiliModelBody.closest("table").hidden = rows.length === 0;
  elements.geiliModelCount.textContent = String(rows.length);
  renderCatalog(state);
  renderRelayBar(state);
  renderNotices(state);
}

const NOTICE_HOT_RE = /(倍率|价格|价格表|分组|渠道|折扣|调整|涨价|降价|上线|下线|失效|公告|ratio|price|group)/i;

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderNoticeText(text) {
  return escapeHtml(text)
    .split("\n")
    .map((line) => (NOTICE_HOT_RE.test(line) ? `<div class="notice-line notice-hot">${line}</div>` : `<div class="notice-line">${line}</div>`))
    .join("");
}

function renderNotices(state) {
  const list = elements.noticesList;
  list.replaceChildren();
  const entries = Object.entries(state.notices || {}).filter(([, n]) => n.ok && n.text);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "notice-empty";
    empty.textContent = "No announcements available from your relays.";
    list.append(empty);
    return;
  }
  for (const [relayId, notice] of entries) {
    const relay = state.relays?.[relayId];
    const card = document.createElement("div");
    card.className = "notice-card";

    const head = document.createElement("div");
    head.className = "notice-head";
    const name = document.createElement("b");
    name.textContent = relay?.name || relayId;
    const meta = document.createElement("small");
    meta.textContent = `${notice.updatedAt ? new Date(notice.updatedAt).toLocaleString() : ""}${notice.stale ? " · cached" : ""}`;
    head.append(name, meta);

    if (notice.justChanged || (notice.changedAt && Date.now() - new Date(notice.changedAt).getTime() < 30 * 60 * 1000)) {
      const badge = document.createElement("span");
      badge.className = "notice-new";
      badge.textContent = "UPDATED";
      badge.title = notice.changedAt ? `Changed at ${new Date(notice.changedAt).toLocaleString()}` : "";
      head.append(badge);
    }
    if (notice.stale) {
      const staleBadge = document.createElement("span");
      staleBadge.className = "notice-stale";
      staleBadge.textContent = "STALE";
      head.append(staleBadge);
    }

    const details = document.createElement("details");
    details.className = "notice-details";
    const summary = document.createElement("summary");
    const firstHot = (notice.text || "").split("\n").find((l) => NOTICE_HOT_RE.test(l));
    summary.textContent = firstHot ? firstHot.slice(0, 120) : "View announcement";
    const body = document.createElement("div");
    body.className = "notice-body";
    body.innerHTML = renderNoticeText(notice.text || "");
    details.append(summary, body);

    card.append(head, details);
    list.append(card);
  }
}

const CATALOG_KEY_PREFIX = "__catalog__";
const CATALOG_COLLAPSE_KEY = "slim-dashboard.catalog-collapsed.v1";

function getCollapsedCatalog() {
  try {
    const v = JSON.parse(localStorage.getItem(CATALOG_COLLAPSE_KEY));
    return v && typeof v === "object" && v.relays && v.vendors ? v : { relays: {}, vendors: {} };
  } catch {
    return { relays: {}, vendors: {} };
  }
}

function setCollapsedCatalog(next) {
  localStorage.setItem(CATALOG_COLLAPSE_KEY, JSON.stringify(next));
}

function catalogGroups(state) {
  return Object.keys(state?.price?.prices || {});
}

function familyOf(modelId) {
  return vendorOf(modelId).id;
}

const VENDOR_RULES = [
  { id: "openai", label: "OpenAI", re: /^gpt|^o\d|^chatgpt|davinci|codex/ },
  { id: "anthropic", label: "Anthropic Claude", re: /claude/ },
  { id: "google", label: "Google Gemini", re: /gemini|palm|bard|gemma/ },
  { id: "xai", label: "xAI Grok", re: /grok/ },
  { id: "deepseek", label: "DeepSeek", re: /deepseek/ },
  { id: "zhipu", label: "智谱 GLM", re: /glm|thudm|cogview|cogvideo/ },
  { id: "moonshot", label: "Moonshot Kimi", re: /kimi|moonshot|^k\d/ },
  { id: "qwen", label: "阿里 Qwen", re: /qwen|qwq/ },
  { id: "minimax", label: "MiniMax", re: /minimax|abab/ },
  { id: "xiaomi", label: "小米 MiMo", re: /mimo/ },
  { id: "baidu", label: "文心 ERNIE", re: /ernie/ },
  { id: "tencent", label: "混元 Hunyuan", re: /hunyuan/ },
  { id: "meta", label: "Meta LLaMA", re: /llama|llava/ },
  { id: "mistral", label: "Mistral", re: /mistral|mixtral/ },
];

function vendorOf(modelId) {
  const s = String(modelId).toLowerCase();
  return VENDOR_RULES.find((v) => v.re.test(s)) || { id: "other", label: "Other / 开源" };
}

const UTILITY_RE = /(tts|asr|audio|speech|whisper|voiceclone|voicedesign|image|ocr|embed|rerank|moderation|kolors|dall|transcribe)/i;

// Rough release-order score: higher = newer. Date suffix (yyyymmdd) wins,
// then semantic version digits, small penalties for preview/experimental.
function releaseScore(modelId) {
  const s = String(modelId).toLowerCase();
  const dateMatch = s.match(/(20\d{6})/);
  // Strip parameter-size tokens (8b, 4b...) and role words so they don't
  // pollute version comparison.
  const cleaned = s.replace(/\d+b\b/g, " ").replace(/instruct|chat|base|\bvl\b/g, " ");
  let nums = [...cleaned.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
  if (dateMatch) nums = nums.filter((n) => n !== parseInt(dateMatch[1], 10));
  let score = 0;
  for (let i = 0; i < nums.length; i++) score += Math.min(nums[i], 99) / Math.pow(100, i);
  if (/preview|-exp\b|experimental/.test(s)) score -= 0.05;
  if (/\blow\b/.test(s)) score -= 0.02;
  if (/(^|[-_.])(lite|mini|nano)([-_.]|$)/.test(s)) score -= 0.03;
  if (/(^|[-_.])flash([-_.]|$)/.test(s)) score -= 0.01;
  if (dateMatch) {
    const d = parseInt(dateMatch[1], 10);
    score += ((d % 10000000) / 10000000) * 0.9 + 0.001;
  }
  return score;
}

function compareModelsNewestFirst(a, b) {
  const ua = UTILITY_RE.test(a) ? 1 : 0;
  const ub = UTILITY_RE.test(b) ? 1 : 0;
  if (ua !== ub) return ua - ub;
  const sa = releaseScore(a);
  const sb = releaseScore(b);
  if (Math.abs(sa - sb) > 1e-9) return sb - sa;
  return a.localeCompare(b);
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// Derive a provider-name prefix for a relay. Priority:
// 1. explicit relay.providerPrefix from config
// 2. an existing opencode provider pointing at the same API host (nan.meta-api.vip -> "nan")
// 3. an already-mapped provider of this relay
// 4. first label of the domain, then the relay id
function relayPrefix(state, relayId, relay) {
  if (relay?.providerPrefix) return String(relay.providerPrefix);
  const host = hostOf(relay?.baseURL);
  const sameHost = (state.providers || []).find((p) => hostOf(p.baseURL) === host && p.id.includes("_"));
  if (sameHost) return sameHost.id.split("_")[0];
  const mapped = Object.entries(state.providerMap || {}).find(
    ([pid, m]) => (m.relay || "geiliapi") === relayId && pid.includes("_")
  );
  if (mapped) return mapped[0].split("_")[0];
  const dom = host ? host.split(".")[0] : "";
  return dom || relayId || "relay";
}

function suggestProviderId(state, prefix, modelId) {
  const taken = new Set((state.providers || []).map((p) => p.id));
  let id = `${prefix}_${familyOf(modelId)}`;
  let n = 2;
  while (taken.has(id)) id = `${prefix}_${familyOf(modelId)}_${n++}`;
  return id;
}

function buildTargetSelect(state, relayId, modelId, relay) {
  const select = document.createElement("select");
  select.className = "group-select target-select";
  const prefix = relayPrefix(state, relayId, relay);
  const seen = new Set();

  // 1) providers already mapped to this relay
  for (const [pid, m] of Object.entries(state.providerMap || {})) {
    if (!m.priceGroup || (m.relay || "geiliapi") !== relayId) continue;
    seen.add(pid);
    const option = document.createElement("option");
    option.value = pid;
    option.textContent = pid;
    select.append(option);
  }

  // 2) existing providers on the same API host (e.g. nan_openai) — deploying
  //    into them just adds the model alongside their current ones.
  const host = hostOf(relay?.baseURL);
  if (host) {
    for (const p of state.providers || []) {
      if (seen.has(p.id) || hostOf(p.baseURL) !== host) continue;
      seen.add(p.id);
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = `${p.id} (已有)`;
      select.append(option);
    }
  }

  const suggestion = suggestProviderId(state, prefix, modelId);
  const newOption = document.createElement("option");
  newOption.value = "__new__";
  newOption.dataset.suggest = suggestion;
  newOption.textContent = `+ ${suggestion}`;
  select.append(newOption);
  if (!seen.size) select.value = "__new__";
  return select;
}

async function deployCatalogModel(state, modelId, groupId, targetProvider, relayId, button, suggestedId) {
  button.disabled = true;
  button.textContent = "Deploying…";
  try {
    const providerId = targetProvider === "__new__" ? suggestedId : targetProvider;
    const response = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ provider: providerId, model: modelId, relay: relayId, group: groupId }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "deploy rejected");
    showToast("success", "Model deployed", result.message + " Reloading…");
    setTimeout(() => loadState(), 1200);
  } catch (error) {
    showToast("error", "Deploy failed", error.message || "Could not write to the opencode config.");
    button.disabled = false;
    button.textContent = "Deploy";
  }
}

function createCatalogRow(state, modelId, relayId, table) {
  const row = document.createElement("tr");
  row.className = "catalog-row";

  const groups = table[modelId] || {};

  const modelCell = document.createElement("td");
  modelCell.className = "agent-name";
  const ownerRelay = state.relays?.[relayId];
  modelCell.textContent = modelId;
  if (ownerRelay) modelCell.title = `from relay: ${ownerRelay.name} (${ownerRelay.baseURL})`;

  const groupCell = document.createElement("td");
  const groupSelect = document.createElement("select");
  groupSelect.className = "group-select";
  for (const groupId of Object.keys(groups)) {
    const option = document.createElement("option");
    option.value = groupId;
    const groupName = state.priceGroupNames?.[groupId] || groupId;
    option.textContent = `${groupId} · ${groupName}`;
    groupSelect.append(option);
  }
  const storedGroup = getSelectedGroup(CATALOG_KEY_PREFIX, modelId, null);
  if (storedGroup && groups[storedGroup]) {
    groupSelect.value = storedGroup;
  } else {
    // Default to the cheapest group so the price shown is the best available.
    let best = null, bestCost = Infinity;
    for (const [gid, e] of Object.entries(groups)) {
      const c = Number(e?.in);
      if (Number.isFinite(c) && c < bestCost) { bestCost = c; best = gid; }
    }
    if (best) groupSelect.value = best;
  }
  groupSelect.addEventListener("change", () => {
    setSelectedGroup(CATALOG_KEY_PREFIX, modelId, groupSelect.value);
    renderCatalog(dashboardState);
  });
  groupCell.append(groupSelect);

  const priceCell = document.createElement("td");
  priceCell.className = "price-column";
  const pill = createPricePill(groups[groupSelect.value]);
  if (pill) priceCell.append(pill);
  else priceCell.textContent = formatPrice(groups[groupSelect.value]);

  const targetCell = document.createElement("td");
  const targetSelect = buildTargetSelect(state, relayId, modelId, ownerRelay);
  targetCell.append(targetSelect);

  const actionCell = document.createElement("td");
  actionCell.className = "action-column";
  const deployBtn = document.createElement("button");
  deployBtn.type = "button";
  deployBtn.className = "deploy-btn";
  deployBtn.textContent = "Deploy";
  deployBtn.title = `Add ${modelId} to opencode.jsonc`;
  deployBtn.addEventListener("click", () => {
    const mapping = state.providerMap?.[targetSelect.value];
    const useRelay = relayId || mapping?.relay || Object.keys(state.relays || {})[0];
    deployCatalogModel(
      state,
      modelId,
      groupSelect.value,
      targetSelect.value,
      useRelay,
      deployBtn,
      targetSelect.selectedOptions[0]?.dataset.suggest
    );
  });
  actionCell.append(deployBtn);

  row.append(modelCell, groupCell, priceCell, targetCell, actionCell);
  return row;
}

function renderCatalog(state) {
  // Per-relay deployed sets: the same model can exist on several relays and
  // be deployed independently under each one's provider.
  const relayOfProvider = (pid) => state.providerMap?.[pid]?.relay || "geiliapi";
  const deployedByRelay = new Map();
  for (const provider of state.providers || []) {
    const rid = relayOfProvider(provider.id);
    if (!deployedByRelay.has(rid)) deployedByRelay.set(rid, new Set());
    for (const model of provider.models || []) deployedByRelay.get(rid).add(model.id);
  }

  const rows = [];
  let undeployedTotal = 0;
  const collapsed = getCollapsedCatalog();
  for (const [relayId, relay] of Object.entries(state.relays || {})) {
    const table = state.relayPrices?.[relayId] || {};
    const deployedHere = deployedByRelay.get(relayId) || new Set();
    const models = Object.keys(table).filter((modelId) => !deployedHere.has(modelId));
    if (!models.length) continue;
    undeployedTotal += models.length;

    const relayCollapsed = Boolean(collapsed.relays[relayId]);
    const header = document.createElement("tr");
    header.className = "catalog-section-row catalog-toggle-row";
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.innerHTML = `<span class="chevron">${relayCollapsed ? "▸" : "▾"}</span><b>${relay.name}</b><small>${models.length} deployable</small>`;
    header.title = relayCollapsed ? "展开" : "折叠";
    header.addEventListener("click", () => {
      const c = getCollapsedCatalog();
      if (c.relays[relayId]) delete c.relays[relayId];
      else c.relays[relayId] = true;
      setCollapsedCatalog(c);
      renderCatalog(dashboardState);
    });
    header.append(cell);
    rows.push(header);
    if (relayCollapsed) continue;

    // Vendor sub-groups, newest releases first within each vendor.
    const byVendor = new Map();
    for (const modelId of models) {
      const v = vendorOf(modelId);
      if (!byVendor.has(v.id)) byVendor.set(v.id, { label: v.label, models: [] });
      byVendor.get(v.id).models.push(modelId);
    }
    for (const [vendorId, { label, models: vendorModels }] of byVendor) {
      vendorModels.sort(compareModelsNewestFirst);
      const vendorKey = `${relayId}|${vendorId}`;
      const vendorCollapsed = Boolean(collapsed.vendors[vendorKey]);
      const vRow = document.createElement("tr");
      vRow.className = "catalog-vendor-row catalog-toggle-row";
      const vCell = document.createElement("td");
      vCell.colSpan = 5;
      vCell.innerHTML = `<span class="chevron">${vendorCollapsed ? "▸" : "▾"}</span>${label}<small>${vendorModels.length}</small>`;
      vRow.title = vendorCollapsed ? "展开" : "折叠";
      vRow.addEventListener("click", () => {
        const c = getCollapsedCatalog();
        if (c.vendors[vendorKey]) delete c.vendors[vendorKey];
        else c.vendors[vendorKey] = true;
        setCollapsedCatalog(c);
        renderCatalog(dashboardState);
      });
      vRow.append(vCell);
      rows.push(vRow);
      if (vendorCollapsed) continue;
      for (const modelId of vendorModels) rows.push(createCatalogRow(state, modelId, relayId, table));
    }
  }

  elements.catalogBody.replaceChildren(...rows);
  elements.catalogFrame.setAttribute("aria-busy", "false");
  elements.catalogCount.textContent = String(undeployedTotal);
  elements.catalogEmptyState.hidden = rows.length > 0;
  elements.catalogBody.closest("table").hidden = rows.length === 0;
}

function renderRelayBar(state) {
  const bar = elements.relayBar;
  bar.replaceChildren();
  const entries = Object.entries(state.relays || {});
  if (!entries.length) {
    const empty = document.createElement("span");
    empty.className = "relay-chip";
    empty.textContent = "No relays configured — click “Add relay”.";
    bar.append(empty);
    return;
  }
  for (const [id, relay] of entries) {
    const chip = document.createElement("span");
    chip.className = "relay-chip";

    const dot = document.createElement("i");
    dot.className = `chip-dot ${relay.tokenConfigured ? "chip-dot--ok" : "chip-dot--warn"}`;
    dot.title = relay.tokenConfigured ? "Token configured" : "No token yet — stability unavailable";

    const name = document.createElement("b");
    name.textContent = relay.name || id;

    const meta = document.createElement("small");
    const typeLabel = { geiliapi: "GeiliAPI", newapi: "new-api", openai: "OpenAI 兼容" }[relay.type] || relay.type;
    meta.textContent = `${typeLabel} · ${relay.modelCount ?? "?"} models`;

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "chip-btn";
    testBtn.textContent = "Test";
    testBtn.title = "Re-probe this relay now";
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      try {
        const res = await fetch("/api/relay-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const r = await res.json().catch(() => null);
        if (r?.ok) showToast("success", `${relay.name} is alive`, `${r.modelCount} models via ${r.detail}`);
        else showToast("error", `${relay.name} probe failed`, r?.detail || r?.error || "unknown");
        loadState();
      } finally {
        testBtn.disabled = false;
      }
    });

    const keyBtn = document.createElement("button");
    keyBtn.type = "button";
    keyBtn.className = `chip-btn chip-btn--key ${relay.apiKeyConfigured ? "chip-btn--set" : ""}`;
    keyBtn.textContent = relay.apiKeyConfigured ? "Key ✓" : "Key";
    keyBtn.title = relay.apiKeyConfigured
      ? "API key saved — new deploys will embed it"
      : "Paste this relay's model-call API key (sk-…)";
    keyBtn.addEventListener("click", () => openKeyModal(id, relay));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "chip-btn chip-btn--danger";
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(`Remove relay "${relay.name}"? Deployed opencode providers are kept.`)) return;
      await fetch(`/api/relays/${encodeURIComponent(id)}`, { method: "DELETE" });
      showToast("success", "Relay removed", relay.name);
      loadState();
    });

    chip.append(dot, name, meta, keyBtn, testBtn, delBtn);
    bar.append(chip);
  }
}

function openRelayModal() {
  elements.relayNameInput.value = "";
  elements.relayBaseURLInput.value = "";
  elements.relayTokenInput.value = "";
  elements.relayTokenEnvInput.value = "";
  elements.relayModal.hidden = false;
  elements.relayNameInput.focus();
}

function closeRelayModal() {
  elements.relayModal.hidden = true;
}

async function submitRelay() {
  const payload = {
    name: elements.relayNameInput.value.trim(),
    baseURL: elements.relayBaseURLInput.value.trim(),
    token: elements.relayTokenInput.value.trim() || undefined,
    tokenEnv: elements.relayTokenEnvInput.value.trim() || undefined,
  };
  if (!payload.name || !payload.baseURL) {
    showToast("error", "Missing fields", "Name and API base URL are required.");
    return;
  }
  elements.relaySaveButton.disabled = true;
  elements.relaySaveButton.textContent = "Probing…";
  try {
    const response = await fetch("/api/relays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "relay rejected");
    closeRelayModal();
    showToast(
      "success",
      `Relay added (${result.detectedType})`,
      `${result.modelCount} models discovered${result.detail ? ` via ${result.detail}` : ""}.`
    );
    // Guide the token flow: open this relay's page in debug Chrome right away,
    // unless the user already supplied a token during add.
    if (!payload.token) {
      try {
        await fetch("/api/open-debug-chrome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relay: result.id }),
        });
      } catch {}
    }
    setTimeout(() => loadState(), 800);
  } catch (error) {
    showToast("error", "Could not add relay", error.message);
  } finally {
    elements.relaySaveButton.disabled = false;
    elements.relaySaveButton.textContent = "Add relay";
  }
}

function renderState(state) {
  dashboardState = state;
  const agents = applyStoredOrder(Array.isArray(state.agents) ? state.agents : []);
  loadedModels = new Map(agents.map((agent) => [agent.name, agent.model]));
  loadedOrder = agents.map((agent) => agent.name);

  elements.tableBody.replaceChildren(...agents.map(createAgentRow));
  elements.tableFrame.setAttribute("aria-busy", "false");
  elements.emptyState.hidden = true;
  elements.tableBody.closest("table").hidden = false;
  elements.presetBadge.textContent = state.presetName || "default";
  elements.presetBadge.title = `Current preset: ${state.presetName || "default"}`;
  elements.agentCount.textContent = String(agents.length);

  const providerCount = Array.isArray(state.providers) ? state.providers.length : 0;
  const modelCount = (state.providers || []).reduce((total, provider) => total + (provider.models?.length || 0), 0);
  elements.providerSummary.textContent = `${providerCount} providers / ${modelCount} models available`;
  const priceOk = state.price?.ok === true;
  const stabOk = state.stability?.ok === true;
  const missing = [
    priceOk ? null : "prices",
    stabOk ? null : "stability",
  ].filter(Boolean);
  const cached = state.stability?.fromCache === true;
  elements.priceBanner.hidden = missing.length === 0 && !cached;
  const bannerTitle = elements.priceBanner.querySelector("strong");
  const bannerText = elements.priceBanner.querySelector("p");
  if (bannerTitle && bannerText) {
    if (cached) {
      bannerTitle.textContent = "Stability is using cached data";
      bannerText.textContent = state.stability?.note || "GeiliAPI returned no live channel data; showing the last successful snapshot.";
    } else if (missing.length === 0) {
      bannerTitle.textContent = "Pricing is not connected";
      bannerText.textContent = "Set a GEILI_* environment key and restart the dashboard to see model prices.";
    } else {
      bannerTitle.textContent = `Some data is unavailable (${missing.join(", ")})`;
      bannerText.textContent = "Add a GeiliAPI session token (GEILI_PLUGIN_TOKEN) and restart the dashboard to see live figures.";
    }
  }
  elements.refreshButton.disabled = false;
  updateDirtyState();
  renderGeiliModels(state);
}

function showLoadError(error) {
  dashboardState = null;
  loadedModels = new Map();
  elements.tableFrame.setAttribute("aria-busy", "false");
  elements.tableBody.closest("table").hidden = true;
  elements.emptyState.hidden = false;
  elements.emptyStateMessage.textContent = error?.message || "Check that the local server is running, then try again.";
  elements.presetBadge.textContent = "Offline";
  elements.providerSummary.textContent = "Local configuration unavailable";
  elements.priceBanner.hidden = true;
  elements.refreshButton.disabled = false;
  elements.saveButton.disabled = true;
  elements.geiliModelBody.replaceChildren();
  elements.healthFrame.setAttribute("aria-busy", "false");
  elements.geiliModelBody.closest("table").hidden = true;
  elements.geiliEmptyState.hidden = false;
  elements.geiliModelCount.textContent = "0";
  setStatus("error", "Load failed");
}

async function loadState({ confirmDiscard = false } = {}) {
  if (isBusy) return;
  if (confirmDiscard && isDirty() && !window.confirm("Refresh and discard unsaved model changes?")) return;

  setStatus("loading", dashboardState ? "Refreshing" : "Loading state");
  setBusy(true, "loading");

  try {
    const response = await fetch("/api/state", { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !Array.isArray(data.agents) || !Array.isArray(data.providers)) {
      throw new Error(data?.error ? `Server error: ${data.error}` : "The server returned an invalid state.");
    }
    renderState(data);
  } catch (error) {
    showLoadError(error);
    showToast("error", "Unable to load", "The dashboard could not reach the local server.");
  } finally {
    setBusy(false, "loading");
    if (dashboardState) updateDirtyState();
  }
}

async function saveChanges() {
  if (isBusy || !dashboardState || !isDirty()) return;

  const agents = getCurrentAgents();
  setStatus("saving", "Saving changes");
  setBusy(true, "saving");

  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ agents }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || "The server did not accept the changes.");
    }

    loadedModels = new Map(agents.map((agent) => [agent.name, agent.model]));
    loadedOrder = agents.map((agent) => agent.name);
    persistOrder();
    elements.presetBadge.textContent = result.presetName || dashboardState.presetName || "default";
    showToast("success", "Configuration saved", `${agents.length} agent assignments are now active.`);
  } catch (error) {
    setStatus("error", "Save failed");
    showToast("error", "Save failed", error.message || "The configuration could not be saved.");
  } finally {
    setBusy(false, "saving");
    if (isDirty()) {
      setStatus("dirty", "Unsaved changes");
      elements.saveButton.disabled = false;
    } else {
      updateDirtyState();
    }
  }
}

function showToast(kind, title, message) {
  window.clearTimeout(toastTimer);
  elements.toast.dataset.kind = kind;
  elements.toastIcon.textContent = kind === "success" ? "\u2713" : "!";
  elements.toastTitle.textContent = title;
  elements.toastMessage.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function clearDragClasses() {
  elements.tableBody.querySelectorAll(".agent-row").forEach((row) => {
    row.classList.remove("is-dragging", "is-drag-over");
  });
}

elements.tableBody.addEventListener("change", (event) => {
  if (!event.target.matches(".model-select")) return;
  const row = event.target.closest(".agent-row");
  updateRowPrice(row, event.target.value);
  updateDirtyState();
});

elements.tableBody.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".agent-row");
  if (!row || !event.target.closest(".drag-handle")) {
    event.preventDefault();
    return;
  }

  draggedRow = row;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", row.dataset.agent);
  window.requestAnimationFrame(() => row.classList.add("is-dragging"));
});

elements.tableBody.addEventListener("dragover", (event) => {
  if (!draggedRow) return;
  const targetRow = event.target.closest(".agent-row");
  if (!targetRow || targetRow === draggedRow) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  elements.tableBody.querySelectorAll(".is-drag-over").forEach((row) => row.classList.remove("is-drag-over"));
  targetRow.classList.add("is-drag-over");

  const bounds = targetRow.getBoundingClientRect();
  const insertAfter = event.clientY > bounds.top + bounds.height / 2;
  elements.tableBody.insertBefore(draggedRow, insertAfter ? targetRow.nextSibling : targetRow);
});

elements.tableBody.addEventListener("drop", (event) => {
  if (!draggedRow) return;
  event.preventDefault();
  persistOrder();
  renumberRows();
  clearDragClasses();
  updateDirtyState();
});

elements.tableBody.addEventListener("dragend", () => {
  if (draggedRow) {
    persistOrder();
    renumberRows();
    updateDirtyState();
  }
  clearDragClasses();
  draggedRow = null;
});

function openKeyModal(relayId, relay) {
  elements.keyModal.dataset.relay = relayId;
  elements.keyModalRelay.textContent = relay.name || relayId;
  const masked = relay.apiKeyConfigured ? `已配置（尾号 ${relay.apiKeyLast4 || "••••"}），粘贴新值可覆盖，留空清除` : "sk-…";
  elements.keyInput.value = "";
  elements.keyInput.placeholder = masked;
  elements.keyModal.hidden = false;
  elements.keyInput.focus();
}

function closeKeyModal() {
  elements.keyModal.hidden = true;
}

async function submitKey() {
  const relayId = elements.keyModal.dataset.relay;
  const key = elements.keyInput.value.trim();
  elements.keySaveButton.disabled = true;
  try {
    const response = await fetch("/api/relay-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: relayId, key }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "save failed");
    closeKeyModal();
    showToast("success", key ? "API key saved" : "API key cleared", "之后的部署会自动使用该密钥。");
    loadState();
  } catch (error) {
    showToast("error", "Could not save key", error.message);
  } finally {
    elements.keySaveButton.disabled = false;
  }
}

elements.keyCancelButton.addEventListener("click", closeKeyModal);
elements.keySaveButton.addEventListener("click", submitKey);
elements.keyModal.addEventListener("click", (e) => {
  if (e.target === elements.keyModal) closeKeyModal();
});

elements.addRelayButton.addEventListener("click", openRelayModal);
elements.relayCancelButton.addEventListener("click", closeRelayModal);
elements.relaySaveButton.addEventListener("click", submitRelay);
elements.relayModal.addEventListener("click", (e) => {
  if (e.target === elements.relayModal) closeRelayModal();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !elements.relayModal.hidden) closeRelayModal();
});

elements.catalogToggleButton.addEventListener("click", () => {
  const state = dashboardState;
  if (!state) return;
  const collapsed = getCollapsedCatalog();
  const relayIds = Object.keys(state.relays || {});
  const allCollapsed = relayIds.every((rid) => collapsed.relays[rid]);
  const next = { relays: {}, vendors: {} };
  if (!allCollapsed) {
    for (const rid of relayIds) {
      next.relays[rid] = true;
      const table = state.relayPrices?.[rid] || {};
      const deployedHere = new Set(
        (state.providers || [])
          .filter((p) => (state.providerMap?.[p.id]?.relay || "geiliapi") === rid)
          .flatMap((p) => (p.models || []).map((m) => m.id))
      );
      for (const modelId of Object.keys(table)) {
        if (!deployedHere.has(modelId)) next.vendors[`${rid}|${vendorOf(modelId).id}`] = true;
      }
    }
  }
  setCollapsedCatalog(next);
  elements.catalogToggleButton.textContent = allCollapsed ? "折叠全部" : "展开全部";
  renderCatalog(state);
});

elements.refreshButton.addEventListener("click", () => loadState({ confirmDiscard: true }));
elements.retryButton.addEventListener("click", () => loadState());
elements.saveButton.addEventListener("click", saveChanges);

elements.chromeButton.addEventListener("click", async () => {
  elements.chromeButton.disabled = true;
  try {
    const response = await fetch("/api/open-debug-chrome", { method: "POST" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.errors?.join(" | ") || "failed to launch Chrome");
    const tabs = (result.opened || []).map((o) => o.name).join(", ");
    showToast(
      "success",
      `Debug Chrome opened ${result.opened.length} tab(s)`,
      `Log in where needed: ${tabs}. Then click Sync token.`
    );
  } catch (error) {
    showToast("error", "Could not open Chrome", error.message);
  } finally {
    elements.chromeButton.disabled = false;
  }
});

elements.tokenButton.addEventListener("click", async () => {
  elements.tokenButton.disabled = true;
  setStatus("loading", "Syncing token");
  try {
    const response = await fetch("/api/token-sync", { method: "POST" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "sync request failed");
    const okItems = (result.results || []).filter((r) => r.ok);
    const failItems = (result.results || []).filter((r) => !r.ok);
    if (okItems.length) {
      const detail = okItems.map((r) => `${r.relayId}: ${r.source}`).join("; ");
      showToast("success", "Token synced", detail + " Restarting dashboard…");
      setTimeout(() => window.location.reload(), 4000);
    } else {
      const reason = failItems.map((r) => r.error).join(" | ") || "unknown error";
      showToast("error", "Token not synced", reason);
      setStatus("live", "Loaded");
    }
  } catch (error) {
    showToast("error", "Token sync failed", error.message);
    setStatus("live", "Loaded");
  } finally {
    elements.tokenButton.disabled = false;
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

loadState();
