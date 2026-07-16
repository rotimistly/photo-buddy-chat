// Server-only Firebase Cloud Messaging HTTP v1 sender.
// Only import from other *.server files or inside createServerFn handlers (dynamic import).
import { JWT } from "google-auth-library";

export type FcmPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  data?: Record<string, string>;
};

let jwtClient: JWT | null = null;
let cachedProjectId: string | null = null;

function getClient(): { jwt: JWT; projectId: string } {
  if (jwtClient && cachedProjectId) return { jwt: jwtClient, projectId: cachedProjectId };
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  const sa = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
    project_id: string;
  };
  jwtClient = new JWT({
    email: sa.client_email,
    key: sa.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  cachedProjectId = sa.project_id;
  return { jwt: jwtClient, projectId: cachedProjectId };
}

async function sendOne(token: string, payload: FcmPayload, accessToken: string, projectId: string) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: {
          url: payload.url,
          tag: payload.tag ?? "",
          ...(payload.data ?? {}),
        },
        webpush: {
          fcm_options: { link: payload.url },
          notification: { tag: payload.tag ?? "default" },
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, body: text };
  }
  return { ok: true, status: 200, body: "" };
}

export async function sendFcmToTokens(tokens: string[], payload: FcmPayload) {
  if (tokens.length === 0) return { sent: 0, invalid: [] as string[] };
  const { jwt, projectId } = getClient();
  const { token: accessToken } = await jwt.getAccessToken();
  if (!accessToken) throw new Error("Failed to obtain Google access token");

  const invalid: string[] = [];
  let sent = 0;
  await Promise.all(
    tokens.map(async (t) => {
      const r = await sendOne(t, payload, accessToken, projectId);
      if (r.ok) sent++;
      else if (
        r.status === 404 ||
        r.status === 400 ||
        (r.body && r.body.includes("UNREGISTERED"))
      ) {
        invalid.push(t);
      }
    }),
  );

  if (invalid.length) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("fcm_tokens").delete().in("token", invalid);
    } catch {}
  }
  return { sent, invalid };
}
