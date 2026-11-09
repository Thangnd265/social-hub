'use strict';

const { ipcRenderer, webFrame } = require('electron');

function detectUnreadDetailsFromDom(preferredTitle = '') {
  try {
    const cleanPref = String(preferredTitle || '')
      .replace(/^(?:(?:\(|\[)\d+\+?(?:\)|\])|[•●])\s*/g, '')
      .replace(/\s*(?:\||—|–|-)\s*(?:Messenger|Facebook|Zalo|Telegram).*$/i, '')
      .trim()
      .toLowerCase();

    // 1. Zalo Web unread conversation row (supports both 1-on-1 and Group chats)
    const zaloRows = Array.from(
      document.querySelectorAll(
        '.msg-item.--unread, .conv-item.--unread, .msg-item.unread, .conv-item.unread'
      )
    );
    const zaloRow =
      (cleanPref &&
        zaloRows.find((r) => {
          const t = r.querySelector('.conv-item-title__name, .conv-item-title .truncate');
          return t && t.textContent && t.textContent.trim().toLowerCase() === cleanPref;
        })) ||
      zaloRows[0];

    if (zaloRow) {
      const titleNode = zaloRow.querySelector('.conv-item-title__name, .conv-item-title .truncate');
      const convTitle = titleNode && titleNode.textContent ? titleNode.textContent.trim() : '';
      const senderNode = zaloRow.querySelector(
        '.conv-dbname, .conv-item-body__main .sender, [class*="sender-name"]'
      );
      const previewNode = zaloRow.querySelector(
        '.conv-message, .conv-item-body__main, .conv-item-body'
      );
      let explicitSender =
        senderNode && senderNode.textContent
          ? senderNode.textContent.replace(/:\s*$/, '').trim()
          : '';
      if (!explicitSender && previewNode) {
        const spans = Array.from(previewNode.querySelectorAll('span'))
          .map((s) => (s.textContent || '').trim())
          .filter(Boolean);
        if (spans.length >= 2 && spans[0].endsWith(':')) {
          explicitSender = spans[0].replace(/:\s*$/, '').trim();
        }
      }
      const previewText =
        previewNode && previewNode.textContent ? previewNode.textContent.trim() : '';

      if (convTitle) {
        if (explicitSender && explicitSender.toLowerCase() !== convTitle.toLowerCase()) {
          return { group: convTitle, sender: explicitSender, body: previewText };
        }
        return { group: '', sender: convTitle, body: previewText };
      }
    }

    // 2. Telegram Web A / K unread chat row
    const tgRow = document.querySelector('.ListItem.unread, .chatlist-chat.is-unread');
    if (tgRow) {
      const titleNode = tgRow.querySelector('.title, .peer-title');
      const convTitle = titleNode && titleNode.textContent ? titleNode.textContent.trim() : '';
      const senderNode = tgRow.querySelector(
        '.subtitle .sender-name, .dialog-subtitle-span-sender, .last-message .sender-name'
      );
      const explicitSender =
        senderNode && senderNode.textContent
          ? senderNode.textContent.replace(/:\s*$/, '').trim()
          : '';
      const subNode = tgRow.querySelector('.subtitle, .dialog-subtitle');
      const previewText = subNode && subNode.textContent ? subNode.textContent.trim() : '';
      if (convTitle) {
        if (explicitSender && explicitSender.toLowerCase() !== convTitle.toLowerCase()) {
          return { group: convTitle, sender: explicitSender, body: previewText };
        }
        return { group: '', sender: convTitle, body: previewText };
      }
    }

    // 3. Messenger / Facebook / Instagram thread rows (extracts both Group Title and Sender Snippet)
    const fbRows = Array.from(document.querySelectorAll('[role="row"], [role="listitem"]'));
    let targetFbRow = null;
    if (cleanPref) {
      targetFbRow = fbRows.find((row) => {
        const firstSpan = row.querySelector('span[dir="auto"]');
        return (
          firstSpan &&
          firstSpan.textContent &&
          firstSpan.textContent.trim().toLowerCase() === cleanPref
        );
      });
    }
    if (!targetFbRow) {
      targetFbRow = fbRows.find((row) =>
        row.querySelector('[aria-label*="chưa đọc" i], [aria-label*="unread" i]')
      );
    }
    if (targetFbRow) {
      const spans = Array.from(targetFbRow.querySelectorAll('span[dir="auto"]'))
        .map((s) => (s.textContent || '').trim())
        .filter(
          (t) =>
            t &&
            t !== '·' &&
            !/^\d+\s*(?:phút|giờ|ngày|tuần|giây|m|h|d|w|s)\b/i.test(t)
        );
      const uniqueSpans = [...new Set(spans)];
      if (uniqueSpans.length >= 2) {
        return {
          group: '',
          sender: uniqueSpans[0],
          body: uniqueSpans[1].replace(/\s*·\s*\d+.*$/, '').trim(),
        };
      }
      if (uniqueSpans.length === 1) {
        return { group: '', sender: uniqueSpans[0], body: '' };
      }
    }
  } catch {}
  return { group: '', sender: '', body: '' };
}

