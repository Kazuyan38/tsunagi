/* owl — Service Worker（Web Push の受け取りだけ。ページのキャッシュはしない＝古い画面が残る事故を作らない） */
"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const SAFARI = /Safari/.test(self.navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(self.navigator.userAgent);

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    // アプリを前面で見ているときはベルの数字で足りるので OS の通知は出さない
    // （Safari は通知を出さない push を続けると購読を止めるため、Safari では常に出す）
    if (!SAFARI) {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.some(w => w.visibilityState === "visible" && w.focused)) return;
    }
    await self.registration.showNotification(d.title || "owl", {
      body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "img/icon-192.png", badge: "img/favicon-64.png",
      data: { id: d.id || null, url: d.url || "./" },
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const { id, url } = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find(c => /\/(pc|m)\.html/.test(c.url));
    if (w) { await w.focus(); if (id) w.postMessage({ type: "open-notif", id }); return; }
    await self.clients.openWindow(new URL(url || "./", self.registration.scope).href);
  })());
});
