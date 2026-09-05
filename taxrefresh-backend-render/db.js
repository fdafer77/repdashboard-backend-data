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
}
