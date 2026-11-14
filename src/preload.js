'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('grab', {
  info: call('info'),
  catalog: call('catalog'),
  refreshCatalog: call('catalog:refresh'),
  search: call('search'),
  get: call('get'),
  install: call('install'),
  update: call('update'),
  installUrl: call('url'),
  cancel: call('cancel'),
  resume: call('resume'),
  dismiss: call('dismiss'),
  jobs: call('jobs'),
  scan: call('scan'),
  uninstall: call('uninstall'),
  open: call('open'),
  openPath: call('openPath'),
  reveal: call('reveal'),
  external: call('external'),
  icon: call('icon'),
  selfCheck: call('self:check'),
  selfApply: call('self:apply'),
  ready: call('ready'),
  onCatalog: on('catalog'),
  onJob: on('job'),
  onScan: on('scan'),
  onSelf: on('self'),
  onSelfProgress: on('self-progress'),
});
