'use strict';
// Röktest: startar appen på riktigt, öppnar fönstren, kör en transkribering och avslutar.
// Körs med DIKTERA_SMOKE=1 (och DIKTERA_MODELS_DIR / DIKTERA_TEST_WAV för hela kedjan).
const { app, webContents } = require('electron');

module.exports = async function smoke({ engine, openMeeting, openSettings, transcribeMeeting, startDictation, stopDictation, wins }) {
  const errors = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const watch = (wc) => wc.on('console-message', (e) => { if (e.level === 'error') errors.push(`[renderer ${wc.id}] ${e.message}`); });
  app.on('web-contents-created', (_e, wc) => watch(wc));
  webContents.getAllWebContents().forEach(watch);

  try {
    const st = await engine.call('status');
    console.log('SMOKE status', JSON.stringify({ vad: st.aux.vad.installed, whisper: Object.entries(st.whisper).filter(([, m]) => m.installed).map(([n]) => n) }));

    openMeeting();
    openSettings();
    await sleep(2500);
    const w = wins();
    for (const [name, win] of Object.entries(w)) {
      if (!win || win.isDestroyed()) throw new Error(`fönstret ${name} saknas`);
      const title = await win.webContents.executeJavaScript('document.title');
      const hasApi = await win.webContents.executeJavaScript('typeof window.diktera === "object"');
      console.log(`SMOKE fönster ${name}: "${title}" api=${hasApi}`);
      if (!hasApi) throw new Error(`preload saknas i ${name}`);
    }
    // Inställningsfönstret ska ha renderat modellistan.
    const rows = await w.settingsWin.webContents.executeJavaScript('document.querySelectorAll("#whisperList .model").length');
    console.log('SMOKE modellrader', rows);
    if (rows < 5) throw new Error('modellistan renderades inte');

    // Dikteringsflödet utan mikrofon: start/stop ska inte krascha.
    await startDictation();
    await sleep(300);
    await stopDictation();

    if (process.env.DIKTERA_TEST_WAV) {
      await engine.call('configure', { whisper: process.env.DIKTERA_SMOKE_WHISPER || 'tiny' });
      // Diktering med riktigt ljud genom samma väg som mikrofonen: Float32Array till motorn, sedan urklipp.
      const { readWav } = require('../engine/audio');
      const { pasteText } = require('./paste');
      const slice = readWav(process.env.DIKTERA_TEST_WAV).samples.subarray(16000 * 9, 16000 * 16);
      const d = await engine.call('dictate', { samples: slice, policy: { language: 'en' }, useLlm: false, voiceCommands: true });
      console.log('SMOKE diktering', JSON.stringify(d));
      if (!/deliver/i.test(d.text)) throw new Error('dikteringen gav fel text');
      console.log('SMOKE paste', await pasteText(d.text, { autoPaste: true, restoreClipboard: true }));
      const r = await transcribeMeeting(process.env.DIKTERA_TEST_WAV, { speakerCount: 2 });
      console.log('SMOKE möte', JSON.stringify({ speakers: r.speakers, segments: r.segments.length, languages: r.languages, by: r.summary.by }));
      if (r.speakers.length < 1 || !r.segments.length) throw new Error('transkriberingen gav inget');
      // Skicka resultatet till mötesfönstret och läs av att det renderas.
      await w.meetingWin.webContents.executeJavaScript(`(${String((res) => { window.__r = res; })})(${JSON.stringify(r)})`);
      await w.meetingWin.webContents.executeJavaScript('showResult(window.__r)');
      await sleep(500);
      const segs = await w.meetingWin.webContents.executeJavaScript('document.querySelectorAll("#segments .seg").length');
      const inboxes = await w.meetingWin.webContents.executeJavaScript('document.querySelectorAll("#inboxes .radio").length');
      console.log('SMOKE mötesfönster segment', segs, 'inkorgar', inboxes);
      if (segs !== r.segments.length || inboxes !== 2) throw new Error('mötesfönstret renderade fel');
      if (process.env.DIKTERA_SMOKE_SHOTS) {
        const fs = require('fs');
        for (const [name, win] of Object.entries(w)) {
          if (name === 'captureWin') continue;
          const img = await win.webContents.capturePage();
          fs.writeFileSync(require('path').join(process.env.DIKTERA_SMOKE_SHOTS, `${name}.png`), img.toPNG());
        }
      }
    }
    // Mikrofonfel förväntas här (ingen mikrofon i testmiljön); allt annat är fel.
    const real = errors.filter((e) => !/Mikrofonfel|getUserMedia|NotFoundError|Requested device not found|NotAllowedError/i.test(e));
    if (real.length) throw new Error('renderer-fel:\n' + real.join('\n'));
    console.log('SMOKE OK');
    app.exit(0);
  } catch (e) {
    console.error('SMOKE FAIL', e.stack || e.message, errors);
    app.exit(1);
  }
};
