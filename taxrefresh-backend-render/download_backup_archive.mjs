import fs from 'fs/promises'
import path from 'path'
import pg from 'pg'

const { Pool } = pg

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

async function ensureOutputDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function main() {
  const RECOVERY_DATABASE_URL = requiredEnv('RECOVERY_DATABASE_URL')
  const requestedArchiveKey = String(process.env.BACKUP_ARCHIVE_KEY || '').trim()
  const outputPath = path.resolve(String(process.env.BACKUP_ARCHIVE_OUTPUT_PATH || '.data/downloaded-backups/latest-backup.json.gz').trim())
  const manifestPath = `${outputPath}.manifest.json`

  const pool = new Pool({ connectionString: RECOVERY_DATABASE_URL, ssl: { rejectUnauthorized: false } })

  try {
    const result = requestedArchiveKey
      ? await pool.query(
          `
            select archive_key, manifest, payload_gzip, created_at
              from ti_backup_archives
             where archive_key = $1
             limit 1
          `,
          [requestedArchiveKey],
        )
      : await pool.query(`
            select archive_key, manifest, payload_gzip, created_at
              from ti_backup_archives
             order by created_at desc
             limit 1
          `)

    const archive = result.rows?.[0] || null
    if (!archive) {
      throw new Error(requestedArchiveKey ? `Backup archive not found: ${requestedArchiveKey}` : 'No backup archives were found.')
    }

    await ensureOutputDir(outputPath)
    await fs.writeFile(outputPath, archive.payload_gzip)
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          archiveKey: archive.archive_key,
          createdAt: archive.created_at ? new Date(archive.created_at).toISOString() : '',
          manifest: archive.manifest || {},
        },
        null,
        2,
      ),
    )

    console.log(`[backup] archive downloaded: ${archive.archive_key}`)
    console.log(`[backup] gzip path: ${outputPath}`)
    console.log(`[backup] manifest path: ${manifestPath}`)
  } finally {
    await pool.end()
  }
}

await main()
