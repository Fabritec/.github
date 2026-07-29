-- Fabritec Lead Intelligence — initial schema.
--
-- Supabase is the source of truth. The Google Sheet and the .xlsx export are
-- views of these tables and carry no data of their own.
--
-- Run this in the Supabase SQL editor, or via `supabase db push`.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- runs: one row per discovery/qualification campaign execution
-- ---------------------------------------------------------------------------
create table if not exists public.runs (
  id                  uuid primary key default gen_random_uuid(),
  run_ref             text not null unique,
  campaign_name       text not null,
  criteria            jsonb not null default '{}'::jsonb,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null default 'running'
                        check (status in ('running', 'completed', 'failed')),
  companies_found     integer not null default 0,
  companies_qualified integer not null default 0,
  contacts_found      integer not null default 0,
  duplicates_removed  integer not null default 0,
  rejected            integer not null default 0,
  sent_to_review      integer not null default 0,
  export_filename     text,
  error               text
);

create index if not exists runs_started_at_idx on public.runs (started_at desc);

-- ---------------------------------------------------------------------------
-- leads: one row per company, updated in place across runs — never duplicated
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                   uuid primary key default gen_random_uuid(),
  lead_ref             text not null unique,
  company_name         text not null,
  website              text,
  domain               text,
  country              text,
  city                 text,
  address              text,
  phone                text,
  industry             text,
  vertical             text check (vertical in
                         ('steel','aluminium','precast','peb','modular','joinery','job_shop','other')),
  icp_segment          text,
  segment_key          text,
  capacity_band        text not null default 'unknown'
                         check (capacity_band in ('unknown','micro','small','mid','large')),
  employee_range       text,
  manufacturing_model  text check (manufacturing_model in
                         ('project_based','job_shop','make_to_order','repetitive_mass','unknown')),
  fit_score            integer check (fit_score between 0 and 100),
  confidence           integer check (confidence between 0 and 100),
  priority_segment     text check (priority_segment in ('A','B','C','D')),
  qualification_status text not null default 'pending'
                         check (qualification_status in
                           ('qualified','nurture','rejected','review','pending')),
  qualification_reason text,
  pain_signals         text[] not null default '{}',
  outreach_angle       text,
  rejection_reasons    text[] not null default '{}',
  detailing_software   text[] not null default '{}',
  source               text not null,
  source_url           text,
  provider_company_id  text,

  -- Dedupe key #3: normalised company name + country. Set by the pipeline.
  name_country_key     text,

  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  last_enriched_at     timestamptz,
  original_run_id      uuid references public.runs (id) on delete set null,
  latest_run_id        uuid references public.runs (id) on delete set null,
  previous_score       integer,
  current_score        integer,
  changed_fields       text[] not null default '{}',

  crm_status           text not null default 'new',
  assigned_to          text,
  notes                text,

  facts                jsonb,
  score_breakdown      jsonb
);

-- The three company-matching rules, in priority order. Partial unique indexes
-- so multiple leads without a domain don't collide on null.
create unique index if not exists leads_domain_key
  on public.leads (domain) where domain is not null;
create unique index if not exists leads_provider_key
  on public.leads (provider_company_id) where provider_company_id is not null;
create unique index if not exists leads_name_country_key
  on public.leads (name_country_key) where name_country_key is not null;

create index if not exists leads_status_idx        on public.leads (qualification_status);
create index if not exists leads_segment_idx       on public.leads (priority_segment);
create index if not exists leads_segment_key_idx   on public.leads (segment_key);
create index if not exists leads_score_idx         on public.leads (fit_score desc);
create index if not exists leads_first_seen_idx    on public.leads (first_seen_at desc);
create index if not exists leads_latest_run_idx    on public.leads (latest_run_id);
create index if not exists leads_country_idx       on public.leads (country);

-- ---------------------------------------------------------------------------
-- contacts: the buying committee, two to four per qualified company
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  contact_ref        text not null unique,
  lead_id            uuid not null references public.leads (id) on delete cascade,
  full_name          text not null,
  job_title          text,
  persona_type       text not null default 'unknown'
                       check (persona_type in
                         ('economic_buyer','operational_champion','technical_influencer',
                          'alternate','unknown')),
  email              text,
  email_status       text not null default 'unknown'
                       check (email_status in
                         ('verified','accept_all','unverified','invalid','unknown')),
  phone              text,
  profile_url        text,
  seniority          text,
  contact_score      integer not null default 0 check (contact_score between 0 and 100),
  source             text not null,
  provider_person_id text,

  -- Dedupe key #3 for contacts: normalised name + company domain.
  name_domain_key    text,

  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

create unique index if not exists contacts_email_key
  on public.contacts (email) where email is not null;
create unique index if not exists contacts_provider_key
  on public.contacts (provider_person_id) where provider_person_id is not null;
create unique index if not exists contacts_name_domain_key
  on public.contacts (name_domain_key) where name_domain_key is not null;

create index if not exists contacts_lead_idx  on public.contacts (lead_id);
create index if not exists contacts_score_idx on public.contacts (contact_score desc);

-- ---------------------------------------------------------------------------
-- evidence: why a lead scored the way it did, with source URLs
-- ---------------------------------------------------------------------------
create table if not exists public.evidence (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  evidence_type text not null,
  finding       text not null,
  source_url    text,
  collected_at  timestamptz not null default now(),
  ai_confidence text not null default 'low' check (ai_confidence in ('high','medium','low'))
);

create index if not exists evidence_lead_idx on public.evidence (lead_id);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The pipeline connects with the service-role key, which bypasses RLS. These
-- policies exist so that if you later point a browser client at these tables
-- with an anon key, it gets read-only access rather than everything.
-- ---------------------------------------------------------------------------
alter table public.runs     enable row level security;
alter table public.leads    enable row level security;
alter table public.contacts enable row level security;
alter table public.evidence enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'leads' and policyname = 'leads_read') then
    create policy leads_read on public.leads for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'contacts' and policyname = 'contacts_read') then
    create policy contacts_read on public.contacts for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'evidence' and policyname = 'evidence_read') then
    create policy evidence_read on public.evidence for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'runs' and policyname = 'runs_read') then
    create policy runs_read on public.runs for select to authenticated using (true);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Convenience view: the actionable pipeline, highest score first
-- ---------------------------------------------------------------------------
create or replace view public.v_actionable_leads as
select
  l.lead_ref,
  l.company_name,
  l.website,
  l.country,
  l.city,
  l.icp_segment,
  l.priority_segment,
  l.fit_score,
  l.confidence,
  l.qualification_status,
  l.outreach_angle,
  l.segment_key,
  l.crm_status,
  l.assigned_to,
  l.first_seen_at,
  l.last_seen_at,
  (select count(*) from public.contacts c where c.lead_id = l.id) as contact_count
from public.leads l
where l.qualification_status in ('qualified', 'nurture')
order by l.fit_score desc nulls last;
