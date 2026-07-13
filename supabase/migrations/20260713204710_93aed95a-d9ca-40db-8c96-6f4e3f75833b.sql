
REVOKE EXECUTE ON FUNCTION public.profiles_update_guard() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_admin_limit() FROM anon, authenticated;
