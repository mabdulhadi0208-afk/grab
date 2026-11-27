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
  getMany: call('getMany'),
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
  updState: call('upd:state'),
  updCheck: call('upd:check'),
  updInstall: call('upd:install'),
  updCancel: call('upd:cancel'),
  meta: call('meta'),
  fav: call('fav'),
  packs: call('packs'),
  ready: call('ready'),
  access: call('access'),
  openAccess: call('access:open'),
  appearance: call('appearance'),
  onCatalog: on('catalog'),
  onJob: on('job'),
  onScan: on('scan'),
  onUpdater: on('updater'),
});
