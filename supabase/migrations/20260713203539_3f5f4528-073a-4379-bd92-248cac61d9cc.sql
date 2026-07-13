
-- ============================================================
-- WIPE OLD SCHEMA (photo-buddy-chat)
-- ============================================================
DROP POLICY IF EXISTS "chat photos scoped read" ON storage.objects;
DROP POLICY IF EXISTS "chat photos insert own" ON storage.objects;
DROP POLICY IF EXISTS "chat photos delete own" ON storage.objects;
DROP POLICY IF EXISTS "chat photos update own" ON storage.objects;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.is_support(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.touch_conversation() CASCADE;

DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;

-- ============================================================
-- ROLES
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Enforce max 2 admins at the database level
CREATE OR REPLACE FUNCTION public.enforce_admin_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') >= 2 THEN
      RAISE EXCEPTION 'admin_limit_reached' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_roles_enforce_admin_limit
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_limit();

-- Helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_seats_available()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(0, 2 - (SELECT COUNT(*)::int FROM public.user_roles WHERE role = 'admin'));
$$;
REVOKE EXECUTE ON FUNCTION public.admin_seats_available() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_seats_available() TO anon, authenticated, service_role;

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  name_lower text GENERATED ALWAYS AS (lower(name)) STORED,
  four_digit_id text CHECK (four_digit_id ~ '^[0-9]{4}$'),
  is_admin boolean NOT NULL DEFAULT false,
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','assigned')),
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name_lower, four_digit_id)
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.my_assigned_admin()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT assigned_admin_id FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_assigned_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_assigned_admin() TO authenticated, service_role;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR id = public.my_assigned_admin()
  OR (
    public.is_admin(auth.uid())
    AND is_admin = false
    AND (assigned_admin_id IS NULL OR assigned_admin_id = auth.uid())
  )
);

CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Prevent privilege-escalation columns from being edited by end users
CREATE OR REPLACE FUNCTION public.profiles_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user = 'service_role' OR current_user = 'postgres' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.four_digit_id IS DISTINCT FROM OLD.four_digit_id
     OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
     OR NEW.assigned_admin_id IS DISTINCT FROM OLD.assigned_admin_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable_field' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_update_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_update_guard();

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_admin_read_at timestamptz DEFAULT to_timestamp(0),
  last_user_read_at timestamptz DEFAULT to_timestamp(0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conv_select" ON public.conversations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR owner_admin_id = auth.uid());
CREATE POLICY "conv_update_read" ON public.conversations FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR owner_admin_id = auth.uid())
  WITH CHECK (user_id = auth.uid() OR owner_admin_id = auth.uid());

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text CHECK (content IS NULL OR char_length(content) <= 4000),
  media_path text,
  media_kind text CHECK (media_kind IS NULL OR media_kind IN ('image','voice','file')),
  media_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_created_idx ON public.messages (conversation_id, created_at DESC);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "msg_select" ON public.messages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND (c.user_id = auth.uid() OR c.owner_admin_id = auth.uid())
  )
);
CREATE POLICY "msg_insert" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.owner_admin_id = messages.owner_admin_id
      AND (c.user_id = auth.uid() OR c.owner_admin_id = auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.touch_conversation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER msg_touch_conv
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_owner_created_idx ON public.announcements (owner_admin_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ann_select" ON public.announcements FOR SELECT TO authenticated USING (
  owner_admin_id = auth.uid() OR owner_admin_id = public.my_assigned_admin()
);
CREATE POLICY "ann_insert_admin_own" ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (owner_admin_id = auth.uid() AND public.is_admin(auth.uid()));
CREATE POLICY "ann_delete_admin_own" ON public.announcements FOR DELETE TO authenticated
  USING (owner_admin_id = auth.uid() AND public.is_admin(auth.uid()));

-- ============================================================
-- PUSH SUBSCRIPTIONS
-- ============================================================
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text UNIQUE NOT NULL,
  subscription jsonb NOT NULL,
  role text NOT NULL CHECK (role IN ('user','admin')),
  owner_admin_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subs_owner_idx ON public.push_subscriptions (owner_admin_id);
CREATE INDEX push_subs_user_idx ON public.push_subscriptions (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_manage_own" ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR owner_admin_id = auth.uid())
  WITH CHECK (user_id = auth.uid() OR owner_admin_id = auth.uid());

-- ============================================================
-- CALL HISTORY
-- ============================================================
CREATE TABLE public.call_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ringing','completed','missed','declined','failed')),
  duration_seconds int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX call_history_owner_started_idx ON public.call_history (owner_admin_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.call_history TO authenticated;
GRANT ALL ON public.call_history TO service_role;
ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_select" ON public.call_history FOR SELECT TO authenticated
  USING (caller_id = auth.uid() OR callee_id = auth.uid() OR owner_admin_id = auth.uid());
CREATE POLICY "call_insert" ON public.call_history FOR INSERT TO authenticated
  WITH CHECK (caller_id = auth.uid());
CREATE POLICY "call_update" ON public.call_history FOR UPDATE TO authenticated
  USING (caller_id = auth.uid() OR callee_id = auth.uid())
  WITH CHECK (caller_id = auth.uid() OR callee_id = auth.uid());

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_history;

-- ============================================================
-- STORAGE (chat-photos bucket, path: <owner_admin_id>/<conversation_id>/<file>)
-- ============================================================
CREATE POLICY "chat_media_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-photos'
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.owner_admin_id::text = (storage.foldername(name))[1]
      AND (c.user_id = auth.uid() OR c.owner_admin_id = auth.uid())
  )
);
CREATE POLICY "chat_media_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-photos'
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.owner_admin_id::text = (storage.foldername(name))[1]
      AND (c.user_id = auth.uid() OR c.owner_admin_id = auth.uid())
  )
);
