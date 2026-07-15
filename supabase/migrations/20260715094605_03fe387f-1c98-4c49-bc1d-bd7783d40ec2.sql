
-- 1. FCM tokens (replaces push_subscriptions)
CREATE TABLE public.fcm_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_admin_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','admin')),
  token text NOT NULL UNIQUE,
  device_info jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fcm_tokens TO authenticated;
GRANT ALL ON public.fcm_tokens TO service_role;
ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own token read" ON public.fcm_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR owner_admin_id = auth.uid());
CREATE POLICY "own token write" ON public.fcm_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid() OR owner_admin_id = auth.uid())
  WITH CHECK (user_id = auth.uid() OR owner_admin_id = auth.uid());
CREATE INDEX idx_fcm_tokens_user ON public.fcm_tokens(user_id);
CREATE INDEX idx_fcm_tokens_owner ON public.fcm_tokens(owner_admin_id);

-- 2. Drop legacy push_subscriptions
DROP TABLE IF EXISTS public.push_subscriptions CASCADE;

-- 3. Shipment status enum (10-step + paused)
CREATE TYPE public.shipment_status AS ENUM (
  'order_created','package_received','processing','dispatched',
  'export_customs','international_transit','import_customs',
  'local_distribution','out_for_delivery','delivered','paused'
);

-- 4. Shipments
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL UNIQUE,
  owner_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  description text,
  sender_name text,
  receiver_name text,
  origin text,
  destination text,
  courier text,
  weight text,
  estimated_delivery date,
  status public.shipment_status NOT NULL DEFAULT 'order_created',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manages own shipments" ON public.shipments FOR ALL TO authenticated
  USING (owner_admin_id = auth.uid())
  WITH CHECK (owner_admin_id = auth.uid());
CREATE POLICY "customer reads own shipments" ON public.shipments FOR SELECT TO authenticated
  USING (customer_id = auth.uid());
CREATE INDEX idx_shipments_customer ON public.shipments(customer_id);
CREATE INDEX idx_shipments_owner ON public.shipments(owner_admin_id);

-- 5. Shipment events (timeline)
CREATE TABLE public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  step public.shipment_status NOT NULL,
  note text,
  location text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.shipment_events TO authenticated;
GRANT ALL ON public.shipment_events TO service_role;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin writes events on own shipments" ON public.shipment_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND s.owner_admin_id = auth.uid()));
CREATE POLICY "parties read events" ON public.shipment_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND (s.owner_admin_id = auth.uid() OR s.customer_id = auth.uid())));
CREATE INDEX idx_shipment_events_shipment ON public.shipment_events(shipment_id, created_at DESC);

-- 6. Updated_at trigger reuse
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_events;
ALTER TABLE public.shipments REPLICA IDENTITY FULL;
ALTER TABLE public.shipment_events REPLICA IDENTITY FULL;
