import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SHIPMENT_STEPS = [
  "order_created",
  "package_received",
  "processing",
  "dispatched",
  "export_customs",
  "international_transit",
  "import_customs",
  "local_distribution",
  "out_for_delivery",
  "delivered",
] as const;
export type ShipmentStep = (typeof SHIPMENT_STEPS)[number];
export const SHIPMENT_STATUSES = [...SHIPMENT_STEPS, "paused"] as const;

const shipmentStatus = z.enum(SHIPMENT_STATUSES);

function makeTrackingNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "LV";
  for (let i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Access Denied.");
}

const createInput = z.object({
  customer_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
  sender_name: z.string().max(200).optional(),
  receiver_name: z.string().max(200).optional(),
  origin: z.string().max(200).optional(),
  destination: z.string().max(200).optional(),
  courier: z.string().max(200).optional(),
  weight: z.string().max(50).optional(),
  estimated_delivery: z.string().optional(),
});

export const createShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Retry on rare tracking-number collision
    for (let attempt = 0; attempt < 4; attempt++) {
      const tn = makeTrackingNumber();
      const { data: ship, error } = await supabaseAdmin
        .from("shipments")
        .insert({
          tracking_number: tn,
          owner_admin_id: context.userId,
          customer_id: data.customer_id,
          conversation_id: data.conversation_id ?? null,
          description: data.description ?? null,
          sender_name: data.sender_name ?? null,
          receiver_name: data.receiver_name ?? null,
          origin: data.origin ?? null,
          destination: data.destination ?? null,
          courier: data.courier ?? null,
          weight: data.weight ?? null,
          estimated_delivery: data.estimated_delivery || null,
          status: "order_created",
        })
        .select("id, tracking_number")
        .maybeSingle();
      if (!error && ship) {
        await supabaseAdmin.from("shipment_events").insert({
          shipment_id: ship.id,
          step: "order_created",
          note: "Shipment created",
          created_by: context.userId,
        });

        // Post a system message into the conversation so the customer sees it.
        if (data.conversation_id) {
          await supabaseAdmin.from("messages").insert({
            conversation_id: data.conversation_id,
            owner_admin_id: context.userId,
            sender_id: context.userId,
            content: `📦 Tracking created: ${ship.tracking_number}. View progress at /tracking`,
          });
        }

        const { writeAuditLog } = await import("./audit.server");
        await writeAuditLog({
          actor_admin_id: context.userId,
          action: "shipment.create",
          target_type: "shipment",
          target_id: ship.id,
          target_owner_admin_id: context.userId,
          metadata: { tracking_number: ship.tracking_number, customer_id: data.customer_id },
        });
        return { id: ship.id, tracking_number: ship.tracking_number };
      }
      if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
    }
    throw new Error("Could not allocate tracking number");
  });

const updateInput = z.object({
  shipment_id: z.string().uuid(),
  status: shipmentStatus,
  note: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
});

export const updateShipmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ship } = await supabaseAdmin
      .from("shipments")
      .select("id, owner_admin_id, tracking_number")
      .eq("id", data.shipment_id)
      .maybeSingle();
    if (!ship || ship.owner_admin_id !== context.userId) throw new Error("Not authorized");

    const { error } = await supabaseAdmin
      .from("shipments")
      .update({ status: data.status })
      .eq("id", data.shipment_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("shipment_events").insert({
      shipment_id: data.shipment_id,
      step: data.status,
      note: data.note ?? null,
      location: data.location ?? null,
      created_by: context.userId,
    });

    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      actor_admin_id: context.userId,
      action: "shipment.status",
      target_type: "shipment",
      target_id: data.shipment_id,
      target_owner_admin_id: context.userId,
      metadata: { status: data.status, note: data.note ?? null },
    });

    // Fire push notification (best-effort)
    try {
      const { notifyShipmentUpdate } = await import("./fcm.functions");
      await notifyShipmentUpdate({ data: { shipmentId: data.shipment_id, status: data.status } });
    } catch {}

    return { ok: true };
  });

export const deleteShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ shipment_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("shipments")
      .delete()
      .eq("id", data.shipment_id)
      .eq("owner_admin_id", context.userId);
    if (error) throw new Error(error.message);
    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      actor_admin_id: context.userId,
      action: "shipment.delete",
      target_type: "shipment",
      target_id: data.shipment_id,
      target_owner_admin_id: context.userId,
    });
    return { ok: true };
  });
