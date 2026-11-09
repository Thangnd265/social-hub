'use strict';

const DEFAULT_SERVICES = [
  {
    id: 'zalo',
    name: 'Zalo',
    url: 'https://chat.zalo.me/',
    iconKey: 'zalo',
    color: '#0068ff',
    partition: 'persist:zalo',
  },
  {
    id: 'messenger',
    name: 'Messenger',
    url: 'https://www.messenger.com/',
    iconKey: 'messenger',
    color: '#0084ff',
    partition: 'persist:messenger',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/a/',
    iconKey: 'telegram',
    color: '#24a1de',
    partition: 'persist:telegram',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    url: 'https://www.facebook.com/',
    iconKey: 'facebook',
    color: '#1877f2',
    partition: 'persist:facebook',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/direct/inbox/',
    iconKey: 'instagram',
    color: '#e1306c',
    partition: 'persist:instagram',
  },
  {
    id: 'threads',
    name: 'Threads',
    url: 'https://www.threads.net/',
    iconKey: 'threads',
    color: '#ffffff',
    partition: 'persist:threads',
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    url: 'https://x.com/',
    iconKey: 'x',
    color: '#ffffff',
    partition: 'persist:x',
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://www.google.com/',
    iconKey: 'google',
    color: '#4285f4',
    partition: 'persist:google',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    url: 'https://www.tiktok.com/',
    iconKey: 'tiktok',
    color: '#fe2c55',
    partition: 'persist:tiktok',
  },
];

const SERVICE_PRESETS = [
  {
    key: 'zalo-extra',
    name: 'Zalo (Tài khoản 2)',
    url: 'https://chat.zalo.me/',
    iconKey: 'zalo',
    color: '#0068ff',
  },
  {
    key: 'messenger-extra',
    name: 'Messenger (Tài khoản 2)',
    url: 'https://www.messenger.com/',
    iconKey: 'messenger',
    color: '#0084ff',
  },
  {
    key: 'telegram-extra',
    name: 'Telegram (Tài khoản 2)',
    url: 'https://web.telegram.org/a/',
    iconKey: 'telegram',
    color: '#24a1de',
  },
  {
    key: 'facebook-extra',
    name: 'Facebook (Tài khoản 2)',
    url: 'https://www.facebook.com/',
    iconKey: 'facebook',
    color: '#1877f2',
  },
  {
    key: 'instagram-extra',
    name: 'Instagram (Tài khoản 2)',
    url: 'https://www.instagram.com/direct/inbox/',
    iconKey: 'instagram',
    color: '#e1306c',
  },
  {
    key: 'threads-extra',
    name: 'Threads (Tài khoản 2)',
    url: 'https://www.threads.net/',
    iconKey: 'threads',
    color: '#ffffff',
  },
  {
    key: 'x-extra',
    name: 'X / Twitter (Tài khoản 2)',
    url: 'https://x.com/',
    iconKey: 'x',
    color: '#ffffff',
  },
  {
    key: 'google-extra',
    name: 'Google (Tài khoản 2)',
    url: 'https://www.google.com/',
    iconKey: 'google',
    color: '#4285f4',
  },
  {
    key: 'tiktok-extra',
    name: 'TikTok (Tài khoản 2)',
    url: 'https://www.tiktok.com/',
    iconKey: 'tiktok',
    color: '#fe2c55',
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    iconKey: 'whatsapp',
    color: '#25d366',
  },
  {
    key: 'discord',
    name: 'Discord',
    url: 'https://discord.com/app',
    iconKey: 'discord',
    color: '#5865f2',
  },
  {
    key: 'viber',
    name: 'Viber / Teams',
    url: 'https://teams.microsoft.com/',
    iconKey: 'teams',
    color: '#6264a7',
  },
  {
    key: 'slack',
    name: 'Slack',
    url: 'https://app.slack.com/client',
    iconKey: 'slack',
    color: '#e01e5a',
  },
  {
    key: 'gmail',
    name: 'Google Chat / Gmail',
    url: 'https://mail.google.com/chat/u/0/',
    iconKey: 'gmail',
    color: '#ea4335',
  },
];

/**
 * Extracts unread message count from web page titles such as:
 * "(3) Zalo - Nguyễn Đình Thắng", "(99+) Messenger", "Messenger (4)", "[5] Telegram"
 * without misinterpreting chat room member counts like "Zalo - Nhóm (159 thành viên)".
 */
