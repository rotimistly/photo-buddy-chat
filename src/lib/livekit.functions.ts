import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const startInput = z.object({
  peer_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable().optional(),
});

async function mintToken(identity: string, roomName: string) {
  const { AccessToken } = await import("livekit-server-sdk");
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity,
    ttl: 60 * 60, // 1h
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

/**
 * Caller initiates a call. Creates a call_history row (status=ringing) with a
 * random LiveKit room, returns caller's token + LiveKit URL. Realtime INSERT
 * notifies the callee, and an FCM push wakes them if the tab is closed.
 */
export const startLivekitCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => startInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.peer_id === context.userId) throw new Error("Cannot call yourself");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authorization: caller must share a conversation with peer, OR both must be admins.
    const [{ data: myRole }, { data: peerRole }] = await Promise.all([
      supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.peer_id)
        .eq("role", "admin")
        .maybeSingle(),
    ]);
    const iAmAdmin = !!myRole;
    const peerIsAdmin = !!peerRole;

    let ownerAdminId: string;
    let convId: string | null = data.conversation_id ?? null;

    if (iAmAdmin && peerIsAdmin) {
      ownerAdminId = context.userId;
      convId = null;
    } else {
      // Must share a conversation
      const adminId = iAmAdmin ? context.userId : data.peer_id;
      const userId = iAmAdmin ? data.peer_id : context.userId;
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("id, owner_admin_id, user_id")
        .eq("owner_admin_id", adminId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!conv) throw new Error("Not authorized to call this user");
      ownerAdminId = conv.owner_admin_id;
      convId = conv.id;
    }

    const roomName = `lk_${crypto.randomUUID()}`;

    const { data: row, error } = await supabaseAdmin
      .from("call_history")
      .insert({
        conversation_id: convId,
        owner_admin_id: ownerAdminId,
        caller_id: context.userId,
        callee_id: data.peer_id,
        status: "ringing",
        room_name: roomName,
        duration_seconds: 0,
      })
      .select("id, room_name")
      .single();
    if (error) throw new Error(error.message);

    // Fire FCM push to peer (best effort, non-blocking on failure).
    try {
      const { sendFcmToTokens } = await import("./fcm.server");
      const { data: tokens } = await supabaseAdmin
        .from("fcm_tokens")
        .select("token")
        .or(`user_id.eq.${data.peer_id},owner_admin_id.eq.${data.peer_id}`);
      const list = (tokens ?? []).map((t) => t.token as string);
      if (list.length) {
        await sendFcmToTokens(list, {
          title: "Incoming voice call",
          body: "Tap to answer",
          url:
            iAmAdmin && peerIsAdmin
              ? "/ops-console-9f2a"
              : peerIsAdmin
                ? "/ops-console-9f2a"
                : "/chat",
          tag: `call-${row.id}`,
        });
      }
    } catch { void 0; }

    const token = await mintToken(context.userId, roomName);
    return {
      room_id: row.id,
      room_name: roomName,
      token,
      url: process.env.LIVEKIT_URL!,
    };
  });

const acceptInput = z.object({ room_id: z.string().uuid() });

export const acceptLivekitCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => acceptInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("call_history")
      .select("id, room_name, callee_id, status")
      .eq("id", data.room_id)
      .maybeSingle();
    if (!row) throw new Error("Call not found");
    if (row.callee_id !== context.userId) throw new Error("Not authorized");
    if (row.status === "ended" || row.status === "declined") throw new Error("Call already ended");
    if (!row.room_name) throw new Error("Call room missing");

    await supabaseAdmin.from("call_history").update({ status: "connected" }).eq("id", data.room_id);

    const token = await mintToken(context.userId, row.room_name);
    return { room_name: row.room_name, token, url: process.env.LIVEKIT_URL! };
  });

const endInput = z.object({
  room_id: z.string().uuid(),
  status: z.enum(["ended", "declined", "missed"]).default("ended"),
  duration_seconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 4)
    .optional(),
});

export const endLivekitCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => endInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("call_history")
      .select("id, caller_id, callee_id, status")
      .eq("id", data.room_id)
      .maybeSingle();
    if (!row) return { ok: true };
    if (row.caller_id !== context.userId && row.callee_id !== context.userId) {
      throw new Error("Not authorized");
    }
    if (row.status === "ended" || row.status === "declined") return { ok: true };

    await supabaseAdmin
      .from("call_history")
      .update({
        status: data.status,
        ended_at: new Date().toISOString(),
        duration_seconds: data.duration_seconds ?? 0,
      })
      .eq("id", data.room_id);

    // Best-effort: delete LiveKit room so both sides fully clean up.
    try {
      const { RoomServiceClient } = await import("livekit-server-sdk");
      const { data: r } = await supabaseAdmin
        .from("call_history")
        .select("room_name")
        .eq("id", data.room_id)
        .maybeSingle();
      if (r?.room_name) {
        const svc = new RoomServiceClient(
          process.env.LIVEKIT_URL!.replace(/^wss?:\/\//, "https://"),
          process.env.LIVEKIT_API_KEY!,
          process.env.LIVEKIT_API_SECRET!,
        );
        await svc.deleteRoom(r.room_name).catch(() => {});
      }
    } catch { void 0; }

    return { ok: true };
  });
