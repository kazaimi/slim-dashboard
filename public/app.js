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
  keyList: document.querySelector("#keyList"),
  keyLabelSelect: document.querySelector("#keyLabelSelect"),
  keyInput: document.querySelector("#keyInput"),
  keyAddButton: document.querySelector("#keyAddButton"),
  keyCancelButton: document.querySelector("#keyCancelButton"),
  keySaveButton: document.querySelector("#keySaveButton"),
  toast: document.querySelector("#toast"),
  toastIcon: document.querySelector("#toastIcon"),
  toastTitle: document.querySelector("#toastTitle"),
  toastMessage: document.querySelector("#toastMessage"),
};

let dashboardState = null;
let loadedModels = new Map();
let loadedEfforts = new Map();
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
  const effortsChanged = agents.some((agent) => loadedEfforts.get(agent.name) !== agent.effort);
  const orderChanged = agents.some((agent, index) => loadedOrder[index] !== agent.name);
  return modelsChanged || effortsChanged || orderChanged;
}

function updateDirtyState() {
  const dirty = isDirty();
  elements.saveButton.disabled = isBusy || !dirty;
  setStatus(dirty ? "dirty" : "live", dirty ? "Unsaved changes" : "Loaded");

  elements.tableBody.querySelectorAll(".agent-row").forEach((row) => {
    const select = row.querySelector(".model-select");
    const effortSelect = row.querySelector(".effort-select");
    row.classList.toggle(
      "is-modified",
      loadedModels.get(row.dataset.agent) !== select.value || loadedEfforts.get(row.dataset.agent) !== effortSelect.value
    );
  });
}

