import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * ONE cloned voice for every admin. Never change per-admin — customers must
 * always hear this exact voice for every admin voice note.
 */
const ADMIN_VOICE_ID = "lUTamkMw7gOzZbFIwmq4";

const input = z.object({
  conversation_id: z.string().uuid(),
  // Raw admin mic recording (webm/opus), base64 encoded (no data: prefix).
  audio_base64: z.string().min(1),
  mime_type: z.string().default("audio/webm"),
});

/**
 * Admin-only: convert a freshly recorded voice note through ElevenLabs
 * Speech-to-Speech (cloned voice), upload the synthesized MP3 to Supabase
 * Storage, insert a `messages` row pointing at it, and return the path.
 *
 * The original raw recording is NEVER written to storage or the database.
 * Only the synthesized cloned-voice MP3 leaves this function.
 */
export const sendAdminVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => input.parse(v))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ElevenLabs is not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify the caller is an admin AND owns the conversation.
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Forbidden");

    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, owner_admin_id")
      .eq("id", data.conversation_id)
      .maybeSingle();
    if (!conv || conv.owner_admin_id !== context.userId) {
      throw new Error("Not authorized for this conversation");
    }

    // Decode base64 raw mic recording (kept in memory only).
    const raw = Buffer.from(data.audio_base64, "base64");
    if (raw.byteLength === 0) throw new Error("Empty audio");
    if (raw.byteLength > 20 * 1024 * 1024) throw new Error("Audio too large");

    // Send to ElevenLabs Speech-to-Speech with the single admin voice.
    const form = new FormData();
    form.append("audio", new Blob([raw], { type: data.mime_type }), "input.webm");
    form.append("model_id", "eleven_multilingual_sts_v2");
    form.append("remove_background_noise", "true");

    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/speech-to-speech/${ADMIN_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      },
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("ElevenLabs STS failed", ttsRes.status, errText);
      throw new Error(`Voice synthesis failed (${ttsRes.status})`);
    }

    const mp3 = new Uint8Array(await ttsRes.arrayBuffer());
    if (mp3.byteLength === 0) throw new Error("Empty synthesized audio");

    const path = `${conv.owner_admin_id}/${conv.id}/${Date.now()}-${crypto.randomUUID()}.mp3`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("chat-photos")
      .upload(path, mp3, { contentType: "audio/mpeg", upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: insErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conv.id,
      owner_admin_id: conv.owner_admin_id,
      sender_id: context.userId,
      media_path: path,
      media_kind: "voice",
    });
    if (insErr) {
      // best-effort cleanup so we don't leak the object
      await supabaseAdmin.storage.from("chat-photos").remove([path]).catch(() => {});
      throw new Error(insErr.message);
    }

    return { path };
  });
