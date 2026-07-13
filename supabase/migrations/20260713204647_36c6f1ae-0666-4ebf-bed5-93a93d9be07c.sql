
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION private.my_assigned_admin()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT assigned_admin_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.admin_seats_available()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(0, 2 - (SELECT COUNT(*)::int FROM public.user_roles WHERE role = 'admin'));
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.my_assigned_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.admin_seats_available() FROM PUBLIC;

-- Rebuild policies to reference private.*
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR id = private.my_assigned_admin()
  OR (private.is_admin(auth.uid()) AND is_admin = false AND (assigned_admin_id IS NULL OR assigned_admin_id = auth.uid()))
);

DROP POLICY IF EXISTS ann_select ON public.announcements;
CREATE POLICY ann_select ON public.announcements FOR SELECT TO authenticated
USING (owner_admin_id = auth.uid() OR owner_admin_id = private.my_assigned_admin());

DROP POLICY IF EXISTS ann_insert_admin_own ON public.announcements;
CREATE POLICY ann_insert_admin_own ON public.announcements FOR INSERT TO authenticated
WITH CHECK (owner_admin_id = auth.uid() AND private.is_admin(auth.uid()));

DROP POLICY IF EXISTS ann_delete_admin_own ON public.announcements;
CREATE POLICY ann_delete_admin_own ON public.announcements FOR DELETE TO authenticated
USING (owner_admin_id = auth.uid() AND private.is_admin(auth.uid()));

-- Drop public helper functions
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_admin(uuid);
DROP FUNCTION IF EXISTS public.my_assigned_admin();
DROP FUNCTION IF EXISTS public.admin_seats_available();

-- Lock down remaining public SECURITY DEFINER trigger functions
REVOKE EXECUTE ON FUNCTION public.profiles_update_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_admin_limit() FROM PUBLIC;

-- Chat-photos storage policy cleanup
DROP POLICY IF EXISTS "Authenticated can upload chat photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own chat photos" ON storage.objects;

CREATE POLICY chat_media_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-photos'
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(objects.name))[2]
      AND c.owner_admin_id::text = (storage.foldername(objects.name))[1]
      AND (c.user_id = auth.uid() OR c.owner_admin_id = auth.uid())
  )
);
