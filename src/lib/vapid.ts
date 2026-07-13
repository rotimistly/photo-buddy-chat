// Public VAPID key — safe to ship to the browser.
// Private key stays in the VAPID_PRIVATE_KEY server secret.
export const VAPID_PUBLIC_KEY =
  "BDaw709a4fxkgEXvXHx2hO2COEpr3prjpDTScswG6dbU6qhrNf31_zFvFGpkPKiqYy0x5qOLH5Br-ap-hxexW7I";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}
