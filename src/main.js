'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  screen,
  session,
  shell,
  webContents,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  DEFAULT_SERVICES,
  SERVICE_PRESETS,
  createServiceEntry,
  removeServiceEntry,
  reorderServiceEntries,
  toggleServiceEnabled,
  unwrapRedirectUrl,
  shouldOpenInAppPopup,
  shouldBlockAdRequest,
  GITHUB_UPDATE_API_URL,
  GITHUB_UPDATE_MANIFEST_URL,
  GITHUB_UPDATE_CDN_URL,
  GITHUB_UPDATE_ZIP_URL,
  isUpdateAvailable,
} = require('./core.js');

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

// Enable Chromium GPU hardware acceleration, zero-copy video decoding & smooth scrolling
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,BackForwardCache');

app.setName('Social Hub');
if (process.platform === 'win32') {
  app.setAppUserModelId('SocialHub.Desktop.App');
}
app.userAgentFallback = CHROME_USER_AGENT;

let mainWindow = null;
let appTray = null;
let isQuitting = false;
const isSmokeTest = process.argv.includes('--smoke-test');

const gotTheLock = isSmokeTest ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createCircleIcon(r, g, b, innerDot = false) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = 6.8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - center, y - center);
      if (dist <= radius) {
        const idx = (y * size + x) * 4;
        if (innerDot && dist <= 2.3) {
          buf[idx] = 255;
          buf[idx + 1] = 255;
          buf[idx + 2] = 255;
          buf[idx + 3] = 255;
        } else {
          buf[idx] = b;
          buf[idx + 1] = g;
          buf[idx + 2] = r;
          buf[idx + 3] = 255;
        }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'zalo-chat-hub-config.json');
}

function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (Array.isArray(parsed.services) && parsed.services.length > 0) {
        const removedIds = Array.isArray(parsed.removedIds) ? parsed.removedIds : [];
        const existingIds = new Set(parsed.services.map((s) => s.id));
        let migrated = false;
        const merged = parsed.services.map((s) => {
          const { mobile, ...rest } = s;
          if (
            rest.iconKey === 'messenger' &&
            rest.url === 'https://www.facebook.com/messages/'
          ) {
            rest.url = 'https://www.messenger.com/';
            migrated = true;
          }
          return rest;
        });
        for (const def of DEFAULT_SERVICES) {
          if (!existingIds.has(def.id) && !removedIds.includes(def.id)) {
            merged.push(def);
          }
        }
        const cfgObj = {
          services: merged,
          removedIds,
          notificationMode: parsed.notificationMode === 'sender' ? 'sender' : 'minimal',
          muteNotificationSound: Boolean(parsed.muteNotificationSound),
          autoStart: Boolean(parsed.autoStart),
          closeToTray: parsed.closeToTray !== false,
          adBlockEnabled: parsed.adBlockEnabled !== false,
        };
        if (migrated) {
          try {
            saveConfig(cfgObj);
          } catch {}
        }
        return cfgObj;
      }
    }
  } catch {}
  return {
    services: [...DEFAULT_SERVICES],
    removedIds: [],
    notificationMode: 'minimal',
    muteNotificationSound: false,
    autoStart: false,
    closeToTray: true,
    adBlockEnabled: true,
  };
}

function saveConfig(config) {
  const cfgPath = getConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
}

const configuredPartitions = new Set();
const ublockLiteDir = path.join(__dirname, 'extensions', 'ublock-origin-lite');
let loadedUblockExtId = null;
let adBlockActive = true;

async function ensureUblockExtensionLoaded(ses) {
  if (!ses || !fs.existsSync(path.join(ublockLiteDir, 'manifest.json'))) return null;
  try {
    const ext =
      ses.extensions && typeof ses.extensions.loadExtension === 'function'
        ? await ses.extensions.loadExtension(ublockLiteDir, { allowFileAccess: false })
        : await ses.loadExtension(ublockLiteDir, { allowFileAccess: false });
    if (ext && ext.id) {
      loadedUblockExtId = ext.id;
    }
    return ext;
  } catch {
    return null;
  }
}

