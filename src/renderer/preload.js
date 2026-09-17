'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('diktera', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  models: {
    status: () => ipcRenderer.invoke('models:status'),
    install: (kind, name) => ipcRenderer.invoke('models:install', { kind, name }),
    remove: (name) => ipcRenderer.invoke('models:remove', { name }),
    onProgress: on('models:progress'),
  },
  llm: { status: () => ipcRenderer.invoke('llm:status') },
  perm: {
    status: () => ipcRenderer.invoke('perm:status'),
    request: (what) => ipcRenderer.invoke('perm:request', what),
  },
  open: {
    external: (url) => ipcRenderer.invoke('open:external', url),
    path: (p) => ipcRenderer.invoke('open:path', p),
    folder: (p) => ipcRenderer.invoke('open:folder', p),
    meeting: () => ipcRenderer.invoke('open:meeting'),
  },
  test: {
    dictate: () => ipcRenderer.invoke('test:dictate'),
    stop: () => ipcRenderer.invoke('test:stop'),
  },
  meeting: {
    start: () => ipcRenderer.invoke('meeting:start'),
    stop: () => ipcRenderer.invoke('meeting:stop'),
    cancel: () => ipcRenderer.invoke('meeting:cancel'),
    upload: () => ipcRenderer.invoke('meeting:upload'),
    summarize: (segments) => ipcRenderer.invoke('meeting:summarize', { segments }),
    chooseFolder: () => ipcRenderer.invoke('meeting:choose-folder'),
    save: (note, folder) => ipcRenderer.invoke('meeting:save', { note, folder }),
    discardAudio: (p) => ipcRenderer.invoke('meeting:discard-audio', p),
    onProgress: on('meeting:progress'),
    onLevel: on('meeting:level'),
    onError: on('meeting:error'),
  },
  overlay: { onState: on('overlay:state') },
  capture: {
    onCommand: on('capture:command'),
    sendChunk: (buf) => ipcRenderer.send('capture:chunk', buf),
    sendLevel: (v) => ipcRenderer.send('capture:level', v),
    sendError: (m) => ipcRenderer.send('capture:error', m),
  },
});
