'use strict';
// Regelbaserad textstädning. Används alltid som grund och som reserv när ingen lokal språkmodell körs.

// Rena tvekljud på svenska och engelska. Riktiga ord som "liksom" och "typ" lämnas i fred.
const FILLERS = /(?<!\p{L})(?:e+h+m*|ö+h+m*|hmm+|mm+|u+h+m*|u+m+|erm+|a+h+)(?!\p{L})[,.]?\s*/giu;

// Kända whisper-hallucinationer på tystnad eller brus.
const HALLUCINATIONS = [
  /undertexter/i, /textning/i, /amara\.org/i, /tack för att (du|ni) (tittade|lyssnade)/i,
  /thanks? (for|you for) (watching|listening)/i, /subtitles? by/i, /subscribe/i, /^\s*(\.|-|,|!|\?)*\s*$/,
  /www\./i, /^\s*(you|du)\s*\.?\s*$/i,
];

function isHallucination(text) {
  const t = (text || '').trim();
  if (!t) return true;
  if (HALLUCINATIONS.some((re) => re.test(t))) return true;
  // Samma korta tecken- eller ordsekvens upprepad många gånger.
  if (/(.{1,12}?)\1{4,}/.test(t)) return true;
  return false;
}

// Dikteringskommandon som uttalas som ord.
const COMMANDS = [
  [/[,.]?\s*\b(?:nytt stycke|new paragraph)\b[,.]?\s*/giu, '\n\n'],
  [/[,.]?\s*\b(?:ny rad|new line)\b[,.]?\s*/giu, '\n'],
];

function applyVoiceCommands(text) {
  let out = text;
  for (const [re, rep] of COMMANDS) out = out.replace(re, rep);
  return out;
}

function tidy(text) {
  let t = text;
  t = t.replace(/\s+([,.!?;:])/g, '$1'); // inget mellanslag före skiljetecken
  t = t.replace(/([,.!?;:])(?=[^\s\d"')\]\n])/g, '$1 '); // mellanslag efter skiljetecken
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/(?<!\p{L})(\p{L}+)(\s+\1(?!\p{L}))+/giu, '$1'); // "jag jag" -> "jag"
  t = t.replace(/([,.!?])\1+/g, '$1');
  t = t.replace(/\s*,\s*\./g, '.');
  t = t.trim();
  // Versal först i varje stycke och efter meningsslut.
  t = t.replace(/(^|[.!?]\s+|\n+)(\p{Ll})/gu, (m, pre, ch) => pre + ch.toUpperCase());
  return t;
}

function cleanup(text, opts = {}) {
  const { voiceCommands = true } = opts;
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.replace(FILLERS, '');
  if (voiceCommands) t = applyVoiceCommands(t);
  return tidy(t);
}

module.exports = { cleanup, tidy, isHallucination, applyVoiceCommands };
