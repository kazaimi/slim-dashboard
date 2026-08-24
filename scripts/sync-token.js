"use strict";

// Harvest a relay session token from a Chrome instance started with
// --remote-debugging-port=9222, persist it via setx and restart the dashboard.
// Usage: node scripts/sync-token.js [--relay <relayId>]
// Config comes from config.json (see config.example.json -> relays.*.tokenSync).

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
const EXAMPLE_PATH = path.join(ROOT, "config.example.json");
const SERVER = path.join(ROOT, "server.js");

function loadConfig() {
  for (const p of [CONFIG_PATH, EXAMPLE_PATH]) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}
  }
  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function looksLikeToken(value) {
  return typeof value === "string" && value.length >= 100 && value.length <= 5000;
}

async function harvest(relayId, relay) {
  const sync = relay.tokenSync;
  if (!sync) throw new Error(`relay "${relayId}" has no tokenSync section`);
  let chromium;
  try {
    ({ chromium } = require(path.join(ROOT, "node_modules", "playwright-core")));
  } catch {
    try {
      ({ chromium } = require("playwright-core"));
    } catch {
      throw new Error("playwright-core is not installed. Run: npm install");
    }
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(sync.cdpUrl || "http://127.0.0.1:9222");
  } catch {
    throw new Error(`Chrome debug port not reachable at ${sync.cdpUrl}. Start Chrome with --remote-debugging-port=9222 first.`);
  }

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
      const hit = cookieNames.find((n) => cookie.name.toLowerCase().includes(n.toLowerCase()));
      if (hit) pushCandidate("cookie", cookie.name, cookie.value);
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
    throw new Error(`no token found in the logged-in ${sitePattern} page. Open the relay site in the debug Chrome window and log in first.`);
  }
  unique.sort((a, b) => b.priority - a.priority || b.value.length - a.value.length);
  return unique[0];
}

function killDashboard() {
  try {
    const netstat = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    const match = netstat.match(/TCP\s+[^\s]+:(\d+)\s+[^\s]+\s+LISTENING\s+(\d+)/i);
    // kill only listeners on our port(s)
    const ports = new Set(Object.values(loadConfig()?.relays || {}).map((r) => String(r.port || 6388)));
    if (match && ports.has(match[1])) {
      execFileSync("taskkill.exe", ["/PID", match[2], "/F"], { stdio: "ignore", windowsHide: true });
    }
  } catch {}
}

function restartDashboard(token, port) {
  killDashboard();
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, GEILI_PLUGIN_TOKEN: token },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

(async () => {
  const args = process.argv.slice(2);
  const relayFilter = args.includes("--relay") ? args[args.indexOf("--relay") + 1] : null;
  const config = loadConfig();
  if (!config?.relays) fail("No config found (config.json or config.example.json with relays).");

  for (const [relayId, relay] of Object.entries(config.relays)) {
    if (relayFilter && relayId !== relayFilter) continue;
    const envName = relay.tokenEnv?.[0];
    if (!envName) continue;
    try {
      const found = await harvest(relayId, relay);
      execFileSync("setx.exe", [envName, found.value], { stdio: "ignore", windowsHide: true });
      process.env[envName] = found.value;
      console.log(`${relayId}: token synced from ${found.source} -> ${envName}`);
      restartDashboard(found.value, relay.port || 6388);
      console.log("dashboard restarted.");
    } catch (e) {
      console.error(`${relayId}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  process.exit(process.exitCode || 0);
})();
