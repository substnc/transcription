'use strict';
// Startar motorn som en egen process (utilityProcess) och pratar RPC med den.
const { utilityProcess } = require('electron');
const path = require('path');
const EventEmitter = require('events');

const fs = require('fs');

class EngineClient extends EventEmitter {
  constructor(logFile) {
    super();
    this.logFile = logFile;
    this.proc = null;
    this.pending = new Map();
    this.n = 0;
    this.ready = null;
  }

  start() {
    if (this.proc) return this.ready;
    const entry = path.join(__dirname, '..', 'engine', 'server.js');
    this.proc = utilityProcess.fork(entry, [], { serviceName: 'diktera-engine', stdio: 'pipe' });
    // Allt motorn skriver hamnar i en loggfil så att krascher går att felsöka.
    if (this.logFile) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      const out = fs.createWriteStream(this.logFile, { flags: 'a' });
      out.write(`\n===== motor startad ${new Date().toISOString()} =====\n`);
      this.proc.stdout.on('data', (d) => out.write(d));
      this.proc.stderr.on('data', (d) => out.write(d));
      this.proc.on('exit', (code) => out.end(`===== motor avslutad, kod ${code} =====\n`));
    }
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
      const tail = this.logTail();
      for (const p of this.pending.values()) p.reject(new Error(`Motorn kraschade (kod ${code}). ${tail}`));
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

  logTail() {
    try {
      const lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n').filter((l) => !/^=====/.test(l));
      const last = lines.slice(-4).join(' | ').slice(-400);
      return last ? `Senaste loggrader: ${last} (hela loggen: ${this.logFile})` : `Se loggen: ${this.logFile}`;
    } catch {
      return '';
    }
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

module.exports = { EngineClient };
