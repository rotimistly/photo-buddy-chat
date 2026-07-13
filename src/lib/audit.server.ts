// Server-only helper to append immutable audit rows via service-role.
// Import lazily inside server-function handlers.
export async function writeAuditLog(entry: {
  actor_admin_id: string;
  action: string;
  target_type: "conversation" | "photo" | "user" | "announcement" | string;
  target_id?: string | null;
  target_owner_admin_id?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("audit_logs" as never).insert({
    actor_admin_id: entry.actor_admin_id,
    action: entry.action,
    target_type: entry.target_type,
    target_id: entry.target_id ?? null,
    target_owner_admin_id: entry.target_owner_admin_id ?? entry.actor_admin_id,
    metadata: entry.metadata ?? {},
  } as never);
  if (error) console.error("[audit] failed to write:", error.message);
}
