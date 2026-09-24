// Speaks prickikon som SVG i fönstren. Samma form som src/main/icon-art.js (appikon och menyrad).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const WAVE = [1, 3, 7, 11, 13, 9, 5, 3];
  const ROW = 5;
  const COLS = WAVE.length + ROW;

  // Ikonen i en ruta `size` px. fill: prickarnas färg. state: 'idle' | 'live' | 'type'.
  function svg(size, fill = '#000000', state = 'idle') {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', `0 0 ${size} ${size}`);
    s.setAttribute('fill', fill);
    s.setAttribute('aria-hidden', 'true');
    s.classList.add('speak-icon', state);
    const sp = (size * 0.98) / (COLS - 0.5);
    const r = sp * (size < 40 ? 0.42 : 0.3); // små ikoner får större prickar så att de syns
    const ox = size / 2 - ((COLS - 1) / 2) * sp;
    const add = (x, y, cls, style) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', (ox + x * sp).toFixed(2));
      c.setAttribute('cy', (size / 2 + y * sp).toFixed(2));
      c.setAttribute('r', r.toFixed(2));
      c.setAttribute('class', cls);
      if (style) c.setAttribute('style', style);
      s.appendChild(c);
    };
    WAVE.forEach((k, col) => {
      for (let j = 0; j < k; j++) {
        const y = j - (k - 1) / 2;
        add(col, y, `w k${Math.abs(y)}`, `animation-delay: -${(col * 0.13).toFixed(2)}s`);
      }
    });
    for (let j = 0; j < ROW; j++) add(WAVE.length + j, 0, 'row', `animation-delay: ${(j * 0.14).toFixed(2)}s`);
    return s;
  }
  function setState(el, state) {
    el.classList.remove('idle', 'live', 'type');
    el.classList.add(state);
  }

  // Nivåmätare av prickar: `cols` kolumner som rullar åt vänster, höjden följer ljudnivån.
  function meter(el, cols = 90, half = 3) {
    const s = document.createElementNS(NS, 'svg');
    const sp = 9, w = 8 + (cols - 1) * sp + 8, h = (half * 2) * sp + 18;
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    s.classList.add('dot-meter');
    s.setAttribute('aria-hidden', 'true');
    const grid = [];
    for (let i = 0; i < cols; i++) {
      const col = [];
      for (let j = -half; j <= half; j++) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', 8 + i * sp);
        c.setAttribute('cy', h / 2 + j * sp);
        c.setAttribute('r', 2.2);
        s.appendChild(c);
        col.push({ c, lvl: Math.abs(j) });
      }
      grid.push(col);
    }
    el.innerHTML = '';
    el.appendChild(s);
    const levels = new Array(cols).fill(0);
    const paint = () => grid.forEach((col, i) => {
      const amp = Math.round(Math.min(1, levels[i]) * half);
      for (const d of col) d.c.classList.toggle('on', d.lvl <= amp && (levels[i] > 0.02 || d.lvl === 0));
    });
    paint();
    return {
      push(level) { levels.shift(); levels.push(level); paint(); },
      reset() { levels.fill(0); paint(); },
    };
  }

  window.SpeakIcon = { svg, setState, meter };
})();
