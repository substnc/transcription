// Osynligt fönster som äger mikrofonen. Skickar rå PCM till huvudprocessen, inget annat.
let ctx = null;
let stream = null;
let node = null;
let running = false;
let meter = false;
let meterAcc = 0;
let meterN = 0;
let meterTimer = null;

async function start(withMeter) {
  if (running) return;
  running = true;
  meter = !!withMeter;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!running) return stop(); // stoppades innan mikrofonen hann öppnas
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('worklet.js');
    const src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
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
    src.connect(node);
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
  try { if (ctx) ctx.close(); } catch {}
  node = null;
  stream = null;
  ctx = null;
}

window.diktera.capture.onCommand((msg) => {
  if (msg.cmd === 'start') start(msg.meter);
  else if (msg.cmd === 'stop') stop();
});
