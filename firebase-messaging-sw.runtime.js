importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

let messagingReadyPromise = null;

function normalizePushPayload(payload) {
  const data = payload?.data || payload || {};
  return {
    type: String(data.type || "").trim(),
    roomId: String(data.roomId || "").trim(),
    inviteId: String(data.inviteId || "").trim(),
    senderId: String(data.senderId || "").trim(),
    senderName: String(data.senderName || "").trim(),
    previewText: String(data.previewText || "").trim(),
    createdAt: String(data.createdAt || "").trim(),
    title: String(data.title || "").trim(),
    body: String(data.body || "").trim(),
    tag: String(data.tag || "").trim(),
    clickPath: String(data.clickPath || "").trim(),
  };
}

async function fetchPushConfig() {
  const response = await fetch("/api/push/config", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Push config request failed with ${response.status}`);
  }
  return response.json();
}

async function ensureMessagingReady() {
  if (messagingReadyPromise) {
    return messagingReadyPromise;
  }

  messagingReadyPromise = (async () => {
    const config = await fetchPushConfig();
    if (!(config?.enabled && config?.webConfig)) {
      return null;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(config.webConfig);
    }

    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const normalized = normalizePushPayload(payload);
      const title = normalized.title || "TRANSCHAT";
      const body = normalized.body || normalized.previewText || "";
      return self.registration.showNotification(title, {
        body,
        tag: normalized.tag || (normalized.type === "message" ? `room:${normalized.roomId}` : `invite:${normalized.inviteId}`),
        data: normalized,
      });
    });

    return messaging;
  })().catch((error) => {
    console.error("[push-sw] init failed", error);
    return null;
  });

  return messagingReadyPromise;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Keep a fetch handler so the same service worker also satisfies installability requirements for PWA.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payload = normalizePushPayload(event.notification.data || {});
  const targetUrl = new URL(payload.clickPath || "/", self.location.origin).toString();

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of clientList) {
      client.postMessage({
        type: "transchat-push-click",
        payload,
      });
      if ("focus" in client) {
        await client.focus();
      }
      return;
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});

void ensureMessagingReady();
