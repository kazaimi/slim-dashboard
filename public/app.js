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
      price = { in: p.in, out: p.out, cache: p.cache, mult: p.mult, officialIn: p.officialIn, officialOut: p.officialOut, currency: p.currency || "USD" };
      groupName = `${mapping.groupName} / group ${groupId}`;
    }
  }
  const stability = mapping ? findStabilityChannel(dashboardState?.stability?.channels, mapping.channel) : null;
  return { provider, modelId, price, groupName, stability };
}

function formatPrice(price) {
  if (!price) return "\u2013";
  const cur = price.currency === "CNY" ? "\u00a5" : "$";
  return `${cur}${price.in} / ${cur}${price.out}`;
}

function priceTitle(price, groupName) {
  if (!price) return "No price available";
  const cur = price.currency === "CNY" ? "\u00a5" : "$";
  return `Multiplier \u00d7${price.mult} \u2014 In ${cur}${price.in} / Out ${cur}${price.out} / Cache ${cur}${price.cache !== null ? price.cache : "\u2013"} per 1M tokens (group ${groupName || ""}, ${price.currency || "USD"})`;
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
}

const CATALOG_KEY_PREFIX = "__catalog__";

function catalogGroups(state) {
  return Object.keys(state?.price?.prices || {});
}

function createTargetSelect(state) {
  const select = document.createElement("select");
  select.className = "group-select target-select";
  const mapped = Object.entries(state.providerMap || {}).filter(([, m]) => m.priceGroup);
  for (const [pid] of mapped) {
    const option = document.createElement("option");
    option.value = pid;
    option.textContent = pid;
    select.append(option);
  }
  const newOption = document.createElement("option");
  const prefixes = [...new Set(mapped.map(([pid]) => pid.split("_")[0] || "relay"))];
  newOption.value = "__new__";
  newOption.dataset.prefix = prefixes[0] || "relay";
  newOption.textContent = "+ New provider";
  select.append(newOption);
  if (!mapped.length) select.value = "__new__";
  return select;
}

function deriveNewProviderId(state, modelId, prefix) {
  const base = `${prefix}_${String(modelId).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
  const existing = new Set((state.providers || []).map((p) => p.id));
  let id = base;
  let n = 2;
  while (existing.has(id)) id = `${base}_${n++}`;
  return id;
}

async function deployCatalogModel(state, modelId, groupId, targetProvider, relayId, button) {
  button.disabled = true;
  button.textContent = "Deploying…";
  try {
    const isNew = targetProvider === "__new__";
    const providerId = isNew
      ? deriveNewProviderId(state, modelId, button.dataset.newPrefix || "relay")
      : targetProvider;
    const response = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ provider: providerId, model: modelId, relay: relayId }),
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

function renderCatalog(state) {
  const deployedModels = new Set(
    (state.providers || []).flatMap((provider) => (provider.models || []).map((model) => model.id))
  );
  const firstRelayId = Object.keys(state.relays || {})[0];
  const rows = [];
  for (const modelId of catalogGroups(state)) {
    if (deployedModels.has(modelId)) continue;

    const row = document.createElement("tr");
    row.className = "catalog-row";

    const modelCell = document.createElement("td");
    modelCell.className = "agent-name";
    modelCell.textContent = modelId;

    const groups = state.price.prices[modelId] || {};
    const groupCell = document.createElement("td");
    const groupSelect = document.createElement("select");
    groupSelect.className = "group-select";
    for (const groupId of Object.keys(groups)) {
      const option = document.createElement("option");
      option.value = groupId;
      const groupName = state.priceGroupNames?.[groupId] || "未命名渠道";
      option.textContent = `${groupId} · ${groupName}`;
      groupSelect.append(option);
    }
    const storedGroup = getSelectedGroup(CATALOG_KEY_PREFIX, modelId, null);
    if (storedGroup && groups[storedGroup]) groupSelect.value = storedGroup;
    groupSelect.addEventListener("change", () => {
      setSelectedGroup(CATALOG_KEY_PREFIX, modelId, groupSelect.value);
      renderCatalog(dashboardState);
    });
    groupCell.append(groupSelect);

    const priceCell = document.createElement("td");
    priceCell.className = "price-column";
    const pill = createPricePill(groups[groupSelect.value]);
    if (pill) priceCell.append(pill);
    else priceCell.textContent = "–";

    const targetCell = document.createElement("td");
    const targetSelect = createTargetSelect(state);
    targetCell.append(targetSelect);

    const actionCell = document.createElement("td");
    actionCell.className = "action-column";
    const deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "deploy-btn";
    deployBtn.textContent = "Deploy";
    deployBtn.title = `Add ${modelId} to opencode.jsonc`;
    const setPrefix = () => {
      const opt = targetSelect.selectedOptions[0];
      deployBtn.dataset.newPrefix = opt?.dataset.prefix || "relay";
    };
    setPrefix();
    targetSelect.addEventListener("change", setPrefix);
    deployBtn.addEventListener("click", () => {
      const mapping = state.providerMap?.[targetSelect.value];
      deployCatalogModel(state, modelId, groupSelect.value, targetSelect.value, mapping?.relay || firstRelayId, deployBtn);
    });
    actionCell.append(deployBtn);

    row.append(modelCell, groupCell, priceCell, targetCell, actionCell);
    rows.push(row);
  }

  elements.catalogBody.replaceChildren(...rows);
  elements.catalogFrame.setAttribute("aria-busy", "false");
  elements.catalogCount.textContent = String(rows.length);
  elements.catalogEmptyState.hidden = rows.length > 0;
  elements.catalogBody.closest("table").hidden = rows.length === 0;
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

elements.refreshButton.addEventListener("click", () => loadState({ confirmDiscard: true }));
elements.retryButton.addEventListener("click", () => loadState());
elements.saveButton.addEventListener("click", saveChanges);

elements.chromeButton.addEventListener("click", async () => {
  elements.chromeButton.disabled = true;
  try {
    const response = await fetch("/api/open-debug-chrome", { method: "POST" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "failed to launch Chrome");
    showToast("success", "Debug Chrome launched", "Log in to the relay page if needed, then click Sync token.");
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