function getCurrentAgents() {
  return Array.from(elements.tableBody.querySelectorAll(".agent-row")).map((row) => ({
    name: row.dataset.agent,
    model: row.querySelector(".model-select").value,
    effort: row.querySelector(".effort-select").value,
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

function findStabilityChannel(stability, priceGroup, channel) {
  if (!stability || !channel) return null;
  if (priceGroup != null) {
    const item = Object.values(stability).find((entry) => entry && typeof entry === "object" && String(entry.id) === String(priceGroup));
    if (item) return item;
  }
  if (stability[channel]) return stability[channel];
  const key = Object.keys(stability).find((name) => name.startsWith(channel) || channel.startsWith(name));
  return key ? stability[key] : null;
}

function computeAgentValue(modelReference) {
  const provider = getProviderId(modelReference);
  const modelId = getModelId(modelReference);
  const mapping = dashboardState?.providerMap?.[provider];
  const groupId = mapping ? getSelectedGroup(provider, modelId, mapping) : null;
  let price = null;
  let groupName = null;
  if (mapping) {
    const p = dashboardState?.price?.prices?.[modelId]?.[groupId];
    if (p && p.in != null) {
      price = { in: p.in, out: p.out, cache: p.cache, mult: p.mult, officialIn: p.officialIn, officialOut: p.officialOut, currency: p.currency || "USD", tiered: p.tiered };
      groupName = `${mapping.groupName} / group ${groupId}`;

      const usage = dashboardState?.usage?.models?.[modelId];
      const usageInput = usage?.input_price;
      const usageOutput = usage?.output_price;
      const usageMatchesGroup = usage?.group_id != null && groupId != null && String(usage.group_id) === String(groupId);
      const hasUsagePrices = usageInput !== null && usageInput !== undefined && usageInput !== ""
        && usageOutput !== null && usageOutput !== undefined && usageOutput !== ""
        && Number.isFinite(Number(usageInput)) && Number.isFinite(Number(usageOutput));
      if (usageMatchesGroup && hasUsagePrices) {
        const rawUsageGroup = usage.group ?? usage.actual_group;
        const usageGroup = rawUsageGroup && typeof rawUsageGroup === "object"
          ? rawUsageGroup.name || rawUsageGroup.group_name || rawUsageGroup.id
          : usage.group_name || rawUsageGroup || usage.group_id;
        price.in = usageInput;
        price.out = usageOutput;
        price.mult = usage.multiplier ?? usage.rate_multiplier ?? usage.mult;
        price.currency = usage.currency || price.currency || "USD";
        groupName = `${mapping.groupName} / Usage group ${usageGroup || usage.group_id}`;
      }
    }
  }
  const stability = mapping ? findStabilityChannel(dashboardState?.stability?.channels, groupId, mapping.channel) : null;
  return { provider, modelId, price, groupName, stability };
}

function formatDecimal(value) {
  if (value === null || value === undefined || value === "") return "\u2013";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value);
}

function formatPrice(price) {
  if (!price || price.in == null) return "\u2013";
  const cur = price.currency === "CNY" ? "\u00a5" : "$";
  return `In ${cur}${formatDecimal(price.in)} / Out ${cur}${formatDecimal(price.out)}`;
}

function priceTitle(price, groupName) {
  if (!price) return "No price available";
  const cur = price.currency === "CNY" ? "\u00a5" : "$";
  const tierNote = price.tiered ? " | 分档计费，此处为基础档（超出长度阈值后单价上浮）" : "";
  return `Multiplier \u00d7${formatDecimal(price.mult)} \u2014 In ${cur}${formatDecimal(price.in)} / Out ${cur}${formatDecimal(price.out)} / Cache ${cur}${formatDecimal(price.cache)} per 1M tokens (group ${groupName || ""}, ${price.currency || "USD"})${tierNote}`;
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

function usageValue(usage, keys) {
  for (const key of keys) {
    if (usage && usage[key] !== null && usage[key] !== undefined && usage[key] !== "") return usage[key];
  }
  return null;
}

function formatUsageValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
  return String(value);
}

function formatUsagePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return `$${Number.isFinite(numeric) ? numeric.toFixed(2) : String(value)}/M`;
}

function formatUsageMultiplier(value) {
  if (value === null || value === undefined || value === "") return null;
  return formatDecimal(value);
}

function createUsageSummary(usage) {
  if (!usage || typeof usage !== "object") return null;

  const recent = usage.recent && typeof usage.recent === "object"
    ? usage.recent
    : usage.latest && typeof usage.latest === "object" ? usage.latest : usage;
  const rawGroup = usageValue(usage, ["actual_group", "actualGroup", "group"]);
  const group = formatUsageValue(
    rawGroup && typeof rawGroup === "object"
      ? rawGroup.name || rawGroup.group_name || rawGroup.id
      : rawGroup
  );
  const inputPrice = formatUsagePrice(
    usageValue(usage, ["actual_input_price", "input_price"])
  );
  const outputPrice = formatUsagePrice(
    usageValue(usage, ["actual_output_price", "output_price"])
  );
  const multiplier = formatUsageMultiplier(
    usageValue(usage, ["rate_multiplier", "multiplier", "mult"])
  );
  const actualCost = formatUsageValue(usageValue(recent, ["actual_cost", "actualCost"]));
  const totalCost = formatUsageValue(usageValue(recent, ["total_cost", "totalCost"]));
  const requests = formatUsageValue(usageValue(recent, ["requests", "request_count", "requestCount"]));
  const values = [];

  if (group !== null) values.push(["实际", group]);
  const pricing = [];
  if (inputPrice !== null) pricing.push(`输入 ${inputPrice}`);
  if (outputPrice !== null) pricing.push(`输出 ${outputPrice}`);
  if (multiplier !== null) pricing.push(`×${multiplier}`);
  if (pricing.length > 0) values.push(["价格", pricing.join(" · "), "pricing"]);
  if (actualCost !== null || totalCost !== null) values.push(["近成本", `${actualCost ?? "–"} / ${totalCost ?? "–"}`]);
  if (requests !== null) values.push(["请求", requests]);
  if (values.length === 0) return null;

  const summary = document.createElement("div");
  summary.className = "usage-summary";
  for (const [label, value, variant] of values) {
    const item = document.createElement("span");
    item.className = "usage-summary__item";
    if (variant) item.classList.add(`usage-summary__item--${variant}`);
    const labelNode = document.createElement("span");
    labelNode.className = "usage-summary__label";
    labelNode.textContent = label;
    const valueNode = document.createElement("span");
    valueNode.className = "usage-summary__value";
    valueNode.textContent = value;
    item.append(labelNode, valueNode);
    summary.append(item);
  }
  return summary;
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
  top.append(status, avail);
  if (meta.textContent) top.append(meta);
  cell.append(top);

  cell.title = `Status: ${stability.status || "unknown"}  |  7-day availability: ${pct != null ? Number(pct).toFixed(2) + "%" : "\u2013"}  |  Latency: ${lat != null && lat < 30000 ? Math.round(lat).toLocaleString() + "ms" : "n/a"}`;

  if (stability.last60) {
    const c = stability.last60.counts || {};
    const op = c.operational || 0;
    const deg = c.degraded || 0;
    const err = c.error || 0;
    const last = document.createElement("div");
    last.className = "stable-last60";
    last.textContent = op === 0 && deg === 0 && err === 0
      ? "No recent checks"
      : `Last 60: ${op} ok / ${deg} degraded / ${err} error`;
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

function getModelVariants(modelReference) {
  const providerId = getProviderId(modelReference || "");
  const modelId = getModelId(modelReference || "");
  const model = (dashboardState?.providers || [])
    .find((provider) => String(provider.id) === providerId)
    ?.models?.find((entry) => String(entry.id) === modelId);
  const variants = model?.variants;
  if (!variants) return [];

  const values = [];
  const addValue = (value) => {
    if (typeof value !== "string" || !value.trim()) return;
    const normalized = value.trim().toLowerCase();
    if (!values.includes(normalized)) values.push(normalized);
  };

  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (typeof variant === "string") {
        addValue(variant);
      } else if (variant && typeof variant === "object") {
        const valueKeys = ["id", "key", "name", "value", "variant"];
        const hasValueKey = valueKeys.some((key) => typeof variant[key] === "string" && variant[key].trim());
        if (hasValueKey) valueKeys.forEach((key) => addValue(variant[key]));
        else Object.keys(variant).forEach(addValue);
      }
    }
  } else if (typeof variants === "object") {
    Object.keys(variants).forEach(addValue);
  }

  return values;
}

function createEffortSelect(currentEffort, modelReference) {
  const wrapper = document.createElement("div");
  wrapper.className = "effort-select-wrap";
  const select = document.createElement("select");
  select.className = "effort-select";
  select.setAttribute("aria-label", "Agent effort");
  const normalizedEffort = typeof currentEffort === "string" ? currentEffort.toLowerCase() : "";
  const effortOptions = ["", ...getModelVariants(modelReference)];

  for (const value of effortOptions) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value ? value[0].toUpperCase() + value.slice(1) : "Default";
    option.selected = value === normalizedEffort;
    select.append(option);
  }
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

  const effortCell = document.createElement("td");
  effortCell.append(createEffortSelect(agent.effort, agent.model));

  const priceCell = document.createElement("td");
  priceCell.className = "price-column";

  const stabilityCell = document.createElement("td");
  stabilityCell.className = "stability-column";

  row.append(dragCell, agentCell, modelCell, effortCell, priceCell, stabilityCell);
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

function createGeiliRow(provider, model, state) {
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
  const groups = state?.price?.prices?.[model.id] || {};
  const mapping = state?.providerMap?.[provider.id];
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
  const usageSummary = createUsageSummary(state?.usage?.models?.[model.id]);
  if (usageSummary) priceCell.append(usageSummary);
  priceCell.title = priceTierTitle(value.price, value.groupName);

  const stabilityCell = document.createElement("td");
  stabilityCell.className = "stability-column";

  const actionCell = document.createElement("td");
  actionCell.className = "action-column";
  const isDeployed = deployedModelRefs(state).has(`${provider.id}/${model.id}`);
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
      rows.push(createGeiliRow(provider, model, state));
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
  { id: "gemini", label: "Google Gemini", re: /gemini|palm|bard|gemma/ },
  { id: "grok", label: "xAI Grok", re: /grok/ },
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

const KNOWN_MODEL_NAMES = {
  // GeiliAPI Relay & Mainstream Models
  // 1. OpenAI
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6": "GPT-5.6",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 mini",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.2-pro": "GPT-5.2 Pro",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4o-realtime-preview": "GPT-4o Realtime",
  "gpt-4-turbo": "GPT-4 Turbo",
  "gpt-4": "GPT-4",
  "gpt-3.5-turbo": "GPT-3.5 Turbo",
  "chatgpt-4o-latest": "ChatGPT-4o",
  "o1": "o1",
  "o1-preview": "o1-preview",
  "o1-mini": "o1-mini",
  "o3-mini": "o3-mini",
  "o3-mini-high": "o3-mini (High)",

  // 2. Claude
  "claude-opus-5": "Claude Opus 5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-fable-5": "Claude Fable 5",
  "claude-3-7-sonnet-latest": "Claude 3.7 Sonnet",
  "claude-3-7-sonnet-20250219": "Claude 3.7 Sonnet",
  "claude-3-7-sonnet-thought": "Claude 3.7 Sonnet (Thinking)",
  "claude-3-5-sonnet-latest": "Claude 3.5 Sonnet",
  "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
  "claude-3-5-haiku-latest": "Claude 3.5 Haiku",
  "claude-3-opus-latest": "Claude 3 Opus",

  // 3. Gemini
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.5-flash-thinking": "Gemini 3.5 Flash Thinking",
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gemini-3.1-pro-thinking": "Gemini 3.1 Pro Thinking",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "gemini-3.1-flash-lite-thinking": "Gemini 3.1 Flash Lite Thinking",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.0-flash-exp": "Gemini 2.0 Flash Exp",
  "gemini-2.0-flash-thinking-exp": "Gemini 2.0 Flash Thinking",
  "gemini-2.0-flash-lite-preview": "Gemini 2.0 Flash Lite",
  "gemini-2.0-pro-exp": "Gemini 2.0 Pro Exp",
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",

  // 4. Grok
  "grok-4.6": "Grok 4.6",
  "grok-4.5": "Grok 4.5",
  "grok-3-mini": "Grok 3 mini",
  "grok-3": "Grok 3",
  "grok-2": "Grok 2",

  // 5. DeepSeek
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-flash-vision-exp": "DeepSeek V4 Flash Vision",
  "deepseek-chat": "DeepSeek V3",
  "deepseek-reasoner": "DeepSeek R1",
  "deepseek-v3": "DeepSeek V3",
  "deepseek-r1": "DeepSeek R1",

  // 6. 智谱 GLM
  "glm-5.3-flash": "GLM-5.3 Flash",
  "glm-5.3": "GLM-5.3",
  "glm-5.2": "GLM-5.2",
  "glm-5.1": "GLM-5.1",

  // 7. Kimi
  "kimi-k3": "Kimi K3",
  "kimi-k2.7-code": "Kimi K2.7 Code",
  "kimi-k2.6": "Kimi K2.6",
  "kimi-k2.5": "Kimi K2.5",

  // 8. Qwen
  "qwen3.8-max": "Qwen 3.8 Max",
  "qwen3.7-max": "Qwen 3.7 Max",
  "qwen3.7-plus": "Qwen 3.7 Plus",
  "qwen3.6-plus": "Qwen 3.6 Plus",
  "qwen3.5-plus": "Qwen 3.5 Plus",
};

const MODEL_WORD_MAP = {
  gpt: "GPT", claude: "Claude", gemini: "Gemini", deepseek: "DeepSeek",
  qwen: "Qwen", qwq: "QwQ", grok: "Grok", glm: "GLM", kimi: "Kimi",
  moonshot: "Moonshot", minimax: "MiniMax", mimo: "MiMo", llama: "LLaMA",
  mistral: "Mistral", yi: "Yi", baichuan: "Baichuan", hunyuan: "Hunyuan",
  ernie: "ERNIE", dall: "DALL", tts: "TTS", asr: "ASR", r1: "R1",
  v1: "V1", v2: "V2", v3: "V3", v4: "V4", pro: "Pro", flash: "Flash",
  lite: "Lite", mini: "mini", turbo: "Turbo", plus: "Plus", max: "Max",
  ultra: "Ultra", vision: "Vision", thinking: "Thinking", thought: "Thinking",
  coder: "Coder", chat: "Chat", instruct: "Instruct", preview: "Preview", latest: "Latest",
};

function formatModelName(modelId) {
  if (!modelId) return "";
  const raw = String(modelId).trim();
  const lower = raw.toLowerCase();
  if (KNOWN_MODEL_NAMES[lower]) return KNOWN_MODEL_NAMES[lower];

  let base = raw;
  const dateSuffixMatch = base.match(/^(.+?)[-_](20\d{6})$/);
  if (dateSuffixMatch) base = dateSuffixMatch[1];

  const tokens = base.split(/[-_/ ]+/).filter(Boolean);
  const formattedTokens = tokens.map((tok) => {
    if (/^\d+-\d+$/.test(tok)) return tok.replace("-", ".");
    const tokLower = tok.toLowerCase();
    if (MODEL_WORD_MAP[tokLower]) return MODEL_WORD_MAP[tokLower];
    if (/^o\d(-mini|-preview)?$/i.test(tok)) return tok.toLowerCase();
    return /^\d/.test(tok) ? tok : tok[0].toUpperCase() + tok.slice(1);
  });

  let joined = formattedTokens.join(" ");
  joined = joined.replace(/\b(Claude|Gemini|GPT)\s+(\d+)\s+(\d+)\b/gi, "$1 $2.$3");
  joined = joined.replace(/\bDeepseek\b/gi, "DeepSeek");
  return joined;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function extractHostBrand(host) {
  if (!host) return "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  const ignoredSubdomains = new Set(["sub", "api", "v1", "v2", "gateway", "open", "ai", "app", "chat", "one", "new"]);
  if (parts.length >= 2 && ignoredSubdomains.has(parts[0].toLowerCase())) {
    return parts[1];
  }
  return parts[0];
}

// Derive a provider-name prefix for a relay.
function relayPrefix(state, relayId, relay) {
  if (relay?.providerPrefix) return String(relay.providerPrefix);
  if (relayId && relayId !== "default") {
    if (relayId === "geiliapi") return "geili";
    return relayId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  }
  const host = hostOf(relay?.baseURL);
  const brand = extractHostBrand(host);
  if (brand) return brand.toLowerCase();
  return "relay";
}

function suggestProviderInfo(state, relayId, relay, modelId) {
  const prefix = relayPrefix(state, relayId, relay);
  let fam = familyOf(modelId);
  const taken = new Set((state.providers || []).map((p) => p.id));
  const famId = fam === "moonshot" ? "kimi" : fam;
  let id = `${prefix}_${famId}`;
  let n = 2;
  while (taken.has(id)) id = `${prefix}_${famId}_${n++}`;

  const relayName = relay?.name || relayId || prefix;
  const v = vendorOf(modelId);
  let familyLabel = v.label ? v.label.replace(/^.*? /, "") : (fam[0].toUpperCase() + fam.slice(1));
  if (fam === "anthropic") familyLabel = "Claude";
  if (fam === "moonshot") familyLabel = "Kimi";
  if (fam === "zhipu") familyLabel = "GLM";
  const name = `${relayName} (${familyLabel})`;
  return { id, name };
}

function providerMatchesFamily(providerId, fam) {
  const pid = String(providerId || "").toLowerCase();
  const f = String(fam || "").toLowerCase();
  if (f === "anthropic" && (pid.includes("anthropic") || pid.includes("claude"))) return true;
  if (f === "openai" && (pid.includes("openai") || pid.includes("gpt"))) return true;
  if (f === "gemini" && (pid.includes("gemini") || pid.includes("google"))) return true;
  if (f === "grok" && (pid.includes("grok") || pid.includes("xai"))) return true;
  if (f === "deepseek" && (pid.includes("deepseek") || pid.includes("chaosuan"))) return true;
  if (f === "qwen" && (pid.includes("qwen") || pid.includes("chaosuan"))) return true;
  if (f === "moonshot" && (pid.includes("moonshot") || pid.includes("kimi") || pid.includes("chaosuan"))) return true;
  if (f === "zhipu" && (pid.includes("zhipu") || pid.includes("glm") || pid.includes("chaosuan"))) return true;
  if (f === "minimax" && (pid.includes("minimax") || pid.includes("chaosuan"))) return true;
  if (f === "xiaomi" && (pid.includes("mimo") || pid.includes("chaosuan"))) return true;
  return pid.includes(f);
}

function buildTargetSelect(state, relayId, modelId, relay) {
  const select = document.createElement("select");
  select.className = "group-select target-select";
  const fam = familyOf(modelId);
  const suggestion = suggestProviderInfo(state, relayId, relay, modelId);
  const seen = new Set();
  let matchedOptionValue = null;

  // 1) providers already mapped to this relay
  for (const [pid, m] of Object.entries(state.providerMap || {})) {
    if (!m.priceGroup || (m.relay || "geiliapi") !== relayId) continue;
    seen.add(pid);
    const option = document.createElement("option");
    option.value = pid;
    option.textContent = pid;
    select.append(option);
    if (!matchedOptionValue && providerMatchesFamily(pid, fam)) {
      matchedOptionValue = pid;
    }
  }

  // 2) existing providers on the same API host
  const host = hostOf(relay?.baseURL);
  if (host) {
    for (const p of state.providers || []) {
      if (seen.has(p.id) || hostOf(p.baseURL) !== host) continue;
      seen.add(p.id);
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = `${p.id} (已有)`;
      select.append(option);
      if (!matchedOptionValue && providerMatchesFamily(p.id, fam)) {
        matchedOptionValue = p.id;
      }
    }
  }

  // Add "+ new provider" option
  const newOption = document.createElement("option");
  newOption.value = "__new__";
  newOption.dataset.suggest = suggestion.id;
  newOption.dataset.suggestName = suggestion.name;
  newOption.textContent = `+ ${suggestion.id} (${suggestion.name})`;
  select.append(newOption);

  // If there's an existing provider matching this model's family, select it;
  // otherwise default to __new__!
  if (matchedOptionValue) {
    select.value = matchedOptionValue;
  } else {
    select.value = "__new__";
  }
  return select;
}

async function deployCatalogModel(state, modelId, groupId, targetProvider, relayId, button, suggestedId, suggestedName) {
  button.disabled = true;
  button.textContent = "Deploying…";
  try {
    const isNew = targetProvider === "__new__";
    const providerId = isNew ? suggestedId : targetProvider;
    const providerName = isNew ? suggestedName : undefined;
    const modelName = formatModelName(modelId);
    const response = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        provider: providerId,
        providerName,
        model: modelId,
        name: modelName,
        relay: relayId,
        group: groupId,
      }),
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

const FAMILY_KEY_PRIORITIES = {
  anthropic: ["anthropic", "claude"],
  openai: ["openai", "gpt"],
  gemini: ["gemini", "google"],
  grok: ["xai", "grok"],
  deepseek: ["deepseek", "zhipu", "chaosuan", "domestic"],
  qwen: ["qwen", "qwq", "zhipu", "chaosuan", "domestic"],
  moonshot: ["moonshot", "kimi", "zhipu", "chaosuan", "domestic"],
  zhipu: ["zhipu", "glm", "chaosuan", "domestic"],
  minimax: ["minimax", "zhipu", "chaosuan", "domestic"],
  xiaomi: ["xiaomi", "mimo", "zhipu", "chaosuan", "domestic"],
};

function resolveKeyLabel(state, relayId, modelId) {
  const keys = state.relays?.[relayId]?.apiKeys || [];
  if (!keys.length) return null;
  const fam = familyOf(modelId).toLowerCase();
  const priorities = FAMILY_KEY_PRIORITIES[fam] || [fam];

  for (const alias of priorities) {
    const found = keys.find((k) => k.label.toLowerCase() === alias);
    if (found) return found.label;
  }
  for (const alias of priorities) {
    const found = keys.find((k) => k.label.toLowerCase().includes(alias) || alias.includes(k.label.toLowerCase()));
    if (found) return found.label;
  }
  const def = keys.find((k) => k.label.toLowerCase() === "default");
  return def ? def.label : null;
}

function resolveKeyHint(state, relayId, modelId) {
  const label = resolveKeyLabel(state, relayId, modelId);
  return label ? ` | 将使用 key [${label}]` : " | ⚠ 未配置该模型族的 key，部署后需手动填入（或添加 default 标签的 key）";
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

  const keyLabel = resolveKeyLabel(state, relayId, modelId);
  const keyBadge = document.createElement("div");
  keyBadge.className = `model-key ${keyLabel ? "model-key--ok" : "model-key--none"}`;
  keyBadge.textContent = keyLabel ? `🔑 ${keyLabel}` : "⚠ 未配 key";
  modelCell.append(keyBadge);

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
  deployBtn.title = `Add ${modelId} to opencode.jsonc` + resolveKeyHint(state, relayId, modelId);
  deployBtn.addEventListener("click", () => {
    const mapping = state.providerMap?.[targetSelect.value];
    const useRelay = relayId || mapping?.relay || Object.keys(state.relays || {})[0];
    const selOpt = targetSelect.selectedOptions[0];
    deployCatalogModel(
      state,
      modelId,
      groupSelect.value,
      targetSelect.value,
      useRelay,
      deployBtn,
      selOpt?.dataset.suggest,
      selOpt?.dataset.suggestName
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

    const keyCount = (relay.apiKeys || []).length;
    const keyBtn = document.createElement("button");
    keyBtn.type = "button";
    keyBtn.className = `chip-btn chip-btn--key ${keyCount ? "chip-btn--set" : ""}`;
    keyBtn.textContent = keyCount ? `Keys(${keyCount})` : "Keys";
    keyBtn.title = keyCount
      ? "已保存的 API keys — 点击管理（部署时按模型族自动匹配）"
      : "粘贴该中转站的模型调用 API keys（可多个，按模型族区分）";
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
  loadedEfforts = new Map(agents.map((agent) => [agent.name, typeof agent.effort === "string" ? agent.effort.toLowerCase() : ""]));
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
  loadedEfforts = new Map();
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
    loadedEfforts = new Map(agents.map((agent) => [agent.name, agent.effort]));
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
  if (!event.target.matches(".model-select, .effort-select")) return;
  const row = event.target.closest(".agent-row");
  if (event.target.matches(".model-select")) {
    const effortSelect = row.querySelector(".effort-select");
    const effortCell = effortSelect.closest("td");
    effortCell.replaceChildren(createEffortSelect(effortSelect.value, event.target.value));
    updateRowPrice(row, event.target.value);
  }
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

let keyDraft = [];
let keyAutoEntries = [];
let keyDraftRelayId = null;

async function openKeyModal(relayId, relay) {
  keyDraftRelayId = relayId;
  elements.keyModal.dataset.relay = relayId;
  elements.keyModalRelay.textContent = relay.name || relayId;
  elements.keyInput.value = "";
  keyDraft = [];
  elements.keyList.replaceChildren();
  try {
    const res = await fetch(`/api/relay-keys?id=${encodeURIComponent(relayId)}`);
    const data = await res.json().catch(() => null);
    if (data?.ok && Array.isArray(data.keys)) keyDraft = data.keys.map((k) => ({ ...k }));
  } catch {}
  // Auto-discovered keys (from same-host providers) shown alongside, not editable.
  const meta = dashboardState?.relays?.[relayId];
  keyAutoEntries = (meta?.apiKeys || [])
    .filter((k) => !keyDraft.some((d) => d.label.toLowerCase() === k.label.toLowerCase()))
    .map((k) => ({ label: k.label, last4: k.last4 || "" }));
  populateKeyLabelOptions(relayId);
  renderKeyDraft();
  elements.keyModal.hidden = false;
  elements.keyLabelSelect.focus();
}

// Label options come from the vendor families actually present in this
// relay's deployable-model table, plus a "default" fallback.
function populateKeyLabelOptions(relayId) {
  const table = dashboardState?.relayPrices?.[relayId] || {};
  const famMap = new Map();
  for (const modelId of Object.keys(table)) {
    const v = vendorOf(modelId);
    if (!famMap.has(v.id)) famMap.set(v.id, v.label);
  }
  const sel = elements.keyLabelSelect;
  sel.replaceChildren();
  const add = (value, text) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    sel.append(option);
  };
  add("default", "default · 兜底匹配");
  for (const [id, label] of [...famMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    add(id, `${id} · ${label}`);
  }
  for (const k of keyDraft) {
    if (![...sel.options].some((o) => o.value === k.label)) add(k.label, `${k.label} · 自定义`);
  }
  sel.title = "可选分类: " + [...sel.options].map((o) => o.value).join(", ");
  markKeyOptions();
}

function markKeyOptions() {
  const has = new Set(keyDraft.map((k) => k.label.toLowerCase()));
  for (const option of elements.keyLabelSelect.options) {
    option.textContent = option.textContent.replace(/ ✓$/, "");
    if (has.has(option.value.toLowerCase())) option.textContent += " ✓";
  }
}

function renderKeyDraft() {
  const list = elements.keyList;
  list.replaceChildren();
  if (!keyDraft.length && !keyAutoEntries.length) {
    const empty = document.createElement("p");
    empty.className = "key-empty";
    empty.textContent = "尚未保存任何 key。";
    list.append(empty);
    return;
  }
  for (const k of keyDraft) {
    const row = document.createElement("div");
    row.className = "key-row";
    const label = document.createElement("b");
    label.textContent = k.label;
    const masked = document.createElement("span");
    masked.className = "key-masked";
    masked.textContent = "••••" + (k.key ? k.key.slice(-4) : "");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "chip-btn chip-btn--danger";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      keyDraft = keyDraft.filter((x) => x !== k);
      renderKeyDraft();
      markKeyOptions();
    });
    row.append(label, masked, del);
    list.append(row);
  }
  for (const k of keyAutoEntries) {
    if (keyDraft.some((d) => d.label.toLowerCase() === k.label.toLowerCase())) continue;
    const row = document.createElement("div");
    row.className = "key-row key-row--auto";
    const label = document.createElement("b");
    label.textContent = k.label;
    const badge = document.createElement("span");
    badge.className = "key-auto-badge";
    badge.textContent = "自动发现";
    badge.title = "来自 opencode.jsonc 同域 provider，部署时同样可用";
    const masked = document.createElement("span");
    masked.className = "key-masked";
    masked.textContent = "••••" + (k.last4 || "");
    row.append(label, badge, masked);
    list.append(row);
  }
  markKeyOptions();
}

function closeKeyModal() {
  elements.keyModal.hidden = true;
}

async function submitKeys() {
  const relayId = keyDraftRelayId;
  // Foolproofing: auto-include whatever is still sitting in the input row,
  // so pasting + Save works without requiring the 添加 click.
  const pendingLabel = elements.keyLabelSelect.value.trim();
  const pendingKey = elements.keyInput.value.trim();
  let draft = [...keyDraft];
  if (pendingLabel && pendingKey) {
    draft = draft.filter((k) => k.label.toLowerCase() !== pendingLabel.toLowerCase());
    draft.push({ label: pendingLabel, key: pendingKey });
  }
  if (!draft.length) {
    showToast("error", "Nothing to save", "请先下拉选分类、粘贴 key，再保存。");
    return;
  }
  elements.keySaveButton.disabled = true;
  try {
    const response = await fetch("/api/relay-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: relayId, keys: draft }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "save failed");
    closeKeyModal();
    showToast("success", `已保存 ${result.count} 个 key`, "部署时按模型家族自动匹配。");
    loadState();
  } catch (error) {
    showToast("error", "Could not save keys", error.message);
  } finally {
    elements.keySaveButton.disabled = false;
  }
}

function addKeyToDraft() {
  const label = elements.keyLabelSelect.value.trim();
  const key = elements.keyInput.value.trim();
  if (!label || !key) {
    showToast("error", "Missing fields", "标签和 key 都要填。");
    return;
  }
  keyDraft = keyDraft.filter((k) => k.label.toLowerCase() !== label.toLowerCase());
  keyDraft.push({ label, key });
  elements.keyInput.value = "";
  renderKeyDraft();
}

elements.keyAddButton.addEventListener("click", addKeyToDraft);
elements.keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addKeyToDraft(); });
elements.keyCancelButton.addEventListener("click", closeKeyModal);
elements.keySaveButton.addEventListener("click", submitKeys);
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
