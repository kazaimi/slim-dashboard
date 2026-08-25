"use strict";

// Relay station probing & price discovery.
// Supports, in detection order:
//   1. geiliapi  - static pricing SPA bundle embedding groupPrices:[...]
//   2. new-api   - GET /api/pricing JSON (used by most Chinese relay panels)
//   3. openai    - GET /v1/models (ids only, no prices)

const { execFileSync } = require("node:child_process");

function fmtNum(v) {
  return Number(v).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeBase(baseURL) {
  return String(baseURL || "").trim().replace(/\/+$/, "");
}

function grabArray(txt, startIdx) {
  let depth = 0, i;
  for (i = startIdx; i < txt.length; i++) {
    const c = txt[i];
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) break; }
  }
  let chunk = txt.slice(startIdx, i + 1);
  chunk = chunk.replace(/`/g, '"').replace(/!1/g, "false").replace(/!0/g, "true");
  return Function("return (" + chunk + ");")();
}

function parseGeiliBundle(txt) {
  const result = {};
  let idx = 0;
  while (true) {
    const gi = txt.indexOf("groupPrices:[", idx);
    if (gi < 0) break;
    const back = txt.lastIndexOf("modelId:", gi);
    const ownMatch = txt.slice(back, back + 200).match(/modelId:`([^`]+)`/);
    const ownId = ownMatch ? ownMatch[1] : "?";
    let arr;
    try { arr = grabArray(txt, txt.indexOf("[", gi)); } catch { idx = gi + 1; continue; }
    for (const gp of arr) {
      const items = {};
      for (const it of gp.items || []) items[it.key] = it;
      const inIt = items.input, outIt = items.output, cacheIt = items.cache_read;
      result[ownId] = result[ownId] || {};
      result[ownId][gp.groupId] = {
        in: inIt ? inIt.actualPrice : null,
        out: outIt ? outIt.actualPrice : null,
        cache: cacheIt ? cacheIt.actualPrice : null,
        mult: inIt ? inIt.effectiveMultiplier : null,
        officialIn: inIt ? inIt.officialPrice : null,
        officialOut: outIt ? outIt.officialPrice : null,
        officialCache: cacheIt ? cacheIt.officialPrice : null,
        currency: inIt?.actualCurrency || "USD",
      };
    }
    idx = gi + 1;
  }
  return result;
}

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

// new-api convention: quota 500000 == $1 => ratio 1 == $2 per 1M tokens.
const NEWAPI_UNIT_USD_PER_1M = 2;

