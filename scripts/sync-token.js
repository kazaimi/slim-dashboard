"use strict";

// Harvest a relay session token from a Chrome instance started with
// --remote-debugging-port=9222, persist it via setx and optionally restart
// the dashboard. Usable as a CLI tool and as a library (see syncTokens).
//
// Usage:
//   node scripts/sync-token.js [--relay <id>]      harvest + setx + restart
//   node scripts/sync-token.js --restart-existing   respawn server using saved token

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");

function loadRawConfig() {
  let base = {};
  try {
    base = JSON.parse(fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"));
  } catch {}
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  } catch {}
  const relays = { ...(base.relays || {}) };
  for (const [id, relay] of Object.entries(user.relays || {})) {
    relays[id] = { ...(relays[id] || {}), ...relay };
  }
  // Backfill tokenSync for relays added before this section existed.
  for (const relay of Object.values(relays)) {
    if (!relay.tokenSync && relay.baseURL) {
      let host = "localhost";
      try { host = new URL(relay.baseURL).hostname.replace(/^www\./, ""); } catch {}
      relay.tokenSync = {
        cdpUrl: "http://127.0.0.1:9222",
        sitePattern: host,
        storageKeys: { auth_token: 100, access_token: 90 },
        cookieNames: ["token", "access_token", "session_token"],
        excludePattern: "(refresh|expires|user)",
      };
    }
  }
  return { port: user.port || base.port, relays };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function looksLikeToken(value) {
  return typeof value === "string" && value.length >= 100 && value.length <= 5000;
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

function connectChromium(cdpUrl) {
  let chromium;
  try {
    ({ chromium } = require(path.join(ROOT, "node_modules", "playwright-core")));
  } catch {
    ({ chromium } = require("playwright-core"));
  }
  return chromium.connectOverCDP(cdpUrl);
}

async function harvestRelay(relayId, relay) {
  const sync = relay.tokenSync;
  if (!sync) return { relayId, ok: false, error: "no tokenSync section in config" };

  let browser;
  try {
    browser = await connectChromium(sync.cdpUrl || "http://127.0.0.1:9222");
  } catch {
    return {
      relayId,
      ok: false,
      error: `Chrome debug port not reachable at ${sync.cdpUrl}. Start Chrome with --remote-debugging-port=9222 (use 启动Chrome调试模式.cmd), open ${relay.baseURL} and log in.`,
    };
  }

  try {
    const excludeRe = sync.excludePattern ? new RegExp(sync.excludePattern, "i") : null;
    const sitePattern = sync.sitePattern;
    const priorities = sync.storageKeys || { auth_token: 100 };
    const cookieNames = sync.cookieNames || ["token", "access_token"];
    const candidates = [];

    const pushCandidate = (source, key, value) => {
      if (!looksLikeToken(value)) return;
      if (excludeRe && excludeRe.test(key)) return;
      const priority = priorities[key] ?? (/access|authorization/i.test(key) ? 60 : 30);
      candidates.push({ source: `${source}:${key}`, value, priority });
    };

    for (const context of browser.contexts()) {
      for (const cookie of await context.cookies()) {
        if (!cookie.domain.includes(sitePattern)) continue;
        if (cookieNames.some((n) => cookie.name.toLowerCase().includes(n.toLowerCase()))) {
          pushCandidate("cookie", cookie.name, cookie.value);
        }
      }
      for (const page of context.pages()) {
        if (!page.url().includes(sitePattern)) continue;
        const storage = await page
          .evaluate(() => {
            const read = (store) => Object.fromEntries(Object.keys(store).map((key) => [key, store.getItem(key)]));
            return { local: read(localStorage), session: read(sessionStorage) };
          })
          .catch(() => ({ local: {}, session: {} }));
        for (const [kind, store] of Object.entries(storage)) {
          for (const [key, value] of Object.entries(store || {})) {
            if (Object.keys(priorities).some((k) => key === k) || /token/i.test(key)) {
              pushCandidate(kind, key, value);
            }
          }
        }
      }
    }
    browser._connection?.close();

    const unique = [...new Map(candidates.map((item) => [item.value, item])).values()];
    if (!unique.length) {
      return { relayId, ok: false, error: `no token found in logged-in ${sitePattern} pages. Open the relay site in the debug Chrome window and log in first.` };
    }
    unique.sort((a, b) => b.priority - a.priority || b.value.length - a.value.length);
    return { relayId, ok: true, source: unique[0].source, value: unique[0].value };
  } catch (e) {
    browser._connection?.close();
    return { relayId, ok: false, error: e.message };
  }
}

function dashboardPort(rawConfig) {
  return Number(rawConfig?.port || process.env.PORT || 6388);
}

function killDashboard(port) {
  try {
    const netstat = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    const match = netstat.match(new RegExp(`TCP\\s+[^\\s]+:${port}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)`, "i"));
    if (match) execFileSync("taskkill.exe", ["/PID", match[1], "/F"], { stdio: "ignore", windowsHide: true });
  } catch {}
}

function startServer(extraEnv) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

/**
 * Harvest tokens for all (or one) relays, persist via setx.
 * Returns per-relay results. When skipRestart is false the dashboard is
 * killed and respawned with the freshest token injected into its env.
 */
async function syncTokens({ only, skipRestart = false } = {}) {
  const rawConfig = loadRawConfig();
  const relays = rawConfig?.relays || {};
  const results = [];
  let restarted = false;

  for (const [relayId, relay] of Object.entries(relays)) {
    if (only && relayId !== only) continue;
    const envName = relay.tokenEnv?.[0];
    if (!envName) continue;

    const found = await harvestRelay(relayId, relay);
    if (!found.ok) {
      results.push({ relayId, ok: false, error: found.error });
      continue;
    }
    try {
      execFileSync("setx.exe", [envName, found.value], { stdio: "ignore", windowsHide: true });
      process.env[envName] = found.value;
    } catch (e) {
      results.push({ relayId, ok: false, error: `setx failed: ${e.message}` });
      continue;
    }
    results.push({ relayId, ok: true, source: found.source, env: envName });

    if (!skipRestart && !restarted) {
      killDashboard(dashboardPort(rawConfig));
      startServer({ [envName]: found.value });
      restarted = true;
    }
  }
  return { results, restarted };
}

function restartExisting() {
  const rawConfig = loadRawConfig();
  const relays = rawConfig?.relays || {};
  const port = dashboardPort(rawConfig);
  killDashboard(port);
  for (const relay of Object.values(relays)) {
    const envName = relay.tokenEnv?.[0];
    if (!envName) continue;
    const token = process.env[envName] || readUserEnv(envName);
    if (token) {
      startServer({ [envName]: token });
      console.log(`dashboard restarted on :${port} with ${envName}`);
      return;
    }
  }
  startServer();
  console.log(`dashboard restarted on :${port} (no token found)`);
}

module.exports = { syncTokens, harvestRelay, restartExisting };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--restart-existing")) {
    restartExisting();
    process.exit(0);
  }
  const only = args.includes("--relay") ? args[args.indexOf("--relay") + 1] : null;
  syncTokens({ only })
    .then(({ results }) => {
      for (const r of results) {
        console.log(r.ok ? `${r.relayId}: token synced from ${r.source} -> ${r.env}` : `${r.relayId}: FAILED - ${r.error}`);
      }
      if (results.some((r) => r.ok)) console.log("dashboard restarted.");
      process.exit(results.some((r) => r.ok) ? 0 : 1);
    })
    .catch((e) => fail(e.message));
}
