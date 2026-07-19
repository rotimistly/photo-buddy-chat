import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Voice notes pipeline (Lovable AI Gateway — no third-party voice cloning):
 *   admin mic recording (webm/opus)
 *     -> STT (openai/gpt-4o-mini-transcribe)  -> transcript text
 *     -> TTS (openai/gpt-4o-mini-tts, voice=ADMIN_VOICE) -> synthesized mp3
 *     -> Supabase Storage + messages row (media_kind="voice")
 *
 * The raw admin recording is NEVER persisted or delivered to the customer.
 * Every admin uses the same AI voice below.
 */
const ADMIN_VOICE = "onyx"; // mature, professional, male-presenting AI voice

const input = z.object({
  conversation_id: z.string().uuid(),
  audio_base64: z.string().min(1),
  mime_type: z.string().default("audio/webm"),
});

export const sendAdminVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => input.parse(v))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI voice is not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Caller must be an admin AND own this conversation.
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

    const raw = Buffer.from(data.audio_base64, "base64");
    if (raw.byteLength === 0) throw new Error("Empty audio");
    if (raw.byteLength > 20 * 1024 * 1024) throw new Error("Audio too large");

    // ---- 1) Speech-to-text ----
    const sttForm = new FormData();
    sttForm.append("file", new Blob([raw], { type: data.mime_type }), "input.webm");
    sttForm.append("model", "openai/gpt-4o-mini-transcribe");
    sttForm.append("response_format", "json");

    const sttRes = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: sttForm,
    });
    if (!sttRes.ok) {
      const errText = await sttRes.text();
      console.error("STT failed", sttRes.status, errText);
      if (sttRes.status === 429) throw new Error("Voice service is busy, please retry");
      if (sttRes.status === 402) throw new Error("AI credits exhausted");
      throw new Error(`Transcription failed (${sttRes.status})`);
    }
    const sttJson = (await sttRes.json()) as { text?: string };
    const transcript = (sttJson.text ?? "").trim();
    if (!transcript) throw new Error("Could not understand audio");

    // ---- 2) Text-to-speech (single shared admin voice) ----
    const ttsRes = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: transcript,
        voice: ADMIN_VOICE,
        response_format: "mp3",
      }),
    });
    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("TTS failed", ttsRes.status, errText);
      if (ttsRes.status === 429) throw new Error("Voice service is busy, please retry");
      if (ttsRes.status === 402) throw new Error("AI credits exhausted");
      throw new Error(`Voice synthesis failed (${ttsRes.status})`);
    }
    const mp3 = new Uint8Array(await ttsRes.arrayBuffer());
    if (mp3.byteLength === 0) throw new Error("Empty synthesized audio");

    // ---- 3) Store synthesized audio only ----
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
      await supabaseAdmin.storage.from("chat-photos").remove([path]).catch(() => {});
      throw new Error(insErr.message);
    }

    return { path };
  });
