'use strict';
// Klient mot en lokal Ollama-server (http://127.0.0.1:11434). Inget lämnar datorn.

const { CLEANUP_SYSTEM, SUMMARY_SYSTEM, SUMMARY_SCHEMA, normalizeSummary } = require('./summarize');

const DEFAULT_HOST = 'http://127.0.0.1:11434';

function assertLocal(host) {
  const u = new URL(host);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) {
    throw new Error(`Språkmodellen måste köras lokalt. Vägrar kontakta ${u.hostname}.`);
  }
}

async function request(host, path, body, timeoutMs) {
  assertLocal(host);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama svarade ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function available(host = DEFAULT_HOST) {
  try {
    const r = await request(host, '/api/tags', null, 1500);
    return { ok: true, models: (r.models || []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}

async function chat({ host = DEFAULT_HOST, model, system, user, format, timeoutMs = 120000, temperature = 0.2 }) {
  const r = await request(host, '/api/chat', {
    model,
    stream: false,
    format,
    options: { temperature },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }, timeoutMs);
  return (r.message && r.message.content) || '';
}

async function cleanupText(text, { host, model, timeoutMs } = {}) {
  const out = await chat({ host, model, system: CLEANUP_SYSTEM, user: text, timeoutMs: timeoutMs || 60000 });
  const t = out.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
  // Skydd mot att modellen svarar med något helt annat eller tom text.
  if (!t || t.length < text.length * 0.3 || t.length > text.length * 2.5) return null;
  return t;
}

async function summarize(transcriptText, { host, model, timeoutMs } = {}) {
  const out = await chat({ host, model, system: SUMMARY_SYSTEM, user: transcriptText, format: SUMMARY_SCHEMA, timeoutMs: timeoutMs || 300000, temperature: 0.1 });
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    const m = out.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }
  return normalizeSummary(parsed);
}

module.exports = { DEFAULT_HOST, available, chat, cleanupText, summarize, assertLocal };
