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

create table if not exists ti_document_receipts (
  receipt_id text primary key,
  session_code text not null,
  name text not null default '',
  document_code text not null default '',
  status text not null default '',
  method text not null default '',
  recipient_email text not null default '',
  sent_at timestamptz,
  signed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actor_email text
);

create index if not exists ti_document_receipts_session_code_idx on ti_document_receipts(session_code);
create index if not exists ti_document_receipts_session_code_updated_at_idx on ti_document_receipts(session_code, updated_at desc);

create table if not exists ti_consultation_profiles (
  session_code text primary key,
  ghl_contact_id text,
  ghl_opportunity_id text,
  client_name text not null default '',
  email text not null default '',
  phone text not null default '',
  state_code text not null default '',
  postal_code text not null default '',
  date_of_birth text not null default '',
  ssn text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actor_email text
);

create index if not exists ti_consultation_profiles_contact_id_idx on ti_consultation_profiles(ghl_contact_id);
create index if not exists ti_consultation_profiles_opportunity_id_idx on ti_consultation_profiles(ghl_opportunity_id);
create index if not exists ti_consultation_profiles_email_idx on ti_consultation_profiles(email);
create index if not exists ti_consultation_profiles_phone_idx on ti_consultation_profiles(phone);
create index if not exists ti_consultation_profiles_updated_at_idx on ti_consultation_profiles(updated_at desc);

create table if not exists ti_consultation_case_facts (
  session_code text primary key,
  ghl_contact_id text,
  ghl_opportunity_id text,
  tax_type text not null default '',
  tax_agency text not null default '',
  tax_situation text not null default '',
  filing_status text not null default '',
  irs_balance numeric(12, 2),
  state_balance numeric(12, 2),
  total_liability numeric(12, 2),
  owe_years text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actor_email text
);

create index if not exists ti_consultation_case_facts_contact_id_idx on ti_consultation_case_facts(ghl_contact_id);
create index if not exists ti_consultation_case_facts_opportunity_id_idx on ti_consultation_case_facts(ghl_opportunity_id);
create index if not exists ti_consultation_case_facts_updated_at_idx on ti_consultation_case_facts(updated_at desc);

create table if not exists ti_billing_schedule_rows (
  id bigserial primary key,
  session_code text not null,
  ghl_contact_id text,
  ghl_opportunity_id text,
  billing_scope text not null default 'all',
  row_key text not null,
  scheduled_date date,
  amount numeric(12, 2),
  status_tone text not null default 'pending',
  status_label text not null default '',
  raw_status text not null default '',
  failure_reason text not null default '',
  processor_reason text not null default '',
  reason text not null default '',
  processed_at timestamptz,
  stripe_payment_intent_id text not null default '',
  processed_stripe_customer_id text not null default '',
  processed_stripe_payment_method_id text not null default '',
  processed_payment_method_brand text not null default '',
  processed_payment_method_last4 text not null default '',
  processed_payment_method_type text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actor_email text,
  unique(session_code, row_key)
);

create index if not exists ti_billing_schedule_rows_session_code_idx on ti_billing_schedule_rows(session_code);
create index if not exists ti_billing_schedule_rows_contact_id_idx on ti_billing_schedule_rows(ghl_contact_id);
create index if not exists ti_billing_schedule_rows_opportunity_id_idx on ti_billing_schedule_rows(ghl_opportunity_id);
create index if not exists ti_billing_schedule_rows_scope_date_idx on ti_billing_schedule_rows(billing_scope, scheduled_date);
create index if not exists ti_billing_schedule_rows_processed_at_idx on ti_billing_schedule_rows(processed_at desc);
create index if not exists ti_billing_schedule_rows_payment_intent_idx on ti_billing_schedule_rows(stripe_payment_intent_id);

create table if not exists ti_consultation_financial_profiles (
  session_code text primary key,
  ghl_contact_id text,
  ghl_opportunity_id text,
  profile_complete boolean not null default false,
  current_step integer not null default 0,
  step_label text not null default '',
  completion_percent numeric(5, 2) not null default 0,
  employment_status text not null default '',
  filing_status text not null default '',
  monthly_income numeric(12, 2),
  monthly_expenses numeric(12, 2),
  monthly_net numeric(12, 2),
  total_assets numeric(12, 2),
  last_saved_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  draft_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actor_email text
);

create index if not exists ti_consultation_financial_profiles_contact_id_idx on ti_consultation_financial_profiles(ghl_contact_id);
create index if not exists ti_consultation_financial_profiles_opportunity_id_idx on ti_consultation_financial_profiles(ghl_opportunity_id);
create index if not exists ti_consultation_financial_profiles_complete_idx on ti_consultation_financial_profiles(profile_complete, updated_at desc);
create index if not exists ti_consultation_financial_profiles_updated_at_idx on ti_consultation_financial_profiles(updated_at desc);
