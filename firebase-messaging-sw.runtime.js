importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

let messagingReadyPromise = null;
const recentNotificationKeys = new Map();

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

function buildNotificationKey(payload) {
  return [
    payload?.tag || "",
    payload?.roomId || "",
    payload?.inviteId || "",
    payload?.createdAt || "",
    payload?.title || "",
    payload?.body || payload?.previewText || "",
  ].join("::");
}

function pruneRecentNotificationKeys(now = Date.now()) {
  recentNotificationKeys.forEach((timestamp, key) => {
    if (now - timestamp > 10_000) {
      recentNotificationKeys.delete(key);
    }
  });
}

async function presentPushNotification(rawPayload) {
  const normalized = normalizePushPayload(rawPayload);
  const title = normalized.title || rawPayload?.notification?.title || "TRANSCHAT";
  const body = normalized.body || rawPayload?.notification?.body || normalized.previewText || "";
  const tag = normalized.tag || (normalized.type === "message" ? `room:${normalized.roomId}` : `invite:${normalized.inviteId}`);
  const key = buildNotificationKey({ ...normalized, title, body, tag });
  const now = Date.now();

  pruneRecentNotificationKeys(now);
  if (recentNotificationKeys.has(key)) {
    return;
  }
  recentNotificationKeys.set(key, now);

  const existing = await self.registration.getNotifications({ tag });
  existing.forEach((notification) => notification.close());

  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: normalized,
  });
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
      return presentPushNotification(payload);
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

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  event.waitUntil((async () => {
    try {
      const payload = event.data.json();
      await presentPushNotification(payload);
    } catch (error) {
      try {
        const text = event.data.text();
        await presentPushNotification({ data: { body: text, previewText: text } });
      } catch (secondaryError) {
        console.error("[push-sw] push event handling failed", secondaryError || error);
      }
    }
  })());
});

void ensureMessagingReady();
