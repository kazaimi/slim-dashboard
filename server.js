"use strict";

// slim-dashboard server
// Real-time pricing + stability dashboard for OpenCode relay stations.
// Relay behaviour is defined in config.json (see config.example.json);
// without a config file the built-in GeiliAPI defaults below are used so
// the dashboard works out of the box.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("node:child_process");
const { deployModel } = require("./scripts/deploy-opencode");
const { syncTokens } = require("./scripts/sync-token");
const { discoverRelay, verifyRelay, parseGeiliBundle, resolveEnvChain } = require("./scripts/discover-relay");

const ROOT = __dirname;
const HOMEDIR = process.env.USERPROFILE || process.env.HOME || os.homedir();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_RELAY = {
  name: "GeiliAPI",
  type: "geiliapi",
  baseURL: "https://sub.geiliapi.com",
  port: process.env.PORT || 6388,
  tokenEnv: ["GEILI_PLUGIN_TOKEN"],
  pricingPath: "/model-pricing/assets/index-kczjgnt4.js",
  monitorPath: "/api/v1/channel-monitors",
  providers: {
    geili_openai: { priceGroup: "27", channel: "GPT 给力 Pro", groupName: "GPT 给力 Pro" },
    geili_grok: { priceGroup: "heavy", channel: "Grok（Heavy）", groupName: "Grok Heavy" },
    geili_guomo: { priceGroup: "82", channel: "国模综合", groupName: "国模综合" },
    geili_deepseek_flash: { priceGroup: "flash-low", channel: "福利 Flash", groupName: "福利 Flash" },
    geili_api: { priceGroup: "47", channel: "CC-kiro", groupName: "CC-Kiro" },
    geili_gemini: { priceGroup: "41", channel: "Gemini", groupName: "Gemini" },
  },
  priceGroupNames: {
    4: "Plus/Pro 混合",
    27: "GPT 给力 Pro",
    41: "Gemini",
    46: "CC-Max",
    47: "CC-Kiro",
    67: "Grok",
    80: "Pro 更稳定",
    82: "国模综合",
    heavy: "Grok Heavy",
    "flash-low": "福利 Flash",
  },
  overrides: [
    // 国模综合 for deepseek-v4-pro/flash: show official price instead of the
    // manually-configured 0.2x entry derived from a different base.
    { models: ["deepseek-v4-pro", "deepseek-v4-flash"], group: "82", useOfficial: true, currency: "CNY" },
    // Group 4 GPT multiplier changed 0.1 -> 0.15 on the gateway while the
    // pricing bundle still reports 0.1; recompute as official x 0.15.
    { models: ["gpt-*"], group: "4", multiplier: 0.15 },
  ],
  syntheticGroups: [
    { id: "heavy", name: "Grok Heavy", baseGroup: "67", models: ["grok-4.5", "grok-4.6"], multiplier: 0.15 },
    { id: "flash-low", name: "福利 Flash", baseGroup: "82", models: ["deepseek-v4-flash"], multiplier: 0.01, currency: "CNY" },
  ],
  tokenSync: {
    cdpUrl: "http://127.0.0.1:9222",
    sitePattern: "geiliapi.com",
    authPageHint: "/monitor",
    storageKeys: { auth_token: 100 },
    cookieNames: ["token", "access_token", "session_token"],
    excludePattern: "(refresh|expires|user)",
    chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  },
  providerTemplate: {
    npm: "@ai-sdk/openai",
    baseURL: "https://sub.geiliapi.com/v1",
    apiKeyEnvPrefix: "GEILI_",
    defaults: { context: 128000, output: 8192 },
  },
};

