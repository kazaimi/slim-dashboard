#!/usr/bin/env node
"use strict";

// slim-dashboard command line interface
//   slim-dashboard start                       run the dashboard server
//   slim-dashboard sync-token [--relay <id>]   harvest relay token from debug Chrome
//   slim-dashboard deploy --provider <id> --model <id> [--name n] [--context c] [--output o]

const path = require("path");
const { spawn } = require("node:child_process");
const { deployModel } = require("./scripts/deploy-opencode");

const ROOT = __dirname;
const args = process.argv.slice(2);
const command = args[0] || "start";

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

function resolveDefaultOpencodeConfig() {
  const fs = require("fs");
  const home = process.env.USERPROFILE || process.env.HOME || require("os").homedir();
  const jsonc = path.join(home, ".config", "opencode", "opencode.jsonc");
  if (fs.existsSync(jsonc)) return jsonc;
  const json = path.join(home, ".config", "opencode", "opencode.json");
  if (fs.existsSync(json)) return json;
  return jsonc;
}

function loadMainConfig() {
  const fs = require("fs");
  try {
    const user = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
    return {
      opencodeConfigPath: user.opencodeConfigPath || resolveDefaultOpencodeConfig(),
      relays: user.relays || {},
    };
  } catch {
    return {
      opencodeConfigPath: resolveDefaultOpencodeConfig(),
      relays: {},
    };
  }
}

switch (command) {
  case "start": {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
    break;
  }
  case "sync-token": {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "sync-token.js"), ...args.slice(1)], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
    break;
  }
  case "deploy": {
    const provider = flag("provider");
    const model = flag("model");
    if (!provider || !model) {
      console.error("usage: slim-dashboard deploy --provider <providerId> --model <modelId> [--name <displayName>] [--context <n>] [--output <n>] [--relay <relayId>]");
      process.exit(1);
    }
    const config = loadMainConfig();
    const relay = config.relays?.[flag("relay")] || Object.values(config.relays || {})[0];
    const result = deployModel(config.opencodeConfigPath || path.join(require("os").homedir(), ".config", "opencode", "opencode.jsonc"), provider, model, {
      name: flag("name"),
      context: flag("context") ? Number(flag("context")) : undefined,
      output: flag("output") ? Number(flag("output")) : undefined,
      providerTemplate: relay?.providerTemplate,
    });
    console.log(result.ok ? `OK: ${result.message}` : `FAILED: ${result.error}`);
    process.exit(result.ok ? 0 : 1);
    break;
  }
  default:
    console.error(`unknown command "${command}". available: start, sync-token, deploy`);
    process.exit(1);
}
