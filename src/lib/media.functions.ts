import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSignedMediaUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ paths: z.array(z.string().min(1)).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.paths.length === 0) return { urls: {} as Record<string, string> };
    // Use the user's supabase client so RLS on storage.objects gates access.
    const { data: signed, error } = await context.supabase.storage
      .from("chat-photos")
      .createSignedUrls(data.paths, 3600);
    if (error) throw new Error(error.message);
    const urls: Record<string, string> = {};
    signed?.forEach((s, i) => {
      if (s.signedUrl) urls[data.paths[i]] = s.signedUrl;
    });
    return { urls };
  });
