import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getSharedConversation = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, subject, status, created_at, user_id")
      .eq("share_token", data.token)
      .maybeSingle();
    if (convErr) throw new Error(convErr.message);
    if (!conv) return null;

    const { data: msgs, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select("id, content, image_url, created_at, sender_id")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error(msgErr.message);

    const senderIds = Array.from(new Set((msgs ?? []).map(m => m.sender_id)));
    const { data: profs } = senderIds.length
      ? await supabaseAdmin.from("profiles").select("id, display_name, email").in("id", senderIds)
      : { data: [] as { id: string; display_name: string | null; email: string | null }[] };
    const profileMap: Record<string, { name: string }> = {};
    (profs ?? []).forEach(p => { profileMap[p.id] = { name: p.display_name || p.email || "Unknown" }; });

    const imagePaths = (msgs ?? []).filter(m => m.image_url).map(m => m.image_url!);
    const signedMap: Record<string, string> = {};
    if (imagePaths.length) {
      const { data: signed } = await supabaseAdmin.storage.from("chat-photos").createSignedUrls(imagePaths, 3600);
      signed?.forEach((s, i) => { if (s.signedUrl) signedMap[imagePaths[i]] = s.signedUrl; });
    }

    return {
      subject: conv.subject,
      status: conv.status,
      created_at: conv.created_at,
      owner_id: conv.user_id,
      messages: (msgs ?? []).map(m => ({
        id: m.id,
        content: m.content,
        image_url: m.image_url ? signedMap[m.image_url] ?? null : null,
        created_at: m.created_at,
        sender: profileMap[m.sender_id]?.name || "Unknown",
        sender_id: m.sender_id,
      })),
    };
  });