function parseUnreadCount(title) {
  if (typeof title !== 'string') return 0;
  const trimmed = title.trim();
  if (!trimmed) return 0;

  // 1. Leading badge: "(12) Zalo..." or "[5] Telegram..."
  const leadingMatch = trimmed.match(/^(?:\(|\[)(\d+)\+?(?:\)|\])\s*/);
  if (leadingMatch) {
    return Math.min(parseInt(leadingMatch[1], 10), 99);
  }

  // 2. Trailing pure numeric badge right after app name: "Messenger (4)" or "Telegram (2)"
  const trailingAppBadge = trimmed.match(/^(?:Zalo|Messenger|Telegram|Facebook|Instagram|Threads|X|Twitter|TikTok|WhatsApp|Discord|Slack)\s*\((\d+)\+?\)$/i);
  if (trailingAppBadge) {
    return Math.min(parseInt(trailingAppBadge[1], 10), 99);
  }

  // 3. Bullet dot notification indicator: "• Messenger"
  if (/^[•●]\s+/.test(trimmed)) {
    return 1;
  }

  return 0;
}

/**
 * Validates and normalizes a service URL (http/https only).
 */
function normalizeServiceUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('URL không được để trống');
  }
  let candidate = rawUrl.trim();
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('URL không hợp lệ');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL không hợp lệ: Chỉ hỗ trợ giao thức http hoặc https');
  }
  return parsed.toString();
}

function slugifyVietnamese(input) {
  return String(input || 'app')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}

function detectIconKey(url, fallbackKey) {
  if (fallbackKey) return fallbackKey;
  const u = url.toLowerCase();
  if (u.includes('zalo.me')) return 'zalo';
  if (u.includes('messenger.com') || u.includes('facebook.com/messages')) return 'messenger';
  if (u.includes('facebook.com')) return 'facebook';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  if (u.includes('telegram.org')) return 'telegram';
  if (u.includes('whatsapp.com')) return 'whatsapp';
  if (u.includes('discord.com')) return 'discord';
  if (u.includes('slack.com')) return 'slack';
  if (u.includes('mail.google.com')) return 'gmail';
  if (u.includes('google.com')) return 'google';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('teams.microsoft')) return 'teams';
  return 'custom';
}

/**
 * Creates a new service entry with an isolated Electron session partition.
 */
