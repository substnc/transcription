'use strict';
// Klient mot en lokal Ollama-server (http://127.0.0.1:11434). Inget lämnar datorn.

const { CLEANUP_SYSTEM, SUMMARY_SYSTEM, SUMMARY_SCHEMA, CORRECT_SYSTEM, CORRECT_SCHEMA, normalizeSummary } = require('./summarize');

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

// numCtx: hur mycket text modellen ser på en gång. Ollamas standard är liten (ett par tusen ord), så ett
// långt möte måste få större kontext, annars läser modellen bara början.
async function chat({ host = DEFAULT_HOST, model, system, user, format, timeoutMs = 120000, temperature = 0.2, numCtx }) {
  const r = await request(host, '/api/chat', {
    model,
    stream: false,
    format,
    options: numCtx ? { temperature, num_ctx: numCtx } : { temperature },
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

// Ungefär så mycket text som får plats i ett anrop (32 000 tokens kontext, med marginal för svaret).
const SUMMARY_CHUNK_CHARS = 60000;

async function summarizeOnce(text, { host, model, timeoutMs }) {
  const out = await chat({ host, model, system: SUMMARY_SYSTEM, user: text, format: SUMMARY_SCHEMA, timeoutMs: timeoutMs || 600000, temperature: 0.1, numCtx: 32768 });
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    const m = out.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }
  return normalizeSummary(parsed);
}

// Delar texten vid radbrytningar i bitar om högst `max` tecken.
function splitText(text, max) {
  const parts = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    if (cur && cur.length + line.length + 1 > max) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) parts.push(cur);
  return parts;
}

// Korta möten sammanfattas i ett anrop. Långa möten sammanfattas del för del, och delarna sammanfattas
// sedan till en helhet. Beslut och att göra samlas från alla delar.
// Korrläser rader ur ett mötestranskript i sitt sammanhang. lines: [{ speaker, text }] att rätta,
// context: raderna strax före (rättas inte). Svarar med lika många rader, eller null om svaret inte går
// att lita på (fel antal rader, eller en rad som ändrats för mycket).
async function correctLines(lines, { context = [], vocabulary = '', topic = '', host, model, timeoutMs } = {}) {
  const parts = [];
  if (topic) parts.push(`Mötets ämne: ${topic}`);
  if (vocabulary) parts.push(`Ordlista (namn och facktermer som kan förekomma): ${vocabulary}`);
  if (context.length) parts.push('Sammanhang, rättas inte:\n' + context.map((l) => `${l.speaker}: ${l.text}`).join('\n'));
  parts.push('Rader att rätta:\n' + lines.map((l, i) => `${i + 1}. ${l.speaker}: ${l.text}`).join('\n'));
  const out = await chat({ host, model, system: CORRECT_SYSTEM, user: parts.join('\n\n'), format: CORRECT_SCHEMA, timeoutMs: timeoutMs || 120000, temperature: 0.1, numCtx: 8192 });
  let parsed;
  try { parsed = JSON.parse(out); } catch { return null; }
  const got = parsed && Array.isArray(parsed.lines) ? parsed.lines.map((s) => String(s || '').trim()) : null;
  if (!got || got.length !== lines.length) return null;
  return got.map((t, i) => {
    // Ta bort ett eventuellt "3. Talare 1:" som modellen upprepat, och skydda mot helt omskrivna rader.
    const clean = t.replace(/^\d+\.\s*/, '').replace(new RegExp(`^${lines[i].speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\s*`), '').trim();
    const orig = lines[i].text;
    return clean && clean.length > orig.length * 0.5 && clean.length < orig.length * 1.6 ? clean : orig;
  });
}

async function summarize(transcriptText, { host, model, timeoutMs, onProgress } = {}) {
  const parts = splitText(transcriptText, SUMMARY_CHUNK_CHARS);
  if (parts.length <= 1) return summarizeOnce(transcriptText, { host, model, timeoutMs });
  const partial = [];
  for (let i = 0; i < parts.length; i++) {
    if (onProgress) onProgress({ done: i, total: parts.length + 1 });
    partial.push(await summarizeOnce(`Del ${i + 1} av ${parts.length} av ett längre möte.\n\n${parts[i]}`, { host, model, timeoutMs }));
  }
  if (onProgress) onProgress({ done: parts.length, total: parts.length + 1 });
  const joined = partial.map((p, i) => `Del ${i + 1}: ${p.summary}\nBeslut: ${p.decisions.join('; ')}\nAtt göra: ${p.todos.map((t) => (t.owner ? `${t.text} (${t.owner})` : t.text)).join('; ')}`).join('\n\n');
  const whole = await summarizeOnce(`Sammanfattningar av delarna i ett långt möte, i ordning. Gör en sammanfattning av hela mötet.\n\n${joined}`, { host, model, timeoutMs });
  const seen = new Set();
  const uniq = (arr, key) => arr.filter((x) => { const k = key(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    summary: whole.summary || partial.map((p) => p.summary).join(' '),
    decisions: uniq([...whole.decisions, ...partial.flatMap((p) => p.decisions)], (d) => d),
    todos: uniq([...whole.todos, ...partial.flatMap((p) => p.todos)], (t) => t.text),
  };
}

module.exports = { DEFAULT_HOST, available, chat, cleanupText, correctLines, summarize, splitText, assertLocal };
