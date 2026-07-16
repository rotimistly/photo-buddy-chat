-- Remove tracking feature
DROP TABLE IF EXISTS public.shipment_events CASCADE;
DROP TABLE IF EXISTS public.shipments CASCADE;

-- Add room_name for LiveKit
ALTER TABLE public.call_history
  ADD COLUMN IF NOT EXISTS room_name text;

-- Realtime for incoming call signaling
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_history;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END$$;
ALTER TABLE public.call_history REPLICA IDENTITY FULL;