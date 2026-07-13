import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const subInput = z.object({
  endpoint: z.string().url().max(1000),
  subscription: z.any(),
  kind: z.enum(["user", "admin"]),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => subInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: {
      endpoint: string;
      subscription: unknown;
      role: string;
      owner_admin_id: string | null;
      user_id: string | null;
    } = {
      endpoint: data.endpoint,
      subscription: data.subscription,
      role: data.kind,
      owner_admin_id: data.kind === "admin" ? context.userId : null,
      user_id: data.kind === "user" ? context.userId : null,
    };
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(row as never, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ endpoint: z.string().url() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
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
    const { sendPushToRecipients } = await import("./push.server");

    // Load conversation (RLS) to confirm caller has access
    const { data: conv, error: convErr } = await context.supabase
      .from("conversations")
      .select("id, user_id, owner_admin_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convErr) throw new Error(convErr.message);
    if (!conv) throw new Error("Not authorized");

    // Recipient = whichever party isn't the caller
    const recipientId =
      context.userId === conv.owner_admin_id ? conv.user_id : conv.owner_admin_id;

    let query = supabaseAdmin.from("push_subscriptions").select("subscription, endpoint");
    if (recipientId === conv.owner_admin_id) {
      query = query.eq("owner_admin_id", recipientId);
    } else {
      query = query.eq("user_id", recipientId);
    }
    const { data: subs, error } = await query;
    if (error) throw new Error(error.message);

    const title =
      data.kind === "announcement"
        ? "New announcement"
        : data.kind === "ring"
          ? "Incoming voice call"
          : "1 new message";
    const body = data.preview ?? "";
    const url = recipientId === conv.owner_admin_id ? "/ops-console-9f2a" : "/chat";

    await sendPushToRecipients(subs ?? [], { title, body, url, tag: `conv-${conv.id}` });
    return { ok: true, sent: subs?.length ?? 0 };
  });

export const notifyAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ preview: z.string().max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToRecipients } = await import("./push.server");

    // Confirm caller is admin
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Access Denied.");

    // All users assigned to this admin
    const { data: users } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("assigned_admin_id", context.userId);
    const ids = (users ?? []).map((u) => u.id);
    if (ids.length === 0) return { ok: true, sent: 0 };

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("subscription, endpoint")
      .in("user_id", ids);

    await sendPushToRecipients(subs ?? [], {
      title: "New announcement",
      body: data.preview,
      url: "/chat",
      tag: `ann-${context.userId}`,
    });
    return { ok: true, sent: subs?.length ?? 0 };
  });
