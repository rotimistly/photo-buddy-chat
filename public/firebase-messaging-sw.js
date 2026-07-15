// Firebase Cloud Messaging service worker.
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBxsIO3nHe4qeF11h90vW5rxb-0VfCYcRU",
  authDomain: "chat-c4316.firebaseapp.com",
  projectId: "chat-c4316",
  storageBucket: "chat-c4316.firebasestorage.app",
  messagingSenderId: "789240895959",
  appId: "1:789240895959:web:8aabc9f7bd00f53ff01392",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "Notification";
  const body = (payload.notification && payload.notification.body) || "";
  const data = payload.data || {};
  const tag = data.tag || "default";
  const url = data.url || "/";
  self.registration.showNotification(title, {
    body,
    tag,
    renotify: false,
    data: { url },
    icon: "/favicon.ico",
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
