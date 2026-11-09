'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  parseUnreadCount,
  extractSenderFromTitle,
  formatNotificationText,
  resolveOmniboxInput,
  shouldTriggerUnreadNotification,
  totalUnreadCount,
} = require('./core.js');

const webviewPreloadUrl = pathToFileURL(path.join(__dirname, 'webview-preload.js')).toString();

contextBridge.exposeInMainWorld('chatHub', {
  getInitialState: () => ipcRenderer.invoke('state:init'),
  addService: (payload) => ipcRenderer.invoke('services:add', payload),
  removeService: (id) => ipcRenderer.invoke('services:remove', id),
  reorderServices: (fromId, toId) => ipcRenderer.invoke('services:reorder', { fromId, toId }),
  toggleService: (id) => ipcRenderer.invoke('services:toggle', id),
  setNotificationMode: (mode) => ipcRenderer.invoke('settings:setNotificationMode', mode),
  setWindowsOptions: (opts) => ipcRenderer.invoke('settings:setWindowsOptions', opts),
  openUblockDashboard: () => ipcRenderer.invoke('extensions:openUblockDashboard'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  onWindowsOptionsChanged: (cb) =>
    ipcRenderer.on('settings:windowsOptionsChanged', (_e, opts) => cb(opts)),
  onWindowVisibilityChanged: (cb) =>
    ipcRenderer.on('window:visibility', (_e, payload) => cb(payload)),
  clearServiceSession: (partition) => ipcRenderer.invoke('session:clear', partition),
  setAppBadge: (count) => ipcRenderer.send('app:badge', count),
  notify: (payload) => ipcRenderer.send('app:notify', payload),
  onActivateService: (cb) => ipcRenderer.on('service:activate', (_e, serviceId) => cb(serviceId)),
  getWebviewPreloadUrl: () => webviewPreloadUrl,
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  parseUnreadCount: (title) => parseUnreadCount(title),
  extractSenderFromTitle: (title) => extractSenderFromTitle(title),
  formatNotificationText: (mode, opts) => formatNotificationText(mode, opts),
  resolveOmniboxInput: (input) => resolveOmniboxInput(input),
  shouldTriggerUnreadNotification: (prev, next, dnd) =>
    shouldTriggerUnreadNotification(prev, next, dnd),
  totalUnreadCount: (unreadMap) => totalUnreadCount(unreadMap),
});
