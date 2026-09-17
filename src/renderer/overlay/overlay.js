window.diktera.overlay.onState(({ state, text }) => {
  const pill = document.getElementById('pill');
  pill.className = `pill ${state}`;
  document.getElementById('text').textContent = text || '';
});