function configurePartitionSession(partitionName) {
  if (!partitionName) return;
  const ses = session.fromPartition(partitionName);
  ses.setUserAgent(CHROME_USER_AGENT);

  if (configuredPartitions.has(partitionName)) return;
  configuredPartitions.add(partitionName);

  if (partitionName === 'persist:tiktok') {
    ses.clearCache().catch(() => {});
  }

  if (adBlockActive) {
    ensureUblockExtensionLoaded(ses);
  }

  ses.webRequest.onBeforeRequest((details, callback) => {
    if (adBlockActive && shouldBlockAdRequest(details.url)) {
      return callback({ cancel: true });
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h['User-Agent'] = CHROME_USER_AGENT;
    const chUa = '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"';
    delete h['Sec-CH-UA'];
    delete h['Sec-CH-UA-Mobile'];
    delete h['Sec-CH-UA-Platform'];
    h['sec-ch-ua'] = chUa;
    h['sec-ch-ua-mobile'] = '?0';
    h['sec-ch-ua-platform'] = '"Windows"';
    callback({ requestHeaders: h });
  });
  const allowed = new Set([
    'notifications',
    'media',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
  ]);
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return allowed.has(permission);
  });
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
}

function stopServiceBackgroundProcess(partitionName) {
  if (!partitionName) return;
  try {
    const targetSession = session.fromPartition(partitionName);
    targetSession.flushStorageData();
    const allContents = webContents.getAllWebContents();
    for (const wc of allContents) {
      if (!wc.isDestroyed() && wc.getType() === 'webview' && wc.session === targetSession) {
        try {
          wc.stop();
          wc.setAudioMuted(true);
          wc.loadURL('about:blank').catch(() => {});
          if (typeof wc.close === 'function') {
            wc.close();
          }
        } catch {}
      }
    }
  } catch {}
}

function updateTrayMenu() {
  if (!appTray) return;
  const cfg = loadConfig();
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mở Social Hub (Alt+S)',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Tắt tiếng thông báo',
      type: 'checkbox',
      checked: Boolean(cfg.muteNotificationSound),
      click: (menuItem) => {
        applyWindowsOptions({ muteNotificationSound: menuItem.checked });
      },
    },
    {
      label: 'Khởi động cùng Windows',
      type: 'checkbox',
      checked: Boolean(cfg.autoStart),
      click: (menuItem) => {
        applyWindowsOptions({ autoStart: menuItem.checked, closeToTray: cfg.closeToTray });
      },
    },
    {
      label: 'Thu xuống khay hệ thống khi bấm Đóng (✕)',
      type: 'checkbox',
      checked: cfg.closeToTray !== false,
      click: (menuItem) => {
        applyWindowsOptions({ autoStart: cfg.autoStart, closeToTray: menuItem.checked });
      },
    },
    { type: 'separator' },
    {
      label: 'Thoát hoàn toàn Social Hub',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  appTray.setContextMenu(contextMenu);
}

function ensureSystemTray() {
  if (appTray || isSmokeTest) return;
  try {
    appTray = new Tray(createCircleIcon(0, 104, 255, true));
    appTray.setToolTip('Social Hub — Trình quản lý mạng xã hội & tin nhắn');
    appTray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    updateTrayMenu();
  } catch {}
}

function applyWindowsOptions({ autoStart, closeToTray, adBlockEnabled, muteNotificationSound } = {}) {
  const cfg = loadConfig();
  if (typeof autoStart === 'boolean') {
    cfg.autoStart = autoStart;
    try {
      app.setLoginItemSettings({
        openAtLogin: cfg.autoStart,
        path: process.execPath,
      });
    } catch {}
  }
  if (typeof closeToTray === 'boolean') {
    cfg.closeToTray = closeToTray;
  }
  if (typeof muteNotificationSound === 'boolean') {
    cfg.muteNotificationSound = muteNotificationSound;
  }
  if (typeof adBlockEnabled === 'boolean') {
    cfg.adBlockEnabled = adBlockEnabled;
    adBlockActive = adBlockEnabled;
    if (adBlockEnabled) {
      cfg.services
        .filter((s) => s.enabled !== false)
        .forEach((s) => {
          if (s.partition) {
            ensureUblockExtensionLoaded(session.fromPartition(s.partition));
          }
        });
    }
  }
  saveConfig(cfg);
  updateTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:windowsOptionsChanged', {
      autoStart: Boolean(cfg.autoStart),
      closeToTray: cfg.closeToTray !== false,
      adBlockEnabled: cfg.adBlockEnabled !== false,
      muteNotificationSound: Boolean(cfg.muteNotificationSound),
    });
  }
  return {
    autoStart: Boolean(cfg.autoStart),
    closeToTray: cfg.closeToTray !== false,
    adBlockEnabled: cfg.adBlockEnabled !== false,
    muteNotificationSound: Boolean(cfg.muteNotificationSound),
  };
}

