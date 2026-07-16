import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const saveInput = z.object({
  token: z.string().min(20).max(4000),
  kind: z.enum(["user", "admin"]),
  device_info: z.record(z.string(), z.unknown()).optional(),
});

export const saveFcmToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      token: data.token,
      role: data.kind,
      user_id: data.kind === "user" ? context.userId : null,
      owner_admin_id: data.kind === "admin" ? context.userId : null,
      device_info: (data.device_info ?? {}) as never,
      last_seen_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("fcm_tokens")
      .upsert(row as never, { onConflict: "token" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeFcmToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("fcm_tokens")
      .delete()
      .eq("token", data.token)
      .or(`user_id.eq.${context.userId},owner_admin_id.eq.${context.userId}`);
    return { ok: true };
  });

const notifyInput = z.object({
  conversationId: z.string().uuid(),
  kind: z.enum(["message", "announcement", "ring"]),
  preview: z.string().max(200).optional(),
});

export const notifyRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => notifyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendFcmToTokens } = await import("./fcm.server");

    const { data: conv, error: convErr } = await context.supabase
      .from("conversations")
      .select("id, user_id, owner_admin_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convErr) throw new Error(convErr.message);
    if (!conv) throw new Error("Not authorized");

    const recipientId =
      context.userId === conv.owner_admin_id ? conv.user_id : conv.owner_admin_id;

    const query = supabaseAdmin.from("fcm_tokens").select("token");
    const { data: rows, error } =
      recipientId === conv.owner_admin_id
        ? await query.eq("owner_admin_id", recipientId)
        : await query.eq("user_id", recipientId);
    if (error) throw new Error(error.message);

    const title =
      data.kind === "announcement"
        ? "New announcement"
        : data.kind === "ring"
          ? "Incoming voice call"
          : "New message";
    const url = recipientId === conv.owner_admin_id ? "/ops-console-9f2a" : "/chat";
    const tokens = (rows ?? []).map((r) => r.token as string);

    const result = await sendFcmToTokens(tokens, {
      title,
      body: data.preview ?? "",
      url,
      tag: `conv-${conv.id}`,
    });
    return { ok: true, ...result };
  });

export const notifyAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ preview: z.string().max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendFcmToTokens } = await import("./fcm.server");

    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Access Denied.");

    const { data: users } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("assigned_admin_id", context.userId);
    const ids = (users ?? []).map((u) => u.id as string);
    if (ids.length === 0) return { ok: true, sent: 0, invalid: [] };

    const { data: rows } = await supabaseAdmin
      .from("fcm_tokens")
      .select("token")
      .in("user_id", ids);
    const tokens = (rows ?? []).map((r) => r.token as string);

    const result = await sendFcmToTokens(tokens, {
      title: "New announcement",
      body: data.preview,
      url: "/chat",
      tag: `ann-${context.userId}`,
    });
    return { ok: true, ...result };
  });

