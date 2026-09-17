'use strict';
// Bygger Obsidian-anteckningar (Markdown med YAML-frontmatter).

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function formatTimestamp(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

function formatDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return `${Math.round(sec)} s`;
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function yamlString(s) {
  return JSON.stringify(String(s ?? ''));
}

function yamlList(items) {
  if (!items || !items.length) return ' []';
  return '\n' + items.map((i) => `  - ${yamlString(i)}`).join('\n');
}

function safeFilename(name) {
  return String(name)
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Möte';
}

// data: { title, date(Date), durationSec, speakers[], segments[{start,end,speaker,text,lang}],
//         summary, decisions[], todos[{text, owner?}], languages[], audioPath?, consent, model, tags[] }
function buildMeetingNote(data) {
  const date = data.date instanceof Date ? data.date : new Date(data.date || Date.now());
  const title = (data.title || '').trim() || `Möte ${localDate(date)} ${localTime(date)}`;
  const languages = data.languages && data.languages.length ? data.languages : ['sv'];
  const tags = ['möte', 'transkript', ...(data.tags || [])];

  const fm = [
    '---',
    `title: ${yamlString(title)}`,
    `date: ${localDate(date)}`,
    `time: ${yamlString(localTime(date))}`,
    'type: meeting',
    'source: diktera',
    `duration: ${yamlString(formatDuration(data.durationSec || 0))}`,
    `languages:${yamlList(languages)}`,
    `speakers:${yamlList(data.speakers || [])}`,
    `consent_confirmed: ${data.consent ? 'true' : 'false'}`,
    `model: ${yamlString(data.model || 'whisper')}`,
    'processing: local',
    `tags:${yamlList(tags)}`,
  ];
  if (data.audioPath) fm.push(`audio: ${yamlString(data.audioPath)}`);
  fm.push('---');

  const lines = [...fm, '', `# ${title}`, ''];

  lines.push('## Sammanfattning', '', (data.summary || '').trim() || '_Ingen sammanfattning._', '');

  lines.push('## Beslut', '');
  if (data.decisions && data.decisions.length) for (const d of data.decisions) lines.push(`- ${String(d).trim()}`);
  else lines.push('_Inga beslut noterade._');
  lines.push('');

  lines.push('## Att göra', '');
  if (data.todos && data.todos.length) {
    for (const t of data.todos) {
      const text = typeof t === 'string' ? t : t.text;
      const owner = typeof t === 'object' && t.owner ? ` (${t.owner})` : '';
      lines.push(`- [ ] ${String(text).trim()}${owner}`);
    }
  } else lines.push('_Inga att-göra-punkter noterade._');
  lines.push('');

  lines.push('## Transkript', '');
  for (const s of data.segments || []) {
    lines.push(`**[${formatTimestamp(s.start)}] ${s.speaker}:** ${String(s.text).trim()}`, '');
  }

  const filename = `${localDate(date)} ${pad(date.getHours())}${pad(date.getMinutes())} ${safeFilename(title)}.md`;
  return { filename, content: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', title };
}

// Enkel text av transkriptet, används som underlag till sammanfattningen.
function transcriptAsText(segments) {
  return (segments || []).map((s) => `[${formatTimestamp(s.start)}] ${s.speaker}: ${String(s.text).trim()}`).join('\n');
}

module.exports = { buildMeetingNote, transcriptAsText, formatTimestamp, formatDuration, safeFilename };
