import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { gzipSync } from 'zlib'
import pg from 'pg'

const { Pool } = pg

const FULL_TABLE_SPECS = [
  { name: 'ti_sessions', orderBy: 'updated_at desc' },
  { name: 'ti_notes', orderBy: 'updated_at desc' },
  { name: 'ti_ea_documents', orderBy: 'updated_at desc' },
  { name: 'ti_ea_activity_timeline', orderBy: 'updated_at desc' },
  { name: 'ti_ea_case_state', orderBy: 'updated_at desc' },
  { name: 'ti_document_receipts', orderBy: 'updated_at desc' },
  { name: 'ti_consultation_profiles', orderBy: 'updated_at desc' },
  { name: 'ti_consultation_case_facts', orderBy: 'updated_at desc' },
  { name: 'ti_billing_accounts', orderBy: 'updated_at desc' },
  { name: 'ti_billing_schedule_rows', orderBy: 'updated_at desc' },
  { name: 'ti_consultation_financial_profiles', orderBy: 'updated_at desc' },
  { name: 'ti_canopy_client_sync', orderBy: 'updated_at desc' },
  { name: 'ti_canopy_oauth_tokens', orderBy: 'updated_at desc' },
]

const HISTORY_TABLE_SPECS = [
  { name: 'ti_session_backups', dateColumn: 'created_at', orderBy: 'created_at desc' },
  { name: 'ti_billing_audit', dateColumn: 'created_at', orderBy: 'created_at desc' },
  { name: 'ti_events', dateColumn: 'created_at', orderBy: 'created_at desc' },
  { name: 'ti_canopy_sync_jobs', dateColumn: 'updated_at', orderBy: 'updated_at desc' },
]

const BILLING_TABLE_NAMES = new Set(['ti_billing_accounts', 'ti_billing_schedule_rows', 'ti_billing_audit'])

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name) {
  return String(process.env[name] || '').trim()
}

function optionalIntEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function buildArchiveKey() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const suffix = crypto.randomBytes(4).toString('hex')
  return `backup-${stamp}-${suffix}`
}

async function ensureRecoveryArchiveTables(pool) {
  await pool.query(`
    create table if not exists ti_backup_archives (
      id bigserial primary key,
      archive_key text not null unique,
      source_database text not null default '',
      source_host text not null default '',
      backup_reason text not null default 'scheduled_archive',
      schema_version text not null default 'v1',
      manifest jsonb not null default '{}'::jsonb,
      payload_gzip bytea not null,
      created_at timestamptz not null default now()
    );
  `)
  await pool.query(`create index if not exists ti_backup_archives_created_at_idx on ti_backup_archives(created_at desc);`)
  await pool.query(`
    create table if not exists ti_backup_runs (
      id bigserial primary key,
      archive_key text,
      status text not null default 'started',
      details jsonb not null default '{}'::jsonb,
      started_at timestamptz not null default now(),
      completed_at timestamptz
    );
  `)
  await pool.query(`create index if not exists ti_backup_runs_started_at_idx on ti_backup_runs(started_at desc);`)
}

async function tableExists(pool, tableName) {
  const result = await pool.query(`select to_regclass($1) as relation_name`, [tableName])
  return Boolean(result.rows?.[0]?.relation_name)
}

async function fetchTableRows(pool, spec, historyDays) {
  if (!(await tableExists(pool, spec.name))) {
    return {
      rows: [],
      exported: false,
      reason: 'table_missing',
    }
  }

  const queryParts = [`select * from ${spec.name}`]
  const values = []
  if (spec.dateColumn) {
    values.push(Math.max(1, Number(historyDays || 45)))
    queryParts.push(`where ${spec.dateColumn} >= now() - make_interval(days => $1::int)`)
  }
  if (spec.orderBy) {
    queryParts.push(`order by ${spec.orderBy}`)
  }
  const rows = (await pool.query(queryParts.join(' '), values)).rows || []
  return {
    rows,
    exported: true,
    reason: '',
  }
}

