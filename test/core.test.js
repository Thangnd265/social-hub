const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SERVICES,
  SERVICE_PRESETS,
  parseUnreadCount,
  normalizeServiceUrl,
  createServiceEntry,
  removeServiceEntry,
  reorderServiceEntries,
  toggleServiceEnabled,
  extractSenderFromTitle,
  formatNotificationText,
  resolveOmniboxInput,
  unwrapRedirectUrl,
  shouldOpenInAppPopup,
  shouldBlockAdRequest,
  shouldTriggerUnreadNotification,
  totalUnreadCount,
  GITHUB_UPDATE_MANIFEST_URL,
  GITHUB_UPDATE_ZIP_URL,
  isUpdateAvailable,
} = require('../src/core.js');

test('DEFAULT_SERVICES provides Zalo, Messenger, Telegram, Facebook, Instagram, Threads, X, Google, and TikTok with isolated persist partitions', () => {
  assert.equal(DEFAULT_SERVICES.length, 9);
  assert.deepEqual(
    DEFAULT_SERVICES.map((s) => s.id),
    ['zalo', 'messenger', 'telegram', 'facebook', 'instagram', 'threads', 'x', 'google', 'tiktok']
  );
  for (const s of DEFAULT_SERVICES) {
    assert.match(s.partition, /^persist:/);
    assert.match(s.url, /^https:\/\//);
  }
  const messengerSvc = DEFAULT_SERVICES.find((s) => s.id === 'messenger');
  assert.equal(messengerSvc.url, 'https://www.messenger.com/');
  assert.ok(Array.isArray(SERVICE_PRESETS) && SERVICE_PRESETS.length >= 10);
});

test('parseUnreadCount extracts unread counts from Zalo, Messenger, and Telegram titles without false positives', () => {
  assert.equal(parseUnreadCount('(1) Zalo - Nguyễn Đình Thắng'), 1);
  assert.equal(parseUnreadCount('(12) Zalo'), 12);
  assert.equal(parseUnreadCount('(99+) Messenger'), 99);
  assert.equal(parseUnreadCount('Messenger (4)'), 4);
  assert.equal(parseUnreadCount('[5] Telegram Web'), 5);
  assert.equal(parseUnreadCount('• Messenger'), 1);
  assert.equal(parseUnreadCount('Zalo - TOPV VP&HN nội bộ (159 thành viên)'), 0);
  assert.equal(parseUnreadCount('Zalo - Nguyễn Đình Thắng'), 0);
  assert.equal(parseUnreadCount(''), 0);
  assert.equal(parseUnreadCount(null), 0);
});

test('normalizeServiceUrl prepends https and blocks unsafe protocols', () => {
  assert.equal(normalizeServiceUrl('chat.zalo.me'), 'https://chat.zalo.me/');
  assert.equal(normalizeServiceUrl('https://www.messenger.com'), 'https://www.messenger.com/');
  assert.throws(() => normalizeServiceUrl('javascript:alert(1)'), /URL không hợp lệ/i);
  assert.throws(() => normalizeServiceUrl('file:///C:/Windows/win.ini'), /URL không hợp lệ/i);
  assert.throws(() => normalizeServiceUrl('   '), /URL không được để trống/i);
});

test('createServiceEntry generates unique id and persist partition for multiple accounts of same service', () => {
  const s1 = createServiceEntry(
    { name: 'Zalo Công Việc', url: 'chat.zalo.me', iconKey: 'zalo' },
    DEFAULT_SERVICES
  );
  assert.equal(s1.id, 'zalo-cong-viec');
  assert.equal(s1.partition, 'persist:zalo-cong-viec');
  assert.equal(s1.url, 'https://chat.zalo.me/');

  const s2 = createServiceEntry(
    { name: 'Zalo Công Việc', url: 'chat.zalo.me', iconKey: 'zalo' },
    [...DEFAULT_SERVICES, s1]
  );
  assert.equal(s2.id, 'zalo-cong-viec-2');
  assert.equal(s2.partition, 'persist:zalo-cong-viec-2');
});

test('removeServiceEntry removes target service but prevents removing the last remaining service', () => {
  const afterOneRemoved = removeServiceEntry(DEFAULT_SERVICES, 'telegram');
  assert.equal(afterOneRemoved.length, 8);
  assert.ok(!afterOneRemoved.some((s) => s.id === 'telegram'));

  const singleList = [DEFAULT_SERVICES[0]];
  assert.throws(() => removeServiceEntry(singleList, 'zalo'), /tối thiểu 1 ứng dụng/i);
});

test('totalUnreadCount sums positive unread badge counts across services', () => {
  assert.equal(totalUnreadCount({ zalo: 3, messenger: 1, telegram: 0 }), 4);
  assert.equal(totalUnreadCount({}), 0);
});

test('reorderServiceEntries moves dragged service to target position and preserves all items', () => {
  const reordered = reorderServiceEntries(DEFAULT_SERVICES, 'x', 'zalo');
  assert.equal(reordered.length, DEFAULT_SERVICES.length);
  assert.equal(reordered[0].id, 'x');
  assert.equal(reordered[1].id, 'zalo');

  const moveDown = reorderServiceEntries(DEFAULT_SERVICES, 'zalo', 'telegram');
  assert.deepEqual(
    moveDown.slice(0, 3).map((s) => s.id),
    ['messenger', 'telegram', 'zalo']
  );

  // Invalid or same IDs leave order intact
  const unchanged = reorderServiceEntries(DEFAULT_SERVICES, 'zalo', 'zalo');
  assert.deepEqual(
    unchanged.map((s) => s.id),
    DEFAULT_SERVICES.map((s) => s.id)
  );
});

test('shouldTriggerUnreadNotification returns true only when unread count increases and DND is off', () => {
  assert.equal(shouldTriggerUnreadNotification(0, 1, false), true);
  assert.equal(shouldTriggerUnreadNotification(2, 5, false), true);
  assert.equal(shouldTriggerUnreadNotification(3, 3, false), false);
  assert.equal(shouldTriggerUnreadNotification(5, 2, false), false);
  assert.equal(shouldTriggerUnreadNotification(0, 1, true), false);
});

test('toggleServiceEnabled flips enabled state and prevents disabling the last active service', () => {
  const sample = [
    { id: 'zalo', name: 'Zalo', enabled: true },
    { id: 'tiktok', name: 'TikTok', enabled: true },
  ];
  const afterDisable = toggleServiceEnabled(sample, 'tiktok');
  assert.equal(afterDisable.find((s) => s.id === 'tiktok').enabled, false);
  assert.equal(afterDisable.find((s) => s.id === 'zalo').enabled, true);

  assert.throws(
    () => toggleServiceEnabled(afterDisable, 'zalo'),
    /tối thiểu 1 ứng dụng/i
  );

  const afterReEnable = toggleServiceEnabled(afterDisable, 'tiktok');
  assert.equal(afterReEnable.find((s) => s.id === 'tiktok').enabled, true);
});

test('extractSenderFromTitle and formatNotificationText support minimal mode and sender-only mode', () => {
  assert.equal(extractSenderFromTitle('Nguyễn Văn A'), 'Nguyễn Văn A');
  assert.equal(extractSenderFromTitle('Tin nhắn mới từ Trần Thị B'), 'Trần Thị B');
  assert.equal(extractSenderFromTitle('Lê Hoàng đã gửi cho bạn 1 tin nhắn'), 'Lê Hoàng');
  assert.equal(extractSenderFromTitle('(2) Phạm Minh | Messenger'), 'Phạm Minh');
  assert.equal(extractSenderFromTitle('(2) Facebook'), '');
  assert.equal(extractSenderFromTitle('(1) Zalo - Nguyễn Đình Thắng'), '');

  assert.equal(
    formatNotificationText('minimal', { sender: 'Nguyễn Văn A', serviceName: 'Zalo' }),
    'Social Hub có thông báo mới'
  );
  assert.equal(
    formatNotificationText('sender', { sender: 'Nguyễn Văn A', serviceName: 'Zalo' }),
    'Nguyễn Văn A'
  );
  assert.equal(
    formatNotificationText('sender', { sender: '(2) Facebook', serviceName: 'Facebook' }),
    'Social Hub có thông báo mới'
  );

  // Group notification: Group name on top line, Sender name on bottom line, hiding message content
  assert.equal(
    formatNotificationText('sender', {
      group: 'Nhóm Dự Án',
      sender: 'Nguyễn Văn A',
      serviceName: 'Zalo',
    }),
    'Nhóm Dự Án\nNguyễn Văn A'
  );
  assert.equal(
    formatNotificationText('sender', {
      sender: 'Nhóm Dự Án',
      body: 'Nguyễn Văn A: Nội dung tin nhắn bí mật cần ẩn đi',
      serviceName: 'Zalo',
    }),
    'Nhóm Dự Án\nNguyễn Văn A'
  );
  assert.equal(
    formatNotificationText('sender', {
      sender: 'Trần Thị B trong Nhóm Marketing',
      serviceName: 'Messenger',
    }),
    'Nhóm Marketing\nTrần Thị B'
  );
  assert.equal(
    formatNotificationText('sender', {
      sender: '(3) Bọn Điên | Messenger',
      body: 'Hùng\nAlo 123',
      serviceName: 'Messenger',
    }),
    'Bọn Điên\nHùng'
  );
  assert.equal(
    formatNotificationText('sender', {
      sender: 'Bọn Điên',
      body: 'Hùng đã gửi một nhãn dán · 1 phút',
      serviceName: 'Messenger',
    }),
    'Bọn Điên\nHùng'
  );
  // Minimal mode still hides both group and sender
  assert.equal(
    formatNotificationText('minimal', {
      group: 'Nhóm Dự Án',
      sender: 'Nguyễn Văn A',
      serviceName: 'Zalo',
    }),
    'Social Hub có thông báo mới'
  );
});

test('shouldOpenInAppPopup allows OAuth, login popups, about:blank popups, and new-window dispositions inside Social Hub', () => {
  // Google OAuth from TikTok / X / Threads
  assert.equal(
    shouldOpenInAppPopup({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123',
      frameName: '',
      disposition: 'foreground-tab',
    }),
    true
  );
  // Two-step about:blank popup used by Google Identity / TikTok OAuth SDK
  assert.equal(
    shouldOpenInAppPopup({
      url: 'about:blank',
      frameName: 'google_login_popup',
      disposition: 'new-window',
    }),
    true
  );
  // Any window.open with popup features (disposition === 'new-window')
  assert.equal(
    shouldOpenInAppPopup({
      url: 'https://www.tiktok.com/login',
      frameName: '',
      disposition: 'new-window',
    }),
    true
  );
  // Facebook / Apple / X OAuth
  assert.equal(
    shouldOpenInAppPopup({
      url: 'https://www.facebook.com/v18.0/dialog/oauth?app_id=123',
      frameName: '_blank',
      disposition: 'foreground-tab',
    }),
    true
  );
  // Shared links clicked inside Threads / chat apps open inside Social Hub instead of launching external Chrome
  assert.equal(
    shouldOpenInAppPopup({
      url: 'https://vnexpress.net/tin-tuc-moi.html',
      frameName: '_blank',
      disposition: 'foreground-tab',
    }),
    true
  );
  assert.equal(
    unwrapRedirectUrl('https://l.threads.net/?u=https%3A%2F%2Fwww.threads.net%2F%40user%2Fpost%2F123&e=abc'),
    'https://www.threads.net/@user/post/123'
  );
  assert.equal(
    unwrapRedirectUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fvnexpress.net%2Fbai-viet&h=xyz'),
    'https://vnexpress.net/bai-viet'
  );
  // Pasted URL inside Google search box unwraps directly to the destination URL
  assert.equal(
    unwrapRedirectUrl('https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2FThangnd265&oq=https'),
    'https://github.com/Thangnd265'
  );
  assert.equal(
    unwrapRedirectUrl('https://www.google.com/search?q=vnexpress.net%2Ftin-tuc'),
    'https://vnexpress.net/tin-tuc'
  );
  // Normal search query stays on Google Search
  assert.equal(
    unwrapRedirectUrl('https://www.google.com/search?q=thoi+tiet+ha+noi'),
    'https://www.google.com/search?q=thoi+tiet+ha+noi'
  );
  // resolveOmniboxInput handles full URLs, domains, localhost/IPs, and plain search terms
  assert.equal(resolveOmniboxInput('https://docs.google.com/document/d/123'), 'https://docs.google.com/document/d/123');
  assert.equal(resolveOmniboxInput('vnexpress.net/so-hoa'), 'https://vnexpress.net/so-hoa');
  assert.equal(resolveOmniboxInput('192.168.1.2:8006'), 'http://192.168.1.2:8006');
  assert.equal(
    resolveOmniboxInput('cách nấu phở bò'),
    'https://www.google.com/search?q=c%C3%A1ch%20n%E1%BA%A5u%20ph%E1%BB%9F%20b%C3%B2'
  );
});

test('TikTok service uses standard PC Web mode without mobile emulation', () => {
  const tiktok = DEFAULT_SERVICES.find((s) => s.id === 'tiktok');
  assert.ok(tiktok);
  assert.equal(tiktok.url, 'https://www.tiktok.com/');
  assert.equal(tiktok.mobile, undefined);
});

test('shouldBlockAdRequest blocks ad networks and trackers while preserving core chat, video, and OAuth traffic', () => {
  assert.equal(
    shouldBlockAdRequest('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'),
    true
  );
  assert.equal(
    shouldBlockAdRequest('https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-123'),
    true
  );
  assert.equal(
    shouldBlockAdRequest('https://ads.tiktok.com/api/v1/ad/Impression'),
    true
  );
  assert.equal(
    shouldBlockAdRequest('https://analytics.tiktok.com/i18n/pixel/events.js'),
    true
  );
  assert.equal(
    shouldBlockAdRequest('https://an.facebook.com/v2/audience_network.js'),
    true
  );
  // Must NOT block normal app, video CDN, or login URLs
  assert.equal(
    shouldBlockAdRequest('https://www.tiktok.com/foryou'),
    false
  );
  assert.equal(
    shouldBlockAdRequest('https://accounts.google.com/o/oauth2/v2/auth'),
    false
  );
  assert.equal(
    shouldBlockAdRequest('https://chat.zalo.me/'),
    false
  );
});

test('isUpdateAvailable compares semantic versions and build timestamps for GitHub auto-update', () => {
  assert.match(GITHUB_UPDATE_MANIFEST_URL, /raw\.githubusercontent\.com\/Thangnd265\/social-hub-updates\/main\/version\.json/);
  assert.match(GITHUB_UPDATE_ZIP_URL, /raw\.githubusercontent\.com\/Thangnd265\/social-hub-updates\/main\/app-update\.zip/);

  // Newer semver version
  assert.equal(
    isUpdateAvailable({ version: '1.0.0', build: 100 }, { version: '1.0.1', build: 100 }),
    true
  );
  // Same semver version but newer build timestamp (including when local build was 0/undefined)
  assert.equal(
    isUpdateAvailable({ version: '1.0.0', build: 1700000000000 }, { version: '1.0.0', build: 1700000005000 }),
    true
  );
  assert.equal(
    isUpdateAvailable({ version: '1.1.0' }, { version: '1.1.0', build: 1700000005000 }),
    true
  );
  // Same version and same/older build -> false
  assert.equal(
    isUpdateAvailable({ version: '1.0.1', build: 200 }, { version: '1.0.1', build: 200 }),
    false
  );
  assert.equal(
    isUpdateAvailable({ version: '1.1.0', build: 300 }, { version: '1.0.9', build: 400 }),
    false
  );
  assert.equal(isUpdateAvailable({ version: '1.0.0' }, null), false);
});
