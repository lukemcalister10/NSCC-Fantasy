-- Durable reset attempts; no password, hash, token, key or request body is recorded.
BEGIN;
CREATE TABLE public.admin_password_reset_audit (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  season_id uuid NOT NULL REFERENCES public.seasons(id),
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX admin_password_reset_actor_time ON public.admin_password_reset_audit(actor_id,created_at DESC);
CREATE INDEX admin_password_reset_target_time ON public.admin_password_reset_audit(target_id,created_at DESC);
ALTER TABLE public.admin_password_reset_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_password_reset_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_password_reset_audit TO authenticated;
CREATE POLICY manager_read_password_reset_audit ON public.admin_password_reset_audit
  FOR SELECT TO authenticated USING (app.is_manager());
COMMIT;
