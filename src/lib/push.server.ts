// Server-only push sender. Only import from other .server or from inside
// createServerFn handlers via dynamic import.
import webpush from "web-push";

let configured = false;
function configure() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:support@example.com";
  if (!publicKey || !privateKey) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

export async function sendPushToRecipients(
  subs: Array<{ subscription: unknown; endpoint: string }>,
  payload: PushPayload,
) {
  if (subs.length === 0) return;
  configure();
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        // subscription is stored as jsonb
        await webpush.sendNotification(s.subscription as webpush.PushSubscription, body);
      } catch (err: any) {
        // Best-effort: prune dead subscriptions
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } catch {}
        }
      }
    }),
  );
}
