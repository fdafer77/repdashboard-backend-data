import pg from 'pg'

const { Pool } = pg

function isPlaceholderDatabaseUrl(url = '') {
  const normalized = String(url || '').trim()
  if (!normalized) return true
  return (
    normalized.includes('USER:PASSWORD@HOST') ||
    normalized.includes('/DBNAME') ||
    normalized.includes('@HOST:') ||
    normalized.includes('://USER:')
  )
}

export function getPool() {
  const url = process.env.DATABASE_URL
  if (!url || isPlaceholderDatabaseUrl(url)) return null
  const pool = new Pool({
    connectionString: url,
    // Fly + many managed Postgres providers require SSL in production.
    ssl: process.env.DB_SSL === '0' ? false : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
    keepAlive: true,
    keepAliveInitialDelayMillis: Number(process.env.DB_KEEPALIVE_INITIAL_DELAY_MS || 10000),
  })
  pool.on('error', (error) => {
    console.error('Postgres pool error:', {
      name: error?.name || 'Error',
      message: error?.message || String(error || ''),
      stack: error?.stack || '',
    })
  })
  return pool
}

export async function ensureSchema(pool) {
  await pool.query(`
    create table if not exists ti_sessions (
      session_code text primary key,
      ghl_contact_id text,
      ghl_opportunity_id text,
      state jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `)
  await pool.query(`alter table ti_sessions add column if not exists ghl_opportunity_id text;`)
  await pool.query(`create index if not exists ti_sessions_ghl_contact_id_idx on ti_sessions(ghl_contact_id);`)
  await pool.query(`create index if not exists ti_sessions_ghl_opportunity_id_idx on ti_sessions(ghl_opportunity_id);`)
  await pool.query(`create index if not exists ti_sessions_updated_at_idx on ti_sessions(updated_at desc);`)

  // Immutable audit log for billing and payment changes (forensics + recovery).
  await pool.query(`
    create table if not exists ti_billing_audit (
      id bigserial primary key,
      session_code text not null,
      event_type text not null,
      billing_mode text,
      actor_email text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `)
  await pool.query(`create index if not exists ti_billing_audit_session_code_idx on ti_billing_audit(session_code);`)
  await pool.query(`create index if not exists ti_billing_audit_created_at_idx on ti_billing_audit(created_at desc);`)

  // Append-only consultation backups for durable recovery of client profile, billing,
  // payment methods/history, and signed-document state.
  await pool.query(`
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
  `)
  await pool.query(`create index if not exists ti_session_backups_session_code_idx on ti_session_backups(session_code);`)
  await pool.query(`create index if not exists ti_session_backups_created_at_idx on ti_session_backups(created_at desc);`)
  await pool.query(`create index if not exists ti_session_backups_session_code_created_at_idx on ti_session_backups(session_code, created_at desc);`)

  // Append-only event log for forensics + recovery.
  // This is the backbone for "data is never lost" investigations.
  await pool.query(`
    create table if not exists ti_events (
      id bigserial primary key,
      session_code text not null,
      event_type text not null,
      domain text,
      actor_email text,
      idempotency_key text,
      request_id text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `)
  await pool.query(`create index if not exists ti_events_session_code_idx on ti_events(session_code);`)
  await pool.query(`create index if not exists ti_events_created_at_idx on ti_events(created_at desc);`)
  await pool.query(`create index if not exists ti_events_session_code_created_at_idx on ti_events(session_code, created_at desc);`)
  await pool.query(`create index if not exists ti_events_event_type_idx on ti_events(event_type);`)
  // Only enforce idempotency uniqueness when a key is present.
  await pool.query(
    `create unique index if not exists ti_events_session_code_idempotency_key_uq on ti_events(session_code, idempotency_key) where idempotency_key is not null;`,
  )

  // Notes as first-class durable records (instead of only being embedded in session JSON).
  await pool.query(`
    create table if not exists ti_notes (
      note_id text primary key,
      session_code text not null,
      body text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      actor_email text
    );
  `)
  await pool.query(`create index if not exists ti_notes_session_code_idx on ti_notes(session_code);`)
  await pool.query(`create index if not exists ti_notes_session_code_updated_at_idx on ti_notes(session_code, updated_at desc);`)
  await pool.query(`create index if not exists ti_notes_session_code_archived_at_idx on ti_notes(session_code, archived_at);`)

  // Document receipts as first-class durable records (instead of only embedded in session JSON).
  await pool.query(`
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
  `)
  await pool.query(`create index if not exists ti_document_receipts_session_code_idx on ti_document_receipts(session_code);`)
  await pool.query(
    `create index if not exists ti_document_receipts_session_code_updated_at_idx on ti_document_receipts(session_code, updated_at desc);`,
  )

  // Critical client profile fields as a durable projection separate from ti_sessions.state.answers.
  await pool.query(`
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
  `)
  await pool.query(`create index if not exists ti_consultation_profiles_contact_id_idx on ti_consultation_profiles(ghl_contact_id);`)
  await pool.query(`create index if not exists ti_consultation_profiles_opportunity_id_idx on ti_consultation_profiles(ghl_opportunity_id);`)
  await pool.query(`create index if not exists ti_consultation_profiles_email_idx on ti_consultation_profiles(email);`)
  await pool.query(`create index if not exists ti_consultation_profiles_phone_idx on ti_consultation_profiles(phone);`)
  await pool.query(`create index if not exists ti_consultation_profiles_updated_at_idx on ti_consultation_profiles(updated_at desc);`)

  // Critical case facts as a durable projection separate from ti_sessions.state.answers.
  await pool.query(`
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
  `)
  await pool.query(`create index if not exists ti_consultation_case_facts_contact_id_idx on ti_consultation_case_facts(ghl_contact_id);`)
  await pool.query(`create index if not exists ti_consultation_case_facts_opportunity_id_idx on ti_consultation_case_facts(ghl_opportunity_id);`)
  await pool.query(`create index if not exists ti_consultation_case_facts_updated_at_idx on ti_consultation_case_facts(updated_at desc);`)

  // Billing schedule rows as first-class durable records for stable revenue analytics.
  await pool.query(`
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
  `)
  await pool.query(`create index if not exists ti_billing_schedule_rows_session_code_idx on ti_billing_schedule_rows(session_code);`)
  await pool.query(`create index if not exists ti_billing_schedule_rows_contact_id_idx on ti_billing_schedule_rows(ghl_contact_id);`)
  await pool.query(`create index if not exists ti_billing_schedule_rows_opportunity_id_idx on ti_billing_schedule_rows(ghl_opportunity_id);`)
  await pool.query(`create index if not exists ti_billing_schedule_rows_scope_date_idx on ti_billing_schedule_rows(billing_scope, scheduled_date);`)
  await pool.query(`create index if not exists ti_billing_schedule_rows_processed_at_idx on ti_billing_schedule_rows(processed_at desc);`)
  await pool.query(`create index if not exists ti_billing_schedule_rows_payment_intent_idx on ti_billing_schedule_rows(stripe_payment_intent_id);`)

  // Financial profile progression as a durable projection separate from ti_sessions.state.answers.
  await pool.query(`
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
  `)
  await pool.query(`create index if not exists ti_consultation_financial_profiles_contact_id_idx on ti_consultation_financial_profiles(ghl_contact_id);`)
  await pool.query(`create index if not exists ti_consultation_financial_profiles_opportunity_id_idx on ti_consultation_financial_profiles(ghl_opportunity_id);`)
  await pool.query(`create index if not exists ti_consultation_financial_profiles_complete_idx on ti_consultation_financial_profiles(profile_complete, updated_at desc);`)
  await pool.query(`create index if not exists ti_consultation_financial_profiles_updated_at_idx on ti_consultation_financial_profiles(updated_at desc);`)
}
