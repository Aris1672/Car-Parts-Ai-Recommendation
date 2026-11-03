// dashboard/sw.js — service worker for the AI Dashboard PWA.
//
// Two jobs:
// 1. Make the dashboard installable (PWA requires a registered service
//    worker, even a minimal one — this is that requirement).
// 2. Receive Web Push events and show a system notification, even when the
//    dashboard tab/app isn't open. This is what makes "instant lead alert"
//    possible without a native app.
//
// Deliberately NOT trying to cache/serve the dashboard offline (no offline
// fetch handler) — this is an internal ops tool with live Supabase data;
// showing a stale cached dashboard would be actively misleading. The PWA
// install/app-icon benefit doesn't require offline support.

const CACHE_NAME = 'ai-dashboard-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Push notification handling ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = { title: 'Новый лид', body: 'Открыть панель управления' };
  try {
    if (event.data) payload = event.data.json();
  } catch (e) {
    // Non-JSON push payload — fall back to defaults above rather than
    // throwing (a malformed push should never silently fail to notify).
  }

  const title = payload.title || 'Новый лид';
  const options = {
    body:  payload.body || '',
    icon:  '/AI_Agent.png',
    badge: '/AI_Agent.png',
    tag:   payload.tag || 'lead-alert',   // same tag = replaces previous unread notification instead of stacking duplicates
    renotify: true,
    data:  { url: payload.url || '/dashboard' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Click handling: focus existing tab if open, else open a new one ────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes('/dashboard') && 'focus' in client) {
          // «Новая заявка» -> show the «Заявки» tab in the open dashboard
          if (targetUrl.includes('#requests')) client.postMessage({ type: 'open-tab', tab: 'requests' });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