function parseNewApiPricing(payload) {
  const prices = {};
  const data = payload?.data;
  const items = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
  const groupRatio = payload?.group_ratio || data?.group_ratio || {};

  for (const m of items) {
    if (!m?.model_name) continue;
    const groups =
      Array.isArray(m.enable_groups) && m.enable_groups.length ? m.enable_groups.map(String) : ["default"];

    let entry;
    const expr = m.billing_mode === "tiered_expr" ? String(m.billing_expr || "") : "";
    if (expr) {
      // Custom tiered billing: the expression's coefficients ARE the price
      // (in panel price-unit per 1M tokens), model_ratio is ignored.
      // Example: len <= 200000 ? tier("base", p * 3 + c * 18 + cr * 0.3 + cc * 3.75) : ...
      const coeff = (re) => {
        const match = expr.match(re);
        return match ? Number(match[1]) : 0;
      };
      entry = {
        in: coeff(/\bp\s*\*\s*([\d.]+)/),
        out: coeff(/\bc\s*\*\s*([\d.]+)/),
        cache: coeff(/\bcr\s*\*\s*([\d.]+)/),
        exprUnit: true,
        tiered: /tier\s*\(/i.test(expr),
      };
    } else if (Number(m.quota_type) === 1 && m.model_price != null) {
      // per-call billing: model_price is dollars per request
      entry = { in: fmtNum(Number(m.model_price)), out: fmtNum(Number(m.model_price)), perCall: true };
    } else if (m.model_ratio != null) {
      const inUsd = Number(m.model_ratio) * NEWAPI_UNIT_USD_PER_1M;
      entry = {
        in: fmtNum(inUsd),
        out: fmtNum(inUsd * (m.completion_ratio != null ? Number(m.completion_ratio) : 1)),
        mult: String(m.model_ratio),
      };
    } else {
      entry = { in: null, out: null };
    }
    entry.currency = "USD";
    entry.officialIn = entry.in;
    entry.officialOut = entry.out;

    for (const g of groups) {
      const gr = groupRatio[g] != null ? Number(groupRatio[g]) : 1;
      const e = { ...entry };
      if (gr !== 1 && e.in != null && !e.perCall) {
        e.in = fmtNum(parseFloat(e.in) * gr);
        e.out = fmtNum(parseFloat(e.out) * gr);
        if (e.cache != null) e.cache = fmtNum(parseFloat(e.cache) * gr);
      }
      prices[m.model_name] = prices[m.model_name] || {};
      prices[m.model_name][g] = e;
    }
  }
  return prices;
}

/**
 * Probe a relay base URL and detect what it speaks.
 * Panel UIs are often served under a subpath (/console, /panel...) while the
 * JSON APIs live at the site root, so every strategy is tried against both
 * the given base and the bare origin. The winning base is returned as apiBase.
 * Returns { ok, type, prices, count, detail, apiBase }.
 */
async function discoverRelay({ baseURL, token } = {}) {
  const base = normalizeBase(baseURL);
  if (!/^https?:\/\//.test(base)) return { ok: false, error: "baseURL must start with http(s)://" };

  let origin = base;
  try { origin = new URL(base).origin; } catch {}
  const candidateBases = [...new Set([base, origin])];

  // 1) GeiliAPI-style static pricing bundle
  for (const cb of candidateBases) {
    try {
      const res = await fetch(`${cb}/model-pricing/assets/index-kczjgnt4.js`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const txt = await res.text();
        if (txt.includes("groupPrices:[")) {
          const prices = parseGeiliBundle(txt);
          if (Object.keys(prices).length) {
            return { ok: true, type: "geiliapi", prices, count: Object.keys(prices).length, detail: "geili pricing bundle", apiBase: cb };
          }
        }
      }
    } catch {}
  }

  // 2) new-api / one-api style pricing endpoint
  for (const cb of candidateBases) {
    try {
      const data = await fetchJson(`${cb}/api/pricing`, token);
      const prices = parseNewApiPricing(data);
      if (Object.keys(prices).length) {
        return { ok: true, type: "newapi", prices, count: Object.keys(prices).length, detail: "/api/pricing", apiBase: cb };
      }
    } catch {}
  }

  // 3) Plain OpenAI-compatible model list (no prices available)
  for (const cb of candidateBases) {
    try {
      const data = await fetchJson(`${cb}/v1/models`, token);
      const ids = (Array.isArray(data?.data) ? data.data : []).map((m) => m?.id).filter(Boolean);
      if (ids.length) {
        const prices = {};
        for (const id of ids) prices[id] = { default: { in: null, out: null, currency: "USD" } };
        return { ok: true, type: "openai", prices, count: ids.length, detail: "/v1/models (prices unavailable)", apiBase: cb };
      }
      return { ok: false, error: "/v1/models returned no models" };
    } catch {}
  }

  return { ok: false, error: `could not reach relay APIs at ${candidateBases.join(" or ")}` };
}

/** Verify a stored relay still answers (uses its saved token when present). */
async function verifyRelay(relay) {
  const token = resolveEnvChain(relay.tokenEnv || []);
  return discoverRelay({ baseURL: relay.baseURL, token });
}

function readUserEnv(name) {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true });
    const line = (out || "").split(/\r?\n/).find((l) => /REG_SZ|REG_EXPAND_SZ/.test(l) && l.trim() !== "");
    if (!line) return null;
    return line.replace(/^.*REG_(EXPAND_)?SZ\s+/, "").trim();
  } catch {
    return null;
  }
}

function resolveEnvChain(names) {
  for (const n of names || []) {
    if (process.env[n]) return process.env[n];
  }
  for (const n of names || []) {
    const v = readUserEnv(n);
    if (v) return v;
  }
  return null;
}

module.exports = { discoverRelay, verifyRelay, parseGeiliBundle, parseNewApiPricing, resolveEnvChain };