function createWindow() {
  const cfg = loadConfig();
  adBlockActive = cfg.adBlockEnabled !== false;
  cfg.services
    .filter((s) => s.enabled !== false)
    .forEach((s) => configurePartitionSession(s.partition));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 580,
    frame: false,
    backgroundColor: '#17191c',
    title: 'Social Hub',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });

  const sendWindowVisibility = (hidden) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:visibility', { hidden: Boolean(hidden) });
    }
  };

  mainWindow.on('focus', () => {
    mainWindow.flashFrame(false);
    sendWindowVisibility(false);
  });
  mainWindow.on('show', () => sendWindowVisibility(false));
  mainWindow.on('restore', () => sendWindowVisibility(false));
  mainWindow.on('hide', () => sendWindowVisibility(true));
  mainWindow.on('minimize', () => sendWindowVisibility(true));

  mainWindow.on('close', (event) => {
    const currentCfg = loadConfig();
    if (!isQuitting && !isSmokeTest && currentCfg.closeToTray !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  if (process.argv.includes('--smoke-test')) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const uiInteractiveOk = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const btnSettings = document.getElementById('btn-settings');
              const modal = document.getElementById('settings-modal');
              const btnClose = document.getElementById('btn-close-settings-modal');
              if (!btnSettings || !modal || !btnClose) return false;
              btnSettings.click();
              const opened = modal.hidden === false;
              btnClose.click();
              const closed = modal.hidden === true;
              const googleBtn = document.querySelector('.rail-app-btn[data-service-id="google"]');
              if (googleBtn) googleBtn.click();
              const googleToolbar = document.querySelector('.webview-pane[data-service-id="google"] .browser-toolbar');
              const backBtn = googleToolbar && googleToolbar.querySelector('.browser-btn-back');
              const fwdBtn = googleToolbar && googleToolbar.querySelector('.browser-btn-forward');
              const urlInput = googleToolbar && googleToolbar.querySelector('.browser-url-input');
              return opened && closed && Boolean(backBtn && fwdBtn && urlInput);
            })()
          `);
          if (!uiInteractiveOk) {
            console.error('SMOKE_TEST_FAIL: UI buttons not interactive');
            app.exit(1);
            return;
          }
          showMinimalDesktopPopup('zalo', 'Nhóm Test\nNgười gửi A');
          await new Promise((r) => setTimeout(r, 350));
          if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) {
            console.error('SMOKE_TEST_FAIL: popupWindow did not show');
            app.exit(1);
            return;
          }
          await popupWindow.webContents.executeJavaScript(`
            document.getElementById('popup-close').click();
          `);
          await new Promise((r) => setTimeout(r, 150));
          if (popupWindow.isVisible()) {
            console.error('SMOKE_TEST_FAIL: popupWindow did not close on X click');
            app.exit(1);
            return;
          }
          const updateRes = await checkForAppUpdate({ silent: true, forceInSmoke: true });
          if (updateRes && updateRes.error) {
            console.error('SMOKE_TEST_FAIL: checkForAppUpdate error:', updateRes.error);
            app.exit(1);
            return;
          }
        } catch (err) {
          console.error('SMOKE_TEST_FAIL:', err);
          app.exit(1);
          return;
        }
        const shotIdx = process.argv.indexOf('--screenshot');
        if (shotIdx !== -1 && process.argv[shotIdx + 1]) {
          try {
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(process.argv[shotIdx + 1], img.toPNG());
          } catch (e) {
            console.error('Screenshot error:', e);
          }
        }
        console.log('SMOKE_TEST_OK');
        app.exit(0);
      }, 2500);
    });
  }
}

// Keep OAuth / login popups and shared links inside Social Hub
function attachPopupHandler(contents) {
  contents.on('will-navigate', (event, navUrl) => {
    if (navUrl && !/^(?:https?:|about:|data:|blob:|javascript:)/i.test(navUrl)) {
      event.preventDefault();
      return;
    }
    if (/^https?:\/\/(?:www\.)?messenger\.com\/login\/password\//i.test(String(navUrl || ''))) {
      event.preventDefault();
      contents
        .loadURL('https://www.facebook.com/login.php?next=https%3A%2F%2Fwww.messenger.com%2F')
        .catch(() => {});
      return;
    }
    const unwrapped = unwrapRedirectUrl(navUrl);
    if (unwrapped && unwrapped !== navUrl) {
      event.preventDefault();
      contents.loadURL(unwrapped).catch(() => {});
    }
  });

  contents.on('did-navigate-in-page', (_event, navUrl, isMainFrame) => {
    if (!isMainFrame) return;
    const unwrapped = unwrapRedirectUrl(navUrl);
    if (unwrapped && unwrapped !== navUrl) {
      contents.loadURL(unwrapped).catch(() => {});
    }
  });

  contents.setWindowOpenHandler(({ url, frameName, disposition }) => {
    if (url && !/^(?:https?:|about:)/i.test(url)) {
      return { action: 'deny' };
    }
    const targetUrl = unwrapRedirectUrl(url);
    const lowerTarget = String(targetUrl || '').toLowerCase();
    const isAuthPopup =
      disposition === 'new-window' ||
      (frameName && frameName !== '_blank') ||
      lowerTarget.startsWith('about:blank') ||
      /oauth|login|signin|sign-in|authorize|auth\/|\/auth|checkpoint|two_step|accounts\.google|id\.zalo|appleid/i.test(
        lowerTarget
      );

    // If clicking a shared link inside Threads that points to Threads, or any link inside the Google browser tab,
    // navigate directly inside the current tab so Back/Forward works seamlessly
    if (!isAuthPopup && contents.getType() === 'webview' && /^https?:\/\//i.test(targetUrl)) {
      try {
        const isGoogleBrowserTab = contents.session === session.fromPartition('persist:google');
        if (isGoogleBrowserTab) {
          contents.loadURL(targetUrl).catch(() => {});
          return { action: 'deny' };
        }
        const currentHost = new URL(contents.getURL()).hostname.toLowerCase();
        const targetHost = new URL(targetUrl).hostname.toLowerCase();
        const bothThreads =
          (currentHost.includes('threads.net') || currentHost.includes('threads.com')) &&
          (targetHost.includes('threads.net') || targetHost.includes('threads.com'));
        if (bothThreads) {
          contents.loadURL(targetUrl).catch(() => {});
          return { action: 'deny' };
        }
      } catch {}
    }

    if (shouldOpenInAppPopup({ url: targetUrl, frameName, disposition })) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
          width: isAuthPopup ? 520 : 1020,
          height: isAuthPopup ? 680 : 720,
          minWidth: 380,
          minHeight: 480,
          center: true,
          frame: true,
          autoHideMenuBar: true,
          backgroundColor: '#17191c',
          title: 'Social Hub',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          },
        },
      };
    }
    return { action: 'deny' };
  });

  contents.on('did-create-window', (childWindow, details) => {
    childWindow.setMenuBarVisibility(false);
    if (childWindow.webContents) {
      childWindow.webContents.setUserAgent(CHROME_USER_AGENT);
      attachPopupHandler(childWindow.webContents);
      const rawUrl = (details && details.url) || '';
      const unwrapped = unwrapRedirectUrl(rawUrl);
      if (unwrapped && unwrapped !== rawUrl) {
        childWindow.loadURL(unwrapped).catch(() => {});
      }
    }
  });
}

app.on('web-contents-created', (_event, contents) => {
  const type = contents.getType();
  if (type === 'webview' || type === 'window') {
    attachPopupHandler(contents);
    if (type === 'webview' && typeof contents.setBackgroundThrottling === 'function') {
      try {
        contents.setBackgroundThrottling(false);
      } catch {}
    }
  }
});

// IPC Wiring
ipcMain.handle('state:init', () => {
  const cfg = loadConfig();
  return {
    services: cfg.services,
    presets: SERVICE_PRESETS,
    notificationMode: cfg.notificationMode || 'minimal',
    muteNotificationSound: Boolean(cfg.muteNotificationSound),
    autoStart: Boolean(cfg.autoStart),
    closeToTray: cfg.closeToTray !== false,
    adBlockEnabled: cfg.adBlockEnabled !== false,
  };
});

ipcMain.handle('extensions:openUblockDashboard', async () => {
  const cfg = loadConfig();
  const firstActive = cfg.services.find((s) => s.enabled !== false) || cfg.services[0];
  const partition = (firstActive && firstActive.partition) || 'persist:zalo';
  const ses = session.fromPartition(partition);
  const ext = await ensureUblockExtensionLoaded(ses);
  const extId = (ext && ext.id) || loadedUblockExtId;
  if (!extId) return false;

  const dashWin = new BrowserWindow({
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    width: 860,
    height: 640,
    minWidth: 520,
    minHeight: 420,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: '#17191c',
    title: 'uBlock Origin Lite — Bộ lọc Chặn quảng cáo',
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  dashWin.setMenuBarVisibility(false);
  dashWin.loadURL(`chrome-extension://${extId}/dashboard.html`).catch(() => {});
  return true;
});