window.addEventListener('__socialhub_notify__', (event) => {
  const detail = (event && event.detail) || {};
  const domInfo = detectUnreadDetailsFromDom(detail.sender || '');
  const rawSender = detail.sender || domInfo.sender || '';
  const rawGroup = detail.group || domInfo.group || '';
  const rawBody = detail.body || domInfo.body || '';
  ipcRenderer.sendToHost('webview:notification', {
    sender: String(rawSender).trim(),
    group: String(rawGroup).trim(),
    body: String(rawBody).trim(),
  });
});

// Observe title changes to also report any unread sender/group found in DOM
window.addEventListener('DOMContentLoaded', () => {
  try {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const obs = new MutationObserver(() => {
        const domInfo = detectUnreadDetailsFromDom(document.title || '');
        if (domInfo.sender || domInfo.group) {
          ipcRenderer.sendToHost('webview:dom-sender', domInfo);
        }
      });
      obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  } catch {}
});

// Override Notification & ServiceWorkerRegistration.showNotification in the MAIN page world
// and optimize TikTok PC Web video scrolling with mouse wheel.
const mainWorldScript = `
(() => {
  try {
    function emitSender(title, options = {}) {
      window.dispatchEvent(
        new CustomEvent('__socialhub_notify__', {
          detail: {
            sender: String(title || ''),
            body: String((options && options.body) || '')
          }
        })
      );
    }

    function PatchedNotification(title, options = {}) {
      emitSender(title, options);
      this.title = String(title || '');
      this.body = String((options && options.body) || '');
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;
    }
    PatchedNotification.prototype.close = function() {};
    PatchedNotification.prototype.addEventListener = function() {};
    PatchedNotification.prototype.removeEventListener = function() {};
    PatchedNotification.requestPermission = async function(cb) {
      if (typeof cb === 'function') cb('granted');
      return 'granted';
    };
    Object.defineProperty(PatchedNotification, 'permission', {
      get: () => 'granted',
      configurable: true
    });
    window.Notification = PatchedNotification;

    if (typeof ServiceWorkerRegistration !== 'undefined' && ServiceWorkerRegistration.prototype) {
      ServiceWorkerRegistration.prototype.showNotification = function(title, options = {}) {
        emitSender(title, options);
        return Promise.resolve();
      };
    }

    function setupTikTokPcWheelNavigation() {
      if (!location.hostname.includes('tiktok.com')) return;

      const injectPcStyles = () => {
        if (document.getElementById('__socialhub_tiktok_pc_style__')) return;
        const style = document.createElement('style');
        style.id = '__socialhub_tiktok_pc_style__';
        style.textContent = \`
          html {
            scroll-behavior: smooth !important;
          }
          [class*="DivPromotionPopup"], [data-e2e="open-app-banner"], [class*="DownloadApp"],
          [data-e2e="ad-tag"], [class*="DivAdBadge"], [class*="SpanAdBadge"] {
            display: none !important;
          }
        \`;
        (document.head || document.documentElement).appendChild(style);
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectPcStyles);
      } else {
        injectPcStyles();
      }

      let lastWheelAt = 0;

      function isInsideScrollableSubPanel(target) {
        let el = target && target.nodeType === 1 ? target : target && target.parentElement;
        while (el && el !== document.body && el !== document.documentElement) {
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'textarea' || tag === 'input' || tag === 'aside' || tag === 'nav' || el.isContentEditable) {
            return true;
          }
          const e2e = (el.getAttribute && el.getAttribute('data-e2e')) || '';
          const role = (el.getAttribute && el.getAttribute('role')) || '';
          const cls = typeof el.className === 'string' ? el.className : '';
          if (
            role === 'dialog' ||
            /comment|reply|chat|message|inbox|nav|sidebar|search|drawer|popover|modal/i.test(e2e) ||
            /Comment|Reply|SideNav|ChatList|MessageList|Drawer|Inbox|Notification|Popover|Modal/i.test(cls)
          ) {
            return true;
          }
          const style = window.getComputedStyle(el);
          const overflowY = style ? style.overflowY : '';
          if (
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            el.scrollHeight > el.clientHeight + 2 &&
            el !== document.scrollingElement &&
            el.querySelectorAll('[data-e2e="recommend-list-item-container"], [id^="one-column-item-"]').length <= 1
          ) {
            return true;
          }
          el = el.parentElement;
        }
        return false;
      }

      function findVisibleButton(selectors) {
        for (const sel of selectors) {
          const nodes = document.querySelectorAll(sel);
          for (const btn of nodes) {
            if (btn && btn.offsetParent !== null && !btn.disabled) {
              return btn;
            }
          }
        }
        return null;
      }

      function getFeedVideoItems() {
        let items = Array.from(
          document.querySelectorAll(
            '[data-e2e="recommend-list-item-container"], [id^="one-column-item-"], article[class*="ItemContainer"], div[class*="DivItemContainerV2"]'
          )
        ).filter((el) => el.offsetHeight > 120);

        if (items.length <= 1) {
          const seen = new Set();
          items = [];
          document.querySelectorAll('video').forEach((v) => {
            const card =
              v.closest('[data-e2e="recommend-list-item-container"], [id^="one-column-item-"], article') ||
              (v.parentElement && v.parentElement.parentElement && v.parentElement.parentElement.parentElement);
            if (card && card.offsetHeight > 120 && !seen.has(card)) {
              seen.add(card);
              items.push(card);
            }
          });
        }
        return items;
      }

      window.addEventListener(
        'wheel',
        (e) => {
          if (e.ctrlKey || Math.abs(e.deltaY) < 12) return;
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          if (isInsideScrollableSubPanel(e.target, e.deltaY)) return;

          const now = Date.now();
          if (now - lastWheelAt < 360) {
            e.preventDefault();
            return;
          }

          const dir = e.deltaY > 0 ? 1 : -1;

          // 1. Check TikTok PC Web built-in Next/Previous arrow buttons (Theater mode or floating feed controls)
          const arrowBtn =
            dir > 0
              ? findVisibleButton([
                  '[data-e2e="arrow-right"]',
                  '[data-e2e="feed-down-button"]',
                  'button[aria-label*="Next video" i]',
                  'button[aria-label*="tiếp theo" i]',
                ])
              : findVisibleButton([
                  '[data-e2e="arrow-left"]',
                  '[data-e2e="feed-up-button"]',
                  'button[aria-label*="Previous video" i]',
                  'button[aria-label*="Video trước" i]',
                ]);

          if (arrowBtn) {
            lastWheelAt = now;
            e.preventDefault();
            arrowBtn.click();
            return;
          }

          // 2. Check Main Feed video containers and snap smoothly to the next/previous video
          const items = getFeedVideoItems();
          if (items.length > 1) {
            const viewportCenter = window.innerHeight / 2;
            let currentIdx = 0;
            let bestDist = Infinity;
            items.forEach((item, idx) => {
              const rect = item.getBoundingClientRect();
              const itemCenter = rect.top + rect.height / 2;
              const dist = Math.abs(itemCenter - viewportCenter);
              if (dist < bestDist) {
                bestDist = dist;
                currentIdx = idx;
              }
            });

            const nextIdx = Math.max(0, Math.min(items.length - 1, currentIdx + dir));
            if (nextIdx !== currentIdx && items[nextIdx]) {
              lastWheelAt = now;
              e.preventDefault();
              items[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
              const keyName = dir > 0 ? 'ArrowDown' : 'ArrowUp';
              const keyCode = dir > 0 ? 40 : 38;
              document.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: keyName,
                  code: keyName,
                  keyCode,
                  which: keyCode,
                  bubbles: true,
                  cancelable: true,
                })
              );
              return;
            }
          }

          // 3. Fallback: trigger TikTok's native ArrowDown / ArrowUp video navigation
          lastWheelAt = now;
          const keyName = dir > 0 ? 'ArrowDown' : 'ArrowUp';
          const keyCode = dir > 0 ? 40 : 38;
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: keyName,
              code: keyName,
              keyCode,
              which: keyCode,
              bubbles: true,
              cancelable: true,
            })
          );
        },
        { capture: true, passive: false }
      );
    }

    setupTikTokPcWheelNavigation();

    // Prevent background tabs (especially TikTok) from auto-resuming video/audio
    // when the main Social Hub window is minimized/hidden and restored
    window.addEventListener(
      'play',
      (e) => {
        if (window.__SOCIALHUB_TAB_HIDDEN__ && e.target && typeof e.target.pause === 'function') {
          try {
            e.target.pause();
          } catch {}
        }
      },
      true
    );

    const blockWhenTabHidden = (e) => {
      if (window.__SOCIALHUB_TAB_HIDDEN__) {
        e.stopImmediatePropagation();
        document.querySelectorAll('video, audio').forEach((m) => {
          try {
            m.pause();
          } catch {}
        });
      }
    };
    document.addEventListener('visibilitychange', blockWhenTabHidden, true);
    window.addEventListener('focus', blockWhenTabHidden, true);

    // Keep shared links inside Threads / Social Hub instead of opening external redirect tabs
    document.addEventListener(
      'click',
      (e) => {
        const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!anchor) return;
        const rawHref = anchor.getAttribute('href') || '';
        if (!rawHref) return;
        try {
          const parsed = new URL(rawHref, location.href);
          const host = parsed.hostname.toLowerCase();
          if (
            host === 'l.threads.net' ||
            host === 'l.threads.com' ||
            host === 'l.instagram.com' ||
            host === 'l.facebook.com' ||
            host === 'lm.facebook.com'
          ) {
            const u = parsed.searchParams.get('u') || parsed.searchParams.get('url');
            if (u && (u.startsWith('https://') || u.startsWith('http://'))) {
              anchor.href = u;
              const targetHost = new URL(u).hostname.toLowerCase();
              if (
                (location.hostname.includes('threads.') &&
                  (targetHost.includes('threads.net') || targetHost.includes('threads.com'))) ||
                targetHost === location.hostname.toLowerCase()
              ) {
                anchor.removeAttribute('target');
              }
            }
          }
        } catch {}
      },
      true
    );

    if (location.hostname.includes('messenger.com')) {
      setTimeout(() => {
        const continueBtn = document.querySelector('button._4zlr');
        if (continueBtn) continueBtn.click();
      }, 600);
    }
  } catch (e) {}
})();
`;

try {
  webFrame.executeJavaScript(mainWorldScript);
} catch {}