async function getSourceIdentity(pool) {
  const result = await pool.query(`
    select
      current_database() as database_name,
      coalesce(inet_server_addr()::text, '') as host,
      version() as server_version
  `)
  return result.rows?.[0] || {
    database_name: '',
    host: '',
    server_version: '',
  }
}

async function pruneOldArchives(pool, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0
  const result = await pool.query(
    `delete from ti_backup_archives where created_at < now() - make_interval(days => $1::int)`,
    [Math.max(1, Number(retentionDays || 30))],
  )
  return Number(result.rowCount || 0)
}

async function writeLocalCopy(archiveKey, payloadBuffer) {
  const enabled = String(process.env.BACKUP_ARCHIVE_WRITE_LOCAL_COPY || '0').trim() === '1'
  if (!enabled) return ''
  const outputDir = String(process.env.BACKUP_ARCHIVE_LOCAL_DIR || '.data/backups').trim() || '.data/backups'
  await fs.mkdir(outputDir, { recursive: true })
  const outputPath = path.resolve(outputDir, `${archiveKey}.json.gz`)
  await fs.writeFile(outputPath, payloadBuffer)
  return outputPath
}

async function main() {
  const PROD_DATABASE_URL = requiredEnv('PROD_DATABASE_URL')
  const RECOVERY_DATABASE_URL = requiredEnv('RECOVERY_DATABASE_URL')
  const BILLING_DATABASE_URL = optionalEnv('BILLING_DATABASE_URL')
  const BACKUP_ARCHIVE_HISTORY_DAYS = optionalIntEnv('BACKUP_ARCHIVE_HISTORY_DAYS', 45)
  const BACKUP_ARCHIVE_RETENTION_DAYS = optionalIntEnv('BACKUP_ARCHIVE_RETENTION_DAYS', 30)
  const BACKUP_ARCHIVE_REASON = String(process.env.BACKUP_ARCHIVE_REASON || 'scheduled_archive').trim() || 'scheduled_archive'

  const prodPool = new Pool({ connectionString: PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const billingPool = BILLING_DATABASE_URL ? new Pool({ connectionString: BILLING_DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null
  const recoveryPool = new Pool({ connectionString: RECOVERY_DATABASE_URL, ssl: { rejectUnauthorized: false } })

  let backupRunId = 0
  const archiveKey = buildArchiveKey()

  try {
    await ensureRecoveryArchiveTables(recoveryPool)
    const runInsert = await recoveryPool.query(
      `insert into ti_backup_runs(archive_key, status, details) values ($1, 'started', $2) returning id`,
      [
        archiveKey,
        {
          historyDays: BACKUP_ARCHIVE_HISTORY_DAYS,
          retentionDays: BACKUP_ARCHIVE_RETENTION_DAYS,
          reason: BACKUP_ARCHIVE_REASON,
        },
      ],
    )
    backupRunId = Number(runInsert.rows?.[0]?.id || 0)

    const sourceIdentity = await getSourceIdentity(prodPool)
    const billingSourceIdentity = billingPool ? await getSourceIdentity(billingPool) : null
    const tablePayload = {}
    const tableManifest = {}
    const exportStartedAt = new Date().toISOString()

    for (const spec of [...FULL_TABLE_SPECS, ...HISTORY_TABLE_SPECS]) {
      const sourcePool = BILLING_TABLE_NAMES.has(spec.name) && billingPool ? billingPool : prodPool
      const sourceRole = BILLING_TABLE_NAMES.has(spec.name) && billingPool ? 'billing' : 'primary'
      const sourceMeta = sourceRole === 'billing' && billingSourceIdentity ? billingSourceIdentity : sourceIdentity
      const startedAt = Date.now()
      const { rows, exported, reason } = await fetchTableRows(sourcePool, spec, BACKUP_ARCHIVE_HISTORY_DAYS)
      const encodedRows = JSON.stringify(rows)
      tablePayload[spec.name] = rows
      tableManifest[spec.name] = {
        rowCount: rows.length,
        exported,
        reason,
        sourceRole,
        sourceDatabase: String(sourceMeta?.database_name || ''),
        sourceHost: String(sourceMeta?.host || ''),
        historyWindowDays: spec.dateColumn ? BACKUP_ARCHIVE_HISTORY_DAYS : null,
        checksum: sha256(encodedRows),
        durationMs: Date.now() - startedAt,
      }
      console.log(`[backup] ${spec.name} (${sourceRole}): ${rows.length} rows`)
    }

    const payload = {
      archiveKey,
      schemaVersion: 'v1',
      reason: BACKUP_ARCHIVE_REASON,
      exportedAt: new Date().toISOString(),
      exportStartedAt,
      source: {
        primary: {
          database: String(sourceIdentity.database_name || ''),
          host: String(sourceIdentity.host || ''),
          serverVersion: String(sourceIdentity.server_version || ''),
        },
        billing: billingSourceIdentity
          ? {
              database: String(billingSourceIdentity.database_name || ''),
              host: String(billingSourceIdentity.host || ''),
              serverVersion: String(billingSourceIdentity.server_version || ''),
            }
          : null,
      },
      tables: tablePayload,
    }

    const payloadJson = JSON.stringify(payload)
    const payloadGzip = gzipSync(Buffer.from(payloadJson, 'utf8'), { level: 9 })
    const manifest = {
      archiveKey,
      schemaVersion: 'v1',
      reason: BACKUP_ARCHIVE_REASON,
      createdAt: payload.exportedAt,
      payloadBytes: Buffer.byteLength(payloadJson),
      payloadGzipBytes: payloadGzip.length,
      payloadChecksum: sha256(payloadJson),
      historyWindowDays: BACKUP_ARCHIVE_HISTORY_DAYS,
      source: payload.source,
      tables: tableManifest,
    }

    await recoveryPool.query(
      `
        insert into ti_backup_archives(
          archive_key,
          source_database,
          source_host,
          backup_reason,
          schema_version,
          manifest,
          payload_gzip
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        archiveKey,
        String(payload.source.primary?.database || ''),
        String(payload.source.primary?.host || ''),
        BACKUP_ARCHIVE_REASON,
        'v1',
        manifest,
        payloadGzip,
      ],
    )

    const prunedArchiveCount = await pruneOldArchives(recoveryPool, BACKUP_ARCHIVE_RETENTION_DAYS)
    const localCopyPath = await writeLocalCopy(archiveKey, payloadGzip)

    if (backupRunId > 0) {
      await recoveryPool.query(
        `
          update ti_backup_runs
             set status = 'completed',
                 completed_at = now(),
                 details = $2
           where id = $1
        `,
        [
          backupRunId,
          {
            manifest,
            prunedArchiveCount,
            localCopyPath,
          },
        ],
      )
    }

    console.log(`[backup] archive stored: ${archiveKey}`)
    console.log(`[backup] compressed size: ${manifest.payloadGzipBytes} bytes`)
    console.log(`[backup] pruned archives: ${prunedArchiveCount}`)
    if (localCopyPath) {
      console.log(`[backup] local copy written: ${localCopyPath}`)
    }
  } catch (error) {
    if (backupRunId > 0) {
      try {
        await recoveryPool.query(
          `
            update ti_backup_runs
               set status = 'failed',
                   completed_at = now(),
                   details = $2
             where id = $1
          `,
          [
            backupRunId,
            {
              error: error instanceof Error ? error.message : String(error),
            },
          ],
        )
      } catch {
        // Ignore secondary failure while trying to record backup status.
      }
    }
    console.error('[backup] archive failed:', error)
    process.exitCode = 1
  } finally {
    await Promise.allSettled([prodPool.end(), billingPool ? billingPool.end() : Promise.resolve(), recoveryPool.end()])
  }
}

await main()