function createServiceEntry(input, existingServices = []) {
  const name = String(input?.name || '').trim();
  if (!name) {
    throw new Error('Tên ứng dụng không được để trống');
  }
  const url = normalizeServiceUrl(input?.url);
  const baseSlug = slugifyVietnamese(name);
  const existingIds = new Set((existingServices || []).map((s) => s.id));

  let id = baseSlug;
  let counter = 2;
  while (existingIds.has(id)) {
    id = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const iconKey = detectIconKey(url, input?.iconKey);
  return {
    id,
    name,
    url,
    iconKey,
    color: input?.color || '#0068ff',
    partition: `persist:${id}`,
  };
}

/**
 * Removes a service by id, keeping at least 1 service active.
 */
function removeServiceEntry(services = [], targetId) {
  if (!Array.isArray(services) || services.length <= 1) {
    throw new Error('Cần giữ lại tối thiểu 1 ứng dụng trên thanh bên');
  }
  const filtered = services.filter((s) => s.id !== targetId);
  if (filtered.length === 0) {
    throw new Error('Cần giữ lại tối thiểu 1 ứng dụng trên thanh bên');
  }
  return filtered;
}

/**
 * Reorders services by moving the item with `fromId` to the position of `toId`.
 */
function reorderServiceEntries(services = [], fromId, toId) {
  if (!Array.isArray(services)) return [];
  const next = [...services];
  const fromIdx = next.findIndex((s) => s.id === fromId);
  const toIdx = next.findIndex((s) => s.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
    return next;
  }
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

/**
 * Toggles the `enabled` state of a service (whether it appears on the sidebar rail).
 * Prevents disabling the last remaining enabled service.
 */
function toggleServiceEnabled(services = [], targetId) {
  if (!Array.isArray(services) || services.length === 0) return [];
  const target = services.find((s) => s.id === targetId);
  if (!target) return [...services];

  const isCurrentlyEnabled = target.enabled !== false;
  if (isCurrentlyEnabled) {
    const enabledCount = services.filter((s) => s.enabled !== false).length;
    if (enabledCount <= 1) {
      throw new Error('Cần bật hiển thị tối thiểu 1 ứng dụng trên thanh bên');
    }
  }

  return services.map((s) =>
    s.id === targetId ? { ...s, enabled: !isCurrentlyEnabled } : s
  );
}

const GENERIC_APP_TITLES = new Set([
  'zalo',
  'messenger',
  'telegram',
  'telegram web',
  'facebook',
  'instagram',
  'threads',
  'x',
  'twitter',
  'google',
  'tiktok',
  'whatsapp',
  'discord',
  'slack',
  'social hub',
]);

/**
 * Extracts a clean sender name from a raw notification title or page title.
 * Returns '' if the title is only a generic app name or Zalo's own account window title.
 */
function extractSenderFromTitle(rawTitle) {
  if (typeof rawTitle !== 'string') return '';
  let text = rawTitle.trim();
  if (!text) return '';

  // Strip leading unread badges like "(2) ", "[5] ", "• "
  text = text.replace(/^(?:(?:\(|\[)\d+\+?(?:\)|\])|[•●])\s*/g, '').trim();

  // Zalo Web's <title> is always "Zalo - <Logged-in User>" (not the sender)
  if (/^zalo\s*-\s*/i.test(text)) {
    return '';
  }

  // Strip trailing app suffixes like " | Messenger", " - Facebook", " (3 chưa đọc)"
  text = text
    .replace(
      /\s*(?:\||—|–|-)\s*(?:Messenger|Facebook|Zalo|Telegram|Instagram|Threads|X|Twitter|TikTok|WhatsApp|Discord|Slack).*$/i,
      ''
    )
    .replace(/\s*\(\d+\s*chưa đọc\)$/i, '')
    .replace(/\s*\(\d+\+?\)$/i, '')
    .trim();

  // Extract sender from common Vietnamese / English notification phrases
  text = text
    .replace(/^(?:Tin nhắn mới từ|Tin nhắn từ|New message from)\s+/i, '')
    .replace(
      /\s+(?:đã gửi cho bạn\s+\d*\s*tin nhắn|đã gửi một tin nhắn|đã nhắn tin cho bạn|vừa nhắn tin cho bạn|sent you a message|sent a message).*$/i,
      ''
    )
    .trim();

  if (!text || GENERIC_APP_TITLES.has(text.toLowerCase())) {
    return '';
  }

  return text;
}

const NON_SENDER_PREFIXES = new Set([
  'bạn',
  'you',
  'tin nhắn',
  'message',
  'thông báo',
  'notification',
  're',
  'fw',
  'fwd',
  'lưu ý',
  'chú ý',
  'http',
  'https',
]);

/**
 * Extracts a sender name from a group notification body (e.g. "Nguyễn Văn A: Xin chào" or "Trần B đã gửi một ảnh")
 * while stripping and discarding the actual message content.
 */
function extractGroupSenderFromBody(rawBody, groupTitle = '') {
  if (typeof rawBody !== 'string') return '';
  const body = rawBody.trim();
  if (!body) return '';

  let candidate = '';
  const colonMatch = body.match(/^([^:\r\n]{1,45}):\s*(.+)/s);
  if (colonMatch) {
    candidate = colonMatch[1].trim();
  } else {
    const actionMatch = body.match(
      /^(.{1,42}?)\s+(?:đã gửi|vừa gửi|đã nhắn|vừa nhắn|đã bày tỏ|đã thả|đã nhắc đến|đã trả lời|đã phản hồi|đã chia sẻ|đã thu hồi|đã ghim|đã đổi|đã tạo|đã thêm|đã tham gia|sent\s|reacted\s|mentioned\s|replied\s|shared\s|unsent\s|pinned\s)/i
    );
    if (actionMatch) {
      candidate = actionMatch[1].trim();
    } else if (body.includes('\n')) {
      const lines = body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length >= 2 && lines[0].length <= 42) {
        candidate = lines[0];
      }
    }
  }

  if (!candidate) return '';
  const lower = candidate.toLowerCase();
  if (NON_SENDER_PREFIXES.has(lower) || GENERIC_APP_TITLES.has(lower)) return '';
  if (/^\d+$/.test(candidate) || /^[[\]()]/.test(candidate)) return '';
  if (groupTitle && lower === String(groupTitle).trim().toLowerCase()) return '';

  return candidate;
}

/**
 * Formats the notification string according to user's selected notificationMode:
 * - 'minimal': Always "Social Hub có thông báo mới"
 * - 'sender':
 *    - If group notification: "<Tên nhóm>\n<Tên người nhắn>" (Group on top, Sender below, message hidden)
 *    - If direct message: "<Tên người nhắn>" (falls back to "Social Hub có thông báo mới" if unknown)
 */
function formatNotificationText(mode = 'minimal', { sender = '', group = '', body = '' } = {}) {
  if (mode === 'sender') {
    let cleanGroup = extractSenderFromTitle(group);
    let cleanSender = '';

    const rawSenderStr = typeof sender === 'string' ? sender.trim() : '';
    if (rawSenderStr.includes('\n')) {
      const parts = rawSenderStr
        .split(/\r?\n/)
        .map((p) => extractSenderFromTitle(p))
        .filter(Boolean);
      if (parts.length >= 2) {
        cleanGroup = cleanGroup || parts[0];
        cleanSender = parts[1];
      } else if (parts.length === 1) {
        cleanSender = parts[0];
      }
    } else {
      const cleaned = extractSenderFromTitle(rawSenderStr);
      const inGroupMatch = cleaned.match(/^(.+?)\s+(?:trong|in)\s+(.+)$/i);
      if (inGroupMatch && !cleanGroup) {
        cleanSender = extractSenderFromTitle(inGroupMatch[1]);
        cleanGroup = extractSenderFromTitle(inGroupMatch[2]);
      } else {
        cleanSender = cleaned;
      }
    }

    if (!cleanGroup && cleanSender && body) {
      const bodySender = extractGroupSenderFromBody(body, cleanSender);
      if (bodySender) {
        cleanGroup = cleanSender;
        cleanSender = bodySender;
      }
    }

    if (
      cleanGroup &&
      cleanSender &&
      cleanGroup.toLowerCase() !== cleanSender.toLowerCase()
    ) {
      return `${cleanGroup}\n${cleanSender}`;
    }

    if (cleanSender) {
      return cleanSender;
    }
    if (cleanGroup) {
      return cleanGroup;
    }
  }
  return 'Social Hub có thông báo mới';
}

/**
 * Resolves a user-entered or pasted address bar / search input into a navigable URL.
 * Direct URLs, domains, localhost, and IPv4 addresses navigate directly; plain text searches Google.
 */
function resolveOmniboxInput(rawInput = '') {
  if (typeof rawInput !== 'string') return 'https://www.google.com/';
  const trimmed = rawInput.trim();
  if (!trimmed) return 'https://www.google.com/';

  if (/^https?:\/\//i.test(trimmed)) {
    return unwrapRedirectUrl(trimmed);
  }

  // No whitespace -> check if it looks like a domain, localhost, or IP address
  if (!/\s/.test(trimmed)) {
    if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
      return `http://${trimmed}`;
    }
    if (/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?(?:\/.*)?$/.test(trimmed)) {
      return `https://${trimmed}`;
    }
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function isDirectUrlQuery(q = '') {
  if (typeof q !== 'string') return false;
  const trimmed = q.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/.*)?$/i.test(trimmed)) return true;
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(trimmed)) return true;
  if (/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?\/.*$/.test(trimmed)) return true;
  return false;
}

