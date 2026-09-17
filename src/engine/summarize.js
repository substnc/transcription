'use strict';
// Sammanfattning av möten: prompt till lokal språkmodell, samt en enkel regelbaserad reserv.

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    todos: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, owner: { type: 'string' } }, required: ['text'] },
    },
  },
  required: ['summary', 'decisions', 'todos'],
};

const SUMMARY_SYSTEM = `Du är en noggrann mötessekreterare. Du får ett transkript av ett möte med talare och tidsstämplar.
Svara ENBART med JSON enligt schemat. Skriv på samma språk som mötet huvudsakligen hålls på (svenska eller engelska).
- "summary": 3 till 8 meningar som beskriver vad mötet handlade om och vad som kom fram.
- "decisions": konkreta beslut som faktiskt fattades. Hitta inte på. Tom lista om inga beslut togs.
- "todos": konkreta uppgifter någon ska göra, med "owner" när det framgår vem. Tom lista om inga finns.
Var saklig och kort. Använd inga tidsstämplar i svaret.`;

const CLEANUP_SYSTEM = `Du städar dikterad text. Texten kan vara på svenska, engelska eller blandad.
Regler:
- Behåll språket exakt som det är, översätt inte, blanda inte in andra ord.
- Ta bort tvekljud (eh, öh, hmm, um) och omtagningar. Rätta uppenbara igenkänningsfel bara när det är entydigt.
- Fixa skiljetecken, versaler och styckeindelning. Behåll innebörden och tonen, lägg inte till något.
- Svara ENBART med den städade texten, utan förklaringar, citattecken eller rubriker.`;

function normalizeSummary(obj) {
  const out = { summary: '', decisions: [], todos: [] };
  if (!obj || typeof obj !== 'object') return out;
  out.summary = String(obj.summary || '').trim();
  out.decisions = (Array.isArray(obj.decisions) ? obj.decisions : []).map((d) => String(typeof d === 'object' && d ? d.text || '' : d).trim()).filter(Boolean);
  out.todos = (Array.isArray(obj.todos) ? obj.todos : [])
    .map((t) => (typeof t === 'string' ? { text: t.trim() } : { text: String(t && t.text || '').trim(), owner: t && t.owner ? String(t.owner).trim() : undefined }))
    .filter((t) => t.text);
  return out;
}

const DECISION_RE = /\b(beslut|beslutar|bestäm|bestämmer|bestämde|vi kör på|då säger vi|vi går på|överens|we decided|we agreed|agreed|let's go with|decision|final answer)\b/i;
const TODO_RE = /\b(ska|måste|tar hand om|fixar|skickar|bokar|kollar|återkommer|följer upp|will|needs? to|i'll|take care of|follow up|action item|todo|to do)\b/i;

// Reserv utan språkmodell: plockar meningar som låter som beslut eller uppgifter.
function heuristicSummary(segments) {
  const decisions = [];
  const todos = [];
  const sentences = [];
  for (const s of segments || []) {
    for (const sent of String(s.text).split(/(?<=[.!?])\s+/)) {
      const t = sent.trim();
      if (t.length < 12) continue;
      sentences.push(t);
      if (DECISION_RE.test(t)) decisions.push(t);
      else if (TODO_RE.test(t)) todos.push({ text: t, owner: s.speaker });
    }
  }
  const first = sentences.slice(0, 3).join(' ');
  const summary = sentences.length
    ? `Automatisk grovsammanfattning utan språkmodell. Mötet inleds: ${first}`
    : 'Inget tal hittades.';
  return { summary, decisions: decisions.slice(0, 15), todos: todos.slice(0, 20) };
}

module.exports = { SUMMARY_SCHEMA, SUMMARY_SYSTEM, CLEANUP_SYSTEM, normalizeSummary, heuristicSummary };
