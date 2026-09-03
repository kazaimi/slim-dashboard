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

const WORD_MAP = {
  gpt: "GPT",
  claude: "Claude",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  qwq: "QwQ",
  grok: "Grok",
  glm: "GLM",
  kimi: "Kimi",
  moonshot: "Moonshot",
  minimax: "MiniMax",
  mimo: "MiMo",
  llama: "LLaMA",
  mistral: "Mistral",
  yi: "Yi",
  baichuan: "Baichuan",
  hunyuan: "Hunyuan",
  ernie: "ERNIE",
  dall: "DALL",
  tts: "TTS",
  asr: "ASR",
  r1: "R1",
  v1: "V1",
  v2: "V2",
  v3: "V3",
  v4: "V4",
  pro: "Pro",
  flash: "Flash",
  lite: "Lite",
  mini: "mini",
  turbo: "Turbo",
  plus: "Plus",
  max: "Max",
  ultra: "Ultra",
  vision: "Vision",
  thinking: "Thinking",
  thought: "Thinking",
  coder: "Coder",
  chat: "Chat",
  instruct: "Instruct",
  preview: "Preview",
  latest: "Latest",
};

function formatModelName(modelId) {
  if (!modelId) return "";
  const raw = String(modelId).trim();
  const lower = raw.toLowerCase();
  if (KNOWN_MODEL_NAMES[lower]) return KNOWN_MODEL_NAMES[lower];

  let base = raw;
  const dateSuffixMatch = base.match(/^(.+?)[-_](20\d{6})$/);
  if (dateSuffixMatch) {
    base = dateSuffixMatch[1];
  }

  const tokens = base.split(/[-_/ ]+/).filter(Boolean);
  const formattedTokens = tokens.map((tok) => {
    if (/^\d+-\d+$/.test(tok)) return tok.replace("-", ".");
    const tokLower = tok.toLowerCase();
    if (WORD_MAP[tokLower]) return WORD_MAP[tokLower];
    if (/^o\d(-mini|-preview)?$/i.test(tok)) return tok.toLowerCase();
    return /^\d/.test(tok) ? tok : tok[0].toUpperCase() + tok.slice(1);
  });

  let joined = formattedTokens.join(" ");
  joined = joined.replace(/\b(Claude|Gemini|GPT)\s+(\d+)\s+(\d+)\b/gi, "$1 $2.$3");
  joined = joined.replace(/\bDeepseek\b/gi, "DeepSeek");
  return joined;
}

function titleize(modelId) {
  return formatModelName(modelId);
}

function envKeyFor(providerTemplate, providerId) {
  const prefix = providerTemplate?.apiKeyEnvPrefix || "";
  return `${prefix}${providerId.replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

function buildProviderBlock(providerId, modelId, opts) {
  const t = opts.providerTemplate || {};
  const name = opts.providerName || providerId;
  const modelName = opts.modelName || formatModelName(modelId);
  const limit = {
    context: opts.context || t.defaults?.context || 128000,
    output: opts.output || t.defaults?.output || 8192,
  };
  let apiKey = opts.apiKey || `{env:${envKeyFor(t, providerId)}}`;
  if (typeof apiKey === "object" && apiKey !== null) {
    apiKey = apiKey.key || `{env:${envKeyFor(t, providerId)}}`;
  }
  const baseURL = opts.baseURL || t.baseURL || "https://example-relay.example/v1";
  const indent = opts.indent || "    ";
  const lines = [
    `${indent}"${providerId}": {`,
    `${indent}  "name": "${name}",`,
    `${indent}  "npm": "${t.npm || "@ai-sdk/openai-compatible"}",`,
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
    const lineIndent = raw.slice(lineStart, braceIdx).match(/^\s*/)?.[0] || "";
    const indent = lineIndent + "  ";
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

/**
 * Keep the provider's {env:...} apiKey placeholder intact. The key is
 * resolved at runtime and must not be written to opencode.jsonc.
 */
function ensureProviderApiKey(filePath, providerId, apiKey) {
  if (!apiKey) return { changed: false };
  if (!fs.existsSync(filePath)) return { changed: false };
  const keyStr = typeof apiKey === "object" && apiKey !== null ? apiKey.key : apiKey;
  if (!keyStr) return { changed: false };
  const raw = fs.readFileSync(filePath, "utf8");
  const providerRe = new RegExp(`"${providerId}"\\s*:\\s*\\{`);
  const m = raw.match(providerRe);
  if (!m) return { changed: false };
  const start = m.index;
  const nextProvider = raw.slice(start + 1).search(new RegExp(`\\n\\s{4}"`));
  const blockEnd = nextProvider === -1 ? raw.length : start + 1 + nextProvider;
  const block = raw.slice(start, blockEnd);
  const keyRe = /("apiKey"\s*:\s*")(\[object Object\]|\{env:[^"]*\}|[^"]*)(")/;
  if (!keyRe.test(block)) return { changed: false };
  const updatedBlock = block.replace(keyRe, `$1${keyStr}$3`);
  const updated = raw.slice(0, start) + updatedBlock + raw.slice(blockEnd);
  try { parseConfig(updated); } catch (e) { return { changed: false, error: e.message }; }
  fs.writeFileSync(filePath, updated, "utf8");
  return { changed: true };
}

module.exports = { deployModel, ensureProviderApiKey, stripForParse, parseConfig, formatModelName };
