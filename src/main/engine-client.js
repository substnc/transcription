'use strict';
// Startar motorn som en egen process (utilityProcess) och pratar RPC med den.
const { utilityProcess } = require('electron');
const path = require('path');
const EventEmitter = require('events');

class EngineClient extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = new Map();
    this.n = 0;
    this.ready = null;
  }

  start() {
    if (this.proc) return this.ready;
    const entry = path.join(__dirname, '..', 'engine', 'server.js');
    this.proc = utilityProcess.fork(entry, [], { serviceName: 'diktera-engine', stdio: 'inherit' });
    this.ready = new Promise((resolve) => {
      this.proc.on('message', (m) => {
        if (m && m.ready) return resolve();
        const p = this.pending.get(m.id);
        if (!p) return;
        if (m.progress) return p.onProgress && p.onProgress(m.progress);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      });
    });
    this.proc.on('exit', (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`Motorn avslutades (kod ${code})`));
      this.pending.clear();
      this.proc = null;
      this.ready = null;
      this.emit('exit', code);
    });
    return this.ready;
  }

  async call(method, params = {}, onProgress) {
    await this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.n;
      this.pending.set(id, { resolve, reject, onProgress });
      this.proc.postMessage({ id, method, params });
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

module.exports = { EngineClient };
