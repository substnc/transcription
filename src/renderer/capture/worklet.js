// Tar emot mikrofon (ingång 0) och datorns ljud (ingång 1), blandar dem och skickar
// Float32-bitar (16 kHz, mono) till huvudprocessen.
//
// Ekoskydd utan hörlurar: när datorns ljud innehåller tal dämpas mikrofonen kraftigt,
// annars hör mikrofonen högtalarna och rösterna dubblas. Dämpningen släpper en stund
// efter att datorn tystnat, eftersom ekot når mikrofonen med liten fördröjning.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.hold = 0; // block kvar av efterhållning
    this.holdBlocks = Math.round((0.3 * sampleRate) / 128); // ~300 ms efter att datorn tystnat
    this.gain = 1; // aktuell mikrofonförstärkning
    this.threshold = 0.006; // under detta räknas datorn som tyst
    this.ducked = 0.04; // mikrofon när datorn talar (-28 dB)
    this.smooth = Math.exp(-1 / (sampleRate * 0.01)); // 10 ms mjukning per sample
  }
  process(inputs) {
    const mic = inputs[0] && inputs[0][0];
    const sys = inputs[1] && inputs[1][0];
    const len = (mic || sys || []).length;
    if (!len) return true;
    let sum = 0;
    if (sys) for (let i = 0; i < len; i++) sum += sys[i] * sys[i];
    const rms = sys ? Math.sqrt(sum / len) : 0;
    if (sys && rms > this.threshold) this.hold = this.holdBlocks;
    else if (this.hold > 0) this.hold--;
    const target = this.hold > 0 ? this.ducked : 1;
    for (let i = 0; i < len; i++) {
      this.gain = this.gain * this.smooth + target * (1 - this.smooth);
      let v = 0;
      if (mic) v += mic[i] * this.gain;
      if (sys) v += sys[i];
      this.buf[this.n++] = v > 1 ? 1 : v < -1 ? -1 : v;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Float32Array(2048);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