ipcMain.handle('settings:setNotificationMode', (_event, mode) => {
  const cfg = loadConfig();
  cfg.notificationMode = mode === 'sender' ? 'sender' : 'minimal';
  saveConfig(cfg);
  return cfg.notificationMode;
});

ipcMain.handle('settings:setWindowsOptions', (_event, opts = {}) => {
  return applyWindowsOptions(opts);
});

ipcMain.handle('services:add', (_event, payload) => {
  const cfg = loadConfig();
  const newService = createServiceEntry(payload, cfg.services);
  configurePartitionSession(newService.partition);
  cfg.services.push(newService);
  saveConfig(cfg);
  return cfg.services;
});

ipcMain.handle('services:remove', (_event, targetId) => {
  const cfg = loadConfig();
  cfg.services = removeServiceEntry(cfg.services, targetId);
  if (!cfg.removedIds.includes(targetId)) {
    cfg.removedIds.push(targetId);
  }
  saveConfig(cfg);
  return cfg.services;
});

ipcMain.handle('services:reorder', (_event, { fromId, toId } = {}) => {
  const cfg = loadConfig();
  cfg.services = reorderServiceEntries(cfg.services, fromId, toId);
  saveConfig(cfg);
  return cfg.services;
});

ipcMain.handle('services:toggle', (_event, targetId) => {
  const cfg = loadConfig();
  cfg.services = toggleServiceEnabled(cfg.services, targetId);
  saveConfig(cfg);
  const toggled = cfg.services.find((s) => s.id === targetId);
  if (toggled) {
    if (toggled.enabled === false) {
      stopServiceBackgroundProcess(toggled.partition);
    } else {
      configurePartitionSession(toggled.partition);
    }
  }
  return cfg.services;
});

