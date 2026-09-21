// Osynligt fönster som äger mikrofonen. Skickar rå PCM till huvudprocessen, inget annat.
let ctx = null;
let stream = null;
let sysStream = null;
let node = null;
let running = false;
let meter = false;
let meterAcc = 0;
let meterN = 0;
let meterTimer = null;

// Datorns eget ljud (videomöten) via skärminspelning. Fungerar på macOS 14.2+ med
// skärminspelningsbehörighet. Videospåret slängs direkt, bara ljudet används.
async function openSystemAudio() {
  const id = await window.diktera.capture.screenSource();
  if (!id) throw new Error('ingen skärmkälla');
  const s = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 2, maxHeight: 2, maxFrameRate: 1 } },
  });
  s.getVideoTracks().forEach((t) => t.stop());
  if (!s.getAudioTracks().length) { s.getTracks().forEach((t) => t.stop()); throw new Error('inget ljudspår'); }
  return s;
}

async function start(withMeter, withSystemAudio, withMic = true) {
  if (running) return;
  running = true;
  meter = !!withMeter;
  try {
    if (withMic) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!running) return stop(); // stoppades innan mikrofonen hann öppnas
    }
    let systemAudio = false;
    if (withSystemAudio) {
      try { sysStream = await openSystemAudio(); systemAudio = true; } catch (e) { console.warn('Systemljud gick inte:', e.message); }
      if (!running) return stop();
    }
    if (!stream && !sysStream) throw new Error('Ingen ljudkälla gick att öppna');
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('worklet.js');
    node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
    const src = stream ? ctx.createMediaStreamSource(stream) : null;
    if (sysStream) {
      // Två källor in på samma ingång summeras av Web Audio. Dämpa lite så summan inte klipper.
      const sysSrc = ctx.createMediaStreamSource(sysStream);
      const gain = ctx.createGain(); gain.gain.value = 0.8;
      sysSrc.connect(gain); gain.connect(node);
    }
    if (meter) window.diktera.capture.sendInfo({ systemAudio, mic: !!stream, wantedSystem: !!withSystemAudio });
    node.port.onmessage = (e) => {
      if (!running) return;
      if (meter) {
        const f = new Float32Array(e.data);
        let s = 0;
        for (let i = 0; i < f.length; i++) s += f[i] * f[i];
        meterAcc += Math.sqrt(s / f.length);
        meterN++;
      }
      window.diktera.capture.sendChunk(e.data);
    };
    if (src) src.connect(node);
    node.connect(ctx.destination);
    if (meter) meterTimer = setInterval(() => {
      if (meterN) window.diktera.capture.sendLevel(Math.min(1, (meterAcc / meterN) * 6));
      meterAcc = 0;
      meterN = 0;
    }, 120);
  } catch (e) {
    running = false;
    window.diktera.capture.sendError(e.message || String(e));
    stop();
  }
}

function stop() {
  running = false;
  clearInterval(meterTimer);
  meterTimer = null;
  try { if (node) { node.port.onmessage = null; node.disconnect(); } } catch {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (sysStream) sysStream.getTracks().forEach((t) => t.stop()); } catch {}
  sysStream = null;
  try { if (ctx) ctx.close(); } catch {}
  node = null;
  stream = null;
  ctx = null;
}

window.diktera.capture.onCommand((msg) => {
  if (msg.cmd === 'start') start(msg.meter, msg.systemAudio, msg.mic !== false);
  else if (msg.cmd === 'stop') stop();
});
