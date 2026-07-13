
-- 1. Scope chat-photos read policy to owner folder or support
DROP POLICY IF EXISTS "Authenticated can read chat photos" ON storage.objects;
CREATE POLICY "Users read own chat photos or support"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-photos'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.is_support(auth.uid())
    )
  );

-- 2. Restrict profiles reads to self or support
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
CREATE POLICY "Users view own profile or support"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_support(auth.uid()));

-- 3. Revoke EXECUTE on SECURITY DEFINER functions from public/anon/authenticated.
-- handle_new_user is a trigger fn (runs as definer, no direct calls needed).
-- has_role/is_support are only needed inside RLS/other definer functions;
-- since they are SECURITY DEFINER and called from other SECURITY DEFINER
-- policies via the postgres owner, we revoke from client roles.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_support(uuid) FROM PUBLIC, anon;