ipcMain.handle('session:clear', async (_event, partitionName) => {
  if (partitionName) {
    const ses = session.fromPartition(partitionName);
    await ses.clearStorageData();
    await ses.clearCache();
  }
  return true;
});

let popupWindow = null;
let popupTimer = null;
let popupReady = false;
let currentPopupServiceId = null;
let popupDismissedUntil = 0;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dismissDesktopPopup(isManualClose = false) {
  if (popupTimer) {
    clearTimeout(popupTimer);
    popupTimer = null;
  }
  if (isManualClose) {
    popupDismissedUntil = Date.now() + 1200;
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
  }
}

function handlePopupAction(action) {
  if (action === 'open') {
    dismissDesktopPopup(false);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (currentPopupServiceId) {
        mainWindow.webContents.send('service:activate', currentPopupServiceId);
      }
    }
  } else if (action === 'close') {
    dismissDesktopPopup(true);
  }
}

function ensureDesktopPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }
  popupReady = false;
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = 330;
  const height = 64;
  const x = Math.round(workArea.x + workArea.width - width - 16);
  const y = Math.round(workArea.y + workArea.height - height - 16);

  popupWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#202328',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popupWindow.setAlwaysOnTop(true, 'pop-up-menu');

  const popupHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #202328; color: #f1f3f5;
    font-family: "Segoe UI", -apple-system, sans-serif;
    border: 1px solid #353a42; border-radius: 8px;
  }
  .wrap {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 0 12px 0 16px; cursor: pointer;
  }
  .wrap:hover { background: #262a30; }
  .msg {
    font-size: 13.5px; font-weight: 600; color: #ffffff;
    display: flex; align-items: center; gap: 10px;
    min-width: 0; flex: 1;
  }
  .msg-lines {
    display: flex; flex-direction: column; justify-content: center;
    gap: 2px; min-width: 0; flex: 1;
  }
  .msg-title {
    font-size: 13.5px; font-weight: 600; color: #ffffff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .msg-sub {
    font-size: 12.5px; font-weight: 500; color: #9ca3af;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .msg-sub[hidden] { display: none !important; }
  .dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: #0068ff; flex-shrink: 0;
  }
  .close {
    width: 30px; height: 30px; border: none; border-radius: 6px;
    background: transparent; color: #9ca3af; font-size: 14px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; position: relative; z-index: 2;
  }
  .close:hover { background: #323740; color: #ffffff; }
</style>
</head>
<body>
  <div class="wrap" id="popup-wrap">
    <div class="msg">
      <span class="dot"></span>
      <div class="msg-lines">
        <div id="msg-title" class="msg-title">Social Hub có thông báo mới</div>
        <div id="msg-sub" class="msg-sub" hidden></div>
      </div>
    </div>
    <button type="button" class="close" id="popup-close" title="Đóng">✕</button>
  </div>
  <script>
    const closeBtn = document.getElementById('popup-close');
    const wrapEl = document.getElementById('popup-wrap');
    const triggerClose = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      document.title = '__POPUP_CLOSE__:' + Date.now();
      window.location.hash = 'close_' + Date.now();
    };
    const triggerOpen = (e) => {
      if (e && e.target && e.target.closest && e.target.closest('#popup-close')) return;
      document.title = '__POPUP_OPEN__:' + Date.now();
      window.location.hash = 'open_' + Date.now();
    };
    closeBtn.addEventListener('mousedown', triggerClose);
    closeBtn.addEventListener('click', triggerClose);
    wrapEl.addEventListener('click', triggerOpen);
  </script>
</body>
</html>`;

  popupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(popupHtml)}`);
  popupWindow.webContents.once('did-finish-load', () => {
    popupReady = true;
  });

  popupWindow.webContents.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const t = String(title || '');
    if (t.startsWith('__POPUP_CLOSE__:')) {
      handlePopupAction('close');
    } else if (t.startsWith('__POPUP_OPEN__:')) {
      handlePopupAction('open');
    }
  });

  popupWindow.webContents.on('did-navigate-in-page', (_e, url) => {
    if (url.includes('#open_')) {
      handlePopupAction('open');
    } else if (url.includes('#close_')) {
      handlePopupAction('close');
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
  });

  return popupWindow;
}

