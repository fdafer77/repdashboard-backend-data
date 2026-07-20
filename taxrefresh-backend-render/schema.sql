-- Minimal Postgres schema for TaxRefresh interactive intake

create table if not exists ti_sessions (
  session_code text primary key,
  ghl_contact_id text,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ti_sessions_ghl_contact_id_idx on ti_sessions(ghl_contact_id);

