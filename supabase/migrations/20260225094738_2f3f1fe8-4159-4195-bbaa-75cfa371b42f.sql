
-- 1. enrich_ai_sessions — tracks AI normalization sessions
CREATE TABLE public.enrich_ai_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  import_job_id UUID REFERENCES public.import_jobs(id),
  run_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrich_ai_sessions_org_job_run
  ON public.enrich_ai_sessions (organization_id, import_job_id, run_id);

ALTER TABLE public.enrich_ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY enrich_ai_sessions_rw ON public.enrich_ai_sessions
  FOR ALL
  USING (public.is_service_role() OR public.is_org_member(organization_id))
  WITH CHECK (public.is_service_role() OR public.is_org_member(organization_id));

-- 2. enrich_ai_actions_log — logs AI-generated actions/patches
CREATE TABLE public.enrich_ai_actions_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  import_job_id UUID REFERENCES public.import_jobs(id),
  run_id TEXT,
  action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrich_ai_actions_org_job_run
  ON public.enrich_ai_actions_log (organization_id, import_job_id, run_id);

ALTER TABLE public.enrich_ai_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY enrich_ai_actions_log_rw ON public.enrich_ai_actions_log
  FOR ALL
  USING (public.is_service_role() OR public.is_org_member(organization_id))
  WITH CHECK (public.is_service_role() OR public.is_org_member(organization_id));

-- 3. enrich_user_decisions — stores user decisions on normalization questions
CREATE TABLE public.enrich_user_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  import_job_id UUID REFERENCES public.import_jobs(id),
  run_id TEXT,
  question_type TEXT NOT NULL,
  decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrich_user_decisions_org_job_run
  ON public.enrich_user_decisions (organization_id, import_job_id, run_id);

ALTER TABLE public.enrich_user_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY enrich_user_decisions_rw ON public.enrich_user_decisions
  FOR ALL
  USING (public.is_service_role() OR public.is_org_member(organization_id))
  WITH CHECK (public.is_service_role() OR public.is_org_member(organization_id));