/**
 * Unwraps social redirector URLs (e.g. l.threads.net/?u=..., l.instagram.com/?u=..., l.facebook.com/l.php?u=...)
 * and Google Search queries where the user pasted a direct URL into the Google search box.
 */
function unwrapRedirectUrl(rawUrl = '') {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'l.threads.net' ||
      host === 'l.threads.com' ||
      host === 'l.instagram.com' ||
      host === 'l.facebook.com' ||
      host === 'lm.facebook.com' ||
      host === 'l.messenger.com'
    ) {
      const target = parsed.searchParams.get('u') || parsed.searchParams.get('url');
      if (target && /^https?:\/\//i.test(target)) {
        return target;
      }
    }
    if (host === 'www.google.com' || host === 'google.com' || host.endsWith('.google.com')) {
      if (parsed.pathname === '/url') {
        const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        if (target && /^https?:\/\//i.test(target)) {
          return target;
        }
      }
      if (parsed.pathname === '/search') {
        const q = (parsed.searchParams.get('q') || '').trim();
        if (isDirectUrlQuery(q)) {
          return resolveOmniboxInput(q);
        }
      }
    }
  } catch {}
  return trimmed;
}

/**
 * Determines whether a `window.open` request from inside a service `<webview>`
 * should open as an in-app popup window inside Social Hub (preserving session & `window.opener`)
 * rather than launching the external system browser.
 */