function showMinimalDesktopPopup(serviceId, rawText) {
  try {
    if (Date.now() < popupDismissedUntil) return;
    if (popupTimer) {
      clearTimeout(popupTimer);
      popupTimer = null;
    }

    currentPopupServiceId = serviceId || null;
    const lines = String(rawText || 'Social Hub có thông báo mới')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const topLine = lines[0] || 'Social Hub có thông báo mới';
    const bottomLine = lines.length >= 2 ? lines[1] : '';

    const win = ensureDesktopPopupWindow();
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const width = 330;
    const height = bottomLine ? 72 : 64;
    const x = Math.round(workArea.x + workArea.width - width - 16);
    const y = Math.round(workArea.y + workArea.height - height - 16);

    const applyUpdateAndShow = () => {
      if (!win || win.isDestroyed()) return;
      win.setBounds({ x, y, width, height });
      const jsCode = `
        (() => {
          const t = document.getElementById('msg-title');
          const s = document.getElementById('msg-sub');
          if (t) t.textContent = ${JSON.stringify(topLine)};
          if (s) {
            s.textContent = ${JSON.stringify(bottomLine)};
            s.hidden = ${!bottomLine};
          }
        })();
      `;
      win.webContents.executeJavaScript(jsCode).catch(() => {});
      if (!win.isVisible()) {
        win.showInactive();
      }
    };

    if (popupReady) {
      applyUpdateAndShow();
    } else {
      win.webContents.once('did-finish-load', applyUpdateAndShow);
    }

    popupTimer = setTimeout(() => {
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.hide();
      }
    }, 4500);
  } catch {}
}

ipcMain.on('app:notify', (_event, { serviceId, text } = {}) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
  showMinimalDesktopPopup(serviceId, text);
});

