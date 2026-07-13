
# Rebuild Plan: Isolated Two-Admin Support Platform

## Important upfront notes

- **Admin accounts**: The admin account you mentioned lives in a *different* Supabase project (the one behind `global-assistant-support.vercel.app`). I cannot import it into this project's database. You will need to **create both admin accounts fresh here**, using two email addresses you control. I will list them in an allow-list so nobody else can gain admin access.
- **User login**: "Name + 4-digit ID" is not a standard Supabase auth method. I will implement it by creating a synthetic email under the hood (`<slug(name)>-<id>@users.local`) and using Supabase password auth with the 4-digit ID as the password. From the user's perspective they only ever type Name + 4-digit ID. This is the standard, secure way to do this on Supabase.
- **Existing chat code**: The current photo-buddy-chat app will be removed. The new app keeps the same tech stack (TanStack Start + Lovable Cloud/Supabase + Tailwind) but replaces routes, schema, and UI.

## URLs / Routes

```text
/                    Landing + user register / login (Name + 4-digit ID)
/chat                User's chat with their assigned admin (waiting screen if unassigned)
/ops-console-9f2a    Admin login + admin workspace (single portal, both admins)
```

No separate admin domain. Everything on the current preview + published URL.

## Roles & access

- `user_roles` table with `admin` | `user`
- Hard allow-list of exactly two admin emails, enforced in:
  1. RLS policies (`is_admin(uid)` checks membership in `user_roles` where role = admin AND email in allow-list)
  2. Ops-console route guard (redirect + "Access Denied." if not in the allow-list)
  3. A DB trigger on `user_roles` that rejects INSERT of `admin` role for any email not in the allow-list
- Public admin sign-up disabled. Admin accounts created via a one-time seed migration you approve.

## Data model (all with RLS + ownership)

- `profiles` — id, name, four_digit_id (unique), assigned_admin_id (nullable), status (`waiting` | `assigned`), created_at
- `conversations` — id, user_id, owner_admin_id, created_at (auto-created on claim)
- `messages` — id, conversation_id, owner_admin_id, sender_id, content, image_url, voice_url, created_at
- `announcements` — id, owner_admin_id, body, created_at
- `notifications` — id, owner_admin_id, recipient_id, kind, payload, read_at
- `push_subscriptions` — id, endpoint (unique), subscription jsonb, role (`visitor`|`admin`), owner_admin_id, conversation_id
- `admin_allowlist` — email (pk) — the two allowed admin emails
- `audit_log` — id, actor_id, action, target, created_at

Every row-owning table has `owner_admin_id`. RLS: users see rows where `user_id = auth.uid()`; admins see rows where `owner_admin_id = auth.uid()`; service_role for backend push.

Storage bucket `chat-media` (private): path prefixed by `<owner_admin_id>/<conversation_id>/…`, RLS scoped identically.

## Flows

**User register**: enter Name + 4-digit ID → row in `profiles` with `status='waiting'`, `assigned_admin_id=NULL` → auth session created → redirect to `/chat` showing the waiting screen + badge.

**Admin claim**: `/ops-console-9f2a` Waiting Users tab lists profiles where `assigned_admin_id IS NULL`. Claim button calls a `createServerFn` that runs an atomic `UPDATE … WHERE assigned_admin_id IS NULL RETURNING id`. If 0 rows updated → "This user has already been assigned." Race-safe.

**Chat**: Realtime subscription on `messages` scoped by `conversation_id`. Photos + voice recordings upload to `chat-media` and are inserted as messages. Voice call = simple WebRTC peer connection with signaling over a `call_signals` realtime channel (optional stretch; noted below).

**Announcements**: Admin posts → visible only to that admin's assigned users. Real-time push.

**Notifications**: Web Push via VAPID keys.
- `public/sw.js` handles `push` event → `showNotification()` with default OS sound.
- Server function `sendPush` looks up `push_subscriptions` filtered by `owner_admin_id`.
- Users subscribe on `/chat`; admins subscribe on `/ops-console-9f2a`.

**Search / dashboard**: All admin queries filtered by `owner_admin_id = auth.uid()` in both the query and RLS.

## Security

- RLS enabled on every table; deny-by-default; `GRANT`s in the same migration.
- Ownership enforced server-side via RLS + server functions, never trusted from client.
- Zod validation on every server function input; file-type + size checks on uploads.
- Rate limiting on register/login/claim server functions (token bucket in a `rate_limits` table).
- Admin allow-list enforced by trigger + RLS + route guard.
- `SUPABASE_SERVICE_ROLE_KEY` and `VAPID_PRIVATE_KEY` stored as secrets, only used inside server functions/routes.
- Web push endpoint under `/api/public/push/subscribe` verifies bearer token before writing.
- Audit log for admin actions (claim, announcement, delete).
- Secure cookies handled by Supabase client; CSRF not applicable (bearer tokens, no cookie auth for state-changing endpoints).

## Voice calls — scope check

Full 2-way voice calling adds real complexity (WebRTC signaling, TURN server for NAT traversal, call UI, ringing, hangup, missed-call log). I will ship it as **realtime WebRTC over Supabase Realtime signaling with STUN only** — works on most home networks, may fail on strict corporate NATs where a paid TURN service would be needed. If you want guaranteed connectivity everywhere, I'll flag adding a TURN provider as a follow-up.

## What I need from you before I start

1. **Two admin email addresses** you control (I'll add them to the allow-list and create their auth accounts with temporary passwords you rotate on first login).
2. Confirm the synthetic-email approach for Name + 4-digit ID login is OK.
3. Confirm the voice-call scope (STUN-only now, TURN later if needed) is acceptable.

Once you reply with those, I'll execute the rebuild in one pass: remove old routes, run the schema migration (with your approval), scaffold the new routes, wire push, and verify build + a smoke test.
