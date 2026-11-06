-- One row per KYC attempt on a lead. Only the decision and the already-masked findings are kept (DPDP):
-- document images and raw OCR text are never stored.
create table public.kyc_checks (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  decision text not null check (decision in ('APPROVE', 'MANUAL_REVIEW', 'REJECT')),
  findings jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index kyc_checks_lead_id_idx on public.kyc_checks (lead_id, created_at desc);

-- Same as the other tables: no policies, so only the server's connection can reach it.
alter table public.kyc_checks enable row level security;