function loadConfig() {
  const file = path.join(ROOT, "config.json");
  try {
    const user = JSON.parse(fs.readFileSync(file, "utf8"));
    const userRelays = {};
    for (const [id, relay] of Object.entries(user.relays || {})) {
      userRelays[id] = { ...relay };
    }
    // The built-in GeiliAPI relay always exists as the baseline station;
    // a config.json entry with the same id overrides its fields.
    const relays = { geiliapi: { ...DEFAULT_RELAY, ...(userRelays.geiliapi || {}), port: undefined } };
    for (const [id, relay] of Object.entries(userRelays)) {
      if (id === "geiliapi") continue;
      relays[id] = { ...DEFAULT_RELAY, ...relay };
    }
    for (const r of Object.values(relays)) delete r.port;
    return {
      port: user.port || process.env.PORT || 6388,
      opencodeConfigPath: user.opencodeConfigPath || path.join(HOMEDIR, ".config", "opencode", "opencode.jsonc"),
      slimConfigPath: user.slimConfigPath || path.join(HOMEDIR, ".config", "opencode", "oh-my-opencode-slim.json"),
      dataDir: user.dataDir || ROOT,
      relays,
    };
  } catch {
    return {
      port: process.env.PORT || 6388,
      opencodeConfigPath: path.join(HOMEDIR, ".config", "opencode", "opencode.jsonc"),
      slimConfigPath: path.join(HOMEDIR, ".config", "opencode", "oh-my-opencode-slim.json"),
      dataDir: ROOT,
      relays: { geiliapi: DEFAULT_RELAY },
    };
  }
}

const CONFIG = loadConfig();
const PUBLIC_DIR = path.join(ROOT, "public");

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function stripComments(src) {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (!inStr && c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (!inStr && c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); i = end === -1 ? src.length : end + 1; continue; }
    out += c;
  }
  return out;
}

function parseJsonc(raw) {
  return JSON.parse(stripComments(raw).replace(/,(\s*[}\]])/g, "$1"));
}

function readUserEnv(name) {
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true });
    const line = (out || "").split(/\r?\n/).find((l) => /REG_SZ|REG_EXPAND_SZ/.test(l) && l.trim() !== "");
    if (!line) return null;
    return line.replace(/^.*REG_(EXPAND_)?SZ\s+/, "").trim();
  } catch {
    return null;
  }
}

