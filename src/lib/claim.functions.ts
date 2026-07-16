import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertIsAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Access Denied.");
}

export const claimUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Atomic claim: only succeeds if not already assigned.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("profiles")
      .update({ assigned_admin_id: context.userId, status: "assigned" })
      .eq("id", data.userId)
      .is("assigned_admin_id", null)
      .eq("is_admin", false)
      .select("id")
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) throw new Error("This user has already been assigned.");

    // Create their conversation
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .insert({ user_id: data.userId, owner_admin_id: context.userId })
      .select("id")
      .maybeSingle();
    if (convErr && !convErr.message.includes("duplicate")) throw new Error(convErr.message);

    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      actor_admin_id: context.userId,
      action: "conversation.claim",
      target_type: "conversation",
      target_id: conv?.id ?? null,
      target_owner_admin_id: context.userId,
      metadata: { claimed_user_id: data.userId },
    });

    return { ok: true };
  });

export const releaseUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ assigned_admin_id: null, status: "waiting" })
      .eq("id", data.userId)
      .eq("assigned_admin_id", context.userId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("conversations").delete().eq("user_id", data.userId);
    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      actor_admin_id: context.userId,
      action: "conversation.release",
      target_type: "user",
      target_id: data.userId,
      target_owner_admin_id: context.userId,
    });
    return { ok: true };
  });
