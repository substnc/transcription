// Statuspillret vid diktering. Prickikonen andas medan du pratar och "skriver" medan texten tas fram.
const icon = window.SpeakIcon.svg(24, '#ffffff', 'live');
icon.style.display = 'block';
document.getElementById('icon').appendChild(icon);

const ICON_STATE = { listening: 'live', processing: 'type' };
window.diktera.overlay.onState(({ state, text }) => {
  const pill = document.getElementById('pill');
  pill.className = `pill ${state}`;
  window.SpeakIcon.setState(icon, ICON_STATE[state] || 'idle');
  document.getElementById('text').textContent = text || '';
});