ipcMain.on('app:badge', (_event, totalUnread) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const count = Number(totalUnread) || 0;
  if (count > 0) {
    const label = count > 99 ? '99+' : String(count);
    mainWindow.setTitle(`(${label}) Social Hub`);
    try {
      mainWindow.setOverlayIcon(createCircleIcon(239, 43, 45, false), `${label} thông báo mới`);
    } catch {}
  } else {
    mainWindow.setTitle('Social Hub');
    try {
      mainWindow.setOverlayIcon(null, '');
    } catch {}
  }
});

function getLocalAppMeta() {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return {
        version: String(pkg.version || '1.0.0'),
        build: Number(pkg.build) || 0,
      };
    }
  } catch {}
  return { version: '1.0.0', build: 0 };
}

async function httpFetch(url, options = {}) {
  const fetchFn = net && typeof net.fetch === 'function' ? net.fetch.bind(net) : fetch;
  try {
    return await fetchFn(url, options);
  } catch {
    return await fetch(url, options);
  }
}

async function fetchRemoteUpdateManifest() {
  const ts = Date.now();
  const candidates = [
    {
      url: `${GITHUB_UPDATE_API_URL}?t=${ts}`,
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'SocialHub-AutoUpdater',
        'Cache-Control': 'no-cache',
      },
    },
    {
      url: `${GITHUB_UPDATE_MANIFEST_URL}?t=${ts}`,
      headers: {
        'User-Agent': 'SocialHub-AutoUpdater',
        'Cache-Control': 'no-cache',
      },
    },
    {
      url: `${GITHUB_UPDATE_CDN_URL}?t=${ts}`,
      headers: {
        'User-Agent': 'SocialHub-AutoUpdater',
        'Cache-Control': 'no-cache',
      },
    },
  ];

  let lastErr = null;
  for (const item of candidates) {
    try {
      const res = await httpFetch(item.url, {
        cache: 'no-store',
        headers: item.headers,
      });
      if (!res || !res.ok) {
        lastErr = new Error(`HTTP ${res ? res.status : 'ERR'}`);
        continue;
      }
      let parsed = await res.json();
      if (parsed && parsed.content && parsed.encoding === 'base64') {
        const decoded = Buffer.from(String(parsed.content).replace(/\s+/g, ''), 'base64').toString(
          'utf8'
        );
        parsed = JSON.parse(decoded);
      }
      if (parsed && typeof parsed === 'object' && parsed.version) {
        return parsed;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('manifest_unreachable');
}

function getTargetAppDirs() {
  const dirs = new Set();
  const appRootDir = path.resolve(__dirname, '..');
  const normRoot = appRootDir.toLowerCase().replace(/\\/g, '/');
  if (normRoot.endsWith('/resources/app')) {
    dirs.add(appRootDir);
  }
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    for (const rel of [
      path.join('Programs', 'SocialHub', 'resources', 'app'),
      path.join('SocialHub', 'runtime', 'resources', 'app'),
    ]) {
      const candidate = path.join(localAppData, rel);
      if (fs.existsSync(candidate)) {
        dirs.add(candidate);
      }
    }
  }
  return {
    isPackagedAppDir: normRoot.endsWith('/resources/app'),
    targetDirs: Array.from(dirs),
  };
}

let activeUpdatePromise = null;

async function checkForAppUpdate({ silent = true, forceInSmoke = false } = {}) {
  if (isSmokeTest && !forceInSmoke) {
    return { updated: false, reason: 'smoke_test' };
  }
  if (activeUpdatePromise) {
    const res = await activeUpdatePromise;
    if (!silent) {
      if (res && res.updated) {
        showMinimalDesktopPopup(
          null,
          `Đã cập nhật Social Hub v${res.version || 'mới'}\nĐang tự khởi động lại...`
        );
      } else if (res && res.error) {
        showMinimalDesktopPopup(null, 'Không thể kiểm tra cập nhật\nVui lòng kiểm tra kết nối mạng');
      } else {
        const localMeta = getLocalAppMeta();
        showMinimalDesktopPopup(
          null,
          `Đã là bản mới nhất (v${localMeta.version})\nKhông có bản cập nhật mới`
        );
      }
    }
    return res;
  }

  activeUpdatePromise = (async () => {
    try {
      const remoteMeta = await fetchRemoteUpdateManifest();
      const localMeta = getLocalAppMeta();

      if (!isUpdateAvailable(localMeta, remoteMeta)) {
        if (!silent) {
          showMinimalDesktopPopup(
            null,
            `Đã là bản mới nhất (v${localMeta.version})\nKhông có bản cập nhật mới`
          );
        }
        return { updated: false, version: localMeta.version };
      }

      const { isPackagedAppDir, targetDirs } = getTargetAppDirs();
      const inlineFiles =
        remoteMeta.files && typeof remoteMeta.files === 'object' ? remoteMeta.files : null;

      if (inlineFiles && Object.keys(inlineFiles).length > 0) {
        for (const baseDir of targetDirs) {
          for (const [relPath, content] of Object.entries(inlineFiles)) {
            if (typeof content !== 'string') continue;
            const safeRel = String(relPath).replace(/^[/\\]+/, '');
            if (safeRel.includes('..')) continue;
            const destPath = path.join(baseDir, safeRel);
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, content, 'utf8');
          }
        }
      } else if (targetDirs.length > 0) {
        const zipUrl = `${remoteMeta.downloadUrl || GITHUB_UPDATE_ZIP_URL}?t=${Date.now()}`;
        const zipRes = await httpFetch(zipUrl, {
          cache: 'no-store',
          headers: { 'User-Agent': 'SocialHub-AutoUpdater' },
        });
        if (!zipRes || !zipRes.ok) {
          throw new Error(`HTTP ${zipRes ? zipRes.status : 'ZIP_ERR'}`);
        }
        const zipBuf = Buffer.from(await zipRes.arrayBuffer());
        const tempZipPath = path.join(app.getPath('temp'), `socialhub-update-${Date.now()}.zip`);
        fs.writeFileSync(tempZipPath, zipBuf);

        for (const baseDir of targetDirs) {
          const psScript = `
            Add-Type -AssemblyName System.IO.Compression.FileSystem;
            $zip = [System.IO.Compression.ZipFile]::OpenRead('${tempZipPath.replace(/'/g, "''")}');
            try {
              foreach ($entry in $zip.Entries) {
                $rel = $entry.FullName -replace '/', [IO.Path]::DirectorySeparatorChar;
                $dest = Join-Path '${baseDir.replace(/'/g, "''")}' $rel;
                if ([string]::IsNullOrEmpty($entry.Name)) {
                  New-Item -ItemType Directory -Path $dest -Force | Out-Null;
                } else {
                  $parent = Split-Path -Parent $dest;
                  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null; }
                  try {
                    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true);
                  } catch {}
                }
              }
            } finally {
              $zip.Dispose();
            }
          `;
          execFileSync(
            'powershell.exe',
            ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript],
            { windowsHide: true }
          );
        }

        try {
          fs.unlinkSync(tempZipPath);
        } catch {}
      }

      showMinimalDesktopPopup(
        null,
        `Đã cập nhật Social Hub v${remoteMeta.version || localMeta.version}\nĐang tự khởi động lại...`
      );

      if (isPackagedAppDir && !isSmokeTest) {
        setTimeout(() => {
          isQuitting = true;
          app.relaunch();
          app.exit(0);
        }, 1200);
      }
      return { updated: true, version: remoteMeta.version };
    } catch (err) {
      if (!silent) {
        showMinimalDesktopPopup(
          null,
          'Không thể kiểm tra cập nhật\nVui lòng kiểm tra kết nối mạng'
        );
      }
      return { updated: false, error: err.message };
    } finally {
      activeUpdatePromise = null;
    }
  })();

  return activeUpdatePromise;
}

ipcMain.handle('app:checkUpdate', async () => {
  return checkForAppUpdate({ silent: false });
});

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (popupTimer) {
    clearTimeout(popupTimer);
    popupTimer = null;
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    try {
      popupWindow.destroy();
    } catch {}
    popupWindow = null;
  }
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch {}
});

  app.whenReady().then(() => {
  createWindow();
  ensureSystemTray();
  if (!isSmokeTest) {
    setTimeout(() => {
      checkForAppUpdate({ silent: true }).catch(() => {});
    }, 3500);
    setInterval(() => {
      checkForAppUpdate({ silent: true }).catch(() => {});
    }, 30 * 60 * 1000);
  }
  try {
    const cfg = loadConfig();
    if (cfg.autoStart) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    }
    globalShortcut.register('Alt+S', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch {}

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
