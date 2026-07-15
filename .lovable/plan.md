# Implementation Plan — FCM + Package Tracking

## Part A — Firebase Setup (you do this once)

Follow these steps, then I'll request the values via a secure form:

1. Go to https://console.firebase.google.com → **Add project** → name it (e.g. "photo-buddy-chat") → disable Analytics (not needed).
2. In the project, click the **Web icon (`</>`)** → register app "web" → copy the config object (apiKey, authDomain, projectId, messagingSenderId, appId).
3. In left sidebar → **Build → Cloud Messaging** → enable if prompted.
4. **Project Settings (gear) → Cloud Messaging tab → Web configuration → Generate key pair** → copy the **VAPID key** (starts with `B...`, ~87 chars).
5. **Project Settings → Service accounts → Generate new private key** → downloads a JSON file. Keep it — I'll ask you to paste its full contents.

I'll request these secrets after you confirm:
- `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_VAPID_PUBLIC_KEY` (client-side, used to request FCM token)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON, server-only, used to send via HTTP v1 API)

## Part B — FCM Migration (fully replace web-push)

**Remove:**
- `src/lib/push.server.ts`, `src/lib/push.functions.ts`, `src/lib/push-client.ts`, `src/lib/vapid.ts`
- `public/sw.js` (replaced by `firebase-messaging-sw.js`)
- `web-push` npm package + `VAPID_*` secret usage
- `push_subscriptions` table → replaced by `fcm_tokens`

**Add:**
- `public/firebase-messaging-sw.js` — background handler; plays sound via `showNotification` + click routes to `/chat` or `/ops-console-9f2a`.
- `src/lib/firebase.ts` — client init (guarded, browser-only).
- `src/lib/fcm-client.ts` — `ensureFcmRegistered(role)`: request permission → `getToken({vapidKey})` → save to Supabase → `onMessage` foreground handler with dedupe (Map of messageId→timestamp, 10s window) + short notification `Audio` chime.
- `src/lib/fcm.functions.ts` — server fns: `saveFcmToken`, `removeFcmToken`.
- `src/lib/fcm.server.ts` — HTTP v1 sender using service account (google-auth-library for OAuth2 access token, then POST to `fcm.googleapis.com/v1/projects/{id}/messages:send`). Prunes tokens on `UNREGISTERED` / `INVALID_ARGUMENT`.
- Replace all `notifyRecipients` / `notifyAnnouncement` call sites in `chat.tsx` and `ops-console-9f2a.tsx` with new `notifyConversation` / `notifyAnnouncement` fns that send via FCM.

**DB migration:**
```sql
DROP TABLE public.push_subscriptions CASCADE;
CREATE TABLE public.fcm_tokens (
  id uuid PK, user_id uuid, owner_admin_id uuid, role text,
  token text UNIQUE, device_info jsonb, last_seen_at, created_at
);
-- RLS: user can manage own tokens; admin can manage own tokens; service_role all
```

Multi-device: one row per token per user (no upsert-by-user).

## Part C — Package Tracking

**DB:**
```sql
CREATE TABLE public.shipments (
  id uuid PK, tracking_number text UNIQUE NOT NULL,
  owner_admin_id uuid NOT NULL,        -- admin that created it
  customer_id uuid,                    -- linked customer (nullable if unassigned)
  conversation_id uuid,                -- link back to chat
  description text, photo_url text,
  sender_name, sender_address,
  receiver_name, receiver_address,
  origin_country, destination_country,
  courier_company, shipping_method,
  estimated_delivery date, notes text,
  status text NOT NULL DEFAULT 'order_created',  -- enum of 10 steps + paused
  is_paused bool DEFAULT false,
  created_at, updated_at
);
CREATE TABLE public.shipment_events (
  id uuid PK, shipment_id uuid, step text, note text,
  created_by uuid, created_at
);
CREATE UNIQUE INDEX ON shipments(tracking_number);
CREATE INDEX ON shipments(owner_admin_id);
CREATE INDEX ON shipments(customer_id);
-- RLS:
--   shipments: admin sees own (owner_admin_id=auth.uid());
--              customer sees where customer_id=auth.uid() OR via tracking_number lookup fn
--   shipment_events: same via join
```

Tracking numbers: `TRK-` + 10-char base32 crockford (collision-checked in txn, retry 3x).

**Timeline steps (fixed enum):**
`order_created → package_received → processing → dispatched → export_customs → international_transit → import_customs → local_distribution → out_for_delivery → delivered` (+ `paused` flag orthogonal).

**Routes (all under `_authenticated` — customers must be signed in):**
- `src/routes/_authenticated/track.tsx` — customer track page: input tracking # → shows details + timeline. Also lists all shipments assigned to `auth.uid()`.
- Admin: extend `ops-console-9f2a.tsx` with a **Shipments** tab → list/create/edit/delete + timeline updater. Photo upload uses existing `chat-photos` bucket via new `shipment-photos` bucket.

**Chat integration:**
- In active conversation view (chat.tsx admin side), add button "Generate Tracking Code" → opens dialog → creates shipment linked to that customer + conversation → inserts a system message with the tracking # into the conversation → sends FCM to customer.
- Customer receives clickable message; clicking navigates to `/track?code=TRK-...`.

**Realtime:**
- Subscribe customer track page to `postgres_changes` on `shipments` (row filter `id=eq.<id>`) and `shipment_events`.
- On admin status change → server fn calls `notifyShipmentUpdate` (FCM to customer).

## Part D — Verification

1. `bunx tsgo --noEmit` — zero errors.
2. Build via harness — zero errors.
3. Playwright headless: sign up user + 2 admins, claim, send message, verify FCM token saved row, generate tracking code, update status, verify realtime + notification row queued.

## Order of execution

1. Request Firebase secrets (after you confirm you've completed steps 1-5 above).
2. Migration: drop push_subscriptions, create fcm_tokens, shipments, shipment_events, storage bucket.
3. Install `firebase` (client) + `google-auth-library` (server); remove `web-push`.
4. Write firebase client + service worker + server sender.
5. Rewire notification call sites.
6. Build shipments admin UI + chat button + `/track` page.
7. Typecheck + build + Playwright smoke test.
8. Delete `VAPID_*` secret usage from code (secrets stay in vault, harmless).

---

**Ready to proceed?** Reply "go" and I'll open the secure form for the Firebase credentials, then implement everything end-to-end. Do NOT paste the service account JSON in chat — the form is encrypted.