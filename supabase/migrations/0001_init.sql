-- Accounts live in Supabase Auth (auth.users). Roles are in each user's app_metadata.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Question id to chosen value. The customer's own words are never stored.
  answers jsonb not null default '{}',
  -- Null until the profile questions are finished.
  stage text check (stage in ('Needs assessed', 'Quote accepted', 'KYC complete', 'Activated')),
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Admin only: never returned to customers.
  close_reason text,
  explanation text,
  business_name text,
  contact_name text,
  phone text,
  -- What the customer accepted, kept as quoted even if the catalogue changes later.
  quote jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_user_id_idx on public.leads (user_id);

-- One row per change, for the tracker. changed_by is null when the customer's own action caused it.
create table public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  stage text,
  status text not null,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index lead_events_lead_id_idx on public.lead_events (lead_id);

-- With no policies, Supabase's public API can't reach these tables. Only the server's connection can.
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
