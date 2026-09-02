-- Minimal Postgres schema for TaxRefresh interactive intake

create table if not exists ti_sessions (
  session_code text primary key,
  ghl_contact_id text,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ti_sessions_ghl_contact_id_idx on ti_sessions(ghl_contact_id);

create table if not exists ti_session_backups (
  id bigserial primary key,
  session_code text not null,
  ghl_contact_id text,
  ghl_opportunity_id text,
  backup_reason text not null default 'session_upsert',
  backup_checksum text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ti_session_backups_session_code_idx on ti_session_backups(session_code);
create index if not exists ti_session_backups_created_at_idx on ti_session_backups(created_at desc);
create index if not exists ti_session_backups_session_code_created_at_idx on ti_session_backups(session_code, created_at desc);
