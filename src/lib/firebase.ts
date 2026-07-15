// Firebase public web config (safe to ship in client bundle).
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

export const firebaseConfig = {
  apiKey: "AIzaSyBxsIO3nHe4qeF11h90vW5rxb-0VfCYcRU",
  authDomain: "chat-c4316.firebaseapp.com",
  projectId: "chat-c4316",
  storageBucket: "chat-c4316.firebasestorage.app",
  messagingSenderId: "789240895959",
  appId: "1:789240895959:web:8aabc9f7bd00f53ff01392",
  measurementId: "G-3T1ZM8YCE1",
};

export const FCM_VAPID_PUBLIC_KEY =
  "BF6T-7ElD2LryX_OnRPGNrXiUS8KKax9SOSQrsmffsOMShJPq4xn8KUqL6CsigEHj9pgWYnFSo25vecdMTluB0A";

let app: FirebaseApp | null = null;
export function getFirebaseApp(): FirebaseApp {
  if (typeof window === "undefined") throw new Error("Firebase client is browser-only");
  if (app) return app;
  app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  if (!(await isSupported())) return null;
  return getMessaging(getFirebaseApp());
}
