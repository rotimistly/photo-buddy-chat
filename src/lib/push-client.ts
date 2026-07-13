import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "./vapid";
import { savePushSubscription } from "./push.functions";

export async function ensurePushSubscribed(kind: "user" | "admin"): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    });
  }

  await savePushSubscription({
    data: {
      endpoint: sub.endpoint,
      subscription: sub.toJSON(),
      kind,
    },
  });

  return true;
}
