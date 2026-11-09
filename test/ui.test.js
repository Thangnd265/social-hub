const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiDir = path.join(__dirname, '..', 'src', 'ui');
const htmlPath = path.join(uiDir, 'index.html');
const cssPath = path.join(uiDir, 'style.css');
const rendererPath = path.join(uiDir, 'renderer.js');

test('Social Hub HTML shell contains custom titlebar, 64px left rail, toast container, and modals', () => {
  assert.ok(fs.existsSync(htmlPath), 'index.html must exist');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Titlebar elements matching Image 1 (no mobile viewport toggle button)
  assert.match(html, /id="titlebar"/);
  assert.match(html, /id="titlebar-text"/);
  assert.doesNotMatch(html, /id="btn-viewport-mode"/);
  assert.match(html, /id="btn-lock-app"/);
  assert.match(html, /id="btn-win-min"/);
  assert.match(html, /id="btn-win-max"/);
  assert.match(html, /id="btn-win-close"/);

  // Left navigation rail matching Image 2 (without avatar or profile name)
  assert.match(html, /id="zalo-rail"/);
  assert.doesNotMatch(html, /id="btn-avatar"/);
  assert.doesNotMatch(html, /id="input-profile-name"/);
  assert.doesNotMatch(html, /Nguyễn Đình Thắng/);
  assert.match(html, /id="app-rail-top"/);
  assert.match(html, /id="app-rail-bottom"/);
  assert.match(html, /id="btn-reload"/);
  assert.match(html, /id="btn-dnd"/);
  assert.match(html, /id="btn-add-app"/);
  assert.match(html, /id="btn-split-view"/);
  assert.match(html, /id="btn-settings"/);

  // Webview container & overlays
  assert.match(html, /id="webview-stage"/);
  assert.match(html, /id="add-service-modal"/);
  assert.match(html, /id="settings-modal"/);
  assert.match(html, /id="lock-overlay"/);

  // App is named Social Hub (not Zalo Hub) and has notification UI
  assert.match(html, /<title>Social Hub<\/title>/);
  assert.match(html, /Đã khóa màn hình Social Hub/);
  assert.doesNotMatch(html, /Zalo Hub/);
  assert.match(html, /id="btn-test-notify"/);
  assert.match(html, /name="notify-mode"/);
  assert.match(html, /id="toggle-auto-start"/);
  assert.match(html, /id="toggle-close-to-tray"/);
  assert.match(html, /id="toggle-adblock"/);
  assert.match(html, /id="toggle-mute-notify-sound"/);
  assert.match(html, /id="btn-open-ublock"/);
  assert.match(html, /id="btn-check-update"/);
  assert.doesNotMatch(html, /id="toast-container"/);
  assert.doesNotMatch(html, /notify-mode-desc/);
});

