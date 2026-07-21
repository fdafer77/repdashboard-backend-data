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
  return new Pool({
    connectionString: url,
    // Fly + many managed Postgres providers require SSL in production.
    ssl: process.env.DB_SSL === '0' ? false : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX || 10),
  })
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
}
