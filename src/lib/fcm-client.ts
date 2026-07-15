import { getFirebaseMessaging, FCM_VAPID_PUBLIC_KEY } from "./firebase";
import { getToken, onMessage } from "firebase/messaging";
import { saveFcmToken, removeFcmToken } from "./fcm.functions";
import { toast } from "sonner";

let foregroundBound = false;

export async function ensureFcmSubscribed(kind: "user" | "admin"): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return false;

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;

  const messaging = await getFirebaseMessaging();
  if (!messaging) return false;

  const token = await getToken(messaging, {
    vapidKey: FCM_VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: reg,
  });
  if (!token) return false;

  await saveFcmToken({
    data: {
      token,
      kind,
      device_info: {
        ua: navigator.userAgent,
        lang: navigator.language,
      },
    },
  });

  if (!foregroundBound) {
    foregroundBound = true;
    onMessage(messaging, (payload) => {
      const n = payload.notification;
      if (!n) return;
      toast(n.title ?? "Notification", { description: n.body });
    });
  }
  try {
    localStorage.setItem("fcm_token", token);
  } catch {}
  return true;
}

export async function unregisterFcm() {
  try {
    const t = localStorage.getItem("fcm_token");
    if (t) await removeFcmToken({ data: { token: t } });
    localStorage.removeItem("fcm_token");
  } catch {}
}
