import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deriveUserEmail, isFourDigitCode, isValidName, slugifyName } from "./user-identity";

const registerUserInput = z.object({
  name: z.string().trim().min(1).max(40),
  code: z.string().regex(/^\d{4}$/),
});

export const registerUser = createServerFn({ method: "POST" })
  .inputValidator((input) => registerUserInput.parse(input))
  .handler(async ({ data }) => {
    if (!isValidName(data.name) || !isFourDigitCode(data.code)) {
      throw new Error("Invalid name or code");
    }
    const email = deriveUserEmail(data.name, data.code);
    const password = `usr_${data.code}_${slugifyName(data.name)}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check collision by name+code
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("name_lower" as never, data.name.toLowerCase())
      .eq("four_digit_id", data.code)
      .maybeSingle();
    if (existing) throw new Error("This name and code are already taken. Try another 4-digit code.");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: data.name.trim(), kind: "user" },
    });
    if (createErr || !created.user) {
      // If email already exists (same slug+code but not in profiles table)
      throw new Error(createErr?.message || "Failed to create account");
    }

    const userId = created.user.id;

    const { error: profErr } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      name: data.name.trim(),
      four_digit_id: data.code,
      is_admin: false,
      status: "waiting",
    });
    if (profErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw new Error(profErr.message);
    }

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "user" });
    if (roleErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw new Error(roleErr.message);
    }

    return { email, password };
  });

/** Returns the derived email + password so the client can sign in. */
export const lookupUserCredentials = createServerFn({ method: "POST" })
  .inputValidator((input) => registerUserInput.parse(input))
  .handler(async ({ data }) => {
    return {
      email: deriveUserEmail(data.name, data.code),
      password: `usr_${data.code}_${slugifyName(data.name)}`,
    };
  });

/** How many admin seats remain (of 2 total). Public — used by the ops-console. */
export const getAdminSeats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("user_roles")
    .select("*", { head: true, count: "exact" })
    .eq("role", "admin");
  if (error) throw new Error(error.message);
  const used = count ?? 0;
  return { used, remaining: Math.max(0, 2 - used) };
});

const registerAdminInput = z.object({
  name: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

export const registerAdmin = createServerFn({ method: "POST" })
  .inputValidator((input) => registerAdminInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Recount atomically-ish; the DB trigger is the ultimate guarantee.
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { head: true, count: "exact" })
      .eq("role", "admin");
    if ((count ?? 0) >= 2) throw new Error("Admin registration is closed. Two administrators already exist.");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name.trim(), kind: "admin" },
    });
    if (createErr || !created.user) throw new Error(createErr?.message || "Failed to create admin");

    const userId = created.user.id;

    const { error: profErr } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      name: data.name.trim(),
      four_digit_id: null,
      is_admin: true,
      status: "assigned",
    });
    if (profErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw new Error(profErr.message);
    }

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "admin" });
    if (roleErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      if (roleErr.message.includes("admin_limit_reached")) {
        throw new Error("Admin registration is closed. Two administrators already exist.");
      }
      throw new Error(roleErr.message);
    }

    return { email: data.email.trim().toLowerCase() };
  });
