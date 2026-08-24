"use strict";

// One-click deployment of a relay model into opencode.jsonc.
// Strategy: targeted text insertion so existing comments survive.
// Every write is validated (comment-stripped JSON.parse) and backed up to .bak.

const fs = require("fs");

function stripForParse(src) {
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
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function parseConfig(raw) {
  return JSON.parse(stripForParse(raw));
}

function titleize(modelId) {
  return modelId
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function envKeyFor(providerTemplate, providerId) {
  const prefix = providerTemplate?.apiKeyEnvPrefix || "";
  return `${prefix}${providerId.replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

function buildProviderBlock(providerId, modelId, opts) {
  const t = opts.providerTemplate || {};
  const name = opts.providerName || providerId;
  const modelName = opts.modelName || titleize(modelId);
  const limit = {
    context: opts.context || t.defaults?.context || 128000,
    output: opts.output || t.defaults?.output || 8192,
  };
  const apiKey = opts.apiKey || `{env:${envKeyFor(t, providerId)}}`;
  const baseURL = opts.baseURL || t.baseURL || "https://example-relay.example/v1";
  const indent = opts.indent || "    ";
  const lines = [
    `${indent}"${providerId}": {`,
    `${indent}  "name": "${name}",`,
    `${indent}  "npm": "${t.npm || "@ai-sdk/openai"}",`,
    `${indent}  "options": {`,
    `${indent}    "baseURL": "${baseURL}",`,
    `${indent}    "apiKey": "${apiKey}"`,
    `${indent}  },`,
    `${indent}  "models": {`,
    `${indent}    "${modelId}": {`,
    `${indent}      "name": "${modelName}",`,
    `${indent}      "limit": {`,
    `${indent}        "context": ${limit.context},`,
    `${indent}        "output": ${limit.output}`,
    `${indent}      }`,
    `${indent}    }`,
    `${indent}  }`,
    `${indent}},`,
  ];
  return lines.join("\n") + "\n";
}

function buildModelBlock(modelId, opts) {
  const modelName = opts.modelName || titleize(modelId);
  const context = opts.context || 128000;
  const output = opts.output || 8192;
  const indent = opts.indent || "        ";
  const lines = [
    `${indent}"${modelId}": {`,
    `${indent}  "name": "${modelName}",`,
    `${indent}  "limit": {`,
    `${indent}    "context": ${context},`,
    `${indent}    "output": ${output}`,
    `${indent}  }`,
    `${indent}},`,
  ];
  return lines.join("\n") + "\n";
}

/**
 * Deploy a model into an opencode.jsonc file.
 * Returns { ok, created, message } - never throws for expected failures.
 */
function deployModel(filePath, providerId, modelId, opts = {}) {
  if (!fs.existsSync(filePath)) return { ok: false, error: "opencode config not found: " + filePath };
  const raw = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath + ".bak", raw, "utf8");

  try {
    parseConfig(raw);
  } catch (e) {
    return { ok: false, error: `target config is not valid JSONC: ${e.message}` };
  }

  let updated;
  let created = false;
  const providerRe = new RegExp(`"${providerId}"\\s*:\\s*\\{`);
  const providerMatch = raw.match(providerRe);

  if (providerMatch) {
    // Provider exists -> insert the model into its models block (or report present).
    const start = providerMatch.index;
    const modelsIdx = raw.indexOf('"models"', start);
    const braceIdx = raw.indexOf("{", modelsIdx === -1 ? start : modelsIdx);
    const alreadyHasModel = raw.slice(start, braceIdx === -1 ? raw.length : Math.max(braceIdx, start)).length > 0 &&
      new RegExp(`"${modelId}"\\s*:\\s*\\{`).test(raw.slice(start));
    if (alreadyHasModel) {
      return { ok: true, created: false, message: `"${modelId}" is already configured under ${providerId}` };
    }
    if (modelsIdx === -1 || braceIdx === -1) {
      return { ok: false, error: `provider ${providerId} has no "models" block` };
    }
    const lineStart = raw.lastIndexOf("\n", braceIdx) + 1;
    const indent = raw.slice(lineStart, braceIdx).replace(/\{/, "") + "  ";
    const block = "\n" + buildModelBlock(modelId, { ...opts, indent });
    updated = raw.slice(0, braceIdx + 1) + block + raw.slice(braceIdx + 1);
  } else {
    // Create the whole provider right after "provider": {
    const rootMatch = raw.match(/"provider"\s*:\s*\{/);
    if (!rootMatch) return { ok: false, error: 'no "provider" object found in target config' };
    const insertAt = rootMatch.index + rootMatch[0].length;
    const block = "\n" + buildProviderBlock(providerId, modelId, opts);
    updated = raw.slice(0, insertAt) + block + raw.slice(insertAt);
    created = true;
  }

  try {
    parseConfig(updated);
  } catch (e) {
    return { ok: false, error: `resulting config failed validation: ${e.message}` };
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return {
    ok: true,
    created,
    message: created
      ? `created provider ${providerId} with model ${modelId}`
      : `added ${modelId} to existing provider ${providerId}`,
  };
}

module.exports = { deployModel, stripForParse, parseConfig };