function shouldOpenInAppPopup({ url = '', frameName = '', disposition = '' } = {}) {
  const rawUrl = String(url || '').trim();
  const lowerUrl = rawUrl.toLowerCase();
  const frame = String(frameName || '').trim();
  const disp = String(disposition || '').toLowerCase();

  // 1. Two-step popups (e.g. Google Identity Services / TikTok OAuth opens about:blank first, then navigates)
  if (!rawUrl || lowerUrl === 'about:blank' || lowerUrl.startsWith('about:blank')) {
    return true;
  }

  // 2. Any http/https link or explicit popup window opens inside Social Hub instead of jumping to external Chrome
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return true;
  }

  if (disp === 'new-window' || (frame && frame !== '_blank')) {
    return true;
  }

  return false;
}

const AD_AND_TRACKER_PATTERNS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.',
  'ads.tiktok.com',
  'analytics.tiktok.com',
  'business-api.tiktok.com',
  'ads-api.twitter.com',
  'analytics.twitter.com',
  'ads.twitter.com',
  'an.facebook.com',
  'connect.facebook.net/en_us/fbevents.js',
  'pixel.facebook.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'rubiconproject.com',
  'pubmatic.com',
  'scorecardresearch.com',
  'moatads.com',
  'adsrvr.org',
  'smartadserver.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  '/pagead/',
  '/adsbygoogle',
];

/**
 * Returns true if a network request URL matches known advertising or ad-tracking endpoints.
 */
function shouldBlockAdRequest(rawUrl = '') {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  const lower = rawUrl.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
  return AD_AND_TRACKER_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Determines whether an unread count change should trigger a desktop notification.
 */
function shouldTriggerUnreadNotification(previousCount, nextCount, dndMuted = false) {
  if (dndMuted) return false;
  const prev = Math.max(0, Number(previousCount) || 0);
  const next = Math.max(0, Number(nextCount) || 0);
  return next > 0 && next > prev;
}

/**
 * Sums positive unread counts across all services.
 */
function totalUnreadCount(unreadMap = {}) {
  if (!unreadMap || typeof unreadMap !== 'object') return 0;
  return Object.values(unreadMap).reduce((sum, val) => {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? sum + Math.floor(n) : sum;
  }, 0);
}

const GITHUB_UPDATE_API_URL =
  'https://api.github.com/repos/Thangnd265/social-hub-updates/contents/version.json';
const GITHUB_UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/Thangnd265/social-hub-updates/main/version.json';
const GITHUB_UPDATE_CDN_URL =
  'https://cdn.jsdelivr.net/gh/Thangnd265/social-hub-updates@main/version.json';
const GITHUB_UPDATE_ZIP_URL =
  'https://raw.githubusercontent.com/Thangnd265/social-hub-updates/main/app-update.zip';

function parseSemverParts(versionStr = '') {
  return String(versionStr || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

/**
 * Compares local and remote update metadata (`{ version, build }`) to determine if an update is available.
 */
function isUpdateAvailable(localMeta = {}, remoteMeta = {}) {
  if (!remoteMeta || typeof remoteMeta !== 'object') return false;
  const [lMaj = 0, lMin = 0, lPat = 0] = parseSemverParts(localMeta && localMeta.version);
  const [rMaj = 0, rMin = 0, rPat = 0] = parseSemverParts(remoteMeta.version);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  if (rPat !== lPat) return rPat > lPat;
  const lBuild = Number(localMeta && localMeta.build) || 0;
  const rBuild = Number(remoteMeta.build) || 0;
  if (rBuild > 0) {
    return rBuild > lBuild;
  }
  return false;
}

module.exports = {
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
  GITHUB_UPDATE_API_URL,
  GITHUB_UPDATE_MANIFEST_URL,
  GITHUB_UPDATE_CDN_URL,
  GITHUB_UPDATE_ZIP_URL,
  isUpdateAvailable,
};
