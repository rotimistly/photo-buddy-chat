ALTER TABLE public.call_history ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE public.call_history ALTER COLUMN duration_seconds DROP NOT NULL;
ALTER TABLE public.call_history ALTER COLUMN duration_seconds SET DEFAULT 0;