"use strict";

// Relay announcement/notice fetching.
// new-api panels expose GET /api/notice -> { data: "<html|md>" }.
// GeiliAPI exposes GET /api/v1/announcements (Bearer auth).
// Response shapes vary; extractText() normalises everything to plain text.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { resolveEnvChain } = require("./discover-relay");

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractText(json) {
  if (json == null) return "";
  if (typeof json === "string") return stripHtml(json);
  const d = json.data ?? json.message ?? json.content;
  if (typeof d === "string") return d.trim() ? stripHtml(d) : "";
  const list = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : null;
  if (list) {
    const parts = list
      .map((it) => {
        const title = typeof it === "string" ? it : it?.title || "";
        const body = typeof it === "string" ? "" : it?.content || it?.body || "";
        return [title, body].filter(Boolean).join("\n");
      })
      .filter(Boolean);
    return stripHtml(parts.join("\n\n"));
  }
  if (d && typeof d === "object") {
    const nested = d.content ?? d.text ?? d.notice;
    if (typeof nested === "string" && nested.trim()) return stripHtml(nested);
  }
  return "";
}

async function fetchRelayNotice(relay) {
  const base = relay.apiBase || relay.baseURL;
  const token = resolveEnvChain(relay.tokenEnv);
  const attempts = [];
  if ((relay.type || "") === "geiliapi") {
    attempts.push({ url: `${base}/api/v1/announcements`, auth: true });
  }
  attempts.push({ url: `${base}/api/notice`, auth: false });

  let lastError = "no notice endpoint responded";
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        headers: attempt.auth && token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) { lastError = `${attempt.url.replace(base, "")} -> http_${res.status}`; continue; }
      const json = await res.json().catch(() => null);
      const text = extractText(json);
      if (text) return { ok: true, text };
      lastError = `${attempt.url.replace(base, "")} returned empty notice`;
    } catch (e) {
      lastError = `${e.message}`;
    }
  }
  return { ok: false, error: lastError };
}

class NoticeStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.memory = new Map(); // relayId -> { fetchedAt, result }
    this.disk = this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (raw && typeof raw === "object") return raw;
    } catch {}
    return {};
  }

  save() {
    try { fs.writeFileSync(this.filePath, JSON.stringify(this.disk, null, 2), "utf8"); } catch {}
  }

  async get(relayId, relay, ttlMs = 5 * 60 * 1000) {
    const mem = this.memory.get(relayId);
    if (mem && Date.now() - mem.fetchedAt < ttlMs) return mem.result;

    const result = await fetchRelayNotice(relay);
    const now = new Date().toISOString();
    const out = { ok: result.ok, text: result.text || "", error: result.error };

    if (result.ok) {
      const hash = sha1(result.text);
      const prev = this.disk[relayId] || {};
      out.updatedAt = now;
      if (prev.hash && prev.hash !== hash) {
        out.changedAt = now;
        out.justChanged = true;
      } else if (prev.changedAt) {
        out.changedAt = prev.changedAt;
      }
      if (!prev.hash || prev.hash !== hash) {
        out.justChanged = true;
        prev.history = [{ at: now, excerpt: result.text.slice(0, 300).replace(/\s+/g, " ") }, ...(prev.history || [])].slice(0, 10);
      }
      prev.hash = hash;
      prev.text = result.text;
      prev.updatedAt = now;
      prev.changedAt = out.changedAt || prev.changedAt || now;
      prev.history = prev.history || [];
      this.disk[relayId] = prev;
      this.save();
      out.history = prev.history;
    } else {
      // Fall back to the last known notice so the UI keeps showing something.
      const prev = this.disk[relayId];
      if (prev?.text) {
        out.ok = true;
        out.text = prev.text;
        out.updatedAt = prev.updatedAt;
        out.history = prev.history || [];
        out.stale = true;
        out.error = result.error;
      }
    }

    this.memory.set(relayId, { fetchedAt: Date.now(), result: out });
    return out;
  }
}

module.exports = { NoticeStore, fetchRelayNotice, extractText };