function matchPattern(id, pattern) {
  return pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

const fmtNum = (v) => Number(v).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

// ---------------------------------------------------------------------------
// Pricing (per relay)
// ---------------------------------------------------------------------------

function applyOverrides(prices, overrides) {
  for (const rule of overrides || []) {
    if (!rule?.group || !Array.isArray(rule.models)) continue;
    for (const modelId of Object.keys(prices)) {
      if (!rule.models.some((pat) => matchPattern(modelId, pat))) continue;
      const entry = prices[modelId]?.[rule.group];
      if (!entry || entry.officialIn == null) continue;
      if (rule.useOfficial) {
        entry.in = String(entry.officialIn);
        if (entry.officialOut != null) entry.out = String(entry.officialOut);
        if (entry.officialCache != null) entry.cache = String(entry.officialCache);
        if (rule.currency) entry.currency = rule.currency;
        entry.officialPricing = true;
      } else if (rule.multiplier != null) {
        const mult = Number(rule.multiplier);
        entry.in = fmtNum(Number(entry.officialIn) * mult);
        if (entry.officialOut != null) entry.out = fmtNum(Number(entry.officialOut) * mult);
        if (entry.officialCache != null) entry.cache = fmtNum(Number(entry.officialCache) * mult);
        entry.mult = String(rule.multiplier);
      }
    }
  }
}

function applySyntheticGroups(prices, syntheticGroups) {
  for (const sg of syntheticGroups || []) {
    if (!sg?.id || !sg?.baseGroup || sg.multiplier == null) continue;
    for (const modelId of Object.keys(prices)) {
      if (!(sg.models || []).some((pat) => matchPattern(modelId, pat))) continue;
      const base = prices[modelId]?.[sg.baseGroup];
      if (!base || base.officialIn == null) continue;
      const mult = Number(sg.multiplier);
      const cacheSrc = base.officialCache != null ? base.officialCache : base.cache;
      prices[modelId][sg.id] = {
        in: fmtNum(Number(base.officialIn) * mult),
        out: base.officialOut == null ? null : fmtNum(Number(base.officialOut) * mult),
        cache: cacheSrc == null ? null : fmtNum(Number(cacheSrc) * mult),
        mult: String(sg.multiplier),
        officialIn: base.officialIn,
        officialOut: base.officialOut,
        officialCache: base.officialCache,
        currency: sg.currency || base.currency || "USD",
      };
    }
  }
}

const priceCaches = new Map(); // relayId -> { table, source }

async function fetchNewApiPrices(relay) {
  const token = resolveRelayToken(relay);
  const res = await fetch(`${relay.baseURL}/api/pricing`, {
    headers: token ? { Authorization: `Bearer ${token.token}` } : {},
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const data = await res.json();
  const prices = {};
  const items = Array.isArray(data?.data) ? data.data : [];
  for (const m of items) {
    if (!m?.model_name) continue;
    const group = (Array.isArray(m.enable_groups) && m.enable_groups[0]) || "default";
    const entry = { currency: "USD", officialIn: null, officialOut: null };
    if (Number(m.quota_type) === 1 && m.model_price != null) {
      entry.in = String(m.model_price);
      entry.out = entry.in;
    } else if (m.model_ratio != null) {
      const inUsd = Number(m.model_ratio) * 2; // quota 500000 == $1 => ratio 1 == $2/1M
      entry.in = fmtNum(inUsd);
      entry.out = fmtNum(inUsd * (m.completion_ratio != null ? Number(m.completion_ratio) : 1));
      entry.mult = String(m.model_ratio);
    }
    entry.officialIn = entry.in;
    entry.officialOut = entry.out;
    prices[m.model_name] = prices[m.model_name] || {};
    prices[m.model_name][group] = entry;
  }
  return prices;
}

async function loadPriceTable(relayId, relay) {
  if (priceCaches.has(relayId)) return priceCaches.get(relayId);

  if (relay.type === "newapi" || relay.type === "openai") {
    try {
      let table;
      if (relay.type === "newapi") {
        table = await fetchNewApiPrices(relay);
      } else {
        const tk = resolveRelayToken(relay);
        const res = await fetch(`${relay.baseURL}/v1/models`, {
          headers: tk ? { Authorization: `Bearer ${tk.token}` } : {},
          signal: AbortSignal.timeout(12000),
        });
        const data = await res.json();
        table = {};
        for (const m of data?.data || []) {
          if (m?.id) table[m.id] = { default: { in: null, out: null, currency: "USD" } };
        }
      }
      priceCaches.set(relayId, { table, source: relay.type });
      return priceCaches.get(relayId);
    } catch {
      priceCaches.set(relayId, { table: {}, source: "none" });
      return priceCaches.get(relayId);
    }
  }

  // geiliapi (default)
  try {
    const res = await fetch(`${relay.baseURL}${relay.pricingPath}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const parsed = parseGeiliBundle(await res.text());
      if (Object.keys(parsed).length > 0) {
        priceCaches.set(relayId, { table: parsed, source: "live" });
        return priceCaches.get(relayId);
      }
    }
  } catch {}
  const fbPath = path.join(CONFIG.dataDir, `price-fallback${relayId === "geiliapi" ? "" : "-" + relayId}.json`);
  try {
    const fb = JSON.parse(fs.readFileSync(fbPath, "utf8"));
    if (Object.keys(fb).length > 0) {
      priceCaches.set(relayId, { table: fb, source: "fallback" });
      return priceCaches.get(relayId);
    }
  } catch {}
  priceCaches.set(relayId, { table: {}, source: "none" });
  return priceCaches.get(relayId);
}

async function fetchPriceData(relayId, relay) {
  const { table, source } = await loadPriceTable(relayId, relay);
  const prices = structuredClone(table);
  applyOverrides(prices, relay.overrides);
  applySyntheticGroups(prices, relay.syntheticGroups);
  return { ok: true, prices, source, count: Object.keys(prices).length };
}

// ---------------------------------------------------------------------------
// Stability (per relay)
// ---------------------------------------------------------------------------

function stabilityCachePath(relayId) {
  const name = relayId === "geiliapi" ? "stability-cache.json" : `stability-cache-${relayId}.json`;
  return path.join(CONFIG.dataDir, name);
}

function loadStabilityCache(relayId) {
  try {
    const raw = JSON.parse(fs.readFileSync(stabilityCachePath(relayId), "utf8"));
    if (raw?.channels && Object.keys(raw.channels).length > 0) return raw;
  } catch {}
  return null;
}

function saveStabilityCache(relayId, channels) {
  try {
    fs.writeFileSync(stabilityCachePath(relayId), JSON.stringify({ savedAt: new Date().toISOString(), channels }, null, 2), "utf8");
  } catch {}
}

function summarizeTimeline(timeline) {
  const list = Array.isArray(timeline) ? timeline.slice(-60) : [];
  const counts = { operational: 0, degraded: 0, error: 0, unknown: 0 };
  for (const t of list) {
    const s = t && t.status ? String(t.status) : "unknown";
    if (Object.prototype.hasOwnProperty.call(counts, s)) counts[s]++;
    else counts.unknown++;
  }
  return { total: list.length, counts };
}

function resolveRelayToken(relay) {
  for (const k of relay.tokenEnv || []) {
    if (process.env[k]) return { token: process.env[k], source: "env" };
  }
  for (const k of relay.tokenEnv || []) {
    const v = readUserEnv(k);
    if (v) return { token: v, source: "user-env" };
  }
  return null;
}

function stabilityFallback(relayId, error) {
  const cached = loadStabilityCache(relayId);
  if (cached) {
    return {
      ok: true,
      channels: cached.channels,
      count: Object.keys(cached.channels).length,
      fromCache: true,
      note: `${error}; showing last known data`,
    };
  }
  return { ok: false, error, channels: {} };
}

async function fetchStability(relayId, relay) {
  const tk = resolveRelayToken(relay);
  if (!tk) return { ok: false, error: "no_token", channels: {} };
  try {
    const res = await fetch(`${relay.baseURL}${relay.monitorPath}`, {
      headers: { Authorization: `Bearer ${tk.token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return stabilityFallback(relayId, `${relayId}_http_${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.data?.items) ? data.data.items : [];
    const channels = {};
    for (const it of items) {
      channels[it.name] = {
        id: it.id,
        status: it.primary_status,
        availability7d: it.availability_7d,
        latencyMs: it.primary_latency_ms,
        last60: summarizeTimeline(it.timeline),
      };
    }
    if (Object.keys(channels).length > 0) {
      saveStabilityCache(relayId, channels);
      return { ok: true, channels, count: Object.keys(channels).length };
    }
    return stabilityFallback(relayId, `${relayId} returned no items`);
  } catch {
    return stabilityFallback(relayId, "fetch failed");
  }
}

// ---------------------------------------------------------------------------
// OpenCode state
// ---------------------------------------------------------------------------

function readSlim() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.slimConfigPath, "utf8"));
  } catch {
    return null;
  }
}

function readOpencodeConfig() {
  try {
    return parseJsonc(fs.readFileSync(CONFIG.opencodeConfigPath, "utf8"));
  } catch {
    return null;
  }
}

function providerInventory() {
  const cfg = readOpencodeConfig();
  const provs = cfg?.provider || {};
  const providers = [];
  for (const [pid, p] of Object.entries(provs)) {
    const models = [];
    for (const [mid, m] of Object.entries(p.models || {})) {
      models.push({ id: mid, name: m?.name || mid, limit: m?.limit || null });
    }
    providers.push({ id: pid, name: p?.name || pid, baseURL: p?.options?.baseURL || "", models });
  }
  return providers;
}

const AGENT_ORDER = ["orchestrator", "oracle", "librarian", "explorer", "designer", "fixer", "council", "observer"];

function buildState() {
  const slim = readSlim();
  const presetName = slim?.default_preset || "mixed";
  const preset = slim?.presets?.[presetName] || {};
  const agents = AGENT_ORDER.map((name) => ({ name, model: preset[name]?.model || "" }));
  return { presetName, agents, providers: providerInventory() };
}

// ---------------------------------------------------------------------------
// Merged multi-relay view
// ---------------------------------------------------------------------------

function findStabilityChannel(stability, channel) {
  if (!stability || !channel) return null;
  if (stability[channel]) return stability[channel];
  const key = Object.keys(stability).find((name) => name.startsWith(channel) || channel.startsWith(name));
  return key ? stability[key] : null;
}

function agentValue(agent, priceTable, stability, providerMap) {
  const slash = agent.model.indexOf("/");
  const provider = slash === -1 ? "" : agent.model.slice(0, slash);
  const modelId = slash === -1 ? agent.model : agent.model.slice(slash + 1);
  const mapping = providerMap[provider];
  let price = null;
  let groupName = null;
  if (mapping && priceTable[modelId]?.[mapping.priceGroup]) {
    const p = priceTable[modelId][mapping.priceGroup];
    price = { in: p.in, out: p.out, cache: p.cache, mult: p.mult, officialIn: p.officialIn, officialOut: p.officialOut, currency: p.currency || "USD" };
    groupName = mapping.groupName;
  }
  const stable = mapping ? findStabilityChannel(stability, mapping.channel) : null;
  return { provider, modelId, price, groupName, stability: stable };
}

async function buildMergedView() {
  const state = buildState();
  const mergedPrices = {};
  const mergedChannels = {};
  const providerMap = {};
  const priceGroupNames = {};
  const priceSources = [];
  const stabilityNotes = [];
  const modelRelays = {};
  let stabilityFromCache = false;

  for (const [relayId, relay] of Object.entries(CONFIG.relays)) {
    const [price, stability] = await Promise.all([fetchPriceData(relayId, relay), fetchStability(relayId, relay)]);
    priceSources.push(`${relay.name}:${price.source}(${price.count})`);
    if (stability.fromCache) {
      stabilityFromCache = true;
      stabilityNotes.push(`${relay.name}: ${stability.note}`);
    }
    for (const [modelId, groups] of Object.entries(price.prices || {})) {
      if (!modelRelays[modelId]) modelRelays[modelId] = relayId;
      mergedPrices[modelId] = { ...(mergedPrices[modelId] || {}), ...groups };
    }
    for (const [channelName, data] of Object.entries(stability.channels || {})) {
      const key = mergedChannels[channelName] ? `${relay.name} ${channelName}` : channelName;
      mergedChannels[key] = data;
    }
    for (const [pid, mapping] of Object.entries(relay.providers || {})) {
      providerMap[pid] = { ...mapping, relay: relayId };
    }
    Object.assign(priceGroupNames, relay.priceGroupNames || {});
  }

  const agents = state.agents.map((agent) => ({
    ...agent,
    ...agentValue(agent, mergedPrices, mergedChannels, providerMap),
  }));

  const stability = {
    ok: Object.keys(mergedChannels).length > 0 || stabilityNotes.length > 0,
    channels: mergedChannels,
    count: Object.keys(mergedChannels).length,
  };
  if (stabilityFromCache) {
    stability.fromCache = true;
    stability.note = stabilityNotes.join("; ");
  }

  return {
    ...state,
    agents,
    price: { ok: Object.keys(mergedPrices).length > 0, prices: mergedPrices, source: priceSources.join(","), count: Object.keys(mergedPrices).length },
    stability,
    providerMap,
    priceGroupNames,
    modelRelays,
    relays: Object.fromEntries(Object.entries(CONFIG.relays).map(([id, r]) => [
      id,
      {
        name: r.name,
        baseURL: r.baseURL,
        type: r.type || "geiliapi",
        tokenConfigured: Boolean(resolveRelayToken(r)),
        modelCount: priceCaches.get(id)?.table ? Object.keys(priceCaches.get(id).table).length : 0,
      },
    ])),
  };
}

// ---------------------------------------------------------------------------
// Agent assignment persistence (oh-my-opencode-slim.json)
// ---------------------------------------------------------------------------

function saveAgents(agents) {
  const slim = readSlim();
  if (!slim) return { ok: false, error: "no_slim_config" };
  const presetName = slim.default_preset || "mixed";
  slim.presets ??= {};
  slim.presets[presetName] ??= {};
  for (const a of agents) {
    slim.presets[presetName][a.name] ??= {};
    slim.presets[presetName][a.name].model = a.model;
  }
  fs.writeFileSync(CONFIG.slimConfigPath, JSON.stringify(slim, null, 2) + "\n", "utf8");
  return { ok: true, presetName };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("forbidden"); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC_DIR, "index.html");
  }
  const ext = path.extname(file).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}

function launchDebugChrome(relay) {
  const sync = relay.tokenSync || {};
  const chromePath = sync.chromePath || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (!fs.existsSync(chromePath)) return { ok: false, error: `chrome.exe not found at ${chromePath} (set relays.<id>.tokenSync.chromePath)` };

  const localAppData = process.env.LOCALAPPDATA || path.join(HOMEDIR, "AppData", "Local");
  const sourceProfile = sync.sourceProfileDir || path.join(localAppData, "Google", "Chrome", "User Data");
  const debugProfile = sync.debugProfileDir || path.join(localAppData, "Google", "Chrome", "Slim Dashboard Debug User Data");

  // First run only: clone the default profile (minus caches) so existing
  // relay logins carry over into the debug instance.
  if (!fs.existsSync(path.join(debugProfile, "Local State"))) {
    try {
      fs.mkdirSync(debugProfile, { recursive: true });
      fs.copyFileSync(path.join(sourceProfile, "Local State"), path.join(debugProfile, "Local State"));
      const srcDefault = path.join(sourceProfile, "Default");
      if (fs.existsSync(srcDefault)) {
        const exclude = new Set(["cache", "code cache", "gpucache", "dawncache", "shadercache", "grshadercache", "crashpad", "browsermetrics", "media cache", "componentcrcache", "temp file"]);
        fs.cpSync(srcDefault, path.join(debugProfile, "Default"), {
          recursive: true,
          force: true,
          filter: (src) => {
            const rel = path.relative(srcDefault, src);
            if (!rel) return true;
            return !exclude.has(rel.split(path.sep)[0].toLowerCase());
          },
        });
      }
    } catch (e) {
      return { ok: false, error: `preparing debug profile failed: ${e.message}` };
    }
  }

  let port = 9222;
  try { port = new URL(sync.cdpUrl || "http://127.0.0.1:9222").port || 9222; } catch {}
  const startUrl = sync.startUrl || `${relay.baseURL}${sync.authPageHint || ""}`;
  const child = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${debugProfile}`,
    "--profile-directory=Default",
    "--no-first-run",
    startUrl,
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { ok: true, message: `Debug Chrome launched on port ${port}; open ${startUrl}` };
}

// ---------------------------------------------------------------------------
// Relay station management (config.json persistence + live activation)
// ---------------------------------------------------------------------------

const USER_CONFIG_PATH = path.join(ROOT, "config.json");

function readUserConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeUserConfigFile(cfg) {
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

function activateRelay(id, entry) {
  CONFIG.relays[id] = { ...DEFAULT_RELAY, ...entry };
  delete CONFIG.relays[id].port;
  priceCaches.delete(id);
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "relay";
}

function execSetx(name, value) {
  const { execFileSync } = require("child_process");
  execFileSync("setx.exe", [name, String(value)], { stdio: "ignore", windowsHide: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "GET" && p === "/api/state") {
    try {
      sendJson(res, 200, await buildMergedView());
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && p === "/api/save") {
    try {
      const body = await readBody(req);
      const agents = Array.isArray(body?.agents) ? body.agents : [];
      const r = saveAgents(agents);
      sendJson(res, r.ok ? 200 : 400, r);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && p === "/api/deploy") {
    try {
      const body = await readBody(req);
      if (!body.provider || !body.model) throw new Error("provider and model are required");
      const relay = CONFIG.relays[body.relay] || Object.values(CONFIG.relays)[0];
      const result = deployModel(CONFIG.opencodeConfigPath, body.provider, body.model, {
        modelName: body.name,
        context: body.context,
        output: body.output,
        apiKey: body.apiKey,
        providerTemplate: relay.providerTemplate,
        providerName: body.providerName,
      });
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && p === "/api/open-debug-chrome") {
    try {
      const body = await readBody(req);
      const relay = CONFIG.relays[body.relay] || Object.values(CONFIG.relays)[0];
      sendJson(res, 200, launchDebugChrome(relay));
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && p === "/api/token-sync") {
    try {
      const body = await readBody(req);
      // Run the harvest synchronously so the UI gets real per-relay results.
      // Restart is deferred: respawn ourselves (with saved token) after the
      // response has been flushed, otherwise we would kill our own request.
      const { results } = await syncTokens({ only: body.relay || null, skipRestart: true });
      if (results.some((r) => r.ok)) {
        setTimeout(() => {
          spawn(process.execPath, [path.join(ROOT, "scripts", "sync-token.js"), "--restart-existing"], {
            cwd: ROOT,
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          }).unref();
        }, 1500);
      }
      sendJson(res, 200, { ok: true, results });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && p === "/api/relays") {
    try {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const baseURL = String(body.baseURL || "").trim().replace(/\/+$/, "");
      if (!name) throw new Error("name is required");
      if (!/^https?:\/\//.test(baseURL)) throw new Error("baseURL must start with http(s)://");

      let id = slugify(body.id || name);
      while (CONFIG.relays[id]) id = `${id}-2`;

      // Persist token before probing so discovery can use authenticated endpoints.
      const tokenEnv = String(body.tokenEnv || "").trim() || `${id.toUpperCase().replace(/-/g, "_")}_TOKEN`;
      if (body.token) {
        execSetx(tokenEnv, body.token);
        process.env[tokenEnv] = body.token;
      }

      const probe = await discoverRelay({ baseURL, token: body.token || null });
      let sitePattern = "localhost";
      try { sitePattern = new URL(baseURL).hostname.replace(/^www\./, ""); } catch {}
      const entry = {
        name,
        baseURL,
        type: probe.ok ? probe.type : "openai",
        tokenEnv: [tokenEnv],
        monitorPath: "/api/v1/channel-monitors",
        pricingPath: "/model-pricing/assets/index-kczjgnt4.js",
        providers: {},
        priceGroupNames: {},
        overrides: [],
        syntheticGroups: [],
        tokenSync: {
          ...(DEFAULT_RELAY.tokenSync || {}),
          sitePattern,
          authPageHint: "",
        },
        providerTemplate: {
          npm: "@ai-sdk/openai",
          baseURL: `${baseURL}/v1`,
          apiKeyEnvPrefix: "",
          defaults: { context: 128000, output: 8192 },
        },
      };

      activateRelay(id, entry);
      const file = readUserConfigFile();
      file.relays = file.relays || {};
      file.relays[id] = JSON.parse(JSON.stringify(entry));
      writeUserConfigFile(file);

      sendJson(res, 200, {
        ok: true,
        id,
        detectedType: entry.type,
        modelCount: probe.count || 0,
        detail: probe.detail || probe.error || "",
        tokenSet: Boolean(body.token),
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && p === "/api/relay-test") {
    try {
      const body = await readBody(req);
      const relay = CONFIG.relays[body.id];
      if (!relay) throw new Error("unknown relay");
      const probe = await verifyRelay(relay);
      if (probe.ok && probe.type !== relay.type) {
        relay.type = probe.type;
        priceCaches.delete(body.id);
        const file = readUserConfigFile();
        if (file.relays?.[body.id]) {
          file.relays[body.id].type = probe.type;
          writeUserConfigFile(file);
        }
      }
      sendJson(res, 200, {
        ok: probe.ok,
        type: probe.type || relay.type,
        modelCount: probe.count || 0,
        detail: probe.detail || probe.error || "",
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === "DELETE" && p.startsWith("/api/relays/")) {
    const id = decodeURIComponent(p.slice("/api/relays/".length));
    if (!CONFIG.relays[id]) {
      sendJson(res, 404, { ok: false, error: "unknown relay" });
      return;
    }
    delete CONFIG.relays[id];
    priceCaches.delete(id);
    const file = readUserConfigFile();
    if (file.relays) {
      delete file.relays[id];
      writeUserConfigFile(file);
    }
    sendJson(res, 200, { ok: true, removed: id });
    return;
  }

  if (req.method === "GET" && p === "/api/health") {
    sendJson(res, 200, { ok: true, relays: Object.keys(CONFIG.relays) });
    return;
  }

  if (p.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  serveStatic(req, res, p);
});

server.listen(CONFIG.port, () => {
  console.log("");
  console.log("  Slim Dashboard running at:");
  console.log(`    http://localhost:${CONFIG.port}`);
  console.log("");
  console.log(`  Relays: ${Object.entries(CONFIG.relays).map(([id, r]) => `${id} (${r.baseURL})`).join(", ")}`);
  console.log(`  OpenCode config: ${CONFIG.opencodeConfigPath}`);
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