test('style.css implements Dark Mode visual tokens (#17191c rail, #2b2f36 active tile, #ef2b2d badge)', () => {
  assert.ok(fs.existsSync(cssPath), 'style.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(css, /#17191c/i);
  assert.match(css, /#2b2f36/i);
  assert.match(css, /#ef2b2d/i);
  assert.match(css, /64px/);
  assert.match(css, /48px/);
  assert.match(css, /tabular-nums/);
  assert.doesNotMatch(css, /mobile-viewport/);
});

test('renderer.js exists and includes service switching, lazy webview mounting, unread badge handling, notifications, and SVG icons', () => {
  assert.ok(fs.existsSync(rendererPath), 'renderer.js must exist');
  const js = fs.readFileSync(rendererPath, 'utf8');

  assert.match(js, /switchService/);
  assert.match(js, /toggleSplitView/);
  assert.match(js, /page-title-updated/);
  assert.match(js, /SERVICE_ICONS/);
  assert.match(js, /facebook:/);
  assert.match(js, /instagram:/);
  assert.match(js, /threads:/);
  assert.match(js, /x:/);
  assert.match(js, /google:/);
  assert.match(js, /tiktok:/);
  assert.match(js, /Social Hub có thông báo mới/);
  assert.match(js, /draggable\s*=\s*true/);
  assert.match(js, /dragstart/);
  assert.match(js, /dragover/);
  assert.match(js, /reorderServices/);
  assert.match(js, /toggleService/);
  assert.match(js, /destroyWebviewPane/);
  assert.doesNotMatch(js, /isMobileService/);
  assert.doesNotMatch(js, /mobile-viewport/);
  assert.doesNotMatch(js, /showInAppToast/);
  assert.doesNotMatch(js, /btn-remove-service/);
  assert.doesNotMatch(js, /card-status-badge/);
  assert.match(js, /setNotificationMode/);
  assert.match(js, /formatNotificationText/);
  assert.match(js, /service-toggle-switch/);
  assert.match(js, /settings-service-card/);
  assert.match(js, /triggerServiceNotification/);
  assert.match(js, /muteNotificationSound/);
  assert.match(js, /__SOCIALHUB_TAB_HIDDEN__/);
  assert.match(js, /media-started-playing/);
  assert.match(js, /wv\.dataset\.domReady\s*=\s*'1'/);
  assert.match(js, /wv\.dataset\.domReady\s*!==\s*'1'/);
  assert.match(js, /browser-toolbar/);
  assert.match(js, /browser-btn-back/);
  assert.match(js, /browser-btn-forward/);
  assert.match(js, /browser-url-input/);
  assert.match(js, /goBack/);
  assert.match(js, /goForward/);
});

test('Electron main.js, preload.js, and webview-preload.js include GPU acceleration, background throttling, and TikTok PC wheel scroll', () => {
  const mainPath = path.join(__dirname, '..', 'src', 'main.js');
  const preloadPath = path.join(__dirname, '..', 'src', 'preload.js');
  const wvPreloadPath = path.join(__dirname, '..', 'src', 'webview-preload.js');
  assert.ok(fs.existsSync(mainPath), 'main.js must exist');
  assert.ok(fs.existsSync(preloadPath), 'preload.js must exist');
  assert.ok(fs.existsSync(wvPreloadPath), 'webview-preload.js must exist');

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  const preloadSrc = fs.readFileSync(preloadPath, 'utf8');
  const wvPreloadSrc = fs.readFileSync(wvPreloadPath, 'utf8');

  assert.match(mainSrc, /webviewTag:\s*true/);
  assert.match(mainSrc, /frame:\s*false/);
  assert.match(mainSrc, /setAppUserModelId/);
  assert.match(mainSrc, /setPermissionCheckHandler/);
  assert.match(mainSrc, /stopServiceBackgroundProcess/);
  assert.match(mainSrc, /shouldOpenInAppPopup/);
  assert.match(mainSrc, /enable-gpu-rasterization/);
  assert.match(mainSrc, /enable-smooth-scrolling/);
  assert.match(mainSrc, /setBackgroundThrottling/);
  assert.match(mainSrc, /ublock-origin-lite/);
  assert.match(mainSrc, /loadExtension/);
  assert.match(mainSrc, /shouldBlockAdRequest/);
  assert.match(mainSrc, /extensions:openUblockDashboard/);
  assert.match(mainSrc, /overrideBrowserWindowOptions/);
  assert.match(mainSrc, /requestSingleInstanceLock/);
  assert.match(mainSrc, /setLoginItemSettings/);
  assert.match(mainSrc, /setOverlayIcon/);
  assert.match(mainSrc, /globalShortcut/);
  assert.match(mainSrc, /new Tray/);
  assert.match(mainSrc, /settings:setWindowsOptions/);
  assert.match(mainSrc, /app:notify/);
  assert.match(mainSrc, /msg-lines/);
  assert.match(mainSrc, /msg-sub/);
  assert.match(mainSrc, /showInactive/);
  assert.match(mainSrc, /popup-close/);
  assert.match(mainSrc, /__POPUP_CLOSE__/);
  assert.doesNotMatch(mainSrc, /focusable:\s*false/);
  assert.match(mainSrc, /Social Hub/);
  assert.match(mainSrc, /state:init/);
  assert.match(mainSrc, /services:add/);
  assert.match(mainSrc, /services:remove/);
  assert.match(mainSrc, /window:minimize/);
  assert.match(mainSrc, /checkForAppUpdate/);
  assert.match(mainSrc, /app:checkUpdate/);
  assert.match(mainSrc, /--smoke-test/);

  assert.match(wvPreloadSrc, /setupTikTokPcWheelNavigation/);
  assert.match(wvPreloadSrc, /recommend-list-item-container/);
  assert.match(wvPreloadSrc, /arrow-right/);
  assert.match(wvPreloadSrc, /ArrowDown/);
  assert.match(wvPreloadSrc, /comment\|reply\|chat/i);
  assert.match(wvPreloadSrc, /isContentEditable/);

  // Verify that mainWorldScript inside webview-preload.js has valid JS syntax without template-string comment bugs
  const scriptMatch = wvPreloadSrc.match(/const mainWorldScript = `([\s\S]*?)`;\s*try\s*\{\s*webFrame/);
  assert.ok(scriptMatch, 'mainWorldScript template literal must exist in webview-preload.js');
  const evaluatedTemplate = eval('`' + scriptMatch[1] + '`');
  assert.doesNotThrow(() => new Function(evaluatedTemplate), 'mainWorldScript must be valid JavaScript');

  assert.match(preloadSrc, /contextBridge\.exposeInMainWorld/);
  assert.match(preloadSrc, /chatHub/);
  assert.match(preloadSrc, /notify:/);

  const buildScriptPath = path.join(__dirname, '..', 'scripts', 'build-exe.js');
  const buildScriptSrc = fs.readFileSync(buildScriptPath, 'utf8');
  assert.match(buildScriptSrc, /ZipArchive/);
  assert.match(buildScriptSrc, /ExtractZipOverwrite/);
  assert.doesNotMatch(buildScriptSrc, /ExtractToDirectory/);
});
