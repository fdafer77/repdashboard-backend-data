import 'dotenv/config'
import http from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import { Server as SocketIOServer } from 'socket.io'
import { customAlphabet } from 'nanoid'
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import jwt from 'jsonwebtoken'
import Stripe from 'stripe'
import { ensureSchema, getPool } from './db.js'
import crypto from 'node:crypto'
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'

const PORT = Number(process.env.PORT || 3001)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*'
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''
const EXPERIENCE_BASE_URL = process.env.EXPERIENCE_BASE_URL || ''
const REP_JWT_SECRET = process.env.REP_JWT_SECRET || process.env.JWT_SECRET || ''
const REP_PASSWORD = process.env.REP_PASSWORD || ''
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET || ''
const GHL_SYNC_WEBHOOK_URL = String(process.env.GHL_SYNC_WEBHOOK_URL || '').trim()
const GHL_SYNC_WEBHOOK_SECRET = String(process.env.GHL_SYNC_WEBHOOK_SECRET || '').trim()
const GHL_SYNC_WEBHOOK_HEADER = String(process.env.GHL_SYNC_WEBHOOK_HEADER || 'x-webhook-secret').trim()
const BOLDSIGN_WEBHOOK_SECRET = String(process.env.BOLDSIGN_WEBHOOK_SECRET || '').trim()
const CALENDLY_API_BASE_URL = String(process.env.CALENDLY_API_BASE_URL || 'https://api.calendly.com').trim().replace(/\/$/, '')
const CALENDLY_PERSONAL_ACCESS_TOKEN = String(process.env.CALENDLY_PERSONAL_ACCESS_TOKEN || '').trim()
const CALENDLY_WEBHOOK_SIGNING_KEY = String(process.env.CALENDLY_WEBHOOK_SIGNING_KEY || 'taxrefresh_calendly_sync_2026').trim()
const CALENDLY_WEBHOOK_SCOPE = String(process.env.CALENDLY_WEBHOOK_SCOPE || 'user').trim().toLowerCase() === 'organization' ? 'organization' : 'user'
const CALENDLY_EVENT_TYPE_URIS = String(process.env.CALENDLY_EVENT_TYPE_URIS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const GHL_API_BASE_URL = String(process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com').trim().replace(/\/$/, '')
const GHL_PRIVATE_INTEGRATION_TOKEN = String(process.env.GHL_PRIVATE_INTEGRATION_TOKEN || '').trim()
const GHL_LOCATION_ID = String(process.env.GHL_LOCATION_ID || '').trim()
const GHL_INSECURE_SSL = String(process.env.GHL_INSECURE_SSL || '').trim() === '1'

if (GHL_INSECURE_SSL) {
  // Local dev workaround for environments missing the correct certificate chain.
  // WARNING: this disables TLS certificate validation for outbound HTTPS requests in this process.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}
const ADMIN_DASHBOARD_PASSCODE = String(process.env.ADMIN_DASHBOARD_PASSCODE || process.env.INTERNAL_DASHBOARD_PASSCODE || '').trim()
const ADMIN_OWNER_PASSWORD_DEFAULTS = {
  'farouk.dafer@taxrefresh.info': 'kjICOLSwD5)*T$tT@Lp495',
  'zach.risheq@taxrefresh.info': 'Rweg2F1&VCx2q^UNJ$eFZg',
}
const SESSION_STORE_PATH = path.resolve(process.env.SESSION_STORE_PATH || path.join(process.cwd(), '.data', 'sessions.json'))
const OUTBOUND_EMAILS_DISABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.DISABLE_OUTBOUND_EMAILS || process.env.DISABLE_CLIENT_EMAILS || '').trim().toLowerCase(),
)
const OUTBOUND_8821_EMAILS_DISABLED = OUTBOUND_EMAILS_DISABLED || ['1', 'true', 'yes', 'on'].includes(String(process.env.DISABLE_8821_EMAILS || '').trim().toLowerCase())
const INTEGRITY_REPAIR_WORKER_DISABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.DISABLE_RECORD_INTEGRITY_REPAIR_WORKER || '').trim().toLowerCase())
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim()
const STRIPE_PUBLISHABLE_KEY = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim()
const GOOGLE_PLACES_SERVER_API_KEY = String(
  process.env.GOOGLE_PLACES_SERVER_API_KEY ||
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.GOOGLE_SERVER_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    '',
).trim()
const SOFT_CREDIT_CHECK_PROVIDER = 'Experian'
const SOFT_CREDIT_CHECK_CONSENT_VERSION = String(process.env.SOFT_CREDIT_CHECK_CONSENT_VERSION || '2026-07-30-v1').trim()
const EXPERIAN_SOFT_PULL_URL = String(process.env.EXPERIAN_SOFT_PULL_URL || '').trim()
const EXPERIAN_SOFT_PULL_BEARER_TOKEN = String(process.env.EXPERIAN_SOFT_PULL_BEARER_TOKEN || '').trim()
const EXPERIAN_SOFT_PULL_USERNAME = String(process.env.EXPERIAN_SOFT_PULL_USERNAME || '').trim()
const EXPERIAN_SOFT_PULL_PASSWORD = String(process.env.EXPERIAN_SOFT_PULL_PASSWORD || '').trim()
const EXPERIAN_OAUTH_TOKEN_URL = String(process.env.EXPERIAN_OAUTH_TOKEN_URL || '').trim()
const EXPERIAN_OAUTH_CLIENT_ID = String(process.env.EXPERIAN_OAUTH_CLIENT_ID || '').trim()
const EXPERIAN_OAUTH_CLIENT_SECRET = String(process.env.EXPERIAN_OAUTH_CLIENT_SECRET || '').trim()
const EXPERIAN_OAUTH_USERNAME = String(process.env.EXPERIAN_OAUTH_USERNAME || EXPERIAN_SOFT_PULL_USERNAME || '').trim()
const EXPERIAN_OAUTH_PASSWORD = String(process.env.EXPERIAN_OAUTH_PASSWORD || EXPERIAN_SOFT_PULL_PASSWORD || '').trim()
const EXPERIAN_OAUTH_SCOPE = String(process.env.EXPERIAN_OAUTH_SCOPE || 'user').trim()
const EXPERIAN_CLIENT_REFERENCE_ID = String(process.env.EXPERIAN_CLIENT_REFERENCE_ID || 'SBMYSQL').trim() || 'SBMYSQL'
const EXPERIAN_REQUESTOR_SUBSCRIBER_CODE = String(process.env.EXPERIAN_REQUESTOR_SUBSCRIBER_CODE || '').trim()
const EXPERIAN_PERMISSIBLE_PURPOSE_TYPE = String(process.env.EXPERIAN_PERMISSIBLE_PURPOSE_TYPE || '').trim()
const EXPERIAN_PERMISSIBLE_PURPOSE_TERMS = String(process.env.EXPERIAN_PERMISSIBLE_PURPOSE_TERMS || '').trim()
const EXPERIAN_PERMISSIBLE_PURPOSE_ABBREVIATED_AMOUNT = String(process.env.EXPERIAN_PERMISSIBLE_PURPOSE_ABBREVIATED_AMOUNT || '').trim()
const EXPERIAN_RISK_MODEL_INDICATORS = String(process.env.EXPERIAN_RISK_MODEL_INDICATORS || '').trim()
const EXPERIAN_RISK_MODEL_SCORE_PERCENTILE = String(process.env.EXPERIAN_RISK_MODEL_SCORE_PERCENTILE || '').trim()

const BOLDSIGN_8821_TEMPLATE_ID_MFJ_FALLBACK = '36137e86-e99e-4bb6-8565-71516f0523d6'
const BOLDSIGN_8821_TEMPLATE_ID_SINGLE_FALLBACK = 'fbc11c0d-8e8c-467c-8deb-bacd47d628e6'
const EXPERIAN_SUMMARY_TYPES = String(process.env.EXPERIAN_SUMMARY_TYPES || '').trim()
const EXPERIAN_OUTPUT_TYPE = String(process.env.EXPERIAN_OUTPUT_TYPE || '').trim()
const EXPERIAN_OUTPUT_HEADING = String(process.env.EXPERIAN_OUTPUT_HEADING || '').trim()
const EXPERIAN_SOFT_PULL_API_KEY = String(process.env.EXPERIAN_SOFT_PULL_API_KEY || '').trim()
const EXPERIAN_SOFT_PULL_API_KEY_HEADER = String(process.env.EXPERIAN_SOFT_PULL_API_KEY_HEADER || 'x-api-key').trim()
const EXPERIAN_SOFT_PULL_USE_MOCK = String(process.env.EXPERIAN_SOFT_PULL_USE_MOCK || '').trim() === '1'
const EXPERIAN_SOFT_PULL_TIMEOUT_MS = Math.max(3000, Number(process.env.EXPERIAN_SOFT_PULL_TIMEOUT_MS || 15000) || 15000)
let experianOAuthTokenCache = {
  accessToken: '',
  expiresAt: 0,
}
let calendlyIdentityCache = {
  fetchedAt: 0,
  resource: null,
}

const DEFAULT_GHL_CONTACT_FIELDS = [
  { slug: 'portal_session_code', name: 'Portal Session Code' },
  { slug: 'taxrefresh_client_portal_link', name: 'TaxRefresh Client Portal Link' },
  { slug: 'taxrefresh_rep_portal_link', name: 'TaxRefresh Rep Portal Link' },
  { slug: 'taxrefresh_onboarding_status', name: 'TaxRefresh Onboarding Status' },
  { slug: 'taxrefresh_form_8821_status', name: 'TaxRefresh Form 8821 Status' },
  { slug: 'taxrefresh_completed_at', name: 'TaxRefresh Completed At' },
]
const DEFAULT_GHL_OPPORTUNITY_FIELDS = [
  { slug: 'begin_red', name: 'Begin RED' },
  { slug: 'red_session_code', name: 'RED Session Code' },
  { slug: 'red_client_portal_link', name: 'RED Client Portal Link' },
  { slug: 'red_onboarding_status', name: 'RED Onboarding Status' },
  { slug: 'red_form_8821_status', name: 'RED Form 8821 Status' },
  { slug: 'red_completed_at', name: 'RED Completed At' },
]

const pool = getPool()
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null
if (pool) {
  // eslint-disable-next-line no-console
  ensureSchema(pool).catch((e) => console.error('DB schema init failed:', e))
}

// DB circuit-breaker to avoid hammering Postgres during Render restarts/maintenance windows.
// This does NOT change any DB data; it only reduces repeated connection attempts/log spam and
// keeps the app responsive by using the existing file-store fallback when possible.
const DB_CIRCUIT_COOLDOWN_MS = Math.max(5_000, Number(process.env.DB_CIRCUIT_COOLDOWN_MS || 30_000) || 30_000)
const DB_CIRCUIT_LOG_THROTTLE_MS = Math.max(1_000, Number(process.env.DB_CIRCUIT_LOG_THROTTLE_MS || 10_000) || 10_000)
const DB_RECOVERY_MERGE_WINDOW_MS = Math.max(60_000, Number(process.env.DB_RECOVERY_MERGE_WINDOW_MS || 10 * 60_000) || 10 * 60_000)
const DB_CIRCUIT_PROBE_INTERVAL_MS = Math.max(1_000, Number(process.env.DB_CIRCUIT_PROBE_INTERVAL_MS || 2_000) || 2_000)
// When enabled, the backend refuses to write to the local file-store fallback.
// This prevents the system from "appearing to save" while Postgres is unavailable,
// which is a major source of data trust issues.
const STRICT_DB_MODE = String(process.env.STRICT_DB_MODE || '').trim() === '1' || String(process.env.STRICT_DB_MODE || '').trim().toLowerCase() === 'true'
let dbCircuitOpenUntil = 0
let dbLastFailureAt = 0
let dbLastFailureMessage = ''
let dbLastFailureLoggedAt = 0
let dbLastProbeAt = 0

function isDbCircuitOpen() {
  return Boolean(pool && Date.now() < dbCircuitOpenUntil)
}

function getRequestId(req) {
  return (
    String(req.headers['x-request-id'] || '').trim() ||
    String(req.headers['x-amzn-trace-id'] || '').trim() ||
    String(req.headers['cf-ray'] || '').trim() ||
    ''
  )
}

async function probeDbAndMaybeCloseCircuit({ timeoutMs = 1500 } = {}) {
  if (!pool) return false
  const now = Date.now()
  if (!isDbCircuitOpen()) return true
  if (now - dbLastProbeAt < DB_CIRCUIT_PROBE_INTERVAL_MS) return false
  dbLastProbeAt = now

  // Best-effort probe: if Postgres is already back, close the circuit early so we stop serving
  // "db_circuit_open" for the full cooldown window.
  try {
    await Promise.race([
      pool.query('select 1 as ok'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db probe timeout')), timeoutMs)),
    ])
    dbCircuitOpenUntil = 0
    return true
  } catch (error) {
    // Do not extend circuit on probe failure here; recordDbFailure will extend when real queries fail.
    return false
  }
}

function isTransientDbConnectionError(error) {
  const message = String(error instanceof Error ? error.message : error || '').toLowerCase()
  if (!message) return false
  return (
    message.includes('not yet accepting connections') ||
    message.includes('terminating connection') ||
    message.includes('connection terminated') ||
    message.includes('connection refused') ||
    message.includes('econnrefused') ||
    message.includes('server closed the connection') ||
    message.includes('timeout') ||
    message.includes('etimedout')
  )
}

async function dbInsertEvent({
  sessionCode = '',
  eventType = '',
  domain = '',
  actorEmail = '',
  idempotencyKey = '',
  requestId = '',
  payload = {},
} = {}) {
  if (!pool) return false
  if (isDbCircuitOpen()) return false
  const normalizedSessionCode = String(sessionCode || '').trim()
  const normalizedEventType = String(eventType || '').trim()
  if (!normalizedSessionCode || !normalizedEventType) return false
  const normalizedIdempotencyKey = String(idempotencyKey || '').trim()
  const resolvedIdempotencyKey = normalizedIdempotencyKey ? normalizedIdempotencyKey : null
  try {
    await pool.query(
      `
      insert into ti_events(session_code, event_type, domain, actor_email, idempotency_key, request_id, payload)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (session_code, idempotency_key) where idempotency_key is not null do nothing
    `,
      [
        normalizedSessionCode,
        normalizedEventType,
        String(domain || '').trim() || null,
        String(actorEmail || '').trim() || null,
        resolvedIdempotencyKey,
        String(requestId || '').trim() || null,
        payload && typeof payload === 'object' ? payload : { value: payload },
      ],
    )
    return true
  } catch (error) {
    recordDbFailure('dbInsertEvent failed:', error, { sessionCode: normalizedSessionCode, eventType: normalizedEventType })
    return false
  }
}

function buildSnapshotMeta({ source = 'db', updatedAt } = {}) {
  const normalizedSource = String(source || '').trim() || 'unknown'
  const updatedMs = updatedAt ? new Date(updatedAt).getTime() : Date.now()
  const safeUpdatedMs = Number.isFinite(updatedMs) ? updatedMs : Date.now()
  return {
    dbReady: Boolean(pool) && !isDbCircuitOpen(),
    source: normalizedSource,
    updatedAt: new Date(safeUpdatedMs).toISOString(),
    snapshotVersion: safeUpdatedMs,
  }
}

function buildSnapshotMetaFromItems(items = [], { source = 'db' } = {}) {
  const maxUpdatedMs = (Array.isArray(items) ? items : []).reduce((maxValue, item) => {
    const candidate = new Date(item?.updatedAt || item?.createdAt || 0).getTime()
    if (!Number.isFinite(candidate)) return maxValue
    return Math.max(maxValue, candidate)
  }, 0)
  return buildSnapshotMeta({ source, updatedAt: maxUpdatedMs || Date.now() })
}

function buildDeterministicId(prefix, seed = '') {
  const normalizedPrefix = String(prefix || 'id').trim() || 'id'
  const normalizedSeed = String(seed || '').trim()
  const digest = crypto.createHash('sha256').update(`${normalizedPrefix}:${normalizedSeed}`).digest('hex').slice(0, 24)
  return `${normalizedPrefix}_${digest}`
}

function normalizeConsultationNotesValue(value) {
  const list = parseStoredObject(value, [])
  if (!Array.isArray(list)) return []
  return list
    .filter((note) => note && typeof note === 'object')
    .map((note) => ({
      id: String(note.id || '').trim(),
      title: String(note.title || '').trim(),
      content: String(note.content || '').trim(),
      author: String(note.author || '').trim(),
      ownerKey: String(note.ownerKey || '').trim(),
      archived: Boolean(note.archived),
      createdAt: String(note.createdAt || '').trim(),
      updatedAt: String(note.updatedAt || '').trim(),
    }))
    .filter((note) => note.id && (note.title || note.content))
}

async function dbUpsertNoteRecord({ sessionCode, note, actorEmail = '' } = {}) {
  if (!pool || isDbCircuitOpen()) {
    if (STRICT_DB_MODE) {
      const error = new Error('Database is temporarily unavailable.')
      error.isTransientDb = true
      throw error
    }
    return false
  }
  const normalizedSessionCode = String(sessionCode || '').trim()
  if (!normalizedSessionCode || !note?.id) return false
  const createdAt = note.createdAt ? new Date(note.createdAt) : new Date()
  const updatedAt = note.updatedAt ? new Date(note.updatedAt) : new Date()
  const archivedAt = note.archived ? new Date(note.updatedAt || Date.now()) : null
  const body = JSON.stringify({
    title: note.title,
    content: note.content,
    author: note.author,
    ownerKey: note.ownerKey,
  })
  try {
    await pool.query(
      `
      insert into ti_notes(note_id, session_code, body, created_at, updated_at, archived_at, actor_email)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (note_id) do update
        set session_code = excluded.session_code,
            body = excluded.body,
            created_at = least(ti_notes.created_at, excluded.created_at),
            updated_at = excluded.updated_at,
            archived_at = excluded.archived_at,
            actor_email = excluded.actor_email
    `,
      [
        note.id,
        normalizedSessionCode,
        body,
        Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
        Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
        archivedAt && !Number.isNaN(archivedAt.getTime()) ? archivedAt : null,
        String(actorEmail || '').trim() || null,
      ],
    )
  } catch (error) {
    recordDbFailure('ti_notes upsert failed:', error, { sessionCode: normalizedSessionCode, noteId: note.id })
    if (STRICT_DB_MODE) {
      if (isTransientDbConnectionError(error)) {
        const wrapped = new Error('Database is temporarily unavailable.')
        wrapped.isTransientDb = true
        throw wrapped
      }
      throw error
    }
    return false
  }
  return true
}

async function dbArchiveNoteRecord({ sessionCode, noteId, actorEmail = '', archivedAt = null } = {}) {
  if (!pool || isDbCircuitOpen()) {
    if (STRICT_DB_MODE) {
      const error = new Error('Database is temporarily unavailable.')
      error.isTransientDb = true
      throw error
    }
    return false
  }
  const normalizedSessionCode = String(sessionCode || '').trim()
  const normalizedNoteId = String(noteId || '').trim()
  if (!normalizedSessionCode || !normalizedNoteId) return false
  const at = archivedAt ? new Date(archivedAt) : new Date()
  try {
    await pool.query(
      `
      update ti_notes
        set archived_at = $1,
            updated_at = $1,
            actor_email = $2
      where session_code = $3 and note_id = $4
    `,
      [Number.isNaN(at.getTime()) ? new Date() : at, String(actorEmail || '').trim() || null, normalizedSessionCode, normalizedNoteId],
    )
  } catch (error) {
    recordDbFailure('ti_notes archive failed:', error, { sessionCode: normalizedSessionCode, noteId: normalizedNoteId })
    if (STRICT_DB_MODE) {
      if (isTransientDbConnectionError(error)) {
        const wrapped = new Error('Database is temporarily unavailable.')
        wrapped.isTransientDb = true
        throw wrapped
      }
      throw error
    }
    return false
  }
  return true
}

async function dbSyncConsultationNotes({ sessionCode, previousNotes = [], nextNotes = [], actorEmail = '', requestId = '' } = {}) {
  const before = normalizeConsultationNotesValue(previousNotes)
  const after = normalizeConsultationNotesValue(nextNotes)
  const previousById = new Map(before.map((note) => [note.id, note]))
  const nextById = new Map(after.map((note) => [note.id, note]))

  for (const note of after) {
    const prev = previousById.get(note.id) || null
    await dbUpsertNoteRecord({ sessionCode, note, actorEmail })

    let eventType = ''
    if (!prev) eventType = 'note_created'
    else if (Boolean(prev.archived) !== Boolean(note.archived)) eventType = note.archived ? 'note_archived' : 'note_restored'
    else if (prev.title !== note.title || prev.content !== note.content) eventType = 'note_updated'

    if (eventType) {
      const ok = await dbInsertEvent({
        sessionCode,
        eventType,
        domain: 'notes',
        actorEmail,
        requestId,
        payload: { noteId: note.id, title: note.title, archived: Boolean(note.archived), at: new Date().toISOString() },
      })
      if (!ok && STRICT_DB_MODE) throw new Error(`Failed to insert ${eventType} event.`)
    }
  }

  for (const prev of before) {
    if (nextById.has(prev.id)) continue
    await dbArchiveNoteRecord({ sessionCode, noteId: prev.id, actorEmail, archivedAt: new Date().toISOString() })
    const ok = await dbInsertEvent({
      sessionCode,
      eventType: 'note_archived',
      domain: 'notes',
      actorEmail,
      requestId,
      payload: { noteId: prev.id, title: prev.title, archived: true, at: new Date().toISOString(), reason: 'removed_from_session_notes' },
    })
    if (!ok && STRICT_DB_MODE) throw new Error('Failed to insert note_archived event.')
  }
}

function normalizeDocumentReceiptValue(value) {
  if (!value || typeof value !== 'object') return null
  const name = String(value.name || '').trim()
  if (!name) return null
  const sentAt = String(value.sentAt || value.sent_at || '').trim()
  const signedAt = String(value.signedAt || value.signed_at || '').trim()
  return {
    id: String(value.id || '').trim(),
    name,
    documentCode: String(value.documentCode || value.document_code || '').trim(),
    status: String(value.status || '').trim(),
    method: String(value.method || '').trim(),
    recipientEmail: String(value.recipientEmail || value.recipient_email || '').trim(),
    sentAt,
    signedAt,
    payload: value && typeof value === 'object' ? value : { value },
  }
}

function normalizeDocumentReceiptsValue(value) {
  const list = parseStoredObject(value, [])
  if (!Array.isArray(list)) return []
  return list.map((entry) => normalizeDocumentReceiptValue(entry)).filter(Boolean)
}

async function dbUpsertDocumentReceiptRecord({ sessionCode, receipt, actorEmail = '' } = {}) {
  if (!pool || isDbCircuitOpen()) {
    if (STRICT_DB_MODE) {
      const error = new Error('Database is temporarily unavailable.')
      error.isTransientDb = true
      throw error
    }
    return false
  }
  const normalizedSessionCode = String(sessionCode || '').trim()
  if (!normalizedSessionCode || !receipt?.name) return false
  const receiptId = receipt.id || buildDeterministicId('receipt', `${normalizedSessionCode}:${buildStoredDocumentReceiptKey(receipt)}`)
  const sentAt = receipt.sentAt ? new Date(receipt.sentAt) : null
  const signedAt = receipt.signedAt ? new Date(receipt.signedAt) : null
  const now = new Date()
  try {
    await pool.query(
      `
      insert into ti_document_receipts(
        receipt_id, session_code, name, document_code, status, method, recipient_email,
        sent_at, signed_at, payload, created_at, updated_at, actor_email
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      on conflict (receipt_id) do update
        set session_code = excluded.session_code,
            name = excluded.name,
            document_code = excluded.document_code,
            status = excluded.status,
            method = excluded.method,
            recipient_email = excluded.recipient_email,
            sent_at = coalesce(excluded.sent_at, ti_document_receipts.sent_at),
            signed_at = coalesce(excluded.signed_at, ti_document_receipts.signed_at),
            payload = excluded.payload,
            updated_at = excluded.updated_at,
            actor_email = excluded.actor_email
    `,
      [
        receiptId,
        normalizedSessionCode,
        receipt.name,
        receipt.documentCode || '',
        receipt.status || '',
        receipt.method || '',
        receipt.recipientEmail || '',
        sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
        signedAt && !Number.isNaN(signedAt.getTime()) ? signedAt : null,
        receipt.payload && typeof receipt.payload === 'object' ? receipt.payload : { value: receipt.payload },
        now,
        now,
        String(actorEmail || '').trim() || null,
      ],
    )
  } catch (error) {
    recordDbFailure('ti_document_receipts upsert failed:', error, { sessionCode: normalizedSessionCode, receiptName: receipt.name })
    if (STRICT_DB_MODE) {
      if (isTransientDbConnectionError(error)) {
        const wrapped = new Error('Database is temporarily unavailable.')
        wrapped.isTransientDb = true
        throw wrapped
      }
      throw error
    }
    return false
  }
  return true
}

async function dbSyncDocumentReceiptsFromAnswers({ sessionCode, answers, actorEmail = '' } = {}) {
  const normalizedSessionCode = String(sessionCode || '').trim()
  if (!normalizedSessionCode) return
  const receipts = normalizeDocumentReceiptsValue(answers?.document_receipts)
  if (!receipts.length) return
  for (const receipt of receipts) {
    await dbUpsertDocumentReceiptRecord({ sessionCode: normalizedSessionCode, receipt, actorEmail })
  }
}

async function adminPersistRoomStateAndLog({
  req,
  roomCode,
  room,
  patches = [],
  eventType = '',
  domain = '',
  actorEmail = '',
  payload = {},
  previousNotes = null,
  nextNotes = null,
} = {}) {
  if (!req) throw new Error('req is required')
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode) throw new Error('roomCode is required')
  if (!room) throw new Error('room is required')

  await persistRoomState(normalizedRoomCode, room, patches)

  const ok = await dbInsertEvent({
    sessionCode: normalizedRoomCode,
    eventType,
    domain,
    actorEmail,
    requestId: getRequestId(req),
    payload,
  })
  if (!ok && STRICT_DB_MODE) throw new Error(`Failed to insert ${String(eventType || 'event')} event.`)

  if (previousNotes !== null || nextNotes !== null) {
    await dbSyncConsultationNotes({
      sessionCode: normalizedRoomCode,
      previousNotes: previousNotes || [],
      nextNotes: nextNotes || [],
      actorEmail,
      requestId: getRequestId(req),
    })
  }
}

function recordDbFailure(label, error, meta = {}) {
  if (!pool) return
  const message = String(error instanceof Error ? error.message : error || '')
  const now = Date.now()
  if (isTransientDbConnectionError(error)) {
    dbCircuitOpenUntil = Math.max(dbCircuitOpenUntil, now + DB_CIRCUIT_COOLDOWN_MS)
    dbLastFailureAt = now
  }

  // Throttle log spam: only log once per window unless the message changed.
  const shouldLog =
    !dbLastFailureLoggedAt ||
    now - dbLastFailureLoggedAt > DB_CIRCUIT_LOG_THROTTLE_MS ||
    (message && message !== dbLastFailureMessage)
  if (!shouldLog) return
  dbLastFailureLoggedAt = now
  dbLastFailureMessage = message
  console.error(label, { ...(meta || {}), message })
}
const fallbackSessions = new Map()
let fallbackStoreLoaded = false
let fallbackStoreLoadPromise = null
let fallbackStoreWritePromise = Promise.resolve()
const portalSmsCodeStore = new Map()
const CLIENT_PORTAL_SMS_CODE_LENGTH = Math.max(4, Math.min(8, Number(process.env.CLIENT_PORTAL_SMS_CODE_LENGTH || 6) || 6))
const CLIENT_PORTAL_SMS_CODE_TTL_MS = Math.max(60_000, Number(process.env.CLIENT_PORTAL_SMS_CODE_TTL_MS || 10 * 60_000) || 10 * 60_000)
const CLIENT_PORTAL_SMS_SEND_COOLDOWN_MS = Math.max(15_000, Number(process.env.CLIENT_PORTAL_SMS_SEND_COOLDOWN_MS || 45_000) || 45_000)
const CLIENT_PORTAL_SMS_VERIFY_MAX_ATTEMPTS = Math.max(3, Math.min(10, Number(process.env.CLIENT_PORTAL_SMS_VERIFY_MAX_ATTEMPTS || 5) || 5))
const SESSION_PERSIST_DEBOUNCE_MS = Math.max(100, Number(process.env.SESSION_PERSIST_DEBOUNCE_MS || 250) || 250)
const DASHBOARD_ANALYTICS_CACHE_TTL_MS = Math.max(2000, Number(process.env.DASHBOARD_ANALYTICS_CACHE_TTL_MS || 10_000) || 10_000)
const CONSULTATION_INTEGRITY_REPAIR_COOLDOWN_MS = Math.max(10_000, Number(process.env.CONSULTATION_INTEGRITY_REPAIR_COOLDOWN_MS || 60_000) || 60_000)
const pendingSessionPersists = new Map()
const dashboardAnalyticsCache = new Map()
const consultationIntegrityRepairTimestamps = new Map()

function invalidateDashboardAnalyticsCache() {
  dashboardAnalyticsCache.clear()
}

function safeJsonClone(value) {
  try {
    return value ? JSON.parse(JSON.stringify(value)) : value
  } catch {
    return value
  }
}

function normalizeDigits(value = '') {
  return String(value || '').replace(/\D/g, '')
}

function sanitizePaymentMethodRecord(method = {}) {
  if (!method || typeof method !== 'object') return method
  const next = { ...method }

  // NEVER persist CVV or full PAN/account numbers (PCI / sensitive).
  delete next.cvv
  delete next.securityCode
  delete next.cvc
  delete next.routingNumber
  delete next.routing_number

  const cardDigits = normalizeDigits(next.cardNumber || next.card_number || '')
  if (cardDigits) {
    next.last4 = cardDigits.slice(-4)
  }
  delete next.cardNumber
  delete next.card_number

  const accountDigits = normalizeDigits(next.accountNumber || next.account_number || '')
  if (accountDigits) {
    next.last4 = next.last4 || accountDigits.slice(-4)
  }
  delete next.accountNumber
  delete next.account_number

  // Rebuild label if needed.
  if (next.last4 && !String(next.label || '').trim()) {
    const type = String(next.cardType || next.type || 'Card').trim()
    next.label = `${type} ending in ${next.last4}`
  }

  return next
}

function sanitizePaymentMethodList(value) {
  const list = Array.isArray(value) ? value : parseStoredObject(value, [])
  if (!Array.isArray(list)) return []
  return list.map((entry) => sanitizePaymentMethodRecord(entry))
}

function sanitizeSensitiveBillingAnswers(answers = {}) {
  if (!answers || typeof answers !== 'object') return answers

  // Remove UI-only raw entry fields if they ever get into answers.
  delete answers._ui_pay_cardNumber
  delete answers._ui_pay_cvv
  delete answers._ui_pay_expiry

  // Legacy raw card fields (should never persist).
  const rawCardDigits = normalizeDigits(answers.payment_card_number || '')
  if (rawCardDigits && !answers.payment_card_last4) answers.payment_card_last4 = rawCardDigits.slice(-4)
  delete answers.payment_card_number
  delete answers.payment_card_cvv

  // Payment method objects / arrays (billing + portal).
  if (answers.billing_payment_method) {
    const next = sanitizePaymentMethodRecord(parseStoredObject(answers.billing_payment_method, null))
    answers.billing_payment_method = next
  }
  if (answers.client_portal_payment_method) {
    const next = sanitizePaymentMethodRecord(parseStoredObject(answers.client_portal_payment_method, null))
    answers.client_portal_payment_method = next
  }
  if (answers.billing_payment_methods) {
    answers.billing_payment_methods = sanitizePaymentMethodList(answers.billing_payment_methods)
  }
  if (answers.client_portal_payment_methods) {
    answers.client_portal_payment_methods = sanitizePaymentMethodList(answers.client_portal_payment_methods)
  }

  return answers
}

async function dbInsertBillingAudit({ sessionCode, eventType, billingMode = '', actorEmail = '', payload = {} } = {}) {
  if (!pool) return
  const normalizedCode = String(sessionCode || '').trim()
  const normalizedEvent = String(eventType || '').trim()
  if (!normalizedCode || !normalizedEvent) return
  try {
    await pool.query(
      `insert into ti_billing_audit(session_code, event_type, billing_mode, actor_email, payload) values ($1, $2, $3, $4, $5)`,
      [normalizedCode, normalizedEvent, String(billingMode || '').trim() || null, String(actorEmail || '').trim() || null, payload || {}],
    )
  } catch (error) {
    console.error('billing audit insert failed:', {
      sessionCode: normalizedCode,
      eventType: normalizedEvent,
      message: error instanceof Error ? error.message : String(error || ''),
    })
  }
}

const SESSION_BACKUP_RESTORE_ANSWER_KEYS = [
  'name',
  'full_name',
  'client_name',
  'clientName',
  'first_name',
  'last_name',
  'email',
  'email_address',
  'phone',
  'phone_number',
  'address',
  'street',
  'address1',
  'city',
  'state',
  'stateCode',
  'zip',
  'zipCode',
  'postalCode',
  'mailing_address',
  'mailing_city',
  'mailing_state',
  'mailing_zip',
  'dob',
  'date_of_birth',
  'birthdate',
  'birth_date',
  'birthDate',
  'client_dob',
  'clientDob',
  'client_birthdate',
  'ssn',
  'client_ssn',
  'taxpayer_ssn',
  'taxType',
  'tax_type',
  'type',
  'taxAgency',
  'tax_agency',
  'owe',
  'oweWho',
  'owe_who',
  'taxSituation',
  'tax_situation',
  'filingStatus',
  'filing_status',
  'tax_filing_status',
  'irsBalance',
  'irs_balance',
  'federalBalance',
  'federal_balance',
  'stateBalance',
  'state_balance',
  'stateTaxBalance',
  'state_tax_balance',
  'taxLiability',
  'tax_liability',
  'totalLiability',
  'total_liability',
  'ghl_liability_value',
  'ghl_opportunity_value',
  'oweYears',
  'owe_years',
  'years',
  'yearsUnfiled',
  'years_unfiled',
  'tax_years_owed',
  'spouse_name',
  'spouse_first_name',
  'spouse_last_name',
  'spouse_email',
  'stripe_customer_id',
  'billing_schedule',
  'investigation_billing_schedule',
  'resolution_billing_schedule',
  'billing_invoice_amount',
  'billing_invoice_created_at',
  'investigation_billing_invoice_amount',
  'investigation_billing_invoice_created_at',
  'resolution_billing_invoice_amount',
  'resolution_billing_invoice_created_at',
  'billing_payment_method',
  'billing_payment_methods',
  'client_portal_payment_method',
  'client_portal_payment_methods',
  'document_receipts',
  'document_delivery_log',
  'document_email_log',
  'hidden_document_receipt_names',
  'ea_documents',
  'consultation_notes',
  'ea_activity_timeline',
  'form8821_status',
  'form8821_spouse_status',
  'onboarding_status',
  'completed_at',
  'current_8821_document_code',
  'active_8821_document_code',
  'boldsign_8821_document_id',
  'boldsign_8821_spouse_document_id',
  'boldsign_8821_file_name',
  'boldsign_8821_spouse_file_name',
  'boldsign_8821_sent_at',
  'boldsign_8821_spouse_sent_at',
  'boldsign_8821_sender_email',
  'boldsign_8821_spouse_sender_email',
  'boldsign_8821_signed_at',
  'signed_8821_saved_at',
  'signed_8821_file_name',
  'signed_8821_first_page_saved_at',
  'signed_8821_first_page_file_name',
  'signed_8821_render_version',
  'signed_8821_first_page_render_version',
  'boldsign_resolution_document_id',
  'boldsign_resolution_file_name',
  'boldsign_resolution_sent_at',
  'boldsign_resolution_sender_email',
  'boldsign_resolution_signed_at',
]

function stripValueForSessionBackup(value, key = '') {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripValueForSessionBackup(entry))
      .filter((entry) => entry !== undefined)
  }
  if (typeof value !== 'object') return value

  const next = {}
  Object.entries(value).forEach(([entryKey, entryValue]) => {
    if (entryKey.startsWith('_ui_') || entryKey.startsWith('_auto_')) return
    if (entryKey === 'dataUrl' || entryKey === 'rawText' || entryKey === 'raw_text' || entryKey === 'extractedTextPreview') return
    const stripped = stripValueForSessionBackup(entryValue, entryKey)
    if (stripped !== undefined) next[entryKey] = stripped
  })
  return next
}

function buildSessionBackupPayload({ code = '', contactId = '', opportunityId = '', state } = {}) {
  const safeState = state && typeof state === 'object' ? safeJsonClone(state) || {} : {}
  const answers = safeState.answers && typeof safeState.answers === 'object' ? safeState.answers : {}
  const sanitizedAnswers = sanitizeSensitiveBillingAnswers(stripValueForSessionBackup(answers) || {})
  return {
    version: 1,
    sessionCode: String(code || '').trim(),
    contactId: String(contactId || '').trim(),
    opportunityId: String(opportunityId || '').trim(),
    route: String(safeState.route || '').trim(),
    step: Number(safeState.step || 0) || 0,
    profile: {
      clientName: getPrimaryAnswer(sanitizedAnswers, ['full_name', 'name', 'client_name', 'clientName']),
      email: getPrimaryAnswer(sanitizedAnswers, ['email', 'email_address']),
      phone: getPrimaryAnswer(sanitizedAnswers, ['phone', 'phone_number']),
    },
    answers: sanitizedAnswers,
  }
}

function getSessionBackupChecksum(payload = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex')
}

async function dbInsertSessionBackup({ sessionCode, contactId = '', opportunityId = '', state, previousState = null, reason = 'session_upsert' } = {}) {
  if (!pool) return false
  if (isDbCircuitOpen()) return false
  const normalizedCode = String(sessionCode || '').trim()
  if (!normalizedCode) return false

  const payload = buildSessionBackupPayload({ code: normalizedCode, contactId, opportunityId, state })
  const previousPayload = previousState ? buildSessionBackupPayload({ code: normalizedCode, contactId, opportunityId, state: previousState }) : null
  const checksum = getSessionBackupChecksum(payload)
  const previousChecksum = previousPayload ? getSessionBackupChecksum(previousPayload) : ''

  if (previousChecksum && previousChecksum === checksum) return false
  if (!Object.keys(payload?.answers || {}).length) return false

  try {
    await pool.query(
      `insert into ti_session_backups(session_code, ghl_contact_id, ghl_opportunity_id, backup_reason, backup_checksum, payload)
       values ($1, $2, $3, $4, $5, $6)`,
      [normalizedCode, String(contactId || '').trim() || null, String(opportunityId || '').trim() || null, String(reason || 'session_upsert'), checksum, payload],
    )
    return true
  } catch (error) {
    recordDbFailure('session backup insert failed:', error, { sessionCode: normalizedCode, reason: String(reason || 'session_upsert') })
    return false
  }
}

async function dbGetLatestSessionBackup(sessionCode = '') {
  if (!pool) return null
  if (isDbCircuitOpen()) return null
  const normalizedCode = String(sessionCode || '').trim()
  if (!normalizedCode) return null
  try {
    const res = await pool.query(
      `select payload, created_at
         from ti_session_backups
        where session_code = $1
        order by created_at desc
        limit 1`,
      [normalizedCode],
    )
    return res.rows?.[0] || null
  } catch (error) {
    recordDbFailure('session backup lookup failed:', error, { sessionCode: normalizedCode })
    return null
  }
}

function getCriticalAnswerCoverageScore(answers = {}, currentAnswers = null) {
  const sourceAnswers = answers && typeof answers === 'object' ? answers : {}
  const liveAnswers = currentAnswers && typeof currentAnswers === 'object' ? currentAnswers : null
  return SESSION_BACKUP_RESTORE_ANSWER_KEYS.reduce((total, key) => {
    if (!hasMeaningfulSessionValue(sourceAnswers[key])) return total
    if (liveAnswers && hasMeaningfulSessionValue(liveAnswers[key])) return total
    return total + 1
  }, 0)
}

async function dbGetBestSessionBackup(sessionCode = '', currentAnswers = {}) {
  if (!pool) return null
  if (isDbCircuitOpen()) return null
  const normalizedCode = String(sessionCode || '').trim()
  if (!normalizedCode) return null
  try {
    const res = await pool.query(
      `select payload, created_at
         from ti_session_backups
        where session_code = $1
        order by created_at desc
        limit 250`,
      [normalizedCode],
    )
    const rows = Array.isArray(res.rows) ? res.rows : []
    let best = null
    let bestScore = 0
    for (const row of rows) {
      const backupAnswers = row?.payload?.answers
      if (!backupAnswers || typeof backupAnswers !== 'object') continue
      const score = getCriticalAnswerCoverageScore(backupAnswers, currentAnswers)
      if (score > bestScore) {
        best = row
        bestScore = score
      }
    }
    return bestScore > 0 ? best : null
  } catch (error) {
    recordDbFailure('session best-backup lookup failed:', error, { sessionCode: normalizedCode })
    return null
  }
}

function restoreCriticalAnswersFromBackup(currentAnswers = {}, backupAnswers = {}) {
  const nextAnswers = currentAnswers && typeof currentAnswers === 'object' ? currentAnswers : {}
  const sourceAnswers = backupAnswers && typeof backupAnswers === 'object' ? backupAnswers : {}
  let changed = false

  SESSION_BACKUP_RESTORE_ANSWER_KEYS.forEach((key) => {
    if (!hasMeaningfulSessionValue(sourceAnswers[key])) return
    if (hasMeaningfulSessionValue(nextAnswers[key])) return
    nextAnswers[key] = safeJsonClone(sourceAnswers[key])
    changed = true
  })

  return changed
}

async function restoreCriticalSessionDataFromBackupIfMissing({ roomCode, state, persist } = {}) {
  if (!pool || typeof persist !== 'function') return false
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode) return false
  const roomState = state && typeof state === 'object' ? state : initialRoomState()
  const answers = roomState.answers && typeof roomState.answers === 'object' ? roomState.answers : {}
  const bestBackup = await dbGetBestSessionBackup(normalizedRoomCode, answers)
  const backupAnswers = bestBackup?.payload?.answers
  if (!backupAnswers || typeof backupAnswers !== 'object') return false

  const changed = restoreCriticalAnswersFromBackup(answers, backupAnswers)
  if (!changed) return false
  roomState.answers = sanitizeSensitiveBillingAnswers(answers)
  await persist(roomState)
  return true
}

function getMissingCriticalAnswerKeys(answers = {}) {
  const sourceAnswers = answers && typeof answers === 'object' ? answers : {}
  return SESSION_BACKUP_RESTORE_ANSWER_KEYS.filter((key) => !hasMeaningfulSessionValue(sourceAnswers[key]))
}

function getRestorableCriticalAnswerKeys(currentAnswers = {}, backupAnswers = {}) {
  const liveAnswers = currentAnswers && typeof currentAnswers === 'object' ? currentAnswers : {}
  const sourceAnswers = backupAnswers && typeof backupAnswers === 'object' ? backupAnswers : {}
  return SESSION_BACKUP_RESTORE_ANSWER_KEYS.filter((key) => {
    if (hasMeaningfulSessionValue(liveAnswers[key])) return false
    return hasMeaningfulSessionValue(sourceAnswers[key])
  })
}

function buildConsultationAnswersPreview(answers = {}) {
  const sourceAnswers = answers && typeof answers === 'object' ? answers : {}
  const billingSchedule = getBillingScheduleRowsFromAnswers(sourceAnswers)
  const documentReceipts = Array.isArray(sourceAnswers.document_receipts)
    ? sourceAnswers.document_receipts
    : parseStoredObject(sourceAnswers.document_receipts, [])
  const notes = Array.isArray(sourceAnswers.consultation_notes)
    ? sourceAnswers.consultation_notes
    : parseStoredObject(sourceAnswers.consultation_notes, [])
  return {
    clientName: String(getPrimaryAnswer(sourceAnswers, ['full_name', 'name', 'client_name', 'clientName']) || '').trim(),
    email: String(getPrimaryAnswer(sourceAnswers, ['email', 'email_address']) || '').trim(),
    phone: String(getPrimaryAnswer(sourceAnswers, ['phone', 'phone_number']) || '').trim(),
    filingStatus: String(getPrimaryAnswer(sourceAnswers, ['filingStatus', 'filing_status']) || '').trim(),
    onboardingStatus: String(sourceAnswers.onboarding_status || '').trim(),
    form8821Status: String(sourceAnswers.form8821_status || '').trim(),
    resolutionSignedAt: String(sourceAnswers.boldsign_resolution_signed_at || '').trim(),
    stripeCustomerId: String(sourceAnswers.stripe_customer_id || '').trim(),
    billingScheduleCount: billingSchedule.length,
    documentReceiptCount: Array.isArray(documentReceipts) ? documentReceipts.length : 0,
    noteCount: Array.isArray(notes) ? notes.length : 0,
  }
}

function getConsultationSparsityFlags(answers = {}) {
  const preview = buildConsultationAnswersPreview(answers)
  return {
    coreProfileSparse: !(preview.clientName || preview.email || preview.phone),
    workflowSparse: !(preview.onboardingStatus || preview.form8821Status || preview.resolutionSignedAt),
    billingSparse: !(preview.stripeCustomerId || preview.billingScheduleCount),
    documentsSparse: preview.documentReceiptCount === 0,
  }
}

function getDashboardAnalyticsCacheKey(account = null) {
  const designatedPosition = String(account?.designatedPosition || '').trim().toLowerCase()
  const email = String(account?.email || '').trim().toLowerCase()
  return designatedPosition === 'enrolled agent' ? `ea:${email}` : 'admin:all'
}

function getCachedDashboardAnalytics(cacheKey = '') {
  const normalizedKey = String(cacheKey || '')
  const cached = dashboardAnalyticsCache.get(normalizedKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    dashboardAnalyticsCache.delete(normalizedKey)
    return null
  }
  return cached.analytics || null
}

function setCachedDashboardAnalytics(cacheKey = '', analytics = null) {
  dashboardAnalyticsCache.set(String(cacheKey || ''), {
    analytics,
    expiresAt: Date.now() + DASHBOARD_ANALYTICS_CACHE_TTL_MS,
  })
}

function serializeCrashError(error) {
  if (error instanceof Error) {
    const plain = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
    for (const key of Object.keys(error)) {
      try {
        plain[key] = error[key]
      } catch {
        // ignore unserializable fields
      }
    }
    return plain
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch {
      return { value: String(error) }
    }
  }
  return { value: String(error) }
}

function logGlobalCrash(eventName, error) {
  try {
    const usage = process.memoryUsage()
    const toMb = (value) => Math.round((Number(value || 0) / (1024 * 1024)) * 10) / 10
    console.error(`Global crash detected: ${eventName}`, {
      pid: process.pid,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      rssMb: toMb(usage.rss),
      heapTotalMb: toMb(usage.heapTotal),
      heapUsedMb: toMb(usage.heapUsed),
      externalMb: toMb(usage.external),
      arrayBuffersMb: toMb(usage.arrayBuffers),
      error: serializeCrashError(error),
    })
  } catch (loggingError) {
    console.error(`Global crash detected: ${eventName}`, error)
    console.error('Crash logger failure:', loggingError)
  }
}

process.on('uncaughtException', (error) => {
  logGlobalCrash('uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  logGlobalCrash('unhandledRejection', reason)
})

function getCodeVariants(code = '') {
  const normalized = String(code || '').trim()
  if (!normalized) return []
  return Array.from(new Set([normalized, normalized.toUpperCase(), normalized.toLowerCase()])).filter(Boolean)
}

function buildFallbackRow(entry) {
  if (!entry) return null
  return {
    session_code: entry.sessionCode,
    ghl_contact_id: entry.contactId || null,
    ghl_opportunity_id: entry.opportunityId || null,
    state: entry.state || initialRoomState(),
    created_at: entry.createdAt || new Date().toISOString(),
    updated_at: entry.updatedAt || new Date().toISOString(),
  }
}

const MIRRORED_ANSWER_KEY_GROUPS = [
  ['email', 'email_address'],
  ['phone', 'phone_number'],
  ['dob', 'date_of_birth', 'birthdate'],
  ['address', 'street', 'address1'],
  ['state', 'stateCode', 'expenseState'],
  ['zip', 'postalCode'],
  ['spouse_dob', 'spouseDob', 'spouse_date_of_birth', 'spouseBirthDate'],
  ['spouse_ssn', 'spouseSsn'],
  ['spouse_phone', 'spousePhone'],
  ['spouse_email', 'spouseEmail'],
  ['spouse_first_name', 'spouseFirstName'],
  ['spouse_last_name', 'spouseLastName'],
]

function mirrorAnswerAliases(answers, answerKey, nextValue) {
  const normalizedKey = String(answerKey || '').trim()
  if (!normalizedKey) return
  const group = MIRRORED_ANSWER_KEY_GROUPS.find((keys) => keys.includes(normalizedKey))
  if (!group) return
  group.forEach((key) => {
    answers[key] = nextValue
  })
}

async function persistFallbackSessions() {
  const payload = {
    sessions: Array.from(fallbackSessions.values()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
  }
  await mkdir(path.dirname(SESSION_STORE_PATH), { recursive: true })
  await writeFile(SESSION_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

async function scheduleFallbackPersist() {
  fallbackStoreWritePromise = fallbackStoreWritePromise
    .catch(() => {})
    .then(() => persistFallbackSessions())
  return fallbackStoreWritePromise
}

async function ensureFallbackStoreLoaded() {
  if (pool || fallbackStoreLoaded) return
  if (!fallbackStoreLoadPromise) {
    fallbackStoreLoadPromise = (async () => {
      try {
        const raw = await readFile(SESSION_STORE_PATH, 'utf8')
        const parsed = JSON.parse(raw)
        const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : []
        fallbackSessions.clear()
        sessions.forEach((entry) => {
          const sessionCode = String(entry?.sessionCode || '').trim()
          if (!sessionCode) return
          fallbackSessions.set(sessionCode, {
            sessionCode,
            contactId: entry?.contactId ? String(entry.contactId) : null,
            opportunityId: entry?.opportunityId ? String(entry.opportunityId) : null,
            state: entry?.state && typeof entry.state === 'object' ? entry.state : initialRoomState(),
            createdAt: entry?.createdAt || new Date().toISOString(),
            updatedAt: entry?.updatedAt || entry?.createdAt || new Date().toISOString(),
          })
        })
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      fallbackStoreLoaded = true
    })()
  }
  await fallbackStoreLoadPromise
}

async function fallbackGetSession(code) {
  await ensureFallbackStoreLoaded()
  for (const candidate of getCodeVariants(code)) {
    const found = fallbackSessions.get(candidate)
    if (found) return buildFallbackRow(found)
  }
  return null
}

async function fallbackUpsertSession({ code, contactId = null, opportunityId = null, state }) {
  if (STRICT_DB_MODE) {
    const error = new Error('Database is temporarily unavailable. Refusing to write to fallback store.')
    error.isTransientDb = true
    throw error
  }
  await ensureFallbackStoreLoaded()
  const existing = await fallbackGetSession(code)
  const resolvedCode = String(existing?.session_code || code)
  const createdAt = existing?.created_at || new Date().toISOString()
  const updatedAt = new Date().toISOString()
  const nextState = mergeSessionStateForPersistence(existing?.state, state, { code: resolvedCode, source: 'fallback' })
  fallbackSessions.set(resolvedCode, {
    sessionCode: resolvedCode,
    contactId: contactId ?? existing?.ghl_contact_id ?? null,
    opportunityId: opportunityId ?? existing?.ghl_opportunity_id ?? null,
    state: nextState,
    createdAt: existing?.created_at || createdAt,
    updatedAt,
  })
  await scheduleFallbackPersist()
  invalidateDashboardAnalyticsCache()
}

async function fallbackDeleteSession(code) {
  if (STRICT_DB_MODE) {
    const error = new Error('Database is temporarily unavailable. Refusing to delete from fallback store.')
    error.isTransientDb = true
    throw error
  }
  await ensureFallbackStoreLoaded()
  let deleted = false
  for (const candidate of getCodeVariants(code)) {
    if (fallbackSessions.delete(candidate)) deleted = true
  }
  if (deleted) {
    await scheduleFallbackPersist()
    invalidateDashboardAnalyticsCache()
  }
  return deleted
}

async function fallbackFindSessionCode({ contactId = '', opportunityId = '' } = {}) {
  await ensureFallbackStoreLoaded()
  const values = Array.from(fallbackSessions.values()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  if (opportunityId) return values.find((entry) => String(entry.opportunityId || '') === opportunityId)?.sessionCode || null
  return values.find((entry) => String(entry.contactId || '') === contactId)?.sessionCode || null
}

async function fallbackListSessions() {
  await ensureFallbackStoreLoaded()
  return Array.from(fallbackSessions.values())
    .map((entry) => buildFallbackRow(entry))
    .filter(Boolean)
}

const app = express()
// Capture the raw request body for webhook signature validation (BoldSign/Calendly).
// Without this, `express.json()` consumes the body and signature checks will fail.
app.use(
  express.json({
    // EA transcript uploads can include large base64 data URLs; raise the JSON limit accordingly.
    // (Express default is ~100kb, which can cause 413 responses for real transcript PDFs/exports.)
    limit: '25mb',
    verify: (req, _res, buf) => {
      try {
        req.rawBody = Buffer.isBuffer(buf) ? buf.toString('utf8') : ''
      } catch {
        req.rawBody = ''
      }
    },
  }),
)
const configuredOrigins = CLIENT_ORIGIN === '*' ? [] : CLIENT_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean)
function isAllowedCorsOrigin(origin = '') {
  if (!origin) return true
  if (CLIENT_ORIGIN === '*') return true
  if (configuredOrigins.includes(origin)) return true
  try {
    const url = new URL(origin)
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      /^192\.168\./.test(url.hostname) ||
      /^10\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname)
    )
  } catch {
    return false
  }
}
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin || '')) return callback(null, true)
      return callback(new Error(`CORS blocked for origin: ${origin || 'unknown'}`))
    },
    credentials: true,
  }),
)

app.get('/health', (_req, res) => res.json({ ok: true }))

async function handleDbHealth(_req, res) {
  if (!pool) return res.status(503).json({ ok: false, dbReady: false, reason: 'DATABASE_URL not configured' })
  if (isDbCircuitOpen()) {
    const recovered = await probeDbAndMaybeCloseCircuit({ timeoutMs: 1200 })
    if (!recovered) return res.status(503).json({ ok: false, dbReady: false, reason: 'db_circuit_open' })
  }
  try {
    await retry(
      async () => {
        try {
          await pool.query('select 1 as ok')
          return true
        } catch (error) {
          if (!isTransientDbConnectionError(error)) error.noRetry = true
          throw error
        }
      },
      { attempts: 3, delayMs: 800 },
    )
    return res.json({ ok: true, dbReady: true })
  } catch (error) {
    recordDbFailure('health db readiness check failed:', error, {})
    return res.status(503).json({ ok: false, dbReady: false, reason: 'db_unavailable' })
  }
}

// Main endpoint (recommended)
app.get('/health/db', handleDbHealth)
// Aliases to avoid slash/backslash confusion and support simplistic monitors.
app.get('/healthdb', handleDbHealth)
app.get('/health-db', handleDbHealth)

function parseGoogleAddressComponents(components = []) {
  const list = Array.isArray(components) ? components : []
  const findPart = (type, mode = 'long_name') =>
    String(
      list.find((component) => Array.isArray(component?.types) && component.types.includes(type))?.[mode] || '',
    ).trim()
  const street = [findPart('street_number'), findPart('route')].filter(Boolean).join(' ').trim()
  return {
    street,
    city: findPart('locality') || findPart('postal_town') || findPart('sublocality_level_1') || findPart('administrative_area_level_2'),
    stateCode: findPart('administrative_area_level_1', 'short_name'),
    zip: findPart('postal_code'),
  }
}

async function fetchGoogleAutocompletePredictions(query = '') {
  const input = String(query || '').trim()
  if (!GOOGLE_PLACES_SERVER_API_KEY || input.length < 3) return []
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
  url.searchParams.set('input', input)
  url.searchParams.set('types', 'address')
  url.searchParams.set('components', 'country:us')
  url.searchParams.set('language', 'en')
  url.searchParams.set('key', GOOGLE_PLACES_SERVER_API_KEY)
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Google autocomplete failed with ${response.status}`)
  const payload = await response.json().catch(() => ({}))
  const predictions = Array.isArray(payload?.predictions) ? payload.predictions : []
  return predictions.map((prediction) => {
    const description = String(prediction?.description || '').trim()
    const parts = description
      .split(',')
      .map((part) => String(part || '').trim())
      .filter(Boolean)
    return {
      placeId: String(prediction?.place_id || '').trim(),
      primary: String(parts[0] || prediction?.structured_formatting?.main_text || '').trim(),
      secondary: String(parts.slice(1).join(', ') || prediction?.structured_formatting?.secondary_text || '').trim(),
    }
  })
}

async function fetchGooglePlaceDetails(placeId = '') {
  const normalized = String(placeId || '').trim()
  if (!GOOGLE_PLACES_SERVER_API_KEY || !normalized) return null
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
  url.searchParams.set('place_id', normalized)
  url.searchParams.set('fields', 'formatted_address,address_component')
  url.searchParams.set('key', GOOGLE_PLACES_SERVER_API_KEY)
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Google place details failed with ${response.status}`)
  const payload = await response.json().catch(() => ({}))
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : null
  if (!result) return null
  return {
    formattedAddress: String(result?.formatted_address || '').trim(),
    ...parseGoogleAddressComponents(result?.address_components),
  }
}

app.get('/api/address-autocomplete', async (req, res) => {
  const query = String(req.query?.q || '').trim()
  if (query.length < 3) return res.json({ suggestions: [] })
  try {
    const suggestions = await fetchGoogleAutocompletePredictions(query)
    return res.json({ suggestions })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch address suggestions.' })
  }
})

app.get('/api/address-place-details', async (req, res) => {
  const placeId = String(req.query?.placeId || '').trim()
  if (!placeId) return res.status(400).json({ error: 'placeId is required' })
  try {
    const details = await fetchGooglePlaceDetails(placeId)
    if (!details) return res.status(404).json({ error: 'Place details unavailable' })
    return res.json(details)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch place details.' })
  }
})

app.post('/webhooks/calendly', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody =
    typeof req.rawBody === 'string' && req.rawBody
      ? req.rawBody
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : ''
  let payload = {}
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' })
  }
  if (!verifyCalendlyWebhookSignature(rawBody, req.headers['calendly-webhook-signature'])) {
    return res.status(401).json({ error: 'Invalid Calendly webhook signature' })
  }
  try {
    await syncCalendlyPayloadToSession(String(payload?.event || '').trim(), payload?.payload || {})
  } catch (error) {
    console.error('Calendly webhook processing failed:', error)
  }
  return res.status(200).json({ ok: true })
})

app.post('/webhooks/boldsign', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody =
    typeof req.rawBody === 'string' && req.rawBody
      ? req.rawBody
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : ''
  let payload = {}
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' })
  }

  const eventPayload = payload?.event && typeof payload.event === 'object' ? payload.event : payload
  const eventType = String(eventPayload?.eventType || eventPayload?.event_type || '').trim()
  if (eventType.toLowerCase() === 'verification') {
    return res.status(200).json({ ok: true })
  }

  if (!verifyBoldsignWebhookSignature(rawBody, req.headers['x-boldsign-signature'])) {
    return res.status(401).json({ error: 'Invalid BoldSign webhook signature' })
  }

  try {
    await applyBoldsignWebhookEvent(eventPayload)
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('BoldSign webhook processing failed:', error)
    return res.status(200).json({ ok: true })
  }
})

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)

function generateSessionId() {
  // 32-char hex session id (example: 6187df37bd8e9e608ec986dd390a413f)
  return crypto.randomBytes(16).toString('hex')
}

function signRepToken(payload) {
  if (!REP_JWT_SECRET) throw new Error('Missing REP_JWT_SECRET')
  return jwt.sign(payload, REP_JWT_SECRET, { expiresIn: '12h' })
}

function verifyRepToken(token) {
  if (!REP_JWT_SECRET) return null
  try {
    return jwt.verify(token, REP_JWT_SECRET)
  } catch {
    return null
  }
}

function readBearer(req) {
  const h = String(req.headers.authorization || '')
  if (!h.toLowerCase().startsWith('bearer ')) return ''
  return h.slice(7).trim()
}

function normalizePem(input = '') {
  return String(input || '').replace(/\\n/g, '\n').trim()
}

function safeOrigin(value) {
  try {
    return new URL(String(value || '')).origin
  } catch {
    return ''
  }
}

function normalizeCalendlyUri(value = '') {
  return String(value || '').trim()
}

function isCalendlyReady() {
  return Boolean(CALENDLY_API_BASE_URL && CALENDLY_PERSONAL_ACCESS_TOKEN)
}

function getCalendlyConfigDiagnostics() {
  const missingEnvVars = []
  if (!CALENDLY_PERSONAL_ACCESS_TOKEN) missingEnvVars.push('CALENDLY_PERSONAL_ACCESS_TOKEN')
  if (!CALENDLY_API_BASE_URL) missingEnvVars.push('CALENDLY_API_BASE_URL')
  const ready = missingEnvVars.length === 0
  let statusMessage = 'Calendly is configured.'
  if (!ready) {
    statusMessage = missingEnvVars.includes('CALENDLY_PERSONAL_ACCESS_TOKEN')
      ? 'Missing CALENDLY_PERSONAL_ACCESS_TOKEN on backend service.'
      : `Missing backend Calendly config: ${missingEnvVars.join(', ')}`
  }
  return {
    ready,
    missingEnvVars,
    statusMessage,
  }
}

function getPrimaryAnswer(answers, keys = []) {
  for (const key of keys) {
    const value = answers?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function toNumberValue(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  const raw = String(input ?? '').trim()
  if (!raw) return 0
  const normalized = raw.toLowerCase()
  const numericMatches = raw.match(/\d[\d,]*/g) || []
  const values = numericMatches
    .map((entry) => Number.parseFloat(String(entry).replace(/,/g, '')))
    .filter((value) => Number.isFinite(value))

  const estimateBracketAmount = (amount) => {
    const safeAmount = Number(amount)
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) return 0
    if (safeAmount < 100) return Math.ceil(safeAmount)
    const magnitude = 10 ** Math.max(String(Math.trunc(safeAmount)).length - 2, 0)
    return Math.ceil(safeAmount / magnitude) * magnitude
  }

  if (values.length) {
    if (/(under|less than|below|up to|upto)/.test(normalized)) {
      return estimateBracketAmount(values[0])
    }
    if (values.length > 1 && /(between|\bto\b|-|–|—)/.test(normalized)) {
      return estimateBracketAmount(Math.max(...values))
    }
  }

  const digits = raw.replace(/[^\d.-]/g, '')
  const parsed = Number.parseFloat(digits)
  return Number.isFinite(parsed) ? parsed : values[0] || 0
}

function digitsOnly(input = '') {
  return String(input || '').replace(/\D/g, '')
}

function extractGhlCustomFieldValue(entity = {}, matcher = () => false) {
  const groups = [
    entity?.customFields,
    entity?.custom_fields,
    entity?.customField,
    entity?.custom_field,
  ]

  for (const group of groups) {
    for (const field of Array.isArray(group) ? group : []) {
      const keysToMatch = [
        field?.slug,
        field?.key,
        field?.name,
        field?.label,
        field?.fieldKey,
        field?.fieldName,
        field?.fieldLabel,
        field?.id,
      ]
      if (!keysToMatch.some((value) => matcher(String(value || '')))) continue
      const value = field?.fieldValue ?? field?.field_value ?? field?.value ?? field?.fieldData ?? field?.data ?? ''
      if (String(value || '').trim()) return String(value).trim()
    }
  }

  return ''
}

function extractGhlLiabilityValue(opportunity = {}, contact = {}) {
  const isLiabilityField = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (!normalized) return false
    return [
      'irs_balance',
      'irs_balance_amount',
      'federal_balance',
      'tax_liability',
      'total_liability',
      'amount_owed',
      'tax_debt',
      'liability',
    ].some((token) => normalized.includes(token))
  }

  return (
    extractGhlCustomFieldValue(opportunity, isLiabilityField) ||
    extractGhlCustomFieldValue(contact, isLiabilityField) ||
    String(opportunity?.monetaryValue ?? '').trim()
  )
}

function parseStoredTargetMap(value) {
  const parsed = parseStoredObject(value, {})
  return Object.fromEntries(
    Object.entries(parsed || {}).filter((entry) => typeof entry[0] === 'string' && typeof entry[1] === 'string'),
  )
}

function getNormalizedFilingStatus(answers = {}) {
  const profilePayload = parseStoredObject(answers?.client_portal_financial_profile_payload, null)
  const rawPayload =
    profilePayload && typeof profilePayload === 'object'
      ? String(profilePayload.filing_status || profilePayload.filingStatus || '').trim()
      : ''
  const rawDirect = String(getPrimaryAnswer(answers, ['filingStatus', 'filing_status']) || '').trim()
  const raw = rawPayload || rawDirect
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  if (!normalized) return ''
  if (['single', 'single_filer'].includes(normalized)) return 'single'
  if (['mfj', 'married_filing_jointly', 'married_joint', 'married_filing_joint'].includes(normalized)) return 'married_joint'
  if (['mfs', 'married_filing_separately', 'married_separate', 'married_filing_separate'].includes(normalized)) return 'married_separate'
  if (['hoh', 'head_of_household', 'head_household'].includes(normalized)) return 'head_of_household'
  if (['qualifying_widow', 'qualifying_widower', 'widow', 'widower', 'qwidow'].includes(normalized)) return 'qualifying_widow'

  return normalized
}

function formatSsnLabel(value = '') {
  const digits = digitsOnly(value)
  if (digits.length !== 9) return digits
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

function formatPhoneLabel(value = '') {
  const digits = digitsOnly(value)
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return String(value || '').trim()
}

function formatCurrentDateLabel(value = '') {
  const normalized = String(value || '').trim()
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized)) return normalized
  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    const [year, month, day] = normalized.slice(0, 10).split('-')
    return `${month}/${day}/${year}`
  }
  const now = new Date()
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`
}

function isBoldsignCompletedDocumentError(error) {
  const message = String(error?.message || '').trim().toLowerCase()
  return message.includes('already been completed') || message.includes('document already complete')
}

function logMemoryDiagnostics(label = '', details = {}) {
  try {
    const usage = process.memoryUsage()
    const toMb = (value) => Math.round((Number(value || 0) / (1024 * 1024)) * 10) / 10
    console.log('8821 memory diagnostics:', {
      label: String(label || '').trim(),
      rssMb: toMb(usage.rss),
      heapTotalMb: toMb(usage.heapTotal),
      heapUsedMb: toMb(usage.heapUsed),
      externalMb: toMb(usage.external),
      arrayBuffersMb: toMb(usage.arrayBuffers),
      ...details,
    })
  } catch {
    // ignore logging failures
  }
}

function formatDobValue(value = '') {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized)) return normalized
  if (/^\d{8}$/.test(normalized)) {
    const month = normalized.slice(0, 2)
    const day = normalized.slice(2, 4)
    const year = normalized.slice(4)
    return `${month}/${day}/${year}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    const [year, month, day] = normalized.slice(0, 10).split('-')
    return `${month}/${day}/${year}`
  }
  return normalized
}

function formatUsdLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function toPositiveNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(digitsOnly(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  return 0
}

function formatCardTypeLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'visa') return 'Visa'
  if (normalized === 'mastercard' || normalized === 'master card') return 'Mastercard'
  if (normalized === 'amex' || normalized === 'american express') return 'AMEX'
  if (normalized === 'discover') return 'Discover'
  if (normalized === 'bank') return 'Bank'
  return String(value || '').trim()
}

function formatEndingInLabel(value = '') {
  const digits = digitsOnly(value)
  if (!digits) return ''
  return `Ending in ${digits.slice(-4)}`
}

function normalizeTaxAgencyLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'irs') return 'IRS'
  if (normalized === 'state') return 'State'
  if (normalized === 'both' || normalized === 'irs & state' || normalized === 'irs and state' || normalized === 'irs + state') return 'IRS & State'
  return String(value || '').trim()
}

function formatYearsLabel(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).join(', ')
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

function dataUrlToBuffer(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: String(match[1] || '').trim().toLowerCase() || 'application/octet-stream',
    buffer: Buffer.from(match[2], 'base64'),
  }
}

function getSaved8821Filename(answers = {}) {
  const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || 'client').trim()
  const safeClientName = clientName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'
  return `${safeClientName}-signed-document.pdf`
}

function getSaved8821FirstPageFilename(answers = {}) {
  const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || 'client').trim()
  const safeClientName = clientName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'
  return `${safeClientName}-signed-8821-page-1.pdf`
}

function getSavedResolutionFilename(answers = {}) {
  const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || 'client').trim()
  const safeClientName = clientName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'
  return `${safeClientName}-signed-2848.pdf`
}

function getSigned8821DocumentRecord(answers = {}) {
  const eaDocuments = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  if (!Array.isArray(eaDocuments)) return null
  return eaDocuments.find((doc) => doc && (doc.id === 'system_signed_8821_form' || doc.category === 'IRS Form 8821')) || null
}

function getSigned8821FirstPageDocumentRecord(answers = {}) {
  const eaDocuments = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  if (!Array.isArray(eaDocuments)) return null
  return eaDocuments.find((doc) => doc && (doc.id === 'system_signed_8821_first_page' || doc.category === 'IRS Form 8821 First Page')) || null
}

const signed8821StoreInFlight = new Map()

function hasFreshSigned8821StoredRecord(answers = {}) {
  return Boolean(
    getSigned8821DocumentRecord(answers) &&
      getSigned8821FirstPageDocumentRecord(answers) &&
      String(answers?.signed_8821_saved_at || '').trim() &&
      String(answers?.signed_8821_first_page_saved_at || '').trim() &&
      String(answers?.signed_8821_render_version || '').trim() === '3' &&
      String(answers?.signed_8821_first_page_render_version || '').trim() === '1',
  )
}

function stripSigned8821DocumentPayloads(answers = {}) {
  const current = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  if (!Array.isArray(current) || !current.length) return false
  let changed = false
  const nextDocuments = current.map((doc) => {
    if (!doc || typeof doc !== 'object') return doc
    const isSigned8821Doc =
      String(doc.id || '').trim() === 'system_signed_8821_form' || String(doc.category || '').trim() === 'IRS Form 8821'
    const isSigned8821Page1 =
      String(doc.id || '').trim() === 'system_signed_8821_first_page' || String(doc.category || '').trim() === 'IRS Form 8821 First Page'
    if (!isSigned8821Doc && !isSigned8821Page1) return doc
    if (!('dataUrl' in doc) || !doc.dataUrl) return doc
    changed = true
    const { dataUrl, ...rest } = doc
    return rest
  })
  if (changed) answers.ea_documents = nextDocuments
  return changed
}

function upsertSigned8821DocumentRecord(answers = {}, documentRecord) {
  const current = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  const nextDocuments = Array.isArray(current) ? current.filter((doc) => doc && doc.id !== 'system_signed_8821_form' && doc.category !== 'IRS Form 8821') : []
  answers.ea_documents = [documentRecord, ...nextDocuments]
}

function upsertSigned8821FirstPageDocumentRecord(answers = {}, documentRecord) {
  const current = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  const nextDocuments = Array.isArray(current)
    ? current.filter((doc) => doc && doc.id !== 'system_signed_8821_first_page' && doc.category !== 'IRS Form 8821 First Page')
    : []
  answers.ea_documents = [documentRecord, ...nextDocuments]
}

function clearSigned8821DocumentRecord(answers = {}) {
  const current = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  const nextDocuments = Array.isArray(current) ? current.filter((doc) => doc && doc.id !== 'system_signed_8821_form' && doc.category !== 'IRS Form 8821') : []
  answers.ea_documents = nextDocuments
}

function clearSigned8821FirstPageDocumentRecord(answers = {}) {
  const current = Array.isArray(answers?.ea_documents) ? answers.ea_documents : parseStoredObject(answers?.ea_documents, [])
  const nextDocuments = Array.isArray(current)
    ? current.filter((doc) => doc && doc.id !== 'system_signed_8821_first_page' && doc.category !== 'IRS Form 8821 First Page')
    : []
  answers.ea_documents = nextDocuments
}

function appendDocumentDeliveryLogEntry(answers = {}, entry = null) {
  if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) return
  const current = Array.isArray(answers?.document_delivery_log) ? answers.document_delivery_log : parseStoredObject(answers?.document_delivery_log, [])
  answers.document_delivery_log = [entry, ...(Array.isArray(current) ? current : [])]
}

function hasDocumentLifecycleEntry(answers = {}, { name = '', documentCode = '' } = {}) {
  const normalizedName = String(name || '').trim()
  const normalizedDocumentCode = String(documentCode || '').trim()
  if (!normalizedName) return false

  const deliveryLog = Array.isArray(answers?.document_delivery_log) ? answers.document_delivery_log : parseStoredObject(answers?.document_delivery_log, [])
  if (
    Array.isArray(deliveryLog) &&
    deliveryLog.some((entry) => {
      const entryName = String(entry?.name || '').trim()
      if (entryName !== normalizedName) return false
      const entryCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryCode && entryCode !== normalizedDocumentCode) return false
      const status = String(entry?.status || '').trim()
      return status === 'Sent' || status === 'Signed'
    })
  ) {
    return true
  }

  const receipts = Array.isArray(answers?.document_receipts) ? answers.document_receipts : parseStoredObject(answers?.document_receipts, [])
  return (
    Array.isArray(receipts) &&
    receipts.some((entry) => {
      const entryName = String(entry?.name || '').trim()
      if (entryName !== normalizedName) return false
      const entryCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryCode && entryCode !== normalizedDocumentCode) return false
      const status = String(entry?.status || '').trim()
      return status === 'Sent' || status === 'Signed'
    })
  )
}

function createDocumentInstanceCode(prefix = 'doc') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getActive8821DocumentCode(answers = {}) {
  return String(answers?.active_8821_document_code || answers?.current_8821_document_code || '').trim()
}

function is8821TargetAlreadySigned(answers = {}, target = 'client') {
  const normalizedTarget = String(target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
  if (normalizedTarget === 'spouse') {
    return String(answers?.form8821_spouse_status || '').trim().toLowerCase() === 'completed'
  }
  return String(answers?.form8821_status || '').trim().toLowerCase() === 'completed'
}

function markSigned8821DeliveryEntries(answers = {}, signedAt = '', documentCode = '') {
  const normalizedSignedAt = String(signedAt || '').trim() || new Date().toISOString()
  const normalizedDocumentCode = String(documentCode || getActive8821DocumentCode(answers)).trim()
  const targetNames = new Set(['8821 Document', '8821 Spouse'])

  const currentDeliveryLog = Array.isArray(answers?.document_delivery_log)
    ? answers.document_delivery_log
    : parseStoredObject(answers?.document_delivery_log, [])
  if (Array.isArray(currentDeliveryLog)) {
    answers.document_delivery_log = currentDeliveryLog.map((entry) => {
      const name = String(entry?.name || '').trim()
      if (!targetNames.has(name)) return entry
      const entryCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryCode && entryCode !== normalizedDocumentCode) return entry
      return {
        ...(entry || {}),
        status: 'Signed',
        signedAt: String(entry?.signedAt || '').trim() || normalizedSignedAt,
      }
    })
  }

  const currentReceipts = Array.isArray(answers?.document_receipts)
    ? answers.document_receipts
    : parseStoredObject(answers?.document_receipts, [])
  if (Array.isArray(currentReceipts)) {
    answers.document_receipts = currentReceipts.map((entry) => {
      const name = String(entry?.name || '').trim()
      if (!targetNames.has(name)) return entry
      const entryCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryCode && entryCode !== normalizedDocumentCode) return entry
      return {
        ...(entry || {}),
        status: 'Signed',
        sentAt: String(entry?.sentAt || '').trim() || normalizedSignedAt,
      }
    })
  }
}

function hasPersistedSigned8821Record(answers = {}) {
  return Boolean(
    String(answers?.signed_8821_saved_at || answers?.boldsign_8821_signed_at || '').trim() || getSigned8821DocumentRecord(answers),
  )
}

function normalizePersistedSigned8821State(answers = {}) {
  const strippedPayloads = stripSigned8821DocumentPayloads(answers)
  if (!hasPersistedSigned8821Record(answers) && !isForm8821FullySigned(answers)) return strippedPayloads
  const signedAt = String(answers?.boldsign_8821_signed_at || answers?.completed_at || answers?.signed_8821_saved_at || '').trim() || new Date().toISOString()
  const documentCode = getActive8821DocumentCode(answers)
  const beforeDelivery = JSON.stringify(parseStoredObject(answers?.document_delivery_log, []))
  const beforeReceipts = JSON.stringify(parseStoredObject(answers?.document_receipts, []))
  markSigned8821DeliveryEntries(answers, signedAt, documentCode)
  const afterDelivery = JSON.stringify(parseStoredObject(answers?.document_delivery_log, []))
  const afterReceipts = JSON.stringify(parseStoredObject(answers?.document_receipts, []))
  return strippedPayloads || beforeDelivery !== afterDelivery || beforeReceipts !== afterReceipts
}

function normalizePersistedResolutionSignedState(answers = {}) {
  if (!String(answers?.boldsign_resolution_signed_at || '').trim() && !hasSignedResolutionDocuments(answers)) return false
  const signedAt = String(answers?.boldsign_resolution_signed_at || '').trim() || new Date().toISOString()
  const documentCode = String(answers?.boldsign_resolution_document_id || '').trim()
  const beforeDelivery = JSON.stringify(parseStoredObject(answers?.document_delivery_log, []))
  const beforeReceipts = JSON.stringify(parseStoredObject(answers?.document_receipts, []))
  markSignedResolutionDeliveryEntries(answers, signedAt, documentCode)
  const afterDelivery = JSON.stringify(parseStoredObject(answers?.document_delivery_log, []))
  const afterReceipts = JSON.stringify(parseStoredObject(answers?.document_receipts, []))
  return beforeDelivery !== afterDelivery || beforeReceipts !== afterReceipts
}

function maybeTrackExperienceDocumentRoute(roomCode, room, nextRoute = '', previousRoute = '') {
  const normalizedNextRoute = String(nextRoute || '').trim()
  const normalizedPreviousRoute = String(previousRoute || '').trim()
  if (!normalizedNextRoute || normalizedNextRoute === normalizedPreviousRoute) return false
  if (normalizedNextRoute !== '/session/sign-form-8821' && normalizedNextRoute !== '/session/sign-form-8821-spouse') return false

  const answers = room?.state?.answers || {}
  const isSpouseTarget = normalizedNextRoute.endsWith('-spouse')
  const receiptName = isSpouseTarget ? '8821 Spouse' : '8821 Document'
  const existingDocumentCode = getActive8821DocumentCode(answers)
  const documentCode = existingDocumentCode || createDocumentInstanceCode('red')
  answers.current_8821_document_code = documentCode
  answers.active_8821_document_code = documentCode
  if (hasDocumentLifecycleEntry(answers, { name: receiptName, documentCode })) {
    return false
  }
  const recipientEmail = String(
    isSpouseTarget
      ? getSpouseSignerEmailFromAnswers(answers) || answers.spouse_email || ''
      : getPrimaryAnswer(answers, ['email', 'email_address']) || '',
  ).trim()
  const sentAt = new Date().toISOString()
  appendDocumentDeliveryLogEntry(answers, {
    id: `doc_experience_${Date.now().toString(36)}_${isSpouseTarget ? 'spouse' : 'client'}`,
    name: receiptName,
    documentCode,
    status: 'Sent',
    method: 'Experience',
    sentAt,
    recipientEmail,
    sentBy: '',
    route: normalizedNextRoute,
    sessionCode: roomCode,
  })
  answers.document_receipts = upsertDocumentReceipts(answers.document_receipts, [
    {
      name: receiptName,
      documentCode,
      status: 'Sent',
      method: 'Experience',
      sentAt,
      recipientEmail,
      sentBy: 'Experience',
    },
  ])
  const hiddenReceiptNames = parseStoredObject(answers.hidden_document_receipt_names, []).filter((name) => typeof name === 'string' && name.trim())
  answers.hidden_document_receipt_names = hiddenReceiptNames.filter((name) => String(name || '').trim() !== receiptName)
  answers.last_document_experience_sent_at = sentAt
  return {
    receiptName,
    documentCode,
    target: isSpouseTarget ? 'spouse' : 'client',
  }
}

async function loadSigned8821DocumentPayload(roomCode, room) {
  const answers = room?.state?.answers || {}
  const savedDocument = getSigned8821DocumentRecord(answers)
  const savedPayload = dataUrlToBuffer(savedDocument?.dataUrl || '')
  if (savedPayload?.buffer?.length) {
    let shouldPersistStrippedPayload = stripSigned8821DocumentPayloads(answers)
    const renderVersion = String(answers?.signed_8821_render_version || '').trim()
    if (renderVersion !== '3') {
      try {
        const refreshed = await refreshSigned8821StoredPdf(roomCode, room)
        if (refreshed?.buffer?.length) {
          return {
            fileBuffer: refreshed.buffer,
            contentType: refreshed.mimeType || 'application/pdf',
            filename: getSaved8821Filename(answers),
          }
        }
      } catch {
        // fall through to probe / return stored payload
      }
    }
    // If we previously saved a PDF that still contains the IRS template's interactive form
    // widgets (which render "Enter value" placeholders), regenerate a clean copy on-demand.
    try {
      const probe = await PDFDocument.load(savedPayload.buffer)
      const probeForm = probe.getForm()
      const hasFields = probeForm.getFields().length > 0
      if (hasFields) {
        const refreshed = await refreshSigned8821StoredPdf(roomCode, room)
        if (refreshed?.buffer?.length) {
          return {
            fileBuffer: refreshed.buffer,
            contentType: refreshed.mimeType || 'application/pdf',
            filename: getSaved8821Filename(answers),
          }
        }
      }
    } catch {
      // ignore; if probe fails, fall back to returning the stored payload
    }
    if (shouldPersistStrippedPayload) {
      room.state.updatedAt = Date.now()
      try {
        await dbUpsertSession({ code: roomCode, state: room.state })
      } catch {
        // ignore; still return the legacy payload for this request
      }
    }
    return {
      fileBuffer: savedPayload.buffer,
      contentType: savedPayload.mimeType || 'application/pdf',
      filename: getSaved8821Filename(answers),
    }
  }

  const documentId = String(answers.boldsign_8821_document_id || '').trim()
  if (!documentId) return null
  const download = await boldsignDownloadDocument(documentId, {
    onBehalfOf: String(answers.boldsign_8821_sender_email || '').trim() || undefined,
  })
  // BoldSign downloads can still include interactive form widgets whose default
  // appearance renders placeholder text like "Enter value". Strip those widgets
  // before serving and persist the cleaned copy for future views.
  let cleanedBuffer = download.fileBuffer
  try {
    const pdfDoc = await PDFDocument.load(download.fileBuffer)
    stripPdfWidgetPlaceholders(pdfDoc)
    cleanedBuffer = Buffer.from(await pdfDoc.save())
  } catch {
    // ignore; fall back to raw download
  }

  if (cleanedBuffer?.length) {
    try {
      upsertSigned8821DocumentRecord(answers, {
        id: 'system_signed_8821_form',
        name: 'Signed Form 8821.pdf',
        category: 'IRS Form 8821',
        mimeType: 'application/pdf',
        size: cleanedBuffer.length,
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'System',
      })
      stripSigned8821DocumentPayloads(answers)
      answers.signed_8821_saved_at = new Date().toISOString()
      answers.signed_8821_file_name = getSaved8821Filename(answers)
      const signedAt = String(answers.boldsign_8821_signed_at || answers.completed_at || '').trim() || new Date().toISOString()
      markSigned8821DeliveryEntries(answers, signedAt)
      room.state.updatedAt = Date.now()
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch {
      // ignore persistence errors; still return cleaned PDF
    }
  }

  return {
    fileBuffer: cleanedBuffer,
    contentType: download.contentType || 'application/pdf',
    filename: getSaved8821Filename(answers),
  }
}

async function loadSigned8821FirstPageDocumentPayload(roomCode, room) {
  const answers = room?.state?.answers || {}
  const savedDocument = getSigned8821FirstPageDocumentRecord(answers)
  const savedPayload = dataUrlToBuffer(savedDocument?.dataUrl || '')
  if (savedPayload?.buffer?.length) {
    let shouldPersistStrippedPayload = stripSigned8821DocumentPayloads(answers)
    const renderVersion = String(answers?.signed_8821_first_page_render_version || '').trim()
    if (renderVersion !== '1') {
      try {
        const refreshed = await refreshSigned8821FirstPageStoredPdf(roomCode, room)
        if (refreshed?.buffer?.length) {
          return {
            fileBuffer: refreshed.buffer,
            contentType: refreshed.mimeType || 'application/pdf',
            filename: getSaved8821FirstPageFilename(answers),
          }
        }
      } catch {
        // fall through
      }
    }
    if (shouldPersistStrippedPayload) {
      room.state.updatedAt = Date.now()
      try {
        await dbUpsertSession({ code: roomCode, state: room.state })
      } catch {
        // ignore; still return the legacy payload for this request
      }
    }
    return {
      fileBuffer: savedPayload.buffer,
      contentType: savedPayload.mimeType || 'application/pdf',
      filename: getSaved8821FirstPageFilename(answers),
    }
  }
  if (!String(answers.boldsign_8821_document_id || '').trim()) return null
  const refreshed = await refreshSigned8821FirstPageStoredPdf(roomCode, room)
  if (!refreshed?.buffer?.length) return null
  return {
    fileBuffer: refreshed.buffer,
    contentType: refreshed.mimeType || 'application/pdf',
    filename: getSaved8821FirstPageFilename(answers),
  }
}

function stripPdfWidgetPlaceholders(pdfDoc) {
  try {
    // Remove the AcroForm root if present.
    try {
      pdfDoc.catalog.delete(PDFName.of('AcroForm'))
    } catch {
      // ignore
    }
    const pages = pdfDoc.getPages()
    pages.forEach((page) => {
      try {
        const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
        if (!annots) return
        const kept = []
        for (let i = 0; i < annots.size(); i += 1) {
          const ref = annots.get(i)
          try {
            const annot = pdfDoc.context.lookup(ref, PDFDict)
            const subtype = annot.get(PDFName.of('Subtype'))
            if (subtype === PDFName.of('Widget')) continue
          } catch {
            // keep unknown annotation refs
          }
          kept.push(ref)
        }
        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(kept))
      } catch {
        // ignore
      }
    })
  } catch {
    // ignore
  }
}

async function refreshSigned8821StoredPdf(roomCode, room) {
  const answers = room?.state?.answers || {}
  const pdfBuffer = await buildSigned8821PdfBuffer(answers)
  upsertSigned8821DocumentRecord(answers, {
    id: 'system_signed_8821_form',
    name: 'Signed Form 8821.pdf',
    category: 'IRS Form 8821',
    mimeType: 'application/pdf',
    size: pdfBuffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: 'System',
  })
  stripSigned8821DocumentPayloads(answers)
  const signedAt = String(answers.boldsign_8821_signed_at || answers.completed_at || '').trim() || new Date().toISOString()
  markSigned8821DeliveryEntries(answers, signedAt)
  answers.signed_8821_saved_at = new Date().toISOString()
  answers.signed_8821_file_name = getSaved8821Filename(answers)
  answers.signed_8821_render_version = '3'
  room.state.updatedAt = Date.now()
  try {
    await dbUpsertSession({ code: roomCode, state: room.state })
  } catch {
    // ignore
  }
  return { buffer: pdfBuffer, mimeType: 'application/pdf' }
}

async function refreshSigned8821FirstPageStoredPdf(roomCode, room) {
  const answers = room?.state?.answers || {}
  const pdfBuffer = await buildSigned8821FirstPagePdfBuffer(answers)
  upsertSigned8821FirstPageDocumentRecord(answers, {
    id: 'system_signed_8821_first_page',
    name: 'Signed Form 8821 Page 1.pdf',
    category: 'IRS Form 8821 First Page',
    mimeType: 'application/pdf',
    size: pdfBuffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: 'System',
  })
  stripSigned8821DocumentPayloads(answers)
  answers.signed_8821_first_page_saved_at = new Date().toISOString()
  answers.signed_8821_first_page_file_name = getSaved8821FirstPageFilename(answers)
  answers.signed_8821_first_page_render_version = '1'
  room.state.updatedAt = Date.now()
  try {
    await dbUpsertSession({ code: roomCode, state: room.state })
  } catch {
    // ignore
  }
  return { buffer: pdfBuffer, mimeType: 'application/pdf' }
}

function get8821PdfValues(answers = {}) {
  const fullName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || '').trim()
  const spouseFullName = getNormalizedSpouseName(answers)
  const street = getPrimaryAnswer(answers, ['street', 'address1', 'address'])
  const apt = getPrimaryAnswer(answers, ['apt', 'address2'])
  const city = getPrimaryAnswer(answers, ['city'])
  const stateCode = getPrimaryAnswer(answers, ['state', 'stateCode'])
  const zipCode = getPrimaryAnswer(answers, ['zip', 'zipCode', 'postalCode'])
  const addressLine1 = [fullName, isMarriedJointFilingAnswers(answers) && spouseFullName ? `& ${spouseFullName}` : ''].filter(Boolean).join(' ')
  const addressLine2 = [street, apt].filter(Boolean).join(', ')
  const addressLine3 = [city, stateCode, zipCode].filter(Boolean).join(', ').replace(', ,', ',')
  const oweValue = String(getPrimaryAnswer(answers, ['owe']) || '').trim().toLowerCase()
  const explicitTaxAgency = String(getPrimaryAnswer(answers, ['taxAgency', 'tax_agency']) || '').trim()
  const taxAgencyLabel = explicitTaxAgency || (oweValue === 'both' ? 'IRS & State' : oweValue === 'state' ? 'State' : 'IRS')
  const taxTypeValue = String(getPrimaryAnswer(answers, ['taxType']) || '').trim().toLowerCase()
  const taxTypeLabel = taxTypeValue === 'business' ? 'Business' : taxTypeValue === 'both' ? 'Income, Business' : 'Income'
  const yearsLabel = formatYearsLabel(
    getPrimaryAnswer(answers, ['oweYears', 'yearsUnfiled', 'years_unfiled', 'years']) || answers?.years || '',
  )
  const signatureDates = parseStoredTargetMap(answers.esign_dates_by_target)
  return {
    taxpayerBlock: [addressLine1, addressLine2, addressLine3].filter(Boolean).join('\n'),
    taxpayerTin: formatSsnLabel(getPrimaryAnswer(answers, ['ssn'])),
    taxpayerPhone: formatPhoneLabel(getPrimaryAnswer(answers, ['phone', 'phone_number'])),
    designeeBlock: ['Tax Refresh', '405 Rockefeller', 'Irvine, CA 92612'].join('\n'),
    designeePhone: '(949) 702-2723',
    taxTypeLabel,
    formNumberLabel: taxTypeValue === 'business' ? '1120' : taxTypeValue === 'both' ? '1040, 1120' : '1040',
    yearsLabel,
    specificMattersLabel: `${taxAgencyLabel} transcript authorization`,
    signatureDateLabel: formatCurrentDateLabel(signatureDates['agreement-client-signature'] || signatureDates['billing-signature'] || ''),
    printNameLabel: fullName,
  }
}

const RED_PACKET_PAGES = Array.from({ length: 13 }, (_, index) => index + 1)

const RED_SIGNATURE_TARGETS = [
  { id: '8821-signature', page: 1, top: 80.3, left: 9.6, width: 19.6, height: 2.8 },
  { id: 'billing-signature', page: 5, top: 89.1, left: 17.4, width: 18.8, height: 2.9 },
  { id: 'page10-custom-signature', page: 10, top: 22.5, left: 15.6, width: 22.0, height: 2.6 },
  { id: 'communications-signature', page: 10, top: 76.9, left: 15.4, width: 18.8, height: 2.9 },
  { id: 'agreement-client-signature', page: 12, top: 16.5, left: 17.4, width: 18.8, height: 2.9 },
  { id: 'agreement-spouse-signature', page: 12, top: 21.5, left: 23.4, width: 18.8, height: 2.9 },
  { id: 'cancellation-signature', page: 13, top: 31.8, left: 16.8, width: 24.2, height: 2.9 },
]

const RED_DATE_TARGETS = [
  { id: '8821-signature', page: 1, top: 81, left: 72.3, width: 16.4, height: 2.9 },
  { id: 'billing-signature', page: 5, top: 89.3, left: 82.8, width: 12.0, height: 2.9 },
  { id: 'page10-custom-signature', page: 10, top: 23.1, left: 69.1, width: 22.0, height: 2.6 },
  { id: 'communications-signature', page: 10, top: 77.2, left: 82.9, width: 12.0, height: 2.9 },
  { id: 'agreement-client-signature', page: 12, top: 17.2, left: 82.7, width: 12.0, height: 2.9 },
  { id: 'agreement-spouse-signature', page: 12, top: 22, left: 82.4, width: 12.0, height: 2.9 },
  { id: 'cancellation-signature', page: 13, top: 11, left: 16, width: 17.4, height: 2.9 },
  { id: 'cancellation-signature', page: 13, top: 29.9, left: 19.9, width: 18.2, height: 2.9 },
]

const RED_FULL_NAME_TARGETS = [
  { id: 'taxpayer-print-name', page: 1, top: 85.6, left: 6.1, width: 30.2, height: 2.7 },
  { id: 'cancellation-spouse-print-name', page: 12, top: 18.9, left: 17.2, width: 32.0, height: 2.7 },
  { id: 'cancellation-client-print-name', page: 13, top: 35.6, left: 20.9, width: 28.0, height: 2.7 },
]

const RED_DISCOUNT_STRIKE_TARGETS = [
  { id: 'fee-summary-service-fee-strike', page: 4, top: 60.1, left: 46.8, width: 6.2, height: 0.3 },
  { id: 'fee-summary-total-fees-strike', page: 4, top: 65.6, left: 46.7, width: 6.2, height: 0.3 },
  { id: 'fee-summary-balance-strike', page: 4, top: 71, left: 46.8, width: 6.2, height: 0.3 },
]

const RED_AUTOFILL_TARGETS = [
  { id: 'custom-1784669349065', page: 1, top: 15.5, left: 0.8, width: 62, height: 2.6 },
  { id: 'custom-1784669313950', page: 1, top: 14.2, left: 58.3, width: 22, height: 2.6 },
  { id: 'custom-1784669326548', page: 1, top: 17.2, left: 55.8, width: 22, height: 2.6 },
  { id: 'custom-1784669186192', page: 1, top: 25.5, left: 0, width: 52, height: 2.6 },
  { id: 'custom-1784669201362', page: 1, top: 22.2, left: 56.4, width: 22, height: 2.6 },
  { id: 'custom-1784669211927', page: 1, top: 23.6, left: 54.7, width: 22, height: 2.6 },
  { id: 'custom-1784669220785', page: 1, top: 25.3, left: 60.3, width: 22, height: 2.6 },
  { id: 'custom-1784669268807', page: 1, top: 48.5, left: 7, width: 22, height: 2.6 },
  { id: 'custom-1784669278409', page: 1, top: 48.7, left: 35.7, width: 22, height: 2.6 },
  { id: 'custom-1784669295728', page: 1, top: 48.7, left: 49.7, width: 22, height: 2.6 },
  { id: 'agreement-effective-date', page: 2, top: 14, left: 45.2, width: 15.8, height: 1.9 },
  { id: 'agreement-client-full-name', page: 2, top: 14, left: 65.9, width: 25.0, height: 1.9 },
  { id: 'client-last-name', page: 2, top: 31.3, left: 6.7, width: 16.5, height: 2.4 },
  { id: 'client-first-name', page: 2, top: 31.3, left: 22, width: 16.5, height: 2.4 },
  { id: 'client-mi', page: 2, top: 31.4, left: 41.4, width: 4.6, height: 2.4 },
  { id: 'client-ssn', page: 2, top: 31.5, left: 54.4, width: 13.6, height: 2.4 },
  { id: 'client-dob', page: 2, top: 31.4, left: 68.9, width: 11.8, height: 2.4 },
  { id: 'spouse-last-name', page: 2, top: 34.7, left: 6.7, width: 16.5, height: 2.4 },
  { id: 'spouse-first-name', page: 2, top: 34.8, left: 22, width: 16.5, height: 2.4 },
  { id: 'spouse-ssn', page: 2, top: 34.7, left: 39.1, width: 13.5, height: 2.4 },
  { id: 'spouse-dob', page: 2, top: 34.8, left: 53.7, width: 11.8, height: 2.4 },
  { id: 'physical-address', page: 2, top: 38, left: 7.7, width: 16.5, height: 2.4 },
  { id: 'physical-city', page: 2, top: 37.9, left: 23.7, width: 16.5, height: 2.4 },
  { id: 'physical-state', page: 2, top: 37.9, left: 41.5, width: 13.5, height: 2.4 },
  { id: 'physical-zip', page: 2, top: 37.9, left: 58.7, width: 11.8, height: 2.4 },
  { id: 'mailing-address', page: 2, top: 41.2, left: 8, width: 16.5, height: 2.4 },
  { id: 'mailing-city', page: 2, top: 41.3, left: 23.8, width: 16.5, height: 2.4 },
  { id: 'mailing-state', page: 2, top: 41.2, left: 41.5, width: 13.5, height: 2.4 },
  { id: 'mailing-zip', page: 2, top: 41.3, left: 58.1, width: 11.8, height: 2.4 },
  { id: 'client-email', page: 2, top: 44.8, left: 7.1, width: 16.5, height: 2.4 },
  { id: 'client-cell-phone', page: 2, top: 44.6, left: 23.6, width: 16.5, height: 2.4 },
  { id: 'client-home-phone', page: 2, top: 44.7, left: 39.2, width: 13.5, height: 2.4 },
  { id: 'spouse-phone', page: 2, top: 44.6, left: 57.4, width: 19.8, height: 2.4 },
  { id: 'business-name', page: 2, top: 48.1, left: 7.6, width: 16.5, height: 4.8 },
  { id: 'business-ein', page: 2, top: 49.1, left: 22.4, width: 16.5, height: 2.4 },
  { id: 'business-work-phone', page: 2, top: 49.1, left: 41.9, width: 13.5, height: 2.4 },
  { id: 'section2-tax-type', page: 2, top: 64.1, left: 7.3, width: 20.0, height: 2.4 },
  { id: 'section2-tax-agency', page: 2, top: 64.3, left: 26.5, width: 18.2, height: 2.4 },
  { id: 'section2-estimated-liability', page: 2, top: 64.2, left: 46.3, width: 17.8, height: 2.4 },
  { id: 'section2-unfiled-years', page: 2, top: 64.3, left: 65, width: 18.0, height: 2.4 },
  { id: 'fee-summary-service-fee', page: 4, top: 59.2, left: 54.3, width: 16.0, height: 2.3 },
  { id: 'fee-summary-total-fees', page: 4, top: 64.7, left: 54.4, width: 16.0, height: 2.3 },
  { id: 'fee-summary-balance', page: 4, top: 70.1, left: 54.3, width: 16.0, height: 2.3 },
  { id: 'payment-card-type', page: 5, top: 30.4, left: 7.0, width: 16.0, height: 2.4 },
  { id: 'payment-cardholder-name', page: 5, top: 30.3, left: 23.4, width: 27.0, height: 2.4 },
  { id: 'payment-card-number', page: 5, top: 34, left: 6.8, width: 17.4, height: 2.4 },
  { id: 'payment-card-expiration', page: 5, top: 33.9, left: 38.8, width: 11.2, height: 2.4 },
  { id: 'payment-card-cvv', page: 5, top: 33.5, left: 57.2, width: 8.8, height: 2.4 },
  { id: 'payment-bank-name', page: 5, top: 41.6, left: 7.4, width: 24.2, height: 2.4 },
  { id: 'payment-account-holder-name', page: 5, top: 41.8, left: 46.7, width: 23.2, height: 2.4 },
  { id: 'payment-account-number', page: 5, top: 45.2, left: 6.1, width: 24.2, height: 2.4 },
  { id: 'payment-routing-number', page: 5, top: 45.3, left: 48.6, width: 23.2, height: 2.4 },
  { id: 'custom-1784670092270', page: 5, top: 33.7, left: 25.5, width: 22, height: 2.6 },
  { id: 'custom-1784672403784', page: 5, top: 55, left: 10.6, width: 22, height: 2.6 },
  { id: 'custom-1784672412360', page: 5, top: 55.1, left: 51.4, width: 22, height: 2.6 },
  { id: 'custom-1784672419999', page: 5, top: 57.6, left: 10.5, width: 22, height: 2.6 },
  { id: 'custom-1784672432443', page: 5, top: 60.3, left: 10.6, width: 22, height: 2.6 },
  { id: 'custom-1784672467904', page: 5, top: 57.7, left: 51.4, width: 22, height: 2.6 },
  { id: 'custom-1784672476809', page: 5, top: 60.3, left: 51.4, width: 22, height: 2.6 },
]

function shrinkOverlayBox(target, widthScale = 0.78, heightScale = 0.68) {
  const nextWidth = target.width * widthScale
  const nextHeight = target.height * heightScale
  return {
    top: target.top + (target.height - nextHeight) / 2,
    left: target.left + (target.width - nextWidth) / 2,
    width: nextWidth,
    height: nextHeight,
  }
}

function getTopY(pageHeight, topRatio, height = 0) {
  return pageHeight * (1 - topRatio) - height
}

function drawWrappedText(page, font, text, {
  leftRatio,
  topRatio,
  maxWidthRatio,
  fontSize = 11,
  lineHeight = 13,
  color = rgb(0.15, 0.15, 0.15),
} = {}) {
  const value = String(text || '').trim()
  if (!value) return
  const pageWidth = page.getWidth()
  const pageHeight = page.getHeight()
  const maxWidth = pageWidth * maxWidthRatio
  const words = value.split(/\s+/)
  const lines = []
  let currentLine = ''
  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !currentLine) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  })
  if (currentLine) lines.push(currentLine)
  const startX = pageWidth * leftRatio
  let currentY = getTopY(pageHeight, topRatio, fontSize)
  lines.forEach((line) => {
    page.drawText(line, { x: startX, y: currentY, size: fontSize, font, color })
    currentY -= lineHeight
  })
}

function drawMultilineText(page, font, lines = [], {
  leftRatio,
  topRatio,
  fontSize = 11,
  lineHeight = 13,
  color = rgb(0.15, 0.15, 0.15),
} = {}) {
  const pageWidth = page.getWidth()
  const pageHeight = page.getHeight()
  let currentY = getTopY(pageHeight, topRatio, fontSize)
  lines.filter(Boolean).forEach((line) => {
    page.drawText(String(line), {
      x: pageWidth * leftRatio,
      y: currentY,
      size: fontSize,
      font,
      color,
    })
    currentY -= lineHeight
  })
}

async function load8821BackgroundImageBytes() {
  // Use the same visual the client signs against (experience-site red packet image),
  // not the IRS fillable PDF template which contains "Enter value" placeholders baked in.
  const imageUrl = new URL('./assets/f8821-page-1.png', import.meta.url)
  return await readFile(imageUrl)
}

async function loadRedPacketPageImageBytes(pageNumber) {
  const imageUrl = new URL(`./assets/f8821-page-${pageNumber}.png`, import.meta.url)
  return await readFile(imageUrl)
}

function getRedPacketRenderContext(answers = {}) {
  const fullName = String(getPrimaryAnswer(answers, ['full_name', 'name', 'client_name', 'clientName']) || 'Client').trim()
  const nameParts = fullName.split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] || 'Client'
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
  const middleInitial = nameParts.length > 2 ? String(nameParts[1] || '').slice(0, 1).toUpperCase() : ''
  const email = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
  const phone = String(getPrimaryAnswer(answers, ['phone', 'phone_number', 'mobile', 'mobile_phone', 'cell', 'cell_phone']) || '').trim()
  const street = String(getPrimaryAnswer(answers, ['street', 'address1', 'address']) || '').trim()
  const apt = String(getPrimaryAnswer(answers, ['apt', 'address2', 'unit', 'apartment']) || '').trim()
  const city = String(getPrimaryAnswer(answers, ['city']) || '').trim()
  const stateCode = String(getPrimaryAnswer(answers, ['state', 'stateCode', 'expenseState']) || '').trim()
  const zipCode = String(getPrimaryAnswer(answers, ['zip', 'zipCode', 'postalCode', 'mailingZip', 'mailing_zip']) || '').trim()
  const mailingStreet = String(getPrimaryAnswer(answers, ['mailing_address', 'mailingAddress', 'mailing_street', 'mailingStreet']) || street).trim()
  const mailingCity = String(getPrimaryAnswer(answers, ['mailing_city', 'mailingCity']) || city).trim()
  const mailingState = String(getPrimaryAnswer(answers, ['mailing_state', 'mailingState']) || stateCode).trim()
  const mailingZip = String(getPrimaryAnswer(answers, ['mailing_zip', 'mailingZip']) || zipCode).trim()
  const dob = formatDobValue(getPrimaryAnswer(answers, ['dob', 'date_of_birth', 'birthDate']))
  const ssn = formatSsnLabel(getPrimaryAnswer(answers, ['ssn']))
  const spouseFirstName = String(getPrimaryAnswer(answers, ['spouseFirstName', 'spouse_first_name']) || '').trim()
  const spouseLastName = String(getPrimaryAnswer(answers, ['spouseLastName', 'spouse_last_name']) || '').trim()
  const spouseFullName = getNormalizedSpouseName(answers)
  const spouseSsn = formatSsnLabel(getPrimaryAnswer(answers, ['spouse_ssn', 'spouseSsn']))
  const spouseDob = formatDobValue(getPrimaryAnswer(answers, ['spouse_dob', 'spouseDob']))
  const spousePhone = String(getPrimaryAnswer(answers, ['spouse_phone', 'spousePhone']) || phone || '').trim()
  const spouseMailingAddress = [mailingStreet, mailingCity, mailingState, mailingZip].filter(Boolean).join(', ').replace(', ,', ',')
  const taxTypeValue = String(getPrimaryAnswer(answers, ['taxType']) || '').trim().toLowerCase()
  const taxTypeLabel = taxTypeValue === 'personal' ? 'Personal' : taxTypeValue === 'business' ? 'Business' : taxTypeValue === 'both' ? 'Both' : ''
  const taxAgencyLabel = normalizeTaxAgencyLabel(String(getPrimaryAnswer(answers, ['taxAgency', 'tax_agency']) || getPrimaryAnswer(answers, ['owe']) || '').trim())
  const irs = toNumberValue(answers['irsBalance'])
  const state = toNumberValue(answers['stateBalance'])
  const aliasTotal = toNumberValue(
    answers['taxLiability'] || answers['tax_liability'] || answers['totalLiability'] || answers['total_liability'] || answers['ghl_opportunity_value'] || 0,
  )
  const totalLiability = irs + state || aliasTotal
  const estimatedLiabilityLabel = formatUsdLabel(totalLiability)
  const unfiledYearsLabel = formatYearsLabel(
    getPrimaryAnswer(answers, ['oweYears', 'yearsUnfiled', 'years_unfiled', 'years']) || answers['years'] || '',
  )
  const storedInvoice = toPositiveNumber(answers['billing_invoice_amount'])
  const paymentPlanSelected = String(answers['paymentPlanSelected'] || answers['payment_plan_selected'] || '').trim().toLowerCase()
  const effectiveInvoiceAmount = storedInvoice > 0 ? storedInvoice : paymentPlanSelected === 'payment_plan' ? 500 : Math.max(toPositiveNumber(answers['planPriceOverride']), 500)
  const discountedFeeLabel = formatUsdLabel(effectiveInvoiceAmount)
  const billingSchedule = getBillingScheduleRowsFromAnswers(answers)
  const billingScheduleDate1Label = formatCurrentDateLabel(billingSchedule[0]?.date || '')
  const billingScheduleAmount1Label = String(billingSchedule[0]?.amount || '').trim()
  const billingScheduleDate2Label = formatCurrentDateLabel(billingSchedule[1]?.date || '')
  const billingScheduleAmount2Label = String(billingSchedule[1]?.amount || '').trim()
  const billingScheduleDate3Label = formatCurrentDateLabel(billingSchedule[2]?.date || '')
  const billingScheduleAmount3Label = String(billingSchedule[2]?.amount || '').trim()
  const signatureDates = parseStoredTargetMap(answers['esign_dates_by_target'])
  const spouseSignatureDateLabel = formatCurrentDateLabel(signatureDates['agreement-spouse-signature'] || '')
  const paymentMethod = (() => {
    const direct = parseStoredObject(answers['billing_payment_method'], null)
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct
    const storedMethods = parseStoredObject(answers['billing_payment_methods'], []).filter((method) => method && typeof method === 'object' && !Array.isArray(method))
    return storedMethods[storedMethods.length - 1] || null
  })()
  const paymentCardTypeLabel = formatCardTypeLabel(
    String(
      getPrimaryAnswer(answers, ['brand', '_ui_pay_cardBrand']) ||
        (typeof paymentMethod?.cardType === 'string' ? paymentMethod.cardType : '') ||
        '',
    ),
  )
  const paymentCardholderNameLabel = String(
    getPrimaryAnswer(answers, ['payment_cardholder_name', '_ui_pay_nameOnCard']) ||
      (typeof paymentMethod?.cardholderName === 'string' ? paymentMethod.cardholderName : '') ||
      '',
  )
  const paymentCardNumberLabel = formatEndingInLabel(
    String(
      getPrimaryAnswer(answers, ['payment_card_number', '_ui_pay_cardNumber']) ||
        (typeof paymentMethod?.cardNumber === 'string' ? paymentMethod.cardNumber : '') ||
        (typeof answers['last4'] === 'string' ? answers['last4'] : '') ||
        '',
    ),
  )
  const paymentCardExpirationLabel = String(
    getPrimaryAnswer(answers, ['payment_card_expiration', '_ui_pay_expiry']) ||
      (typeof paymentMethod?.expiration === 'string' ? paymentMethod.expiration : '') ||
      '',
  )
  const paymentCardCvvLabel = String(
    getPrimaryAnswer(answers, ['payment_card_cvv', 'paymentCardCvv', 'payment_cvv', '_ui_pay_cvv', 'cvv', 'cvc']) ||
      (typeof paymentMethod?.cvv === 'string' ? paymentMethod.cvv : '') ||
      (typeof paymentMethod?.cvc === 'string' ? paymentMethod.cvc : '') ||
      (typeof paymentMethod?.securityCode === 'string' ? paymentMethod.securityCode : '') ||
      '',
  ).trim()
  const paymentBankNameLabel = String(
    getPrimaryAnswer(answers, ['payment_bank_name']) || (typeof paymentMethod?.institutionName === 'string' ? paymentMethod.institutionName : '') || '',
  )
  const paymentAccountHolderNameLabel = String(
    getPrimaryAnswer(answers, ['payment_account_holder_name', '_ui_pay_accountHolderName']) ||
      (typeof paymentMethod?.accountHolderName === 'string' ? paymentMethod.accountHolderName : '') ||
      '',
  )
  const paymentAccountNumberLabel = formatEndingInLabel(
    String(
      getPrimaryAnswer(answers, ['payment_account_number', '_ui_pay_accountNumber']) ||
        (typeof paymentMethod?.accountNumber === 'string' ? paymentMethod.accountNumber : '') ||
        (typeof answers['last4'] === 'string' ? answers['last4'] : '') ||
        '',
    ),
  )
  const paymentRoutingNumberLabel = formatEndingInLabel(
    String(getPrimaryAnswer(answers, ['payment_routing_number', '_ui_pay_routingNumber']) || (typeof paymentMethod?.routingNumber === 'string' ? paymentMethod.routingNumber : '') || ''),
  )
  const primaryPaymentMethodKind = (() => {
    const explicit = String(answers['payment_method_type'] || answers['pay'] || '').trim().toLowerCase()
    if (explicit === 'card') return 'card'
    if (explicit === 'bank') return 'bank'
    const methodType = String(typeof paymentMethod?.type === 'string' ? paymentMethod.type : '').trim().toLowerCase()
    if (methodType === 'card') return 'card'
    if (methodType === 'ach' || methodType === 'bank') return 'bank'
    const hasCardData = Boolean(paymentCardTypeLabel || paymentCardholderNameLabel || paymentCardNumberLabel || paymentCardExpirationLabel || paymentCardCvvLabel)
    const hasBankData = Boolean(paymentBankNameLabel || paymentAccountHolderNameLabel || paymentAccountNumberLabel || paymentRoutingNumberLabel)
    if (hasCardData && !hasBankData) return 'card'
    if (hasBankData && !hasCardData) return 'bank'
    return null
  })()
  return {
    fullName,
    firstName,
    lastName,
    middleInitial,
    email,
    phone,
    city,
    stateCode,
    zipCode,
    mailingCity,
    mailingState,
    mailingZip,
    dob,
    ssn,
    spouseFirstName,
    spouseLastName,
    spouseFullName,
    spouseSsn,
    spouseDob,
    spousePhone,
    spouseMailingAddress,
    spouseSignatureDateLabel,
    businessName: String(getPrimaryAnswer(answers, ['business_name', 'businessName']) || '').trim(),
    businessEin: String(getPrimaryAnswer(answers, ['business_ein', 'businessEin', 'ein']) || '').trim(),
    businessWorkPhone: String(getPrimaryAnswer(answers, ['business_phone', 'business_work_phone', 'businessWorkPhone']) || '').trim(),
    physicalAddress: [street, apt].filter(Boolean).join(', '),
    mailingAddress: [mailingStreet].filter(Boolean).join(', '),
    taxTypeLabel,
    taxAgencyLabel,
    estimatedLiabilityLabel,
    unfiledYearsLabel,
    effectiveInvoiceAmount,
    discountedFeeLabel,
    paymentCardTypeLabel,
    paymentCardholderNameLabel,
    paymentCardNumberLabel,
    paymentCardExpirationLabel,
    paymentCardCvvLabel,
    paymentBankNameLabel,
    paymentAccountHolderNameLabel,
    paymentAccountNumberLabel,
    paymentRoutingNumberLabel,
    billingScheduleDate1Label,
    billingScheduleAmount1Label,
    billingScheduleDate2Label,
    billingScheduleAmount2Label,
    billingScheduleDate3Label,
    billingScheduleAmount3Label,
    paymentPlanSelected,
    showSpouseFields: isMarriedJointFilingAnswers(answers),
    showBusinessFields: taxTypeLabel === 'Business' || taxTypeLabel === 'Both',
    showPaymentScheduleFields: paymentPlanSelected === 'payment_plan' && billingSchedule.length > 0,
    primaryPaymentMethodKind,
  }
}

function isSpouseFieldTarget(id = '') {
  return ['spouse-last-name', 'spouse-first-name', 'spouse-ssn', 'spouse-dob', 'spouse-phone'].includes(id)
}

function isBusinessFieldTarget(id = '') {
  return ['business-name', 'business-ein', 'business-work-phone'].includes(id)
}

function isDiscountFeeFieldTarget(id = '') {
  return ['fee-summary-service-fee', 'fee-summary-total-fees', 'fee-summary-balance'].includes(id)
}

function isBillingScheduleFieldTarget(id = '') {
  return ['custom-1784672403784', 'custom-1784672412360', 'custom-1784672419999', 'custom-1784672432443', 'custom-1784672467904', 'custom-1784672476809'].includes(id)
}

function isCardPaymentFieldTarget(id = '') {
  return ['payment-card-type', 'payment-cardholder-name', 'payment-card-number', 'payment-card-expiration', 'payment-card-cvv'].includes(id)
}

function isBankPaymentFieldTarget(id = '') {
  return ['payment-bank-name', 'payment-account-holder-name', 'payment-account-number', 'payment-routing-number'].includes(id)
}

function isLongAddressFieldTarget(id = '') {
  return ['physical-address', 'mailing-address'].includes(id)
}

function isCompactNumericFieldTarget(id = '') {
  return ['client-ssn', 'spouse-ssn', 'client-cell-phone', 'client-home-phone', 'spouse-phone', 'business-work-phone'].includes(id)
}

function getRedAutofillTargetValue(context, id = '') {
  switch (id) {
    case 'agreement-effective-date':
      return formatCurrentDateLabel()
    case 'agreement-client-full-name':
      return context.fullName
    case 'custom-1784669349065':
      return [context.fullName, context.mailingAddress, `${context.mailingCity}${context.mailingCity && context.mailingState ? ', ' : ''}${context.mailingState} ${context.mailingZip}`.trim()].filter(Boolean).join(' ')
    case 'custom-1784669201362':
      return '0317-33812'
    case 'custom-1784669313950':
      return context.showBusinessFields ? [context.ssn, context.businessEin].filter(Boolean).join(' & ') : context.ssn
    case 'custom-1784669326548':
      return context.phone
    case 'custom-1784669211927':
      return 'P03152236'
    case 'custom-1784669186192':
      return 'Caprizio Fornaro 23652 Lexington Ct, Laguna Niguel CA 92677'
    case 'custom-1784669220785':
      return '949-590-6731'
    case 'custom-1784669268807':
      return 'Income'
    case 'custom-1784669278409':
      return '1040'
    case 'custom-1784669295728':
      return context.unfiledYearsLabel
    case 'custom-1784670092270':
      return context.paymentCardTypeLabel || context.paymentCardholderNameLabel || context.paymentCardNumberLabel || context.paymentCardExpirationLabel || context.paymentCardCvvLabel ? 'Yes' : ''
    case 'client-last-name':
      return context.lastName
    case 'client-first-name':
      return context.firstName
    case 'client-mi':
      return context.middleInitial
    case 'client-ssn':
      return context.ssn
    case 'client-dob':
      return context.dob
    case 'spouse-last-name':
      return context.spouseLastName
    case 'spouse-first-name':
      return context.spouseFirstName
    case 'spouse-ssn':
      return context.spouseSsn
    case 'spouse-dob':
      return context.spouseDob
    case 'physical-address':
      return context.physicalAddress
    case 'mailing-address':
      return context.mailingAddress
    case 'physical-city':
      return context.city
    case 'mailing-city':
      return context.mailingCity
    case 'physical-state':
      return context.stateCode
    case 'mailing-state':
      return context.mailingState
    case 'physical-zip':
      return context.zipCode
    case 'mailing-zip':
      return context.mailingZip
    case 'client-email':
      return context.email
    case 'client-cell-phone':
    case 'client-home-phone':
      return context.phone
    case 'business-work-phone':
      return context.businessWorkPhone
    case 'spouse-phone':
      return context.spousePhone
    case 'business-name':
      return context.businessName
    case 'business-ein':
      return context.businessEin
    case 'fee-summary-service-fee':
    case 'fee-summary-total-fees':
    case 'fee-summary-balance':
      return context.effectiveInvoiceAmount < 500 ? context.discountedFeeLabel : ''
    case 'section2-tax-type':
      return context.taxTypeLabel
    case 'section2-tax-agency':
      return context.taxAgencyLabel
    case 'section2-estimated-liability':
      return context.estimatedLiabilityLabel
    case 'section2-unfiled-years':
      return context.unfiledYearsLabel
    case 'payment-card-type':
      return context.paymentCardTypeLabel
    case 'payment-cardholder-name':
      return context.paymentCardholderNameLabel
    case 'payment-card-number':
      return context.paymentCardNumberLabel
    case 'payment-card-expiration':
      return context.paymentCardExpirationLabel
    case 'payment-card-cvv':
      return context.paymentCardCvvLabel
    case 'custom-1784672403784':
      return context.billingScheduleDate1Label
    case 'custom-1784672412360':
      return context.billingScheduleAmount1Label
    case 'custom-1784672419999':
      return context.billingScheduleDate2Label
    case 'custom-1784672467904':
      return context.billingScheduleAmount2Label
    case 'custom-1784672432443':
      return context.billingScheduleDate3Label
    case 'custom-1784672476809':
      return context.billingScheduleAmount3Label
    case 'payment-bank-name':
      return context.paymentBankNameLabel
    case 'payment-account-holder-name':
      return context.paymentAccountHolderNameLabel
    case 'payment-account-number':
      return context.paymentAccountNumberLabel
    case 'payment-routing-number':
      return context.paymentRoutingNumberLabel
    default:
      return ''
  }
}

function getPercentBoxRect(page, target) {
  const pageWidth = page.getWidth()
  const pageHeight = page.getHeight()
  return {
    x: pageWidth * (target.left / 100),
    y: pageHeight * (1 - (target.top + target.height) / 100),
    width: pageWidth * (target.width / 100),
    height: pageHeight * (target.height / 100),
  }
}

function wrapTextForWidth(font, text, fontSize, maxWidth) {
  const value = String(text || '').trim()
  if (!value) return []
  const words = value.split(/\s+/)
  const lines = []
  let currentLine = ''
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (!currentLine || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function drawPacketText(page, font, text, target, { widthScale = 0.78, heightScale = 0.68, fontSize = 11, multiline = false } = {}) {
  const value = String(text || '').trim()
  if (!value) return
  const box = shrinkOverlayBox(target, widthScale, heightScale)
  const rect = getPercentBoxRect(page, box)
  const lines = multiline ? value.split('\n').filter(Boolean) : wrapTextForWidth(font, value, fontSize, rect.width)
  const totalHeight = Math.max(fontSize, lines.length * fontSize)
  let currentY = rect.y + (rect.height - totalHeight) / 2 + totalHeight - fontSize * 0.82
  lines.forEach((line) => {
    page.drawText(String(line), { x: rect.x, y: currentY, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
    currentY -= fontSize
  })
}

async function drawPacketSignature(page, pdfDoc, dataUrl, target) {
  const payload = dataUrlToBuffer(dataUrl)
  if (!payload?.buffer?.length) return
  let signatureImage = null
  if (payload.mimeType.includes('png')) signatureImage = await pdfDoc.embedPng(payload.buffer)
  else if (payload.mimeType.includes('jpeg') || payload.mimeType.includes('jpg')) signatureImage = await pdfDoc.embedJpg(payload.buffer)
  if (!signatureImage) return
  const rect = getPercentBoxRect(page, target)
  page.drawImage(signatureImage, {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  })
}

function drawPacketStrike(page, target) {
  const rect = getPercentBoxRect(page, target)
  const midY = rect.y + rect.height / 2
  page.drawLine({
    start: { x: rect.x, y: midY },
    end: { x: rect.x + rect.width, y: midY },
    thickness: Math.max(1, rect.height),
    color: rgb(0.12, 0.12, 0.12),
  })
}

async function buildSigned8821PdfBuffer(answers = {}) {
  const outputPdf = await PDFDocument.create()
  const font = await outputPdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await outputPdf.embedFont(StandardFonts.HelveticaBold)
  const signatureMap = parseStoredTargetMap(answers.esign_signatures_by_target)
  const dateMap = parseStoredTargetMap(answers.esign_dates_by_target)
  const context = getRedPacketRenderContext(answers)

  for (const pageNumber of RED_PACKET_PAGES) {
    const backgroundBytes = await loadRedPacketPageImageBytes(pageNumber)
    const background = await outputPdf.embedPng(backgroundBytes)
    const page = outputPdf.addPage([background.width, background.height])
    page.drawImage(background, { x: 0, y: 0, width: background.width, height: background.height })

    const pageSignatureTargets = RED_SIGNATURE_TARGETS.filter((target) => target.page === pageNumber)
    for (const target of pageSignatureTargets) {
      const dataUrl = signatureMap[target.id] || ''
      if (!dataUrl) continue
      await drawPacketSignature(page, outputPdf, dataUrl, target)
    }

    const pageDateTargets = RED_DATE_TARGETS.filter((target) => target.page === pageNumber)
    for (const target of pageDateTargets) {
      const dateValue = dateMap[target.id] || ''
      if (!dateValue) continue
      drawPacketText(page, boldFont, dateValue, target, { widthScale: 1, heightScale: 1, fontSize: 13 })
    }

    const pageFullNameTargets = RED_FULL_NAME_TARGETS.filter((target) => target.page === pageNumber)
    for (const target of pageFullNameTargets) {
      const displayName = target.id === 'cancellation-spouse-print-name' ? context.spouseFullName : context.fullName
      if (!displayName) continue
      drawPacketText(page, boldFont, displayName, target, { widthScale: 0.76, heightScale: 0.62, fontSize: 11 })
    }

    const pageAutofillTargets = RED_AUTOFILL_TARGETS.filter((target) => target.page === pageNumber).filter((target) => {
      if (isSpouseFieldTarget(target.id)) return context.showSpouseFields
      if (isBusinessFieldTarget(target.id)) return context.showBusinessFields
      if (isBillingScheduleFieldTarget(target.id)) return context.showPaymentScheduleFields
      if (isCardPaymentFieldTarget(target.id)) return context.primaryPaymentMethodKind !== 'bank'
      if (isBankPaymentFieldTarget(target.id)) return context.primaryPaymentMethodKind !== 'card'
      return true
    })
    for (const target of pageAutofillTargets) {
      const value = getRedAutofillTargetValue(context, target.id)
      if (!value) continue
      const isCompactNumericField = isCompactNumericFieldTarget(target.id)
      const isLongAddressField = isLongAddressFieldTarget(target.id)
      const isDiscountFeeField = isDiscountFeeFieldTarget(target.id)
      drawPacketText(page, font, value, target, {
        widthScale: isLongAddressField ? 0.94 : isCompactNumericField ? 0.92 : 0.74,
        heightScale: 0.62,
        fontSize: isDiscountFeeField ? 14 : isLongAddressField ? 9 : isCompactNumericField ? 10 : 11,
      })
    }

    if (context.effectiveInvoiceAmount === 375) {
      const pageStrikeTargets = RED_DISCOUNT_STRIKE_TARGETS.filter((target) => target.page === pageNumber)
      pageStrikeTargets.forEach((target) => drawPacketStrike(page, target))
    }
  }

  return Buffer.from(await outputPdf.save())
}

async function buildSigned8821FirstPagePdfBuffer(answers = {}) {
  const outputPdf = await PDFDocument.create()
  const font = await outputPdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await outputPdf.embedFont(StandardFonts.HelveticaBold)
  const signatureMap = parseStoredTargetMap(answers.esign_signatures_by_target)
  const dateMap = parseStoredTargetMap(answers.esign_dates_by_target)
  const context = getRedPacketRenderContext(answers)

  const backgroundBytes = await loadRedPacketPageImageBytes(1)
  const background = await outputPdf.embedPng(backgroundBytes)
  const page = outputPdf.addPage([background.width, background.height])
  page.drawImage(background, { x: 0, y: 0, width: background.width, height: background.height })

  for (const target of RED_SIGNATURE_TARGETS.filter((entry) => entry.page === 1)) {
    const dataUrl = signatureMap[target.id] || ''
    if (!dataUrl) continue
    await drawPacketSignature(page, outputPdf, dataUrl, target)
  }

  for (const target of RED_DATE_TARGETS.filter((entry) => entry.page === 1)) {
    const dateValue = dateMap[target.id] || ''
    if (!dateValue) continue
    drawPacketText(page, boldFont, dateValue, target, { widthScale: 1, heightScale: 1, fontSize: 13 })
  }

  for (const target of RED_FULL_NAME_TARGETS.filter((entry) => entry.page === 1)) {
    const displayName = context.fullName
    if (!displayName) continue
    drawPacketText(page, boldFont, displayName, target, { widthScale: 0.76, heightScale: 0.62, fontSize: 11 })
  }

  const pageAutofillTargets = RED_AUTOFILL_TARGETS.filter((entry) => entry.page === 1)
  for (const target of pageAutofillTargets) {
    const value = getRedAutofillTargetValue(context, target.id)
    if (!value) continue
    const isCompactNumericField = isCompactNumericFieldTarget(target.id)
    const isLongAddressField = isLongAddressFieldTarget(target.id)
    const isDiscountFeeField = isDiscountFeeFieldTarget(target.id)
    drawPacketText(page, font, value, target, {
      widthScale: isLongAddressField ? 0.94 : isCompactNumericField ? 0.92 : 0.74,
      heightScale: 0.62,
      fontSize: isDiscountFeeField ? 14 : isLongAddressField ? 9 : isCompactNumericField ? 10 : 11,
    })
  }

  return Buffer.from(await outputPdf.save())
}

async function ensureSigned8821StoredOnRecord(roomCode, room) {
  const normalizedRoomCode = String(roomCode || '').trim().toUpperCase()
  if (!normalizedRoomCode) return false
  if (signed8821StoreInFlight.has(normalizedRoomCode)) {
    logMemoryDiagnostics('ensureSigned8821StoredOnRecord:skip-inflight', { roomCode: normalizedRoomCode })
    return signed8821StoreInFlight.get(normalizedRoomCode)
  }

  const task = (async () => {
  const answers = room?.state?.answers || {}
  if (!isForm8821FullySigned(answers)) return false
  if (hasFreshSigned8821StoredRecord(answers)) {
    logMemoryDiagnostics('ensureSigned8821StoredOnRecord:skip-fresh', { roomCode: normalizedRoomCode })
    return false
  }
  logMemoryDiagnostics('ensureSigned8821StoredOnRecord:start', {
    roomCode: normalizedRoomCode,
    hasDocumentId: Boolean(String(answers.boldsign_8821_document_id || '').trim()),
  })

  let pdfBuffer = null
  const documentId = String(answers.boldsign_8821_document_id || '').trim()
  if (documentId) {
    try {
      const download = await boldsignDownloadDocument(documentId, {
        onBehalfOf: String(answers.boldsign_8821_sender_email || '').trim() || undefined,
      })
      pdfBuffer = download.fileBuffer
      try {
        const pdfDoc = await PDFDocument.load(download.fileBuffer)
        stripPdfWidgetPlaceholders(pdfDoc)
        pdfBuffer = Buffer.from(await pdfDoc.save())
      } catch {
        // ignore cleaning errors; fall back to the raw BoldSign payload
      }
      logMemoryDiagnostics('ensureSigned8821StoredOnRecord:after-download', {
        roomCode: normalizedRoomCode,
        documentId,
        pdfBytes: pdfBuffer?.length || 0,
      })
    } catch {
      pdfBuffer = null
    }
  }
  if (!pdfBuffer?.length) {
    pdfBuffer = await buildSigned8821PdfBuffer(answers)
    logMemoryDiagnostics('ensureSigned8821StoredOnRecord:after-build-main', {
      roomCode: normalizedRoomCode,
      pdfBytes: pdfBuffer?.length || 0,
    })
  }
  const firstPagePdfBuffer = await buildSigned8821FirstPagePdfBuffer(answers)
  logMemoryDiagnostics('ensureSigned8821StoredOnRecord:after-build-page1', {
    roomCode: normalizedRoomCode,
    pdfBytes: pdfBuffer?.length || 0,
    page1Bytes: firstPagePdfBuffer?.length || 0,
  })
  const existingDocument = getSigned8821DocumentRecord(answers)
  upsertSigned8821DocumentRecord(answers, {
    id: 'system_signed_8821_form',
    name: 'Signed Form 8821.pdf',
    category: 'IRS Form 8821',
    mimeType: 'application/pdf',
    size: pdfBuffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: 'System',
  })
  upsertSigned8821FirstPageDocumentRecord(answers, {
    id: 'system_signed_8821_first_page',
    name: 'Signed Form 8821 Page 1.pdf',
    category: 'IRS Form 8821 First Page',
    mimeType: 'application/pdf',
    size: firstPagePdfBuffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: 'System',
  })
  stripSigned8821DocumentPayloads(answers)
  const signedAt = String(answers.boldsign_8821_signed_at || answers.completed_at || '').trim() || new Date().toISOString()
  markSigned8821DeliveryEntries(answers, signedAt)
  answers.signed_8821_saved_at = new Date().toISOString()
  answers.signed_8821_file_name = getSaved8821Filename(answers)
  answers.signed_8821_first_page_saved_at = new Date().toISOString()
  answers.signed_8821_first_page_file_name = getSaved8821FirstPageFilename(answers)
  answers.signed_8821_first_page_render_version = '1'
  if (!existingDocument) {
    const timeline = Array.isArray(answers.ea_activity_timeline) ? answers.ea_activity_timeline : parseStoredObject(answers.ea_activity_timeline, [])
    answers.ea_activity_timeline = [
      {
        id: `ea_act_8821_${Date.now().toString(36)}`,
        type: 'document_upload',
        title: 'Signed 8821 saved',
        description: 'A signed IRS Form 8821 copy was automatically saved to the client record.',
        createdAt: new Date().toISOString(),
        actor: 'System',
      },
      ...(Array.isArray(timeline) ? timeline : []),
    ]
  }
  room.state.updatedAt = Date.now()
  io.to(roomCode).emit('room_state', room.state)
  try {
    await dbUpsertSession({ code: normalizedRoomCode, state: room.state })
  } catch {
    // ignore; state still updates in-memory
  }
  logMemoryDiagnostics('ensureSigned8821StoredOnRecord:after-persist', {
    roomCode: normalizedRoomCode,
    pdfBytes: pdfBuffer?.length || 0,
    page1Bytes: firstPagePdfBuffer?.length || 0,
  })
  void sendSigned8821CopyEmail({ roomCode: normalizedRoomCode, room }).catch((error) => {
    console.error('Signed 8821 client email failed:', error)
  })
  return true
  })()

  signed8821StoreInFlight.set(normalizedRoomCode, task)
  try {
    return await task
  } finally {
    signed8821StoreInFlight.delete(normalizedRoomCode)
  }
}

function parseStoredObject(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function normalizeBillingDateValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T/)
  if (isoMatch) return isoMatch[1]
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, left, right, year] = slashMatch
    const leftNum = Number.parseInt(left, 10)
    const rightNum = Number.parseInt(right, 10)
    const month = leftNum > 12 && rightNum <= 12 ? right : left
    const day = leftNum > 12 && rightNum <= 12 ? left : right
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 8) {
    const first4 = Number.parseInt(digits.slice(0, 4), 10)
    if (first4 >= 1900 && first4 <= 2099) {
      const year = digits.slice(0, 4)
      const month = digits.slice(4, 6)
      const day = digits.slice(6, 8)
      return `${year}-${month}-${day}`
    }
    const month = digits.slice(0, 2)
    const day = digits.slice(2, 4)
    const year = digits.slice(4, 8)
    return `${year}-${month}-${day}`
  }
  return raw
}

function getTodayBillingDateValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeBillingScheduleRows(rows = []) {
  return rows
    .map((row) => ({
      ...row,
      date: normalizeBillingDateValue(row?.date),
      amount: String(row?.amount ?? ''),
      status: String(row?.status || ''),
      failureReason: String(row?.failureReason || row?.processorReason || row?.reason || ''),
    }))
    .filter((row) => row && (row.date || row.amount))
}

function mergeUniqueBillingScheduleRows(...groups) {
  const seen = new Set()
  return groups
    .flat()
    .filter((row) => {
      const key = [
        String(row?.date || '').trim(),
        String(row?.amount || '').trim(),
        String(row?.status || '').trim().toLowerCase(),
        String(row?.failureReason || '').trim().toLowerCase(),
      ].join('|')
      if (!key.replace(/\|/g, '')) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function mapClientPortalPendingPaymentsToBillingRows(value = []) {
  return parseStoredObject(value, [])
    .map((row) => ({
      date: normalizeBillingDateValue(row?.isoDate || row?.date || ''),
      amount: String(row?.amount ?? ''),
      status: String(row?.status || ''),
      failureReason: String(row?.failureReason || ''),
    }))
    .filter((row) => row && (row.date || row.amount))
}

function hasResolutionBillingSignalsFromAnswers(answers = {}) {
  const resolutionSchedule = parseStoredObject(answers?.resolution_billing_schedule, [])
  const resolutionInvoiceAmount = toNumberValue(answers?.resolution_billing_invoice_amount)
  const invoiceTaxPrepYears = String(answers?.invoiceTaxPrepYears || '').match(/\b(19|20)\d{2}\b/g) || []
  return (
    resolutionInvoiceAmount > 0 ||
    resolutionSchedule.length > 0 ||
    toNumberValue(answers?.invoiceIrsResolutionAmount) > 0 ||
    toNumberValue(answers?.invoiceTaxPrepAmount) > 0 ||
    toNumberValue(answers?.invoiceStateResolutionAmount) > 0 ||
    String(answers?.invoiceServiceIrsResolution || '').trim().toLowerCase() === 'yes' ||
    String(answers?.invoiceServiceTaxPrep || '').trim().toLowerCase() === 'yes' ||
    String(answers?.invoiceServiceStateResolution || '').trim().toLowerCase() === 'yes' ||
    invoiceTaxPrepYears.length > 0
  )
}

function getBillingInvoiceAmountFromAnswers(answers = {}, mode = 'investigation') {
  const invoiceFieldKey = mode === 'resolution' ? 'resolution_billing_invoice_amount' : 'investigation_billing_invoice_amount'
  const bucketStored = toNumberValue(answers?.[invoiceFieldKey])
  if (bucketStored > 0) return bucketStored
  const genericStored = toNumberValue(answers?.billing_invoice_amount)
  const resolutionSignals = hasResolutionBillingSignalsFromAnswers(answers)
  if (mode === 'resolution') {
    const derivedResolutionTotal =
      toNumberValue(answers?.invoiceIrsResolutionAmount) +
      toNumberValue(answers?.invoiceTaxPrepAmount) +
      toNumberValue(answers?.invoiceStateResolutionAmount)
    if (derivedResolutionTotal > 0) return derivedResolutionTotal
    return 0
  }
  if (genericStored > 0 && !resolutionSignals) return genericStored
  const clientPortalTotal = parseStoredObject(answers?.client_portal_pending_payments, []).reduce(
    (sum, item) => sum + toNumberValue(item?.amount),
    0,
  )
  if (clientPortalTotal > 0 && !resolutionSignals) return clientPortalTotal
  const override = toNumberValue(answers?.planPriceOverride)
  if (override > 0 && !resolutionSignals) return override
  return 0
}

function getScopedBillingScheduleRowsFromAnswers(answers = {}, mode = 'investigation') {
  const scheduleFieldKey = mode === 'resolution' ? 'resolution_billing_schedule' : 'investigation_billing_schedule'
  const scopedSchedule = normalizeBillingScheduleRows(parseStoredObject(answers?.[scheduleFieldKey], []))
  if (scopedSchedule.length) return scopedSchedule

  const resolutionSignals = hasResolutionBillingSignalsFromAnswers(answers)
  const genericSchedule = normalizeBillingScheduleRows(parseStoredObject(answers?.billing_schedule, []))
  if (mode === 'resolution') {
    if (genericSchedule.length && resolutionSignals) return genericSchedule
    return []
  }
  if (genericSchedule.length && !resolutionSignals) return genericSchedule
  if (resolutionSignals) return []
  return mapClientPortalPendingPaymentsToBillingRows(answers?.client_portal_pending_payments)
}

function getBillingScheduleRowsFromAnswers(answers = {}) {
  const investigationSchedule = parseStoredObject(answers?.investigation_billing_schedule, [])
  const resolutionSchedule = parseStoredObject(answers?.resolution_billing_schedule, [])
  const directSchedule = parseStoredObject(answers?.billing_schedule, [])
  const mergedSchedules = mergeUniqueBillingScheduleRows(
    normalizeBillingScheduleRows(Array.isArray(investigationSchedule) ? investigationSchedule : []),
    normalizeBillingScheduleRows(Array.isArray(resolutionSchedule) ? resolutionSchedule : []),
    normalizeBillingScheduleRows(Array.isArray(directSchedule) ? directSchedule : []),
  )
  if (mergedSchedules.length) {
    return mergedSchedules
  }

  if (Array.isArray(directSchedule) && directSchedule.length) {
    return normalizeBillingScheduleRows(directSchedule)
  }

  return mapClientPortalPendingPaymentsToBillingRows(answers?.client_portal_pending_payments)
}

function getBillingProcessedAtValue(row = {}) {
  return (
    String(row?.processedAt || '').trim() ||
    String(row?.processed_at || '').trim() ||
    String(row?.processed_at_iso || '').trim() ||
    ''
  )
}

function getBillingStripePaymentIntentIdValue(row = {}) {
  return (
    String(row?.stripePaymentIntentId || '').trim() ||
    String(row?.stripe_payment_intent_id || '').trim() ||
    String(row?.stripe_payment_intent || '').trim() ||
    ''
  )
}

function getBillingProcessedStripePaymentMethodIdValue(row = {}) {
  return (
    String(row?.processedStripePaymentMethodId || '').trim() ||
    String(row?.processed_stripe_payment_method_id || '').trim() ||
    ''
  )
}

function getBillingProcessedPaymentMethodLast4Value(row = {}) {
  return (
    String(row?.processedPaymentMethodLast4 || '').trim() ||
    String(row?.processed_payment_method_last4 || '').trim() ||
    ''
  )
}

function getBillingProcessedPaymentMethodBrandValue(row = {}) {
  return (
    String(row?.processedPaymentMethodBrand || '').trim() ||
    String(row?.processed_payment_method_brand || '').trim() ||
    ''
  )
}

function hasBillingProcessingEvidence(row = {}) {
  return Boolean(
    getBillingProcessedAtValue(row) ||
      getBillingStripePaymentIntentIdValue(row) ||
      getBillingProcessedStripePaymentMethodIdValue(row) ||
      getBillingProcessedPaymentMethodLast4Value(row) ||
      getBillingProcessedPaymentMethodBrandValue(row),
  )
}

function getBillingStatusTone(row = {}) {
  const rawStatus = String(row?.status || '').trim().toLowerCase()
  if (['failed', 'declined', 'rejected', 'error'].includes(rawStatus)) return 'failed'
  const hasProcessingEvidence = hasBillingProcessingEvidence(row)

  // Back-compat: some legacy rows were persisted without a reliable `status`, but do contain
  // Stripe evidence fields (`processed_at`, `stripe_payment_intent_id`, etc.). We should still
  // treat these as processed, otherwise processed revenue totals drop unexpectedly.
  if (hasProcessingEvidence) return 'processed'

  if (['processed', 'paid', 'succeeded', 'successful', 'complete', 'completed'].includes(rawStatus)) {
    const normalizedDate = normalizeBillingDateValue(row?.date || '')
    const isFutureScheduleWithoutEvidence = Boolean(
      normalizedDate && normalizedDate > getTodayBillingDateValue() && !hasProcessingEvidence,
    )
    if (isFutureScheduleWithoutEvidence) return 'pending'
    return 'processed'
  }
  return 'pending'
}

function getBillingRowMatchKey(row = {}) {
  const normalizedDate = normalizeBillingDateValue(row?.date || getBillingProcessedAtValue(row) || '')
  const normalizedAmount = Number(toNumberValue(row?.amount || 0)).toFixed(2)
  if (!normalizedDate && normalizedAmount === '0.00') return ''
  return `${normalizedDate}|${normalizedAmount}`
}

function getBillingRowPersistenceKey(row = {}) {
  const tone = getBillingStatusTone(row)
  // Persisted rows sometimes lack an explicit `date` but have `processedAt` (or `processed_at`).
  // Use the processed timestamp as a stable fallback so schedule edits don't orphan processed rows
  // and wipe Stripe evidence on save.
  const normalizedDate = normalizeBillingDateValue(row?.date || getBillingProcessedAtValue(row) || '')
  const normalizedAmount = Number(toNumberValue(row?.amount || 0)).toFixed(2)
  if (!normalizedDate && normalizedAmount === '0.00') return ''
  return `${tone}|${normalizedDate}|${normalizedAmount}`
}

function sanitizeBillingScheduleRowsForPersistence(nextRows = [], existingRows = []) {
  const existingBuckets = new Map()
  ;(Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    const key = getBillingRowPersistenceKey(row)
    if (!key) return
    const bucket = existingBuckets.get(key)
    if (bucket) {
      bucket.push(row)
      return
    }
    existingBuckets.set(key, [row])
  })

  return (Array.isArray(nextRows) ? nextRows : [])
    .map((row) => ({
      ...(row || {}),
      date: normalizeBillingDateValue(row?.date || ''),
      amount: String(row?.amount ?? '').trim(),
      status: String(row?.status || '').trim(),
      failureReason: String(row?.failureReason || '').trim(),
      processorReason: String(row?.processorReason || '').trim(),
      reason: String(row?.reason || '').trim(),
    }))
    .filter((row) => row.date || row.amount)
    .map((row) => {
      const key = getBillingRowPersistenceKey(row)
      const matchBucket = key ? existingBuckets.get(key) : null
      const existingMatch = Array.isArray(matchBucket) && matchBucket.length ? matchBucket.shift() : null
      if (existingMatch) {
        return {
          ...existingMatch,
          ...row,
          date: row.date,
          amount: row.amount,
        }
      }

      const tone = getBillingStatusTone(row)
      if (tone !== 'pending') {
        // Only clear "processed" metadata when the row has no real Stripe evidence.
        // This prevents stale metadata carry-over, but also avoids deleting legitimate
        // processed rows when schedules are edited/resaved.
        const hasEvidence = hasBillingProcessingEvidence(row)
        if (hasEvidence) return row
        return {
          ...row,
          status: '',
          failureReason: '',
          processorReason: '',
          reason: '',
          stripePaymentIntentId: '',
          processedAt: '',
          processedPaymentMethodLast4: '',
          processedPaymentMethodBrand: '',
          processedStripePaymentMethodId: '',
          processedStripeCustomerId: '',
          processedPaymentMethodType: '',
        }
      }

      return {
        ...row,
        status: '',
        failureReason: '',
        processorReason: '',
        reason: '',
      }
    })
}

function getOutstandingBillingRows(rows = []) {
  const processedKeys = new Set(
    rows
      .filter((row) => getBillingStatusTone(row) === 'processed')
      .map((row) => getBillingRowMatchKey(row))
      .filter(Boolean),
  )
  return rows.filter((row) => {
    if (getBillingStatusTone(row) === 'processed') return false
    const matchKey = getBillingRowMatchKey(row)
    if (matchKey && processedKeys.has(matchKey)) return false
    return Boolean(normalizeBillingDateValue(row?.date || ''))
  })
}

function getBillingTimingTone(value = '') {
  const normalized = normalizeBillingDateValue(value)
  if (!normalized) return ''
  const today = getTodayBillingDateValue()
  if (!today) return ''
  if (normalized === today) return 'today'
  return normalized > today ? 'upcoming' : 'past'
}

function isTrainingLeadItem(item = {}) {
  if (String(item.leadType || '').trim().toLowerCase() === 'training') return true
  if (String(item.isTrainingLead || '').trim().toLowerCase() === 'true') return true
  const searchable = `${String(item.clientName || '').trim().toLowerCase()} ${String(item.email || '').trim().toLowerCase()}`
  return /\btest\b|\btraining\b/.test(searchable)
}

// If Stripe restore fails due to missing metadata/temporary Stripe search availability,
// we want to retry reasonably soon without hammering Stripe.
const AUTO_STRIPE_BILLING_RESTORE_MIN_INTERVAL_MS = 10 * 60 * 1000

async function autoRestoreStripeBillingEvidenceIfMissing({ roomCode, state, persist } = {}) {
  if (!stripe) return
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode) return
  if (!state || typeof state !== 'object') return
  if (typeof persist !== 'function') return

  const nextState = state
  const answers = nextState?.answers || {}

  const lastAttemptRaw = String(answers._auto_stripe_billing_restore_attempted_at || '').trim()
  if (lastAttemptRaw) {
    const lastAttemptMs = new Date(lastAttemptRaw).getTime()
    if (!Number.isNaN(lastAttemptMs) && Date.now() - lastAttemptMs < AUTO_STRIPE_BILLING_RESTORE_MIN_INTERVAL_MS) {
      return
    }
  }

  const existingScheduleRows = getBillingScheduleRowsFromAnswers(answers)
  const hasExistingEvidence = existingScheduleRows.some((row) => hasBillingProcessingEvidence(row))
  const outstandingDueRows = getOutstandingBillingRows(existingScheduleRows).filter((row) => {
    const tone = getBillingTimingTone(row?.date || '')
    return tone === 'today' || tone === 'past'
  })
  // Previously we bailed out as soon as we saw *any* processing evidence. That can miss later payments
  // (e.g. one payment intent succeeded but never got written back to the schedule). If there are
  // due/past rows still outstanding, we should attempt a restore (throttled by attempted_at).
  if (hasExistingEvidence && outstandingDueRows.length === 0) return

  let customerId = String(answers.stripe_customer_id || '').trim()
  const email = String(answers.email || '').trim()
  const sessionCodeVariants = Array.from(
    new Set([normalizedRoomCode, normalizedRoomCode.toUpperCase(), normalizedRoomCode.toLowerCase()]),
  ).filter(Boolean)
  const safeSessionCodeVariants = Array.from(
    new Set(sessionCodeVariants.map((value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, ''))),
  ).filter(Boolean)

  // Prefer Stripe metadata search when available (most reliable; doesn't rely on email being present).
  if (!customerId && safeSessionCodeVariants.length && typeof stripe?.customers?.search === 'function') {
    for (const safeSessionCode of safeSessionCodeVariants) {
      if (customerId) break
      try {
        const search = await stripe.customers.search({
          query: `metadata['sessionCode']:'${safeSessionCode}'`,
          limit: 1,
        })
        customerId = String(search?.data?.[0]?.id || '').trim()
        if (customerId) answers.stripe_customer_id = customerId
      } catch {
        // ignore search errors; we'll try other approaches
      }
    }
  }

  // Fallback: find customer by email if we have it.
  if (!customerId && email) {
    const candidates = await stripe.customers.list({ email, limit: 10 })
    const match =
      candidates.data.find((customer) => String(customer?.metadata?.sessionCode || '').trim().toLowerCase() === normalizedRoomCode.toLowerCase()) ||
      candidates.data[0]
    customerId = String(match?.id || '').trim()
    if (customerId) answers.stripe_customer_id = customerId
  }

  // Fallback: search Payment Intents by metadata sessionCode (if the Stripe account supports it).
  // This also works even when the Stripe customer can't be resolved yet.
  let intentData = null
  if (safeSessionCodeVariants.length && typeof stripe?.paymentIntents?.search === 'function') {
    for (const safeSessionCode of safeSessionCodeVariants) {
      if (intentData) break
      try {
        const search = await stripe.paymentIntents.search({
          query: `metadata['sessionCode']:'${safeSessionCode}'`,
          limit: 100,
          expand: ['data.payment_method'],
        })
        if (Array.isArray(search?.data) && search.data.length) {
          intentData = search.data
          if (!customerId) {
            const inferredCustomer = String(search.data.find((intent) => intent?.customer)?.customer || '').trim()
            if (inferredCustomer) {
              customerId = inferredCustomer
              answers.stripe_customer_id = inferredCustomer
            }
          }
        }
      } catch {
        // ignore search errors; we'll try listing intents by customer next
      }
    }
  }

  // Nothing to restore (no linked customer).
  if (!customerId && !intentData) {
    answers._auto_stripe_billing_restore_attempted_at = new Date().toISOString()
    await persist(nextState)
    return
  }

  if (!intentData) {
    const intents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 100,
      expand: ['data.payment_method'],
    })
    intentData = intents.data
  }

  let candidates = (Array.isArray(intentData) ? intentData : [])
    .filter((intent) => intent && (intent.status === 'succeeded' || intent.status === 'requires_capture'))
    .map((intent) => {
      const received = Number(intent.amount_received || intent.amount || 0)
      const amount = received ? received / 100 : 0
      const processedAt = new Date(Number(intent.created || 0) * 1000).toISOString()
      const normalizedDate = normalizeBillingDateValue(processedAt)
      const billingMode = String(intent?.metadata?.billingMode || '').trim().toLowerCase()
      const paymentMethod = intent.payment_method
      const paymentMethodId = typeof paymentMethod === 'string' ? paymentMethod : String(paymentMethod?.id || '')
      let brand = ''
      let last4 = ''
      let methodType = ''
      if (paymentMethod && typeof paymentMethod === 'object') {
        methodType = String(paymentMethod?.type || '').trim()
        if (paymentMethod.type === 'card') {
          brand = String(paymentMethod?.card?.brand || '').trim()
          last4 = String(paymentMethod?.card?.last4 || '').trim()
        } else if (paymentMethod.type === 'us_bank_account') {
          brand = 'bank'
          last4 = String(paymentMethod?.us_bank_account?.last4 || '').trim()
        }
      } else if (Array.isArray(intent.payment_method_types) && intent.payment_method_types.length) {
        methodType = String(intent.payment_method_types[0] || '').trim()
      }
      return {
        date: normalizedDate,
        amount,
        status: 'processed',
        stripePaymentIntentId: String(intent.id || '').trim(),
        processedAt,
        processedStripeCustomerId: customerId || String(intent.customer || '').trim(),
        processedStripePaymentMethodId: String(paymentMethodId || '').trim(),
        processedPaymentMethodBrand: brand,
        processedPaymentMethodLast4: last4,
        processedPaymentMethodType: methodType,
        _billingMode: billingMode,
      }
    })
    .filter((row) => Boolean(row?.stripePaymentIntentId) && Number(row?.amount || 0) > 0 && Boolean(row?.date))

  // If PaymentIntents didn't produce candidates, fall back to Charges.
  // Some legacy payments might not be represented as retrievable PaymentIntents (or may lack the metadata search path),
  // but charges will still exist and often reference a payment_intent.
  if (!candidates.length && customerId) {
    try {
      const charges = await stripe.charges.list({
        customer: customerId,
        limit: 100,
      })
      const chargeCandidates = (Array.isArray(charges?.data) ? charges.data : [])
        .filter((charge) => charge && charge.status === 'succeeded' && !charge.disputed)
        .map((charge) => {
          const net = Math.max(0, Number(charge.amount || 0) - Number(charge.amount_refunded || 0))
          const amount = net ? net / 100 : 0
          const processedAt = new Date(Number(charge.created || 0) * 1000).toISOString()
          const normalizedDate = normalizeBillingDateValue(processedAt)
          const intentOrChargeId = String(charge.payment_intent || charge.id || '').trim()
          return {
            date: normalizedDate,
            amount,
            status: 'processed',
            stripePaymentIntentId: intentOrChargeId,
            processedAt,
            processedStripeCustomerId: customerId,
            processedStripePaymentMethodId: String(charge.payment_method || '').trim(),
            processedPaymentMethodBrand: '',
            processedPaymentMethodLast4: '',
            processedPaymentMethodType: '',
            _billingMode: '',
          }
        })
        .filter((row) => Boolean(row?.stripePaymentIntentId) && Number(row?.amount || 0) > 0 && Boolean(row?.date))
      if (chargeCandidates.length) candidates = chargeCandidates
    } catch {
      // ignore charge restore errors
    }
  }

  if (!candidates.length) {
    answers._auto_stripe_billing_restore_attempted_at = new Date().toISOString()
    await persist(nextState)
    return
  }

  const existingDirectSchedule = normalizeBillingScheduleRows(parseStoredObject(answers.billing_schedule, []))
  const existingIntentIds = new Set(existingDirectSchedule.map((row) => getBillingStripePaymentIntentIdValue(row)).filter(Boolean))
  const existingByKey = new Map()
  existingDirectSchedule.forEach((row) => {
    const key = getBillingRowMatchKey(row)
    if (!key) return
    const bucket = existingByKey.get(key)
    if (bucket) bucket.push(row)
    else existingByKey.set(key, [row])
  })

  const merged = [...existingDirectSchedule]
  candidates.forEach((candidate) => {
    const intentId = getBillingStripePaymentIntentIdValue(candidate)
    if (intentId && existingIntentIds.has(intentId)) return
    const key = getBillingRowMatchKey(candidate)
    if (!key) return
    const bucket = existingByKey.get(key)
    const match = Array.isArray(bucket) && bucket.length ? bucket[0] : null
    if (match) {
      if (hasBillingProcessingEvidence(match)) return
      Object.assign(match, candidate)
      existingIntentIds.add(intentId)
      return
    }
    merged.push(candidate)
    existingIntentIds.add(intentId)
  })

  const nextSchedule = sanitizeBillingScheduleRowsForPersistence(
    // remove helper-only field before saving
    merged.map((row) => {
      const { _billingMode, ...rest } = row || {}
      return rest
    }),
    existingDirectSchedule,
  )
  answers.billing_schedule = nextSchedule

  // Also populate scoped schedules if we can infer billing mode from Stripe metadata.
  const hasAnyModeTags = candidates.some((row) => String(row?._billingMode || '').trim())
  if (hasAnyModeTags) {
    const existingInvestigation = normalizeBillingScheduleRows(parseStoredObject(answers.investigation_billing_schedule, []))
    const existingResolution = normalizeBillingScheduleRows(parseStoredObject(answers.resolution_billing_schedule, []))
    const invMerged = sanitizeBillingScheduleRowsForPersistence(
      mergeUniqueBillingScheduleRows(
        existingInvestigation,
        candidates
          .filter((row) => String(row?._billingMode || '').trim() !== 'resolution')
          .map((row) => {
            const { _billingMode, ...rest } = row || {}
            return rest
          }),
      ),
      existingInvestigation,
    )
    const resMerged = sanitizeBillingScheduleRowsForPersistence(
      mergeUniqueBillingScheduleRows(
        existingResolution,
        candidates
          .filter((row) => String(row?._billingMode || '').trim() === 'resolution')
          .map((row) => {
            const { _billingMode, ...rest } = row || {}
            return rest
          }),
      ),
      existingResolution,
    )
    answers.investigation_billing_schedule = invMerged
    answers.resolution_billing_schedule = resMerged
  }

  answers._auto_stripe_billing_restore_attempted_at = new Date().toISOString()
  answers._auto_stripe_billing_restore_at = new Date().toISOString()
  nextState.answers = answers

  await persist(nextState)
}

// Payment methods can get out of sync when a Stripe customer id is missing or when state was edited.
// If we can resolve the Stripe customer, we should re-populate the stored payment method list so the dashboard
// does not show "No payment method" when Stripe actually has one.
const AUTO_STRIPE_PAYMENT_METHOD_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000

async function autoSyncStripePaymentMethodsIfMissing({ roomCode, state, persist } = {}) {
  if (!stripe) return
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode) return
  if (!state || typeof state !== 'object') return
  if (typeof persist !== 'function') return

  const nextState = state
  const answers = nextState?.answers || {}

  const lastAttemptRaw = String(answers._auto_stripe_payment_method_sync_attempted_at || '').trim()
  if (lastAttemptRaw) {
    const lastAttemptMs = new Date(lastAttemptRaw).getTime()
    if (!Number.isNaN(lastAttemptMs) && Date.now() - lastAttemptMs < AUTO_STRIPE_PAYMENT_METHOD_SYNC_MIN_INTERVAL_MS) {
      return
    }
  }

  const existingMethods = parseStoredPaymentMethods(answers.billing_payment_methods)
  const existingDirect = parseStoredObject(answers.billing_payment_method, null)
  const hasExistingStripeMethod =
    existingMethods.some((entry) => String(entry?.stripePaymentMethodId || '').trim()) ||
    Boolean(String(existingDirect?.stripePaymentMethodId || '').trim())
  if (hasExistingStripeMethod) return

  let customerId = String(answers.stripe_customer_id || '').trim()
  const email = String(answers.email || '').trim()
  const safeSessionCode = normalizedRoomCode.replace(/[^a-zA-Z0-9_-]/g, '')

  if (!customerId && safeSessionCode && typeof stripe?.customers?.search === 'function') {
    try {
      const search = await stripe.customers.search({
        query: `metadata['sessionCode']:'${safeSessionCode}'`,
        limit: 1,
      })
      customerId = String(search?.data?.[0]?.id || '').trim()
      if (customerId) answers.stripe_customer_id = customerId
    } catch {
      // ignore
    }
  }

  if (!customerId && email) {
    try {
      const candidates = await stripe.customers.list({ email, limit: 10 })
      const match =
        candidates.data.find((customer) => String(customer?.metadata?.sessionCode || '').trim() === normalizedRoomCode) ||
        candidates.data[0]
      customerId = String(match?.id || '').trim()
      if (customerId) answers.stripe_customer_id = customerId
    } catch {
      // ignore
    }
  }

  if (!customerId) {
    answers._auto_stripe_payment_method_sync_attempted_at = new Date().toISOString()
    nextState.answers = sanitizeSensitiveBillingAnswers(answers)
    await persist(nextState)
    return
  }

  let nextStripeMethods = []
  try {
    const cardMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 100 })
    cardMethods.data.forEach((method) => {
      const record = buildStripePaymentMethodRecord(method, { customerId, setupIntentId: '' })
      if (record?.stripePaymentMethodId) nextStripeMethods.push(record)
    })
    const bankMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'us_bank_account', limit: 100 })
    bankMethods.data.forEach((method) => {
      const record = buildStripePaymentMethodRecord(method, { customerId, setupIntentId: '' })
      if (record?.stripePaymentMethodId) nextStripeMethods.push(record)
    })
  } catch (error) {
    answers._auto_stripe_payment_method_sync_attempted_at = new Date().toISOString()
    nextState.answers = sanitizeSensitiveBillingAnswers(answers)
    await persist(nextState)
    return
  }

  if (!nextStripeMethods.length) {
    answers._auto_stripe_payment_method_sync_attempted_at = new Date().toISOString()
    nextState.answers = sanitizeSensitiveBillingAnswers(answers)
    await persist(nextState)
    return
  }

  // Keep any existing stored methods that are not Stripe-linked (legacy) first.
  const merged = []
  existingMethods.forEach((entry) => {
    if (!String(entry?.stripePaymentMethodId || '').trim()) merged.push(entry)
  })
  nextStripeMethods.forEach((entry) => merged.push(entry))

  const portalMethods = merged.map(buildClientPortalPaymentMethodRecord).filter((entry) => entry && (entry.holder || entry.last4))
  const portalMethod = portalMethods[portalMethods.length - 1] || null
  const nextMethod = merged.findLast((entry) => String(entry?.stripePaymentMethodId || '').trim()) || merged[merged.length - 1]

  answers.billing_payment_methods = merged
  answers.billing_payment_method = nextMethod
  answers.client_portal_payment_methods = portalMethods
  answers.client_portal_payment_method = portalMethod
  answers._auto_stripe_payment_method_sync_attempted_at = new Date().toISOString()
  answers._auto_stripe_payment_method_sync_at = new Date().toISOString()

  nextState.answers = sanitizeSensitiveBillingAnswers(answers)
  await persist(nextState)

  void dbInsertBillingAudit({
    sessionCode: normalizedRoomCode,
    eventType: 'stripe_payment_methods_synced_auto',
    billingMode: '',
    actorEmail: '',
    payload: {
      stripeCustomerId: customerId,
      count: merged.length,
      at: new Date().toISOString(),
    },
  })
}

const STRIPE_BILLING_RESTORE_QUEUE_MAX = 2000
const STRIPE_BILLING_RESTORE_WORK_INTERVAL_MS = 1000
const RECORD_INTEGRITY_REPAIR_STARTUP_LIMIT = Math.max(1, Math.min(20000, Number(process.env.RECORD_INTEGRITY_REPAIR_STARTUP_LIMIT || 5000) || 5000))
const stripeBillingRestoreQueue = new Set()
let stripeBillingRestoreWorkerStarted = false

function queueStripeBillingRestore(roomCode = '') {
  const normalized = String(roomCode || '').trim()
  if (!normalized) return
  if (stripeBillingRestoreQueue.size >= STRIPE_BILLING_RESTORE_QUEUE_MAX) return
  stripeBillingRestoreQueue.add(normalized)
}

async function repairConsultationRecordIntegrity({ roomCode, state, persist } = {}) {
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode) return { restoredFromBackup: false, normalized8821: false, normalizedResolution: false, reconciled8821: false, reconciledResolution: false, restoredBilling: false, syncedPaymentMethods: false, storedSigned8821: false }
  if (typeof persist !== 'function') {
    return { restoredFromBackup: false, normalized8821: false, normalizedResolution: false, reconciled8821: false, reconciledResolution: false, restoredBilling: false, syncedPaymentMethods: false, storedSigned8821: false }
  }

  let currentState = state && typeof state === 'object' ? state : initialRoomState()
  const results = {
    restoredFromBackup: false,
    normalized8821: false,
    normalizedResolution: false,
    reconciled8821: false,
    reconciledResolution: false,
    restoredBilling: false,
    syncedPaymentMethods: false,
    storedSigned8821: false,
  }
  const persistAndCapture = async (nextState) => {
    currentState = nextState && typeof nextState === 'object' ? nextState : currentState
    await persist(currentState)
  }

  results.restoredFromBackup = await restoreCriticalSessionDataFromBackupIfMissing({
    roomCode: normalizedRoomCode,
    state: currentState,
    persist: persistAndCapture,
  })
  const answers = currentState.answers || {}
  results.normalized8821 = normalizePersistedSigned8821State(answers)
  results.normalizedResolution = normalizePersistedResolutionSignedState(answers)
  if (results.normalized8821 || results.normalizedResolution) {
    currentState.answers = answers
    await persistAndCapture(currentState)
  }

  results.reconciled8821 = await reconcileBoldsign8821Status({
    roomCode: normalizedRoomCode,
    state: currentState,
    persist: persistAndCapture,
  })
  results.reconciledResolution = await reconcileBoldsignResolutionStatus({
    roomCode: normalizedRoomCode,
    state: currentState,
    persist: persistAndCapture,
  })
  results.restoredBilling = await autoRestoreStripeBillingEvidenceIfMissing({
    roomCode: normalizedRoomCode,
    state: currentState,
    persist: persistAndCapture,
  })
  results.syncedPaymentMethods = await autoSyncStripePaymentMethodsIfMissing({
    roomCode: normalizedRoomCode,
    state: currentState,
    persist: persistAndCapture,
  })

  const tempRoom = { state: currentState }
  results.storedSigned8821 = await ensureSigned8821StoredOnRecord(normalizedRoomCode, tempRoom).catch(() => false)
  currentState = tempRoom.state || currentState

  return results
}

async function seedStripeBillingRestoreQueue(limit = 5000) {
  const normalizedLimit = Math.max(1, Math.min(20000, Number(limit) || 5000))
  if (pool) {
    const res = await pool.query('select session_code from ti_sessions order by updated_at desc limit $1', [normalizedLimit])
    res.rows.forEach((row) => queueStripeBillingRestore(String(row?.session_code || '').trim()))
    return res.rows.length
  }
  const rows = (await fallbackListSessions())
    .sort((left, right) => String(right?.updated_at || right?.updatedAt || '').localeCompare(String(left?.updated_at || left?.updatedAt || '')))
    .slice(0, normalizedLimit)
  rows.forEach((row) => queueStripeBillingRestore(String(row?.session_code || row?.sessionCode || '').trim()))
  return rows.length
}

function startStripeBillingRestoreWorker() {
  if (stripeBillingRestoreWorkerStarted) return
  stripeBillingRestoreWorkerStarted = true
  setInterval(async () => {
    for (let i = 0; i < 3; i += 1) {
      const iterator = stripeBillingRestoreQueue.values().next()
      if (iterator.done) return
      const nextCode = iterator.value
      stripeBillingRestoreQueue.delete(nextCode)
      try {
        const row = await dbGetSession(nextCode)
        if (row?.state) {
          await repairConsultationRecordIntegrity({
            roomCode: row.session_code,
            state: row.state,
            persist: async (nextState) => {
              row.state = nextState
              await dbUpsertSession({ code: row.session_code, state: nextState })
            },
          })
          continue
        }
        const room =
          rooms.get(nextCode) || rooms.get(String(nextCode).toUpperCase()) || rooms.get(String(nextCode).toLowerCase())
        if (room?.state) {
          await repairConsultationRecordIntegrity({
            roomCode: nextCode,
            state: room.state,
            persist: async (nextState) => {
              room.state = nextState
              await dbUpsertSession({ code: nextCode, state: nextState })
            },
          })
        }
      } catch (error) {
        console.error('consultation integrity repair worker failed:', {
          code: String(nextCode || '').trim(),
          message: error instanceof Error ? error.message : String(error || ''),
        })
      }
    }
  }, STRIPE_BILLING_RESTORE_WORK_INTERVAL_MS)
}

function getLifecycleLabel(item = {}) {
  if (isTrainingLeadItem(item)) return 'Test Lead'
  if (Boolean(item.hasProcessedPayment)) return 'Active Client'
  return 'Active Prospect'
}

function isPortalAuthorizedForAnswers(answers = {}) {
  const onboardingStatus = String(answers?.onboarding_status || '').trim().toLowerCase()
  if (onboardingStatus === 'documents_signed') return true
  return isForm8821FullySigned(answers)
}

function hasSignedResolutionDocuments(answers = {}) {
  const documentReceipts = Array.isArray(answers.document_receipts) ? answers.document_receipts : parseStoredObject(answers.document_receipts, [])
  const documentDeliveryLog = Array.isArray(answers.document_delivery_log) ? answers.document_delivery_log : parseStoredObject(answers.document_delivery_log, [])
  const pool = [...(Array.isArray(documentReceipts) ? documentReceipts : []), ...(Array.isArray(documentDeliveryLog) ? documentDeliveryLog : [])]
  return (
    pool.some((entry) => {
      const normalizedName = String(entry?.name || '').trim().toLowerCase()
      const isResolutionDoc =
        normalizedName === 'resolution documents' ||
        normalizedName.includes('resolution documents') ||
        normalizedName.includes('resolution document')
      if (!isResolutionDoc) return false
      const status = String(entry?.status || '').trim().toLowerCase()
      if (status === 'signed') return true
      return Boolean(String(entry?.signedAt || entry?.signed_at || '').trim())
    }) || Boolean(String(answers.boldsign_resolution_signed_at || '').trim())
  )
}

function hasSignedPendingRevenueDocuments(answers = {}) {
  const onboardingStatus = String(answers?.onboarding_status || '').trim().toLowerCase()
  if (onboardingStatus === 'documents_signed') return true
  // For scheduled investigation revenue, "docs signed" means the investigation (R.E.D / 8821) docs are signed.
  return hasAnySignedInvestigationDocuments(answers)
}

function hasAnySignedInvestigationDocuments(answers = {}) {
  if (isForm8821FullySigned(answers)) return true
  if (hasPersistedSigned8821Record(answers)) return true
  const documentDeliveryLog = Array.isArray(answers?.document_delivery_log) ? answers.document_delivery_log : parseStoredObject(answers?.document_delivery_log, [])
  const documentReceipts = Array.isArray(answers?.document_receipts) ? answers.document_receipts : parseStoredObject(answers?.document_receipts, [])
  const entries = [...(Array.isArray(documentReceipts) ? documentReceipts : []), ...(Array.isArray(documentDeliveryLog) ? documentDeliveryLog : [])]
  return entries.some((entry) => {
    const name = String(entry?.name || '').trim()
    if (name !== '8821 Document' && name !== '8821 Spouse' && name !== 'R.E.D Document') return false
    const status = String(entry?.status || '').trim().toLowerCase()
    return status === 'signed' || Boolean(String(entry?.signedAt || entry?.signed_at || '').trim())
  })
}

function hasStoredPaymentMethodOnFile(answers = {}) {
  const billingPaymentMethods = parseStoredPaymentMethods(answers.billing_payment_methods)
  const portalPaymentMethods = parseStoredPaymentMethods(answers.client_portal_payment_methods)
  const billingPaymentMethod = parseStoredObject(answers.billing_payment_method, null)
  const portalPaymentMethod = parseStoredObject(answers.client_portal_payment_method, null)
  return Boolean(
    billingPaymentMethods.length ||
      portalPaymentMethods.length ||
      (billingPaymentMethod && typeof billingPaymentMethod === 'object' && !Array.isArray(billingPaymentMethod)) ||
      (portalPaymentMethod && typeof portalPaymentMethod === 'object' && !Array.isArray(portalPaymentMethod)),
  )
}

function formatMonthLabel(monthKey = '') {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey
  const [year, month] = monthKey.split('-')
  const parsed = new Date(`${monthKey}-01T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return `${month}/${year}`
  return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function safeEqualText(a = '', b = '') {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (!left.length || !right.length) return false
  if (left.length !== right.length) return false
  try {
    return crypto.timingSafeEqual(left, right)
  } catch {
    return false
  }
}

function deriveNameParts(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
  }
}

const ADMIN_DESIGNATED_POSITIONS = [
  'Owner',
  'Settlement Officer',
  'Management',
  'Enrolled Agent',
]

const ADMIN_ALLOWED_USERS = {
  'farouk.dafer@taxrefresh.info': {
    email: 'farouk.dafer@taxrefresh.info',
    name: 'Farouk Dafer',
    designatedPosition: 'Owner',
  },
  'zach.risheq@taxrefresh.info': {
    email: 'zach.risheq@taxrefresh.info',
    name: 'Zach Risheq',
    designatedPosition: 'Owner',
  },
  'caprizio.fornaro@taxrefresh.info': {
    email: 'caprizio.fornaro@taxrefresh.info',
    name: 'Caprizio Fornaro',
    designatedPosition: 'Enrolled Agent',
  },
}
const ADMIN_LOGIN_PASSWORD = String(
  process.env.ADMIN_DASHBOARD_PASSWORD || ADMIN_DASHBOARD_PASSCODE || 'Trf!A9vK#72pLmQ4xN8s',
).trim()
const ADMIN_USER_PASSWORDS = {
  'farouk.dafer@taxrefresh.info': String(
    process.env.ADMIN_DASHBOARD_PASSWORD_FAROUK_DAFER || ADMIN_OWNER_PASSWORD_DEFAULTS['farouk.dafer@taxrefresh.info'],
  ).trim(),
  'zach.risheq@taxrefresh.info': String(
    process.env.ADMIN_DASHBOARD_PASSWORD_ZACH_RISHEQ || ADMIN_OWNER_PASSWORD_DEFAULTS['zach.risheq@taxrefresh.info'],
  ).trim(),
  'caprizio.fornaro@taxrefresh.info': String(process.env.ADMIN_DASHBOARD_PASSWORD_CAPRIZIO_FORNARO || ADMIN_LOGIN_PASSWORD).trim(),
}
const ENROLLED_AGENT_ALLOWED_ANSWER_KEYS = new Set([
  'consultation_notes',
  'ea_case_status',
  'ea_due_date',
  'ea_priority',
  'ea_handled_years',
  'ea_wage_income_years',
  'ea_account_transcript_years',
  'ea_transcripts_ready_for_client',
  'ea_transcripts_submitted_at',
  'ea_client_transcript_snapshot',
  'ea_resolution_recommendation',
  'ea_important_deadlines',
  'ea_tasks',
  'ea_documents',
  'ea_activity_timeline',
])

function readAdminCredentials(req) {
  return {
    email: String(req.headers['x-admin-email'] || req.body?.email || '').trim().toLowerCase(),
    password: String(req.headers['x-admin-password'] || req.body?.password || req.headers['x-admin-passcode'] || req.body?.passcode || '').trim(),
  }
}

function authenticateAdmin(req) {
  const { email, password } = readAdminCredentials(req)
  const account = ADMIN_ALLOWED_USERS[email]
  if (!account) return null
  const expectedPassword = String(ADMIN_USER_PASSWORDS[email] || '').trim()
  if (!expectedPassword) return null
  if (!safeEqualText(password, expectedPassword)) return null
  return {
    ...account,
    designatedPosition: ADMIN_DESIGNATED_POSITIONS.includes(account.designatedPosition)
      ? account.designatedPosition
      : '',
  }
}

function listAdminDirectory() {
  return Object.values(ADMIN_ALLOWED_USERS).map((account) => ({
    email: String(account?.email || '').trim().toLowerCase(),
    name: String(account?.name || '').trim(),
    designatedPosition: String(account?.designatedPosition || '').trim(),
  }))
}

function requireAdminAccess(req, res) {
  const account = authenticateAdmin(req)
  if (!account) {
    res.status(401).json({ error: 'Invalid email or password' })
    return false
  }
  req.adminUser = account
  return true
}

function getPublicBaseUrl(fallback = '') {
  return safeOrigin(PUBLIC_BASE_URL) || safeOrigin(String(CLIENT_ORIGIN || '').split(',')[0]) || safeOrigin(fallback) || ''
}

function getBackendBaseUrl(fallback = '') {
  return (
    safeOrigin(process.env.BACKEND_PUBLIC_BASE_URL || '') ||
    safeOrigin(process.env.RENDER_EXTERNAL_URL || '') ||
    safeOrigin(fallback) ||
    ''
  )
}

function getUpdatedExperienceBaseUrl(fallback = '') {
  const explicit = safeOrigin(EXPERIENCE_BASE_URL)
  if (explicit) return explicit
  const base = getPublicBaseUrl(fallback)
  if (!base) return ''
  try {
    const url = new URL(base)
    if (url.hostname === 'taxrefreshdashboard.com') return 'https://secure.taxrefresh.us'
    // The client portal host is not the same as the experience-site host.
    // If we accidentally derive a portal origin here, map it to the experience-site.
    if (url.hostname === 'taxrefresh-auth.com') return 'https://secure.taxrefresh.us'
    if (url.port === '4173') url.port = '5173'
    return url.origin
  } catch {
    return base
  }
}

function makePortalLinks(contactId, code, baseUrl = '', opportunityId = '') {
  const base = String(getUpdatedExperienceBaseUrl(baseUrl) || '').replace(/\/+$/, '')
  if (!base || !code) return { repLink: '', clientLink: '', signingLink: '' }
  const oppPart = opportunityId ? `&opportunityId=${encodeURIComponent(opportunityId)}` : ''
  return {
    repLink: contactId ? `${base}/${encodeURIComponent(contactId)}/ti-rep?session=${encodeURIComponent(code)}${oppPart}` : '',
    clientLink: buildClientPortalLoginLink(code, { contactId, opportunityId, state: { answers: {} } }),
    signingLink: contactId ? `${base}/${encodeURIComponent(contactId)}/signing${opportunityId ? `?opportunityId=${encodeURIComponent(opportunityId)}` : ''}` : '',
  }
}

function getClientPortalBaseUrl() {
  return String(process.env.CLIENT_PORTAL_BASE_URL || 'https://taxrefresh-auth.com').trim().replace(/\/+$/, '')
}

function buildClientPortalLoginLink(roomCode, room = null) {
  const base = getClientPortalBaseUrl()
  if (!base) return ''
  const url = new URL(base)
  const answers = room?.state?.answers || {}
  const email = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
  const contactId = String(room?.contactId || answers.ghl_contact_id || '').trim()
  const opportunityId = String(room?.opportunityId || answers.ghl_opportunity_id || '').trim()
  if (email) url.searchParams.set('email', email)
  if (roomCode) url.searchParams.set('session', String(roomCode).trim())
  if (contactId) url.searchParams.set('contactId', contactId)
  if (opportunityId) url.searchParams.set('opportunityId', opportunityId)
  return url.toString()
}

function isValidEmailAddress(value = '') {
  const normalized = String(value || '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
}

function buildExternalDocumentLinks(roomCode, room, baseUrl = '') {
  const experienceBase = String(getUpdatedExperienceBaseUrl(baseUrl) || '').replace(/\/+$/, '')
  const contactId = String(room?.contactId || room?.state?.answers?.ghl_contact_id || '').trim()
  const opportunityId = String(room?.opportunityId || room?.state?.answers?.ghl_opportunity_id || '').trim()
  const portalLinks = makePortalLinks(contactId, roomCode, baseUrl, opportunityId)
  const backendBase = String(getBackendBaseUrl() || '').trim().replace(/\/+$/, '')
  const encodedCode = encodeURIComponent(roomCode)
  return {
    experienceBase,
    clientPortalLink: buildClientPortalLoginLink(roomCode, room) || portalLinks.clientLink || (experienceBase ? `${experienceBase}/rep/session/${encodeURIComponent(roomCode)}` : ''),
    // For signature requests we want the "Review and Sign" button to take the
    // client directly into the BoldSign signing session, not the legacy PDF
    // overlay experience.
    form8821ClientLink: backendBase
      ? `${backendBase}/api/session/${encodedCode}/document-link`
      : experienceBase
        ? `${experienceBase}/document/red-signing?session=${encodedCode}&document=1&packet=red&standalone=1`
        : '',
    form8821SpouseLink: backendBase
      ? `${backendBase}/api/session/${encodedCode}/document-link?target=spouse`
      : experienceBase
        ? `${experienceBase}/document/red-signing-spouse?session=${encodedCode}&document=1&packet=red&standalone=1`
        : '',
  }
}

async function sendGhlEmailMessage({ contactId, emailTo, subject, html, message }) {
  const normalizedContactId = String(contactId || '').trim()
  const normalizedEmail = String(emailTo || '').trim()
  if (!normalizedContactId) throw new Error('A CRM contact id is required before emailing this document.')
  if (!isValidEmailAddress(normalizedEmail)) throw new Error('A valid recipient email is required.')
  return ghlFetch('conversations/messages', {
    method: 'POST',
    version: '2021-04-15',
    body: {
      type: 'Email',
      contactId: normalizedContactId,
      subject: String(subject || '').trim(),
      html: String(html || '').trim(),
      message: String(message || '').trim(),
      status: 'delivered',
    },
  })
}

function normalizePhoneForSms(value = '') {
  const digits = digitsOnly(value)
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (String(value || '').trim().startsWith('+')) return String(value || '').trim()
  return String(value || '').trim()
}

function normalizeSmsThreadEntry(entry = {}) {
  const body = String(entry?.body ?? entry?.message ?? '').trim()
  const id =
    String(entry?.id || entry?.messageId || entry?.message_id || '').trim() ||
    `${String(entry?.conversationId || entry?.conversation_id || 'local').trim()}:${String(entry?.direction || 'outbound').trim()}:${String(entry?.dateAdded || entry?.date_added || '').trim()}:${body}`
  return {
    id,
    conversationId: String(entry?.conversationId || entry?.conversation_id || '').trim(),
    contactId: String(entry?.contactId || entry?.contact_id || '').trim(),
    body,
    direction: String(entry?.direction || 'outbound').trim().toLowerCase() === 'inbound' ? 'inbound' : 'outbound',
    status: String(entry?.status || '').trim(),
    messageType: String(entry?.messageType || entry?.message_type || 'SMS').trim() || 'SMS',
    dateAdded: String(entry?.dateAdded || entry?.date_added || new Date().toISOString()).trim() || new Date().toISOString(),
    from: String(entry?.from || '').trim(),
    to: String(entry?.to || '').trim(),
    source: String(entry?.source || 'dashboard').trim() || 'dashboard',
    userId: String(entry?.userId || entry?.user_id || '').trim(),
    error: String(entry?.error || '').trim(),
    attachments: Array.isArray(entry?.attachments) ? entry.attachments.filter(Boolean).map((item) => String(item)) : [],
  }
}

function parseStoredSmsThread(value) {
  const parsed = parseStoredObject(value, [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((entry) => normalizeSmsThreadEntry(entry))
    .filter((entry) => entry.body || entry.attachments.length)
    .sort((left, right) => String(left.dateAdded || '').localeCompare(String(right.dateAdded || '')))
}

function mergeSmsThreadEntries(existingEntries = [], nextEntries = []) {
  const merged = new Map()
  for (const entry of [...existingEntries, ...nextEntries].map((item) => normalizeSmsThreadEntry(item))) {
    if (!entry.id) continue
    merged.set(entry.id, entry)
  }
  return Array.from(merged.values())
    .sort((left, right) => String(left.dateAdded || '').localeCompare(String(right.dateAdded || '')))
    .slice(-100)
}

function getStoredSmsConversationId(answers = {}, smsThread = []) {
  const direct = String(answers?.ghl_conversation_id || answers?.ghl_sms_conversation_id || '').trim()
  if (direct) return direct
  return String(smsThread.find((entry) => String(entry?.conversationId || '').trim())?.conversationId || '').trim()
}

function buildSmsThreadEntryFromGhlMessage(message = {}, overrides = {}) {
  return normalizeSmsThreadEntry({
    id: String(message?.id || message?.messageId || '').trim(),
    conversationId: String(message?.conversationId || overrides?.conversationId || '').trim(),
    contactId: String(message?.contactId || overrides?.contactId || '').trim(),
    body: String(message?.body || message?.message || '').trim(),
    direction: String(message?.direction || overrides?.direction || '').trim() || 'outbound',
    status: String(message?.status || overrides?.status || '').trim(),
    messageType: String(message?.messageType || overrides?.messageType || 'SMS').trim(),
    dateAdded: String(message?.dateAdded || overrides?.dateAdded || new Date().toISOString()).trim(),
    from: String(message?.from || overrides?.from || '').trim(),
    to: String(message?.to || overrides?.to || '').trim(),
    source: String(overrides?.source || 'ghl').trim(),
    userId: String(message?.userId || overrides?.userId || '').trim(),
    error: String(message?.error || overrides?.error || '').trim(),
    attachments: Array.isArray(message?.attachments) ? message.attachments : overrides?.attachments || [],
  })
}

async function findRecentGhlConversationIdsByContact(contactId = '') {
  const normalizedContactId = String(contactId || '').trim()
  if (!normalizedContactId || !hasDirectGhlConfig()) return []
  try {
    const data = await ghlFetch('conversations/search', {
      version: 'v3',
      query: {
        locationId: GHL_LOCATION_ID,
        contactId: normalizedContactId,
        sort: 'desc',
        sortBy: 'last_message_date',
        limit: 10,
      },
    })
    const conversations = Array.isArray(data?.conversations) ? data.conversations : []
    const ordered = conversations
      .slice()
      .sort((left, right) => {
        const leftScore =
          (['TYPE_PHONE', 'TYPE_GROUP_SMS'].includes(String(left?.type || '').trim()) ? 5 : 0) +
          (String(left?.lastMessageType || '').toUpperCase().includes('SMS') ? 3 : 0)
        const rightScore =
          (['TYPE_PHONE', 'TYPE_GROUP_SMS'].includes(String(right?.type || '').trim()) ? 5 : 0) +
          (String(right?.lastMessageType || '').toUpperCase().includes('SMS') ? 3 : 0)
        return rightScore - leftScore
      })
    return ordered
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean)
  } catch (error) {
    console.error('Failed to search GHL conversations by contact:', error)
    return []
  }
}

async function fetchRecentGhlSmsMessages(conversationId = '', limit = 20) {
  const normalizedConversationId = String(conversationId || '').trim()
  if (!normalizedConversationId || !hasDirectGhlConfig()) return []
  try {
    const data = await ghlFetch(`conversations/${encodeURIComponent(normalizedConversationId)}/messages`, {
      version: 'v3',
      query: { limit },
    })
    const messages = Array.isArray(data?.messages?.messages)
      ? data.messages.messages
      : Array.isArray(data?.messages)
        ? data.messages
        : []
    return messages
      .filter((entry) => {
        const messageType = String(entry?.messageType || '').toUpperCase()
        if (!messageType) return Boolean(String(entry?.body || entry?.message || '').trim())
        if (messageType.includes('EMAIL') || messageType.includes('INTERNAL')) return false
        if (messageType.includes('SMS')) return true
        return Boolean(String(entry?.body || entry?.message || '').trim()) && !messageType.includes('CALL')
      })
      .map((entry) => buildSmsThreadEntryFromGhlMessage(entry, { source: 'ghl' }))
  } catch (error) {
    console.error('Failed to fetch GHL SMS thread:', error)
    return []
  }
}

async function sendGhlSmsMessage({ contactId, phoneNumber, message }) {
  const normalizedContactId = String(contactId || '').trim()
  const normalizedMessage = String(message || '').trim()
  if (!normalizedContactId) throw new Error('A CRM contact id is required before sending SMS.')
  if (!normalizedMessage) throw new Error('SMS message cannot be empty.')
  return ghlFetch('conversations/messages', {
    method: 'POST',
    version: 'v3',
    body: {
      type: 'SMS',
      contactId: normalizedContactId,
      message: normalizedMessage,
      status: 'delivered',
    },
  })
}

function buildStoredDocumentReceiptKey(receipt = {}) {
  const name = String(receipt?.name || '').trim().toLowerCase()
  const documentCode = String(receipt?.documentCode || '').trim().toLowerCase()
  const recipientEmail = String(receipt?.recipientEmail || '').trim().toLowerCase()
  const sentAt = String(receipt?.sentAt || '').trim().toLowerCase()
  return [name || 'document', documentCode || 'no-document-code', recipientEmail || 'no-recipient', sentAt || 'no-time'].join('__')
}

function upsertDocumentReceipts(existingReceipts, nextReceipts) {
  const current = Array.isArray(existingReceipts) ? existingReceipts : parseStoredObject(existingReceipts, [])
  const currentList = Array.isArray(current) ? current : []
  const nextKeys = new Set((Array.isArray(nextReceipts) ? nextReceipts : []).map((entry) => buildStoredDocumentReceiptKey(entry)))
  const remaining = currentList.filter((entry) => !nextKeys.has(buildStoredDocumentReceiptKey(entry)))
  return [...nextReceipts, ...remaining]
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getClientFirstName(value = '') {
  const safeValue = String(value || '').trim()
  if (!safeValue) return 'Client'
  return safeValue.split(/\s+/)[0] || 'Client'
}

function build8821EmailHtml({ clientName, signingLink, secondarySigningLink = '', secondaryLabel = 'Open spouse signature' }) {
  const safeName = escapeHtml(getClientFirstName(clientName))
  const safeLink = String(signingLink || '').trim()
  const safeHref = escapeHtml(safeLink || '#')
  const safeSecondaryLink = String(secondarySigningLink || '').trim()
  const safeSecondaryHref = escapeHtml(safeSecondaryLink || '#')
  const safeSecondaryLabel = escapeHtml(String(secondaryLabel || 'Open spouse signature').trim() || 'Open spouse signature')
  const secondaryBlock = safeSecondaryLink
    ? `
                <div style="margin:18px 0 0 0; padding:18px; border-radius:16px; background:#ffffff; border:1px solid #dce8f8;">
                  <div style="font-size:14px; font-weight:800; color:#1c3158; margin-bottom:8px;">
                    Additional signing link
                  </div>
                  <p style="margin:0 0 14px 0; font-size:14px; line-height:1.7; color:#4d5b74;">
                    If the same person is signing for the spouse too, use this second secure link after finishing the first signature.
                  </p>
                  <a
                    href="${safeSecondaryHref}"
                    style="display:inline-block; padding:12px 20px; border-radius:12px; background:#eef6ff; color:#1d5fd1; font-size:14px; font-weight:800; text-decoration:none;"
                  >
                    ${safeSecondaryLabel}
                  </a>
                </div>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TaxRefresh Form 8821 and Service Agreement</title>
  </head>
  <body style="margin:0; padding:0; background:#eef3f9; font-family:Arial, Helvetica, sans-serif; color:#182235;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
      Your TaxRefresh Form 8821 and Service Agreement are ready for review and signature.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef3f9; padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:660px; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 16px 46px rgba(15, 23, 42, 0.10);">
            <tr>
              <td style="background:linear-gradient(135deg, #d9ebff 0%, #b9d8ff 100%); padding:14px 38px 8px 38px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                        <tr>
                          <td align="center">
                            <img
                              src="https://secure.taxrefresh.us/taxrefreshlogo.png"
                              alt="TaxRefresh"
                              width="290"
                              style="display:block; width:290px; max-width:100%; height:auto; border:0;"
                            />
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 38px 22px 38px;">
                <div style="text-align:center; margin:0 0 24px 0;">
                  <div style="display:inline-block; padding:8px 16px; border-radius:999px; background:#eef6ff; color:#1d5fd1; font-size:12px; font-weight:800; letter-spacing:0.55px; text-transform:uppercase; box-shadow:0 8px 18px rgba(29,95,209,0.08);">
                    Signature needed
                  </div>
                  <h1 style="margin:16px auto 14px auto; max-width:520px; font-size:34px; line-height:1.15; color:#182235; font-weight:800;">
                    Your documents are ready for review
                  </h1>
                  <p style="margin:0 auto 12px auto; max-width:560px; font-size:17px; line-height:1.75; color:#4c5b74;">
                    Hello <strong style="color:#182235;">${safeName}</strong>,
                  </p>
                  <p style="margin:0 auto; max-width:580px; font-size:17px; line-height:1.75; color:#4c5b74;">
                    Your TaxRefresh <strong style="color:#182235;">Form 8821</strong> and <strong style="color:#182235;">Service Agreement</strong> are now ready for review and signature. These documents allow us to move forward with your case and confirm the authorization and service terms needed to begin.
                  </p>
                </div>
                <div style="margin:30px 0 26px 0; padding:24px 24px 18px 24px; border-radius:18px; background:#f8fbff; border:1px solid #e2ebf7;">
                  <div style="font-size:15px; font-weight:800; color:#1c3158; margin-bottom:14px; letter-spacing:0.15px;">
                    What to do next
                  </div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate; border-spacing:0 10px;">
                    <tr>
                      <td valign="top" style="width:28px; font-size:14px; line-height:1.7; color:#1d5fd1; font-weight:800;">1</td>
                      <td valign="top" style="font-size:15px; line-height:1.75; color:#4d5b74; font-weight:500;">
                        Review the Form 8821 and Service Agreement
                      </td>
                    </tr>
                    <tr>
                      <td valign="top" style="width:28px; font-size:14px; line-height:1.7; color:#1d5fd1; font-weight:800;">2</td>
                      <td valign="top" style="font-size:15px; line-height:1.75; color:#4d5b74; font-weight:500;">
                        Sign where prompted in the secure signing flow
                      </td>
                    </tr>
                    <tr>
                      <td valign="top" style="width:28px; font-size:14px; line-height:1.7; color:#1d5fd1; font-weight:800;">3</td>
                      <td valign="top" style="font-size:15px; line-height:1.75; color:#4d5b74; font-weight:500;">
                        Submit it so TaxRefresh can continue working on your file
                      </td>
                    </tr>
                  </table>
                  ${secondaryBlock}
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px auto;">
                  <tr>
                    <td align="center" style="border-radius:14px; background:#1d5fd1; box-shadow:0 8px 18px rgba(29, 95, 209, 0.18);">
                      <a
                        href="${safeHref}"
                        style="display:inline-block; padding:16px 28px; border-radius:14px; color:#ffffff; text-decoration:none; font-size:15px; font-weight:700; letter-spacing:0.15px;"
                      >
                        Review and Sign
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 38px 30px 38px;">
                <div style="height:1px; background:#e6edf6; margin:0 0 18px 0;"></div>
                <p style="margin:0; font-size:15px; line-height:1.75; color:#4c5b74; text-align:center;">
                  If you have any questions before signing, reply to this email and our team will help you.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 38px 32px 38px;">
                <div style="margin:0 0 18px 0; padding:18px 20px; border-top:1px solid #d8e1ee; border-bottom:1px solid #d8e1ee; background:#f8fafc; border-radius:14px;">
                  <p style="margin:0 0 14px 0; font-size:12px; line-height:1.8; color:#5d6a7f;">
                    <strong style="color:#182235;">Confidential Communication:</strong>
                    This email and any documents attached may contain confidential and/or legally privileged information, and are for the sole use of the intended recipient named above. If you have received this email in error, please notify the sender and delete the electronic message. Any disclosure, copying, distribution, or use of the contents of the information received in error is strictly prohibited.
                  </p>
                  <p style="margin:0; font-size:12px; line-height:1.8; color:#5d6a7f;">
                    <strong style="color:#182235;">IRS Circular 230 Disclosure:</strong>
                    To ensure compliance with requirements imposed by the IRS, please be advised that any U.S. federal tax advice contained in this communication, including any attachments, is not intended or written to be used, and cannot be used or relied upon, for the purpose of avoiding penalties under the Internal Revenue Code or promoting, marketing, or recommending to another party any transaction or matter addressed here.
                  </p>
                </div>
                <p style="margin:0; font-size:12px; line-height:1.7; color:#8a97ad; text-align:center;">
                  TaxRefresh | 949-390-6350 | <a href="https://taxrefresh.us" style="color:#1d5fd1; text-decoration:none;">taxrefresh.us</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

async function releasePendingMfj8821SpouseEmail({ roomCode, room, senderEmail = '', spouseRecipientEmail: overrideSpouseRecipientEmail = '' } = {}) {
  const answers = room?.state?.answers || {}
  if (!isMarriedJointFilingAnswers(answers)) return { sent: false, reason: 'not_married_joint' }

  const documentCode = String(answers.active_8821_document_code || answers.current_8821_document_code || '').trim()
  if (!documentCode) return { sent: false, reason: 'missing_document_code' }
  if (hasDocumentLifecycleEntry(answers, { name: '8821 Spouse', documentCode })) {
    return { sent: false, reason: 'already_sent' }
  }
  if (String(answers.form8821_status || '').trim().toLowerCase() !== 'completed') {
    return { sent: false, reason: 'client_not_completed' }
  }

  const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || 'Client').trim() || 'Client'
  const clientEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
  const spouseRecipientEmail = String(overrideSpouseRecipientEmail || answers.spouse_email || getSpouseSignerEmailFromAnswers(answers) || '').trim()
  const spouseName = String(getSpouseSignerNameFromAnswers(answers) || 'Spouse').trim() || 'Spouse'
  const phone = String(getPrimaryAnswer(answers, ['phone', 'phone_number']) || '').trim()
  const spouseUsesClientEmail = clientEmail.trim().toLowerCase() === spouseRecipientEmail.trim().toLowerCase()

  if (!isValidEmailAddress(clientEmail)) throw new Error('A valid client email is required before releasing the spouse signature email.')
  if (!isValidEmailAddress(spouseRecipientEmail)) throw new Error('A valid spouse email is required before releasing the spouse signature email.')
  answers.spouse_email = spouseRecipientEmail

  const priorContactId = String(room?.contactId || answers.ghl_contact_id || '').trim()
  const contactId = await resolveGhlContactIdForEmail({ contactId: priorContactId, email: clientEmail, name: clientName, phone })
  if (!contactId) throw new Error('A CRM contact id is required before emailing the spouse document.')
  if (room) room.contactId = contactId
  answers.ghl_contact_id = contactId
  answers.ghl_contact_created_at = answers.ghl_contact_created_at || new Date().toISOString()

  const backendBase = String(getBackendBaseUrl() || '').trim().replace(/\/+$/, '')
  const spouseReturnUrl = backendBase ? `${backendBase}/api/session/${encodeURIComponent(roomCode)}/document-complete?target=spouse` : ''
  const created = await createBoldsign8821SigningLink({
    sessionCode: roomCode,
    signerName: clientName,
    signerEmail: clientEmail,
    spouseSignerName: spouseName,
    spouseSignerEmail: spouseRecipientEmail,
    target: 'spouse',
    returnUrl: spouseReturnUrl,
    onBehalfOf: String(senderEmail || answers.boldsign_8821_sender_email || '').trim(),
    persistDocument: false,
    documentFieldPrefix: 'boldsign_8821',
  })

  const spouseSigningUrl = String(created?.signingUrl || '').trim()
  if (!spouseSigningUrl) throw new Error('Unable to create a secure spouse signing link for this document.')

  await sendGhlEmailMessage({
    contactId,
    emailTo: spouseRecipientEmail,
    subject: 'TaxRefresh Signature Request',
    message: `Open and sign the spouse portion of TaxRefresh Form 8821: ${spouseSigningUrl}`,
    html: build8821EmailHtml({ clientName: spouseName, signingLink: spouseSigningUrl }),
  })

  const sentAt = new Date().toISOString()
  answers.form8821_spouse_status = 'launching'
  answers.form8821_spouse_release_error = ''
  answers.form8821_spouse_release_attempted_at = sentAt
  answers.form8821_spouse_released_at = sentAt
  answers.document_receipts = upsertDocumentReceipts(answers.document_receipts, [
    {
      name: '8821 Spouse',
      documentCode,
      status: 'Sent',
      method: 'Email',
      sentAt,
      recipientEmail: spouseRecipientEmail,
      sentBy: String(senderEmail || answers.boldsign_8821_sender_email || 'System').trim() || 'System',
    },
  ])
  const nextEmailLog = Array.isArray(answers.document_email_log) ? answers.document_email_log : parseStoredObject(answers.document_email_log, [])
  answers.document_email_log = [
    {
      id: `doc_email_${Date.now().toString(36)}_spouse`,
      documentType: '8821 Spouse',
      documentCode,
      recipientEmail: spouseRecipientEmail,
      link: spouseSigningUrl,
      sentAt,
      sentBy: String(senderEmail || answers.boldsign_8821_sender_email || '').trim(),
    },
    ...nextEmailLog,
  ]
  appendDocumentDeliveryLogEntry(answers, {
    id: `doc_delivery_${Date.now().toString(36)}_spouse`,
    name: '8821 Spouse',
    documentCode,
    status: 'Sent',
    method: 'Email',
    sentAt,
    recipientEmail: spouseRecipientEmail,
    sentBy: String(senderEmail || answers.boldsign_8821_sender_email || 'System').trim() || 'System',
  })
  const hiddenReceiptNames = parseStoredObject(answers.hidden_document_receipt_names, []).filter((name) => typeof name === 'string' && name.trim())
  answers.hidden_document_receipt_names = hiddenReceiptNames.filter((name) => String(name || '').trim() !== '8821 Spouse')

  return { sent: true, signingUrl: spouseSigningUrl, recipientEmail: spouseRecipientEmail, sentAt, documentCode }
}

function buildSigned8821CopyEmailHtml({ clientName, downloadLink, portalLink }) {
  const safeName = escapeHtml(getClientFirstName(clientName))
  const safeLink = String(downloadLink || '').trim()
  const safeHref = escapeHtml(safeLink || '#')
  const safePortalLink = String(portalLink || '').trim()
  const safePortalHref = escapeHtml(safePortalLink || '#')
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your signed TaxRefresh Form 8821 copy</title>
  </head>
  <body style="margin:0; padding:0; background:#eef3f9; font-family:Arial, Helvetica, sans-serif; color:#182235;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
      Your signed TaxRefresh Form 8821 copy is ready to download.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef3f9; padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:660px; background:#ffffff; border-radius:24px; overflow:hidden; box-shadow:0 16px 46px rgba(15, 23, 42, 0.10);">
            <tr>
              <td style="background:linear-gradient(135deg, #d9ebff 0%, #b9d8ff 100%); padding:14px 38px 8px 38px; text-align:center;">
                <img
                  src="https://secure.taxrefresh.us/taxrefreshlogo.png"
                  alt="TaxRefresh"
                  width="290"
                  style="display:block; width:290px; max-width:100%; height:auto; border:0; margin:0 auto;"
                />
              </td>
            </tr>
            <tr>
              <td style="padding:28px 38px 34px 38px;">
                <div style="text-align:center; margin:0 0 24px 0;">
                  <div style="display:inline-block; padding:8px 16px; border-radius:999px; background:#eef6ff; color:#1d5fd1; font-size:12px; font-weight:800; letter-spacing:0.55px; text-transform:uppercase;">
                    Signed copy ready
                  </div>
                  <h1 style="margin:16px auto 14px auto; max-width:520px; font-size:32px; line-height:1.15; color:#182235; font-weight:800;">
                    Your Signed Document is ready
                  </h1>
                  <p style="margin:0 auto 12px auto; max-width:560px; font-size:17px; line-height:1.75; color:#4c5b74;">
                    Hello <strong style="color:#182235;">${safeName}</strong>,
                  </p>
                  <p style="margin:0 auto; max-width:580px; font-size:17px; line-height:1.75; color:#4c5b74;">
                    We’ve attached your completed authorization to your record and made a copy available for you to download below.
                  </p>
                </div>
                <div style="text-align:center; margin:30px 0 22px 0;">
                  <a
                    href="${safeHref}"
                    style="display:inline-block; padding:16px 28px; border-radius:14px; background:#1d5fd1; color:#ffffff; text-decoration:none; font-size:16px; font-weight:800; letter-spacing:0.01em; box-shadow:0 10px 24px rgba(29,95,209,0.22);"
                  >
                    Download Document
                  </a>
                </div>
                <div style="margin:0 auto; max-width:580px; text-align:center;">
                  <p style="margin:0 0 12px 0; font-size:15px; line-height:1.75; color:#6a768c;">
                    You can also view your documents anytime in your client portal.
                  </p>
                  <a
                    href="${safePortalHref}"
                    style="display:inline-block; padding:12px 22px; border-radius:12px; background:#eef6ff; border:1px solid #cfe0ff; color:#1d5fd1; text-decoration:none; font-size:15px; font-weight:800; letter-spacing:0.01em; box-shadow:0 6px 18px rgba(29,95,209,0.10);"
                  >
                    Open Client Portal
                  </a>
                </div>
                <div style="margin:26px 0 0 0; padding:18px 20px; border-top:1px solid #d8e1ee; border-bottom:1px solid #d8e1ee; background:#f8fafc; border-radius:14px;">
                  <p style="margin:0 0 10px 0; font-size:12px; line-height:1.8; color:#5d6a7f; text-align:left;">
                    TaxRefresh works with IRS-authorized Enrolled Agent representation and secure document handling practices to help protect your tax information.
                  </p>
                  <p style="margin:0 0 12px 0; font-size:12px; line-height:1.8; color:#5d6a7f; text-align:left;">
                    <strong style="color:#182235;">Confidential Communication:</strong>
                    This email and any documents attached may contain confidential and/or legally privileged information, and are for the sole use of the intended recipient named above. If you have received this email in error, please notify the sender and delete the electronic message. Any disclosure, copying, distribution, or use of the contents of the information received in error is strictly prohibited.
                  </p>
                  <p style="margin:0; font-size:12px; line-height:1.8; color:#5d6a7f; text-align:left;">
                    <strong style="color:#182235;">IRS Circular 230 Disclosure:</strong>
                    To ensure compliance with requirements imposed by the IRS, please be advised that any U.S. federal tax advice contained in this communication, including any attachments, is not intended or written to be used, and cannot be used or relied upon, for the purpose of avoiding penalties under the Internal Revenue Code or promoting, marketing, or recommending to another party any transaction or matter addressed here.
                  </p>
                </div>
                <p style="margin:16px 0 0 0; font-size:12px; line-height:1.7; color:#8a97ad; text-align:center;">
                  TaxRefresh | 949-390-6350 | <a href="https://taxrefresh.us" style="color:#1d5fd1; text-decoration:none;">taxrefresh.us</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

async function sendSigned8821CopyEmail({ roomCode, room }) {
  if (OUTBOUND_8821_EMAILS_DISABLED) return false
  const answers = room?.state?.answers || {}
  if (!isForm8821FullySigned(answers)) return false
  if (String(answers.signed_8821_client_emailed_at || '').trim()) return false
  if (String(answers.signed_8821_client_email_sending_at || '').trim()) return false

  const contactId = String(room?.contactId || answers.ghl_contact_id || '').trim()
  const recipientEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
  if (!contactId || !isValidEmailAddress(recipientEmail)) return false

  const backendBase = getBackendBaseUrl()
  if (!backendBase) return false

  answers.signed_8821_client_email_sending_at = new Date().toISOString()
  room.state.updatedAt = Date.now()
  io.to(roomCode).emit('room_state', room.state)
  try {
    await dbUpsertSession({ code: roomCode, state: room.state })
  } catch {
    // ignore; room state still updates in-memory
  }

  const downloadLink = `${backendBase}/api/session/${encodeURIComponent(String(roomCode || '').trim())}/signed-8821?download=1`
  const portalLink = buildClientPortalLoginLink(roomCode, room)
  const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || 'TaxRefresh Client').trim()
  try {
    await sendGhlEmailMessage({
      contactId,
      emailTo: recipientEmail,
      subject: 'Your Signed TaxRefresh Document Copy',
      message: `Your Signed TaxRefresh Document Copy is ready: ${downloadLink}`,
      html: buildSigned8821CopyEmailHtml({ clientName, downloadLink, portalLink }),
    })

    answers.signed_8821_client_emailed_at = new Date().toISOString()
    answers.signed_8821_client_emailed_to = recipientEmail
    answers.signed_8821_client_email_sending_at = ''
    room.state.updatedAt = Date.now()
    io.to(roomCode).emit('room_state', room.state)
    try {
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch {
      // ignore; room state still updates in-memory
    }
  } catch (error) {
    answers.signed_8821_client_email_sending_at = ''
    room.state.updatedAt = Date.now()
    io.to(roomCode).emit('room_state', room.state)
    try {
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch {
      // ignore; room state still updates in-memory
    }
    throw error
  }
  return true
}

async function markBoldsign8821Completed({ roomCode, completedDocumentCode = '', target = 'client' }) {
  const room = await ensureRoom(roomCode)
  logMemoryDiagnostics('markBoldsign8821Completed:start', {
    roomCode,
    target: String(target || 'client'),
    completedDocumentCode: String(completedDocumentCode || ''),
  })
  if (completedDocumentCode) {
    room.state.answers.active_8821_document_code = completedDocumentCode
  }

  const normalizedTarget = String(target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
  if (normalizedTarget === 'spouse') {
    // In MFJ signing-order flows, the spouse cannot complete unless the client
    // has already completed signer order 1. Backfill the client-complete state
    // here so the overall packet still resolves to fully signed even if the
    // earlier client completion callback/webhook was missed.
    if (isMarriedJointFilingAnswers(room.state.answers)) {
      room.state.answers.form8821_status = 'completed'
    }
    room.state.answers.form8821_spouse_status = 'completed'
  } else {
    room.state.answers.form8821_status = 'completed'
    if (!isMarriedJointFilingAnswers(room.state.answers)) {
      room.state.answers.form8821_spouse_status = room.state.answers.form8821_spouse_status || 'not_required'
    }
  }

  if (
    normalizedTarget === 'client' &&
    isMarriedJointFilingAnswers(room.state.answers) &&
    String(room.state.answers.form8821_spouse_status || '').trim().toLowerCase() !== 'completed'
  ) {
    if (String(room.state.answers.boldsign_8821_delivery_mode || '').trim().toLowerCase() === 'boldsign_email') {
      room.state.answers.form8821_spouse_status = 'launching'
    } else {
      room.state.answers.form8821_spouse_release_attempted_at = new Date().toISOString()
      try {
        if (!OUTBOUND_EMAILS_DISABLED) {
          await releasePendingMfj8821SpouseEmail({
            roomCode,
            room,
            senderEmail: String(room.state.answers.boldsign_8821_sender_email || '').trim(),
          })
        }
      } catch (error) {
        room.state.answers.form8821_spouse_status = 'release_failed'
        room.state.answers.form8821_spouse_release_error = error instanceof Error ? error.message : 'Unable to release the spouse signing email.'
        console.error('MFJ spouse signing release failed:', error)
      }
    }
  }

  if (isForm8821FullySigned(room.state.answers)) {
    room.state.answers.onboarding_status = 'documents_signed'
    room.state.answers.completed_at = room.state.answers.completed_at || new Date().toISOString()
    room.state.answers.boldsign_8821_signed_at = new Date().toISOString()
    markSigned8821DeliveryEntries(room.state.answers, room.state.answers.boldsign_8821_signed_at, completedDocumentCode)
    logMemoryDiagnostics('markBoldsign8821Completed:before-store', {
      roomCode,
      target: normalizedTarget,
    })
    void runSoftCreditCheckForRoom({
      roomCode,
      room,
      consentGranted: true,
      source: 'document_signed_auto',
    }).catch((error) => {
      console.error('Soft credit check auto-run failed:', error)
    })
  }

  room.state.updatedAt = Date.now()
  io.to(roomCode).emit('room_state', room.state)
  try {
    await dbUpsertSession({ code: roomCode, state: room.state })
  } catch {
    // ignore; session still works in-memory
  }
  if (isForm8821FullySigned(room.state.answers)) {
    void ensureSigned8821StoredOnRecord(roomCode, room)
      .then(() => {
        logMemoryDiagnostics('markBoldsign8821Completed:after-store', {
          roomCode,
          target: normalizedTarget,
        })
      })
      .catch((error) => {
        console.error('Signed 8821 storage failed:', error)
      })
    if (!OUTBOUND_8821_EMAILS_DISABLED) {
      void sendSigned8821CopyEmail({ roomCode, room }).catch((error) => {
        console.error('Signed 8821 client email failed:', error)
      })
    }
  }
  logMemoryDiagnostics('markBoldsign8821Completed:after-persist', {
    roomCode,
    target: normalizedTarget,
  })
  void syncSessionToGhl({ roomCode, room, reason: 'form_8821_completed', force: true }).catch((error) => {
    console.error('GHL form 8821 completion sync failed:', error)
  })
  return room
}

function timingSafeEqualHex(a = '', b = '') {
  const left = String(a || '').trim()
  const right = String(b || '').trim()
  if (!left || !right || left.length !== right.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  } catch {
    return false
  }
}

function verifyBoldsignWebhookSignature(rawBody, headerValue = '') {
  if (!BOLDSIGN_WEBHOOK_SECRET) return true
  const header = String(headerValue || '').trim()
  if (!header) return false
  const parts = header.split(',').map((part) => part.trim()).filter(Boolean)
  let timestamp = ''
  const signatures = []
  parts.forEach((part) => {
    const [key, value] = part.split('=')
    if (key === 't') timestamp = String(value || '').trim()
    if (key === 's0' || key === 'v1' || key === 'sig') signatures.push(String(value || '').trim())
  })
  if (!timestamp || !signatures.length) return false
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp || 0))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 10) return false
  const payload = `${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', BOLDSIGN_WEBHOOK_SECRET).update(payload).digest('hex')
  return signatures.some((signature) => timingSafeEqualHex(expected, signature))
}

async function findSessionByBoldsignDocumentId(documentId = '') {
  const normalized = String(documentId || '').trim()
  if (!normalized) return null
  if (pool) {
    const res = await pool.query(
      `select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
       from ti_sessions
       where state->'answers'->>'boldsign_8821_document_id' = $1
          or state->'answers'->>'boldsign_8821_spouse_document_id' = $1
          or state->'answers'->>'boldsign_resolution_document_id' = $1
       order by updated_at desc
       limit 1`,
      [normalized],
    )
    if (res.rows[0]) return res.rows[0]
  }
  await ensureFallbackStoreLoaded()
  for (const entry of fallbackSessions.values()) {
    const answers = entry?.state?.answers || {}
    if (
      String(answers.boldsign_8821_document_id || '').trim() === normalized ||
      String(answers.boldsign_8821_spouse_document_id || '').trim() === normalized ||
      String(answers.boldsign_resolution_document_id || '').trim() === normalized
    ) {
      return {
        session_code: entry.sessionCode,
        ghl_contact_id: entry.contactId,
        ghl_opportunity_id: entry.opportunityId,
        state: entry.state,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
      }
    }
  }
  return null
}

function markSignedResolutionDeliveryEntries(answers = {}, signedAt = '', documentCode = '') {
  const normalizedSignedAt = String(signedAt || '').trim() || new Date().toISOString()
  const targetName = 'Resolution Documents'
  const normalizedDocumentCode = String(documentCode || '').trim()

  const currentDeliveryLog = Array.isArray(answers?.document_delivery_log)
    ? answers.document_delivery_log
    : parseStoredObject(answers?.document_delivery_log, [])
  if (Array.isArray(currentDeliveryLog)) {
    answers.document_delivery_log = currentDeliveryLog.map((entry) => {
      const name = String(entry?.name || '').trim()
      if (name !== targetName) return entry
      const entryDocumentCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryDocumentCode && entryDocumentCode !== normalizedDocumentCode) return entry
      return {
        ...(entry || {}),
        status: 'Signed',
        signedAt: String(entry?.signedAt || '').trim() || normalizedSignedAt,
      }
    })
  }

  const currentReceipts = Array.isArray(answers?.document_receipts)
    ? answers.document_receipts
    : parseStoredObject(answers?.document_receipts, [])
  if (Array.isArray(currentReceipts)) {
    answers.document_receipts = currentReceipts.map((entry) => {
      const name = String(entry?.name || '').trim()
      if (name !== targetName) return entry
      const entryDocumentCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryDocumentCode && entryDocumentCode !== normalizedDocumentCode) return entry
      return {
        ...(entry || {}),
        status: 'Signed',
        sentAt: String(entry?.sentAt || '').trim() || normalizedSignedAt,
      }
    })
  }
}

function getLatestIsoTimestamp(previous = '', next = '') {
  const prevRaw = String(previous || '').trim()
  const nextRaw = String(next || '').trim()
  if (!prevRaw) return nextRaw
  if (!nextRaw) return prevRaw
  const prevTime = new Date(prevRaw).getTime()
  const nextTime = new Date(nextRaw).getTime()
  if (!Number.isFinite(prevTime)) return nextRaw
  if (!Number.isFinite(nextTime)) return prevRaw
  return nextTime >= prevTime ? nextRaw : prevRaw
}

function markViewedDeliveryEntries(answers = {}, openedAt = '', targetName = '', documentCode = '') {
  const normalizedOpenedAt = String(openedAt || '').trim() || new Date().toISOString()
  const normalizedTargetName = String(targetName || '').trim()
  const normalizedDocumentCode = String(documentCode || '').trim()
  if (!normalizedTargetName) return

  const currentDeliveryLog = Array.isArray(answers?.document_delivery_log)
    ? answers.document_delivery_log
    : parseStoredObject(answers?.document_delivery_log, [])
  if (Array.isArray(currentDeliveryLog)) {
    answers.document_delivery_log = currentDeliveryLog.map((entry) => {
      const name = String(entry?.name || '').trim()
      if (name !== normalizedTargetName) return entry
      const entryDocumentCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryDocumentCode && entryDocumentCode !== normalizedDocumentCode) return entry
      const existingOpenedAt = String(entry?.openedAt || entry?.opened_at || '').trim()
      return {
        ...(entry || {}),
        openedAt: getLatestIsoTimestamp(existingOpenedAt, normalizedOpenedAt),
      }
    })
  }

  const currentReceipts = Array.isArray(answers?.document_receipts)
    ? answers.document_receipts
    : parseStoredObject(answers?.document_receipts, [])
  if (Array.isArray(currentReceipts)) {
    answers.document_receipts = currentReceipts.map((entry) => {
      const name = String(entry?.name || '').trim()
      if (name !== normalizedTargetName) return entry
      const entryDocumentCode = String(entry?.documentCode || '').trim()
      if (normalizedDocumentCode && entryDocumentCode && entryDocumentCode !== normalizedDocumentCode) return entry
      const existingOpenedAt = String(entry?.openedAt || entry?.opened_at || '').trim()
      return {
        ...(entry || {}),
        openedAt: getLatestIsoTimestamp(existingOpenedAt, normalizedOpenedAt),
      }
    })
  }
}

async function applyBoldsignWebhookEvent(eventPayload = {}) {
  const eventType = String(eventPayload?.eventType || eventPayload?.event_type || '').trim()
  const data = eventPayload?.data && typeof eventPayload.data === 'object' ? eventPayload.data : {}
  const document = data?.document && typeof data.document === 'object' ? data.document : data
  const documentId = String(document?.documentId || document?.id || data?.documentId || data?.id || '').trim()
  if (!documentId) return { handled: false, reason: 'missing_document_id', eventType }

  const row = await findSessionByBoldsignDocumentId(documentId)
  if (!row) return { handled: false, reason: 'session_not_found', eventType, documentId }

  const roomCode = String(row.session_code || '').trim().toUpperCase()
  const room = await ensureRoom(roomCode)
  const answers = room.state.answers || {}
  const resolutionDocumentId = String(answers.boldsign_resolution_document_id || '').trim()

  // Resolution documents have a separate template + document id, so handle them explicitly.
  if (resolutionDocumentId && resolutionDocumentId === documentId) {
    const normalizedType = eventType.toLowerCase()
    const sentAt = new Date().toISOString()
    const openedAt = sentAt
    const signerEmail = String(data?.signer?.emailAddress || data?.signer?.email || document?.signerEmail || '').trim().toLowerCase()
    const receiptName = 'Resolution Documents'

    if (normalizedType.includes('verification')) {
      return { handled: true, reason: 'verification', roomCode, eventType, documentId }
    }

    if (normalizedType.includes('sent') || normalizedType.includes('created')) {
      if (!hasDocumentLifecycleEntry(answers, { name: receiptName, documentCode: documentId })) {
        const receiptEntry = {
          id: `boldsign_${documentId}_${normalizedType}_resolution`,
          name: receiptName,
          documentCode: documentId,
          status: 'Sent',
          method: 'Experience',
          sentAt,
          recipientEmail: signerEmail,
          sentBy: 'BoldSign',
        }
        answers.document_delivery_log = [receiptEntry, ...parseStoredObject(answers.document_delivery_log, [])]
        answers.document_receipts = upsertDocumentReceipts(answers.document_receipts, [
          {
            name: receiptName,
            documentCode: documentId,
            status: 'Sent',
            method: 'Experience',
            sentAt,
            recipientEmail: signerEmail,
            sentBy: 'BoldSign',
          },
        ])
      }
      answers.onboarding_status = String(answers.onboarding_status || '').trim() || 'documents_ready_for_signature'
    }

    if (normalizedType.includes('viewed') || normalizedType.includes('opened')) {
      answers.boldsign_resolution_viewed_at = getLatestIsoTimestamp(String(answers.boldsign_resolution_viewed_at || '').trim(), openedAt)
      markViewedDeliveryEntries(answers, openedAt, receiptName, documentId)
    }

    if (normalizedType.includes('signed') || normalizedType.includes('completed')) {
      answers.boldsign_resolution_signed_at = answers.boldsign_resolution_signed_at || new Date().toISOString()
      markSignedResolutionDeliveryEntries(answers, answers.boldsign_resolution_signed_at, documentId)
      room.state.updatedAt = Date.now()
      try {
        await dbUpsertSession({
          code: roomCode,
          contactId: room.contactId || null,
          opportunityId: room.opportunityId || null,
          state: room.state,
        })
      } catch {
        // ignore; room state is still updated in memory
      }
      emitDashboardRecordsUpdated({ reason: 'boldsign_webhook_completed', roomCode, eventType, target: 'resolution', documentCode: '' })
      return { handled: true, reason: 'completed', roomCode, eventType, target: 'resolution' }
    }

    room.state.updatedAt = Date.now()
    try {
      await dbUpsertSession({
        code: roomCode,
        contactId: room.contactId || null,
        opportunityId: room.opportunityId || null,
        state: room.state,
      })
    } catch {
      // ignore; room state is still updated in memory
    }
    emitDashboardRecordsUpdated({ reason: 'boldsign_webhook', roomCode, eventType, target: 'resolution', documentCode: '' })
    return { handled: true, reason: 'updated', roomCode, eventType, target: 'resolution' }
  }

  const clientDocumentId = String(answers.boldsign_8821_document_id || '').trim()
  const spouseDocumentId = String(answers.boldsign_8821_spouse_document_id || '').trim()
  const matchedTarget = spouseDocumentId && spouseDocumentId === documentId ? 'spouse' : clientDocumentId && clientDocumentId === documentId ? 'client' : ''
  const activeDocumentCode = String(answers.active_8821_document_code || answers.current_8821_document_code || '').trim()
  const resolvedDocumentCode = activeDocumentCode || createDocumentInstanceCode('red')
  const sentAt = new Date().toISOString()
  const openedAt = sentAt
  const normalizedType = eventType.toLowerCase()
  const signerEmail = String(data?.signer?.emailAddress || data?.signer?.email || document?.signerEmail || '').trim().toLowerCase()
  const clientEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim().toLowerCase()
  const spouseEmail = getStoredBoldsignSpouseSignerEmail(answers, { clientEmail })
  const actorId = String(eventPayload?.context?.actor?.id || '').trim()
  const signerDetails = Array.isArray(data?.signerDetails)
    ? data.signerDetails
    : Array.isArray(document?.signerDetails)
      ? document.signerDetails
      : []
  let signerOrder = Number(data?.signer?.order || data?.signer?.signerOrder || 0)
  if (!signerOrder && actorId && signerDetails.length) {
    const actorMatch = signerDetails.find((entry) => String(entry?.id || '').trim() === actorId)
    signerOrder = Number(actorMatch?.order || 0)
  }
  const isMfj = isMarriedJointFilingAnswers(answers)
  const usesSharedMfjDocument = Boolean(isMfj && clientDocumentId && (!spouseDocumentId || spouseDocumentId === clientDocumentId))
  const inferredTarget =
    isMfj && signerOrder >= 2
      ? 'spouse'
      : isMfj && signerOrder === 1
        ? 'client'
        : signerEmail && spouseEmail && spouseEmail !== clientEmail && signerEmail === spouseEmail
          ? 'spouse'
          : 'client'
  const target = usesSharedMfjDocument ? inferredTarget : matchedTarget || inferredTarget
  const receiptName = target === 'spouse' ? '8821 Spouse' : '8821 Document'
  answers.current_8821_document_code = answers.current_8821_document_code || resolvedDocumentCode
  answers.active_8821_document_code = answers.active_8821_document_code || resolvedDocumentCode

  if (normalizedType.includes('verification')) return { handled: true, reason: 'verification', roomCode, eventType }

  if (normalizedType.includes('sent') || normalizedType.includes('created')) {
    if (!hasDocumentLifecycleEntry(answers, { name: receiptName, documentCode: resolvedDocumentCode })) {
      const receiptEntry = {
        id: `boldsign_${documentId}_${normalizedType}_${target}`,
        name: receiptName,
        documentCode: resolvedDocumentCode,
        status: 'Sent',
        method: 'Experience',
        sentAt,
        recipientEmail: signerEmail,
        sentBy: 'BoldSign',
      }
      answers.document_delivery_log = [receiptEntry, ...parseStoredObject(answers.document_delivery_log, [])]
      answers.document_receipts = upsertDocumentReceipts(answers.document_receipts, [
        {
          name: receiptName,
          documentCode: resolvedDocumentCode,
          status: 'Sent',
          method: 'Experience',
          sentAt,
          recipientEmail: signerEmail,
          sentBy: 'BoldSign',
        },
      ])
    }
    if (target === 'spouse') {
      answers.form8821_spouse_status = answers.form8821_spouse_status || 'launching'
    } else {
      answers.form8821_status = answers.form8821_status || 'launching'
    }
    answers.onboarding_status = String(answers.onboarding_status || '').trim() || 'documents_ready_for_signature'
  }

  if (normalizedType.includes('viewed') || normalizedType.includes('opened')) {
    const viewKey = target === 'spouse' ? 'boldsign_8821_spouse_viewed_at' : 'boldsign_8821_viewed_at'
    answers[viewKey] = getLatestIsoTimestamp(String(answers?.[viewKey] || '').trim(), openedAt)
    markViewedDeliveryEntries(answers, openedAt, receiptName, resolvedDocumentCode)
  }

  if (normalizedType.includes('signed') || normalizedType.includes('completed')) {
    const completionTarget =
      isMfj && usesSharedMfjDocument && normalizedType.includes('completed') && !actorId && !signerOrder ? 'spouse' : target
    await markBoldsign8821Completed({ roomCode, completedDocumentCode: resolvedDocumentCode, target: completionTarget })
    emitDashboardRecordsUpdated({
      reason: 'boldsign_webhook_completed',
      roomCode,
      eventType,
      target: completionTarget,
      documentCode: resolvedDocumentCode,
    })
    return { handled: true, reason: 'completed', roomCode, eventType, target: completionTarget }
  }

  room.state.updatedAt = Date.now()
  try {
    await dbUpsertSession({
      code: roomCode,
      contactId: room.contactId || null,
      opportunityId: room.opportunityId || null,
      state: room.state,
    })
  } catch {
    // ignore; room state is still updated in memory
  }
  emitDashboardRecordsUpdated({ reason: 'boldsign_webhook', roomCode, eventType, target, documentCode: resolvedDocumentCode })
  return { handled: true, reason: 'updated', roomCode, eventType, target }
}

function buildResolutionEmailHtml({ clientName, portalLink }) {
  const safeName = String(clientName || 'Client').trim() || 'Client'
  const safeLink = String(portalLink || '').trim()
  return [
    `<p>Hi ${safeName},</p>`,
    '<p>Your TaxRefresh documents are ready for review in your secure portal.</p>',
    `<p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">Open Secure Portal</a></p>`,
    `<p>If the button does not work, copy and paste this secure link into your browser:<br /><a href="${safeLink}">${safeLink}</a></p>`,
    '<p>Thank you,<br />TaxRefresh</p>',
  ].join('')
}

const BOLDSIGN_RESOLUTION_TEMPLATE_ID_FALLBACK = '91f2ebc9-830d-4c85-9349-63ba0dda3964'
const BOLDSIGN_RESOLUTION_TEMPLATE_ID_SINGLE_FALLBACK = '2b83adc4-7ccd-459c-9ca0-596e9c7b2967'
const RESOLUTION_EA_PROFILE = {
  // Used for Resolution (2848) BoldSign autofill.
  name: 'Caprizio Fornaro',
  address: '23652 Lexington Ct, Laguna Niguel, CA 92677',
  phone: '(949)-590-6731',
  fax: '(941)-340-2146',
  caf: '0317-33812',
  ptin: 'P03152236',
}

function getBoldsignConfig() {
  const apiBase = String(process.env.BOLDSIGN_BASE_URI || 'https://api.boldsign.com').trim().replace(/\/$/, '')
  const apiKey = String(process.env.BOLDSIGN_API_KEY || '').trim()
  const pdfPath = process.env.BOLDSIGN_8821_PDF_PATH?.trim() || new URL('./assets/f8821.pdf', import.meta.url)
  const templateId = String(process.env.BOLDSIGN_8821_TEMPLATE_ID || '').trim()
  // R.E.D packet templates are fixed by filing status (do not override via env).
  const templateIdMfj = BOLDSIGN_8821_TEMPLATE_ID_MFJ_FALLBACK
  const templateIdSingle = BOLDSIGN_8821_TEMPLATE_ID_SINGLE_FALLBACK
  const resolutionTemplateId = String(process.env.BOLDSIGN_RESOLUTION_TEMPLATE_ID || BOLDSIGN_RESOLUTION_TEMPLATE_ID_FALLBACK).trim()
  const resolutionTemplateIdSingle = String(
    process.env.BOLDSIGN_RESOLUTION_TEMPLATE_ID_SINGLE || BOLDSIGN_RESOLUTION_TEMPLATE_ID_SINGLE_FALLBACK,
  ).trim()
  const brandId = String(process.env.BOLDSIGN_BRAND_ID || '').trim()
  const brandIdMfj = String(process.env.BOLDSIGN_BRAND_ID_MFJ || '').trim()
  const brandIdSingle = String(process.env.BOLDSIGN_BRAND_ID_SINGLE || '').trim()
  const hideDocumentId = ['1', 'true', 'yes', 'on'].includes(String(process.env.BOLDSIGN_HIDE_DOCUMENT_ID || '').trim().toLowerCase())

  return {
    apiBase,
    apiKey,
    pdfPath,
    templateId,
    templateIdMfj,
    templateIdSingle,
    resolutionTemplateId,
    resolutionTemplateIdSingle,
    brandId,
    brandIdMfj,
    brandIdSingle,
    hideDocumentId,
    ready: Boolean(apiKey),
  }
}

function summarizeBoldsignRequest({ path = '', query, body } = {}) {
  const normalizedPath = String(path || '').trim()
  const summary = {
    path: normalizedPath,
    query: query && typeof query === 'object' ? { ...query } : {},
  }
  if (!body || typeof body !== 'object') return summary

  if (normalizedPath === 'v1/template/send') {
    summary.body = {
      Title: body.Title,
      DisableEmails: body.DisableEmails,
      EnableEmbeddedSigning: body.EnableEmbeddedSigning,
      EnableSigningOrder: body.EnableSigningOrder,
      roleCount: Array.isArray(body.Roles) ? body.Roles.length : 0,
      roles: Array.isArray(body.Roles)
        ? body.Roles.map((role) => ({
            RoleIndex: role?.RoleIndex,
            SignerName: role?.SignerName,
            SignerEmail: role?.SignerEmail,
            SignerType: role?.SignerType,
            Locale: role?.Locale,
            existingFormFieldCount: Array.isArray(role?.ExistingFormFields) ? role.ExistingFormFields.length : 0,
          }))
        : [],
    }
    return summary
  }

  if (normalizedPath === 'v1/document/getEmbeddedSignLink') {
    summary.body = undefined
    summary.query = {
      documentId: query?.documentId,
      signerEmail: query?.signerEmail,
      redirectUrl: query?.redirectUrl,
    }
    return summary
  }

  if (normalizedPath === 'v1/document/send') {
    summary.body = {
      Title: body.Title,
      DisableEmails: body.DisableEmails,
      AutoDetectFields: body.AutoDetectFields,
      EnableEmbeddedSigning: body.EnableEmbeddedSigning,
      UseTextTags: body.UseTextTags,
      fileCount: Array.isArray(body.Files) ? body.Files.length : 0,
      signers: Array.isArray(body.Signers)
        ? body.Signers.map((signer) => ({
            Name: signer?.Name,
            EmailAddress: signer?.EmailAddress,
            SignerType: signer?.SignerType,
            Locale: signer?.Locale,
          }))
        : [],
    }
    return summary
  }

  summary.body = body
  return summary
}

function getErrorMessageChain(error) {
  const seen = new Set()
  const messages = []
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const nextMessage = String(current.message || current.code || '').trim()
    if (nextMessage) messages.push(nextMessage)
    current = current.cause
  }
  return messages.join(' :: ')
}

function isRetryableBoldsignTransportMessage(message = '') {
  return /connection terminated unexpectedly|fetch failed|socket hang up|other side closed|headers timeout|body timeout|network.*reset|terminated|econnreset|econnrefused|enotfound|etimedout|ehostunreach|und_err_socket|und_err_connect_timeout|eai_again|epipe/i.test(
    String(message || ''),
  )
}

function buildBoldsignTransportError(error, { path, method, query, body }) {
  const transportMessage = getErrorMessageChain(error)
  const wrapped = new Error(
    isRetryableBoldsignTransportMessage(transportMessage)
      ? 'BoldSign connection terminated unexpectedly. Please try again.'
      : transportMessage || 'Failed to reach BoldSign.',
  )
  wrapped.status = 503
  wrapped.retryable = true
  wrapped.cause = error
  wrapped.boldsign = {
    path,
    method,
    transportError: transportMessage,
    request: summarizeBoldsignRequest({ path, query, body }),
  }
  return wrapped
}

function shouldRetryBoldsignError(error) {
  const status = typeof error?.status === 'number' ? error.status : 0
  if (status === 429) return false
  if (status === 408) return true
  if (status >= 500 && status < 600) return true
  if (error?.retryable === true) return true
  return isRetryableBoldsignTransportMessage(getErrorMessageChain(error))
}

async function boldsignFetch(path, { method = 'GET', query, body } = {}) {
  const config = getBoldsignConfig()
  if (!config.ready) {
    throw new Error('BoldSign is not configured. Set BOLDSIGN_API_KEY.')
  }

  const url = new URL(path, `${config.apiBase}/`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  const requestSummary = summarizeBoldsignRequest({ path, query, body })
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          'X-API-KEY': config.apiKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const retryAfterHeader = String(response.headers.get('retry-after') || '').trim()
        const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : 0
        const message =
          data?.error ||
          data?.title ||
          data?.errors?.[0]?.message ||
          data?.errors?.[0] ||
          `BoldSign request failed (${response.status})`
        const error = new Error(message)
        error.status = response.status
        error.retryable = response.status === 408 || (response.status >= 500 && response.status < 600)
        if (retryAfterSeconds) error.retryAfterSeconds = retryAfterSeconds
        if (response.status === 429 || (response.status >= 400 && response.status < 500 && response.status !== 408)) {
          error.noRetry = true
        }
        error.boldsign = {
          path,
          method,
          status: response.status,
          retryAfterSeconds,
          response: data,
          request: requestSummary,
        }
        throw error
      }
      return data
    } catch (error) {
      const normalizedError =
        error?.boldsign || typeof error?.status === 'number'
          ? error
          : buildBoldsignTransportError(error, { path, method, query, body })
      if (!normalizedError?.boldsign) {
        normalizedError.boldsign = {
          path,
          method,
          request: requestSummary,
        }
      }
      if (!shouldRetryBoldsignError(normalizedError) || attempt >= maxAttempts) {
        throw normalizedError
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt))
    }
  }

  throw new Error('BoldSign request failed.')
}

async function boldsignDownloadDocument(documentId, { onBehalfOf } = {}) {
  const config = getBoldsignConfig()
  if (!config.ready) {
    throw new Error('BoldSign is not configured. Set BOLDSIGN_API_KEY.')
  }
  const normalizedDocumentId = String(documentId || '').trim()
  if (!normalizedDocumentId) {
    throw new Error('A BoldSign document id is required.')
  }

  const url = new URL('v1/document/download', `${config.apiBase}/`)
  url.searchParams.set('documentId', normalizedDocumentId)
  if (onBehalfOf) url.searchParams.set('onBehalfOf', String(onBehalfOf).trim())

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/pdf, application/json',
      'X-API-KEY': config.apiKey,
    },
  })

  if (!response.ok) {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    let message = `BoldSign document download failed (${response.status})`
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => ({}))
      message =
        data?.error ||
        data?.title ||
        data?.errors?.[0]?.message ||
        data?.errors?.[0] ||
        message
    } else {
      const text = await response.text().catch(() => '')
      if (text) message = text
    }
    throw new Error(message)
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer())
  return {
    fileBuffer,
    contentType: String(response.headers.get('content-type') || 'application/pdf'),
  }
}

async function getBoldsignDocumentProperties(documentId, { onBehalfOf } = {}) {
  const normalizedDocumentId = String(documentId || '').trim()
  if (!normalizedDocumentId) throw new Error('A BoldSign document id is required.')
  return boldsignFetch('v1/document/properties', {
    query: {
      documentId: normalizedDocumentId,
      ...(onBehalfOf ? { onBehalfOf: String(onBehalfOf).trim() } : {}),
    },
  })
}

const BOLDSIGN_RECONCILE_CACHE_MS = 5 * 60 * 1000

function hasFreshBoldsignReconcileCheck(value = '') {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  const timestamp = new Date(normalized).getTime()
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false
  return Date.now() - timestamp < BOLDSIGN_RECONCILE_CACHE_MS
}

async function reconcileBoldsign8821Status({ roomCode, state, persist } = {}) {
  const roomState = state || initialRoomState()
  const answers = roomState.answers || {}
  const documentId = String(answers.boldsign_8821_document_id || '').trim()
  if (!documentId) return false
  if (isForm8821FullySigned(answers)) return false
  if (hasFreshBoldsignReconcileCheck(answers.boldsign_8821_last_checked_at)) return false

  try {
    const properties = await getBoldsignDocumentProperties(documentId)
    answers.boldsign_8821_last_checked_at = new Date().toISOString()
    const status = String(properties?.status || '').trim().toLowerCase()
    if (status !== 'completed') {
      roomState.answers = answers
      await persist(roomState)
      return false
    }

    answers.form8821_status = 'completed'
    if (isMarriedJointFilingAnswers(answers)) {
      answers.form8821_spouse_status = 'completed'
    }
    answers.onboarding_status = 'documents_signed'
    answers.completed_at = answers.completed_at || new Date().toISOString()
    answers.boldsign_8821_signed_at = answers.boldsign_8821_signed_at || new Date().toISOString()
    markSigned8821DeliveryEntries(answers, answers.boldsign_8821_signed_at, getActive8821DocumentCode(answers))
    roomState.answers = answers
    await persist(roomState)
    emitDashboardRecordsUpdated({ reason: 'boldsign_reconciled_completed', roomCode, documentCode: getActive8821DocumentCode(answers) })
    return true
  } catch (error) {
    console.error('Failed to reconcile BoldSign 8821 status:', error)
    return false
  }
}

async function reconcileBoldsignResolutionStatus({ roomCode, state, persist } = {}) {
  const roomState = state || initialRoomState()
  const answers = roomState.answers || {}
  const documentId = String(answers.boldsign_resolution_document_id || '').trim()
  if (!documentId) return false
  if (String(answers.boldsign_resolution_signed_at || '').trim()) return false
  if (hasFreshBoldsignReconcileCheck(answers.boldsign_resolution_last_checked_at)) return false

  try {
    const properties = await getBoldsignDocumentProperties(documentId, {
      onBehalfOf: String(answers.boldsign_resolution_sender_email || '').trim() || undefined,
    })
    answers.boldsign_resolution_last_checked_at = new Date().toISOString()
    const status = String(properties?.status || '').trim().toLowerCase()
    if (status !== 'completed') {
      roomState.answers = answers
      await persist(roomState)
      return false
    }

    answers.boldsign_resolution_signed_at = new Date().toISOString()
    markSignedResolutionDeliveryEntries(answers, answers.boldsign_resolution_signed_at, documentId)
    roomState.answers = answers
    await persist(roomState)
    emitDashboardRecordsUpdated({ reason: 'boldsign_reconciled_resolution_completed', roomCode, target: 'resolution' })
    return true
  } catch (error) {
    console.error('Failed to reconcile BoldSign resolution status:', error)
    return false
  }
}

async function loadBoldsign8821PdfDataUri() {
  const { pdfPath } = getBoldsignConfig()
  const resolvedPath =
    typeof pdfPath === 'string' && !pdfPath.startsWith('/')
      ? new URL(pdfPath.replace(/^\.\//, './'), new URL('./', import.meta.url))
      : pdfPath
  const file = await readFile(resolvedPath)
  return `data:application/pdf;base64,${file.toString('base64')}`
}

async function getBoldsignEmbeddedSignLink({ documentId, signerEmail, redirectUrl }) {
  const embedded = await retry(
    () =>
      boldsignFetch('v1/document/getEmbeddedSignLink', {
        query: {
          documentId,
          signerEmail,
          redirectUrl,
        },
      }),
    { attempts: 8, delayMs: 1500 },
  )
  return String(embedded?.signLink || '').trim()
}

function formatMmDdYyyy(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function extractLast4(value = '') {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length <= 4 ? digits : digits.slice(-4)
}

function maskedCardLabel(value = '') {
  const last4 = extractLast4(value)
  return last4 ? `**** **** **** ${last4}` : ''
}

function maskedAccountLabel(value = '') {
  const last4 = extractLast4(value)
  return last4 ? `****${last4}` : ''
}

function maskedRoutingLabel(value = '') {
  const last4 = extractLast4(value)
  return last4 ? `*****${last4}` : ''
}

function getSpouseSignerEmailFromAnswers(answers = {}) {
  const direct = String(getPrimaryAnswer(answers, ['spouse_email', 'spouseEmail', 'spouse_email_address', 'spouseEmailAddress']) || '').trim()
  if (isValidEmailAddress(direct)) return direct
  const logEntries = Array.isArray(answers.document_email_log) ? answers.document_email_log : parseStoredObject(answers.document_email_log, [])
  const targetLog = Array.isArray(logEntries)
    ? logEntries.find((entry) => String(entry?.documentType || '').trim() === '8821 Spouse')
    : null
  const fallback = String(targetLog?.recipientEmail || '').trim()
  return isValidEmailAddress(fallback) ? fallback : ''
}

function buildEmbeddedSignerAlias(email = '', suffix = 'spouse') {
  const normalized = String(email || '').trim().toLowerCase()
  if (!isValidEmailAddress(normalized)) return normalized
  const atIndex = normalized.lastIndexOf('@')
  if (atIndex <= 0) return normalized
  const local = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1)
  return `${local}+${suffix}@${domain}`
}

function resolveBoldsignSignerEmail(email = '', { target = 'client', primaryEmail = '' } = {}) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized
}

function getStoredBoldsignSpouseSignerEmail(answers = {}, { clientEmail = '' } = {}) {
  const stored = String(answers.boldsign_8821_spouse_signer_email || '').trim().toLowerCase()
  if (isValidEmailAddress(stored)) return stored
  return resolveBoldsignSignerEmail(getSpouseSignerEmailFromAnswers(answers), { target: 'spouse', primaryEmail: clientEmail })
}

function getNormalizedSpouseName(answers = {}) {
  const first = String(getPrimaryAnswer(answers, ['spouse_first_name', 'spouseFirstName']) || '').trim()
  const last = String(getPrimaryAnswer(answers, ['spouse_last_name', 'spouseLastName']) || '').trim()
  const combined = [first, last].filter(Boolean).join(' ').trim()
  if (combined) return combined
  return String(getPrimaryAnswer(answers, ['spouse_full_name', 'spouseFullName', 'spouse_name']) || '').trim()
}

function getSpouseSignerNameFromAnswers(answers = {}) {
  return getNormalizedSpouseName(answers) || 'Spouse'
}

function buildBoldsignExistingFormFieldsFromAnswers(answers = {}, { sentDateLabel = '' } = {}) {
  const context = getRedPacketRenderContext(answers)
  const isMarriedJoint = isMarriedJointFilingAnswers(answers)
  const fullName = [String(context.firstName || '').trim(), String(context.lastName || '').trim()].filter(Boolean).join(' ')

  const spouseFirstName = isMarriedJoint ? String(context.spouseFirstName || '').trim() : ''
  const spouseLastName = isMarriedJoint ? String(context.spouseLastName || '').trim() : ''
  const spouseFullName = [spouseFirstName, spouseLastName].filter(Boolean).join(' ')

  const mailingFull = [String(context.mailingAddress || '').trim(), String(context.mailingCity || '').trim(), String(context.mailingState || '').trim(), String(context.mailingZip || '').trim()]
    .filter(Boolean)
    .join(', ')

  const physicalStreet = String(context.physicalAddress || '').trim()
  const physicalCity = String(context.city || '').trim()
  const physicalState = String(context.stateCode || '').trim()
  const physicalZip = String(context.zipCode || '').trim()

  const paymentKind = String(context.primaryPaymentMethodKind || '').trim().toLowerCase()
  const isCard = paymentKind === 'card'
  const isBank = paymentKind === 'bank'

  const showSchedule = Boolean(context.showPaymentScheduleFields)

  const effectiveInvoiceAmount = Number(context.effectiveInvoiceAmount || 0)
  const discountActive = effectiveInvoiceAmount === 375
  const redYearsOwedAutofill = '2016-2026'

  const clientFields = {
    // Client identity
    Client_First_Name: String(context.firstName || '').trim(),
    Client_Last_Name: String(context.lastName || '').trim(),
    Client_Middle_Name: String(getPrimaryAnswer(answers, ['middle_name', 'middleName', 'client_middle_name']) || '').trim(),
    Client_Full_Name: fullName,
    Client_Full_Name2: fullName,
    Client_Full_Name3: fullName,
    Client_Full_Name4: fullName,
    Client_Full_Name5: fullName,
    Client_Email: String(context.email || '').trim(),
    Client_Phone_Number: String(context.phone || '').trim(),
    Client_Phone_Number2: String(context.phone || '').trim(),
    Work_Phone: String(context.businessWorkPhone || '').trim(),
    Client_SSN: String(context.ssn || '').trim(),
    Client_SSN2: String(context.ssn || '').trim(),
    Client_DOB: String(context.dob || '').trim(),

    // Addresses (physical + mailing)
    Client_Address: physicalStreet,
    Client_City: physicalCity,
    Client_State: physicalState,
    Client_ZIP: physicalZip,
    Client_Address2: physicalStreet,
    Client_City2: physicalCity,
    Client_State2: physicalState,
    Client_ZIP2: physicalZip,
    Client_Mailing_Address: mailingFull,

    // Business
    Business_Name: String(context.businessName || '').trim(),
    Business_EIN: String(context.businessEin || '').trim(),

    // Tax/plan
    Tax_Type: String(context.taxTypeLabel || '').trim(),
    Tax_Agency: String(context.taxAgencyLabel || '').trim(),
    Years_Owed: redYearsOwedAutofill,
    Years_Owed_Unfiled: String(context.unfiledYearsLabel || '').trim(),
    Estimated_Tax_Liability: String(context.estimatedLiabilityLabel || '').trim(),
    Specific_Tax_Matters: 'Record of Account transcripts,\nWage and income transcripts',

    // Payment (masked)
    Card_Type: isCard ? String(context.paymentCardTypeLabel || '').trim() : '',
    Cardholder_Name: isCard ? String(context.paymentCardholderNameLabel || '').trim() : '',
    Card_Number: isCard ? maskedCardLabel(context.paymentCardNumberLabel || '') : '',
    Card_On_File: isCard ? 'Yes' : '',
    Card_On_File2: isCard ? 'Yes' : '',
    Card_Expiration_Date: isCard ? String(context.paymentCardExpirationLabel || '').trim() : '',

    Bank_Name: isBank ? String(context.paymentBankNameLabel || '').trim() : '',
    Bank_Account_Name: isBank ? String(context.paymentAccountHolderNameLabel || '').trim() : '',
    Bank_Account_Number: isBank ? maskedAccountLabel(context.paymentAccountNumberLabel || '') : '',
    Bank_Routing_Number: isBank ? maskedRoutingLabel(context.paymentRoutingNumberLabel || '') : '',

    // Payment schedule (up to 3)
    Payment_Schedule_Date: showSchedule ? String(context.billingScheduleDate1Label || '').trim() : '',
    Payment_Scheduled_Amount: showSchedule ? String(context.billingScheduleAmount1Label || '').trim() : '',
    Payment_Schedule_Date2: showSchedule ? String(context.billingScheduleDate2Label || '').trim() : '',
    Payment_Scheduled_Amount2: showSchedule ? String(context.billingScheduleAmount2Label || '').trim() : '',
    Payment_Schedule_Date3: showSchedule ? String(context.billingScheduleDate3Label || '').trim() : '',
    Payment_Scheduled_Amount3: showSchedule ? String(context.billingScheduleAmount3Label || '').trim() : '',

    // Discount text block
    Discount_1: discountActive ? 'DISCARD' : '',
    Discount_2: discountActive ? 'DISCARD' : '',
    Discount_3: discountActive ? 'DISCARD' : '',
    Discount_4: discountActive ? '$375' : '',
    Discount_5: discountActive ? '$375' : '',
    Discount_6: discountActive ? '$375' : '',
  }

  const spouseFields = {
    Spouse_First_Name: spouseFirstName,
    Spouse_Last_Name: spouseLastName,
    Spouse_SSN: isMarriedJoint ? String(context.spouseSsn || '').trim() : '',
    Spouse_DOB: isMarriedJoint ? String(context.spouseDob || '').trim() : '',
    Spouse_Phone_Number: isMarriedJoint ? String(context.spousePhone || '').trim() : '',
    Spouse_mailing_address: isMarriedJoint ? String(context.spouseMailingAddress || '').trim() : '',
    Spouse_Full_Name: isMarriedJoint ? String(context.spouseFullName || '').trim() : '',
    Spouse_SSN2: isMarriedJoint ? String(context.spouseSsn || '').trim() : '',
    Spouse_Phone_Number2: isMarriedJoint ? String(context.spousePhone || '').trim() : '',
    Spouse_full_name: isMarriedJoint ? String(context.spouseFullName || '').trim() : '',
    Spouse_Years_Owed: isMarriedJoint ? redYearsOwedAutofill : '',
  }

  return {
    clientFields: Object.entries(clientFields).map(([Id, Value]) => ({ Id, Value: String(Value ?? '') })),
    spouseFields: Object.entries(spouseFields).map(([Id, Value]) => ({ Id, Value: String(Value ?? '') })),
  }
}

function getResolutionTaxFormLabel(taxTypeValue = '') {
  const normalized = String(taxTypeValue || '').trim().toLowerCase()
  if (normalized === 'business') return '1120'
  if (normalized === 'both') return '1040, 1120'
  return '1040'
}

function buildBoldsignResolutionExistingFormFieldsFromAnswers(answers = {}) {
  const context = getRedPacketRenderContext(answers)
  const isMarriedJoint = isMarriedJointFilingAnswers(answers)
  const fullName = [String(context.firstName || '').trim(), String(context.lastName || '').trim()].filter(Boolean).join(' ')
  const mailingFull = [
    String(context.mailingAddress || '').trim(),
    String(context.mailingCity || '').trim(),
    String(context.mailingState || '').trim(),
    String(context.mailingZip || '').trim(),
  ]
    .filter(Boolean)
    .join(', ')
  const clientStreet = String(context.physicalAddress || '').trim()
  const clientCity = String(context.city || '').trim()
  const clientState = String(context.stateCode || '').trim()
  const clientZip = String(context.zipCode || '').trim()
  const clientPhone = String(context.phone || '').trim()
  const clientEmail = String(context.email || '').trim()
  const clientSsn = String(context.ssn || '').trim()
  const clientDob = String(context.dob || '').trim()

  const spouseFullName = isMarriedJoint ? String(context.spouseFullName || '').trim() : ''
  const spouseFirstName = isMarriedJoint ? String(context.spouseFirstName || '').trim() : ''
  const spouseLastName = isMarriedJoint ? String(context.spouseLastName || '').trim() : ''
  const spouseMailingAddress = isMarriedJoint ? String(context.spouseMailingAddress || '').trim() : ''
  const spouseSsn = isMarriedJoint ? String(context.spouseSsn || '').trim() : ''
  const spousePhone = isMarriedJoint ? String(context.spousePhone || '').trim() : ''
  const spouseDob = isMarriedJoint ? String(context.spouseDob || '').trim() : ''

  const taxTypeLabel = String(context.taxTypeLabel || '').trim()
  const taxAgencyLabel = String(context.taxAgencyLabel || '').trim()
  const yearsOwedLabel = String(context.unfiledYearsLabel || '').trim()
  const taxBalanceLabel = String(context.estimatedLiabilityLabel || '').trim()
  const resolutionCostLabel = formatUsdLabel(Number(context.effectiveInvoiceAmount || 0))
  const taxFormLabel = getResolutionTaxFormLabel(context.taxTypeValue || getPrimaryAnswer(answers, ['taxType']) || '')
  const cafValue = String(getPrimaryAnswer(answers, ['ea_caf_number', 'irs_caf_number', 'caf_number']) || RESOLUTION_EA_PROFILE.caf).trim()

  const clientFields = {
    Client_Full_Name: fullName,
    Client_Mailing_Address: mailingFull,
    Client_SSN: clientSsn,
    Client_Phone_Number: clientPhone,
    Enrolled_Agent_Fax: RESOLUTION_EA_PROFILE.fax,
    Enrolled_Agent_Name: RESOLUTION_EA_PROFILE.name,
    Enrolled_Agent_Address: RESOLUTION_EA_PROFILE.address,
    Enrolled_Agent_CAF: cafValue,
    Enrolled_Agent_PTIN: RESOLUTION_EA_PROFILE.ptin,
    Enrolled_Agent_Phone: RESOLUTION_EA_PROFILE.phone,
    Tax_Type: 'Income',
    Tax_Form: '1040',
    Years_Owed: '2016-2026',
    Client_Full_Name2: fullName,
    Client_Full_Name4: fullName,
    Client_Last_Name: String(context.lastName || '').trim(),
    Client_First_Name: String(context.firstName || '').trim(),
    Client_DOB: clientDob,
    Client_Address: clientStreet,
    Client_City: clientCity,
    Client_State: clientState,
    Client_Zip_Code: clientZip,
    Client_Email: clientEmail,
    Client_Phone_Number2: clientPhone,
    Tax_Agency: taxAgencyLabel,
    Tax_Type3: taxTypeLabel,
    Years_Owed3: yearsOwedLabel,
    Tax_Balance: taxBalanceLabel,
    Resolution_Cost: resolutionCostLabel,
    Years_Owed4: yearsOwedLabel,
    Resolution_Cost2: resolutionCostLabel,
    Client_Full_Name3: fullName,
    Client_Full_Name5: fullName,
  }

  const spouseFields = {
    Spouse_Full_Name: spouseFullName,
    Spouse_Mailing_address: spouseMailingAddress,
    Spouse_SSN: spouseSsn,
    Spouse_Phone_Number: spousePhone,
    Spouse_Full_Name2: spouseFullName,
    Spouse_Last_Name: spouseLastName,
    Spouse_First_name: spouseFirstName,
    Spouse_DOB: spouseDob,
    Spouse_Full_Name3: spouseFullName,
    Spouse_Full_Name4: spouseFullName,
  }

  return {
    clientFields: Object.entries(clientFields).map(([Id, Value]) => ({ Id, Value: String(Value ?? '') })),
    spouseFields: Object.entries(spouseFields).map(([Id, Value]) => ({ Id, Value: String(Value ?? '') })),
  }
}

async function createBoldsignResolutionSigningLink({
  sessionCode,
  signerName,
  signerEmail,
  spouseSignerEmail = '',
  spouseSignerName = '',
  onBehalfOf = '',
  disableEmails = false,
  persistDocument = true,
  documentFieldPrefix = 'boldsign_resolution',
} = {}) {
  const normalizedSessionCode = String(sessionCode || '').trim()
  if (!normalizedSessionCode) throw new Error('sessionCode is required')

  const roomState = await getSessionStateForCode(normalizedSessionCode)
  if (!roomState) throw new Error('Session not found')

  const answers = roomState.answers || {}
  const resolvedSignerName = String(signerName || getPrimaryAnswer(answers, ['full_name', 'name']) || 'TaxRefresh Client').trim()
  const resolvedSignerEmail = String(signerEmail || getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
  if (!resolvedSignerEmail) throw new Error('A client email is required before launching the resolution document.')

  const boldsignConfig = getBoldsignConfig()
  const isMarriedJoint = isMarriedJointFilingAnswers(answers)
  // Resolution documents only need a spouse signer for MFJ. For all other filing
  // statuses (including when filing status hasn't been set yet), use the single-signer template.
  const resolutionTemplateId = isMarriedJoint
    ? String(boldsignConfig.resolutionTemplateId || '').trim()
    : String(boldsignConfig.resolutionTemplateIdSingle || boldsignConfig.resolutionTemplateId || '').trim()
  if (!resolutionTemplateId) throw new Error('The BoldSign resolution template is not configured yet.')

  const selectedBrandId = isMarriedJoint
    ? String(boldsignConfig.brandIdMfj || boldsignConfig.brandId || '').trim()
    : String(boldsignConfig.brandIdSingle || boldsignConfig.brandId || '').trim()
  const hideDocumentId = Boolean(boldsignConfig.hideDocumentId)
  const spouseEmail = isMarriedJoint ? String(spouseSignerEmail || getSpouseSignerEmailFromAnswers(answers) || '').trim() : ''
  const spouseSignerEmailForBoldsign = isMarriedJoint
    ? resolveBoldsignSignerEmail(spouseEmail, { target: 'spouse', primaryEmail: resolvedSignerEmail })
    : ''
  const spouseName = isMarriedJoint ? String(spouseSignerName || getSpouseSignerNameFromAnswers(answers) || '').trim() : ''
  if (isMarriedJoint && !isValidEmailAddress(spouseEmail)) {
    throw new Error('Spouse email is required for married filing jointly resolution documents.')
  }

  const { clientFields: existingClientFormFields, spouseFields: existingSpouseFormFields } = buildBoldsignResolutionExistingFormFieldsFromAnswers(answers)

  const sendResult = await boldsignFetch('v1/template/send', {
    method: 'POST',
    query: { templateId: resolutionTemplateId },
    body: {
      Title: 'TaxRefresh Resolution Documents',
      Message: '',
      ...(selectedBrandId ? { BrandId: selectedBrandId } : {}),
      ...(hideDocumentId ? { HideDocumentId: true } : {}),
      DisableEmails: disableEmails,
      EnableEmbeddedSigning: true,
      EnableSigningOrder: isMarriedJoint,
      ...(isMarriedJoint
        ? {
            Roles: [
              {
                RoleIndex: 1,
                SignerName: resolvedSignerName,
                SignerEmail: resolvedSignerEmail,
                SignerOrder: 1,
                SignerType: 'Signer',
                Locale: 'EN',
                ExistingFormFields: existingClientFormFields,
              },
              {
                RoleIndex: 2,
                SignerName: spouseName || 'Spouse',
                SignerEmail: spouseSignerEmailForBoldsign,
                SignerOrder: 2,
                SignerType: 'Signer',
                Locale: 'EN',
                ExistingFormFields: existingSpouseFormFields,
              },
            ],
          }
        : {
            Roles: [
              {
                RoleIndex: 1,
                SignerName: resolvedSignerName,
                SignerEmail: resolvedSignerEmail,
                SignerType: 'Signer',
                Locale: 'EN',
                ExistingFormFields: existingClientFormFields,
              },
            ],
          }),
    },
  })

  const documentId = String(
    sendResult?.documentId ||
      sendResult?.DocumentId ||
      (Array.isArray(sendResult?.documentIds) ? sendResult.documentIds[0] : '') ||
      sendResult?.data?.documentId ||
      sendResult?.data?.id ||
      sendResult?.id ||
      '',
  ).trim()
  if (!documentId) throw new Error('BoldSign did not return a documentId for the resolution document.')

  if (persistDocument) {
    const room = await ensureRoom(normalizedSessionCode)
    room.state.answers[`${documentFieldPrefix}_document_id`] = documentId
    room.state.answers[`${documentFieldPrefix}_file_name`] = 'TaxRefresh Resolution Documents.pdf'
    room.state.answers[`${documentFieldPrefix}_sent_at`] = new Date().toISOString()
    room.state.answers[`${documentFieldPrefix}_sender_email`] = String(onBehalfOf || '').trim()
    if (isMarriedJoint) {
      room.state.answers[`${documentFieldPrefix}_spouse_signer_email`] = spouseSignerEmailForBoldsign
    }
    room.state.updatedAt = Date.now()
    try {
      await dbUpsertSession({ code: normalizedSessionCode, state: room.state })
    } catch {
      // ignore; room state still updates in-memory
    }
  }

  return { documentId, spouseSignerEmail: spouseSignerEmailForBoldsign }
}

async function createBoldsign8821SigningLink({
  sessionCode,
  signerName,
  signerEmail,
  returnUrl = '',
  onBehalfOf = '',
  disableEmails = true,
  persistDocument = true,
  documentFieldPrefix = 'boldsign_8821',
  spouseSignerEmail = '',
  spouseSignerName = '',
  forceNewDocument = false,
  createReceiptOnCreate = false,
  receiptRecipientEmail = '',
  target = 'client',
} = {}) {
  const normalizedSessionCode = String(sessionCode || '').trim()
  if (!normalizedSessionCode) throw new Error('sessionCode is required')
  logMemoryDiagnostics('createBoldsign8821SigningLink:start', {
    sessionCode: normalizedSessionCode,
    forceNewDocument: Boolean(forceNewDocument),
    createReceiptOnCreate: Boolean(createReceiptOnCreate),
    target: String(target || 'client'),
  })

  const roomState = await getSessionStateForCode(normalizedSessionCode)
  if (!roomState) throw new Error('Session not found')

  const answers = roomState.answers || {}
  const resolvedSignerName = String(
    signerName || getPrimaryAnswer(answers, ['full_name', 'name']) || 'TaxRefresh Client',
  ).trim()
  const resolvedSignerEmail = String(
    signerEmail || getPrimaryAnswer(answers, ['email', 'email_address']) || '',
  ).trim()
  if (!resolvedSignerEmail) throw new Error('A client email is required before launching Form 8821 signing.')

  let resolvedReturnUrl = String(returnUrl || '').trim()
  if (!resolvedReturnUrl) {
    const base = safeOrigin(PUBLIC_BASE_URL) || safeOrigin(CLIENT_ORIGIN.split(',')[0]) || ''
    if (!base) throw new Error('A valid returnUrl is required.')
    resolvedReturnUrl = `${base}/session/preparing-documents?session=${encodeURIComponent(normalizedSessionCode)}&boldsign=complete`
  }

  const boldsignConfig = getBoldsignConfig()
  const isMarriedJoint = isMarriedJointFilingAnswers(answers)
  const isSingleFiling = isSingleFilingAnswers(answers)
  // R.E.D packet: only two templates matter (MFJ vs non-MFJ).
  // Treat anything not explicitly MFJ as the single template so we never fall back to a stale default template id.
  const selectedTemplateId = isMarriedJoint
    ? String(boldsignConfig.templateIdMfj || '').trim()
    : String(boldsignConfig.templateIdSingle || '').trim()
  const selectedBrandId = isMarriedJoint
    ? String(boldsignConfig.brandIdMfj || boldsignConfig.brandId || '').trim()
    : isSingleFiling
      ? String(boldsignConfig.brandIdSingle || boldsignConfig.brandId || '').trim()
      : String(boldsignConfig.brandId || '').trim()
  const hideDocumentId = Boolean(boldsignConfig.hideDocumentId)
  const isTemplateConfigured = Boolean(selectedTemplateId)
  const spouseEmail = isMarriedJoint ? String(spouseSignerEmail || getSpouseSignerEmailFromAnswers(answers) || '').trim() : ''
  const spouseSignerEmailForBoldsign = isMarriedJoint
    ? resolveBoldsignSignerEmail(spouseEmail, { target: 'spouse', primaryEmail: resolvedSignerEmail })
    : ''
  const spouseName = isMarriedJoint ? String(spouseSignerName || getSpouseSignerNameFromAnswers(answers) || '').trim() : ''
  if (isTemplateConfigured && isMarriedJoint && !isValidEmailAddress(spouseEmail)) {
    throw new Error('Spouse email is required for married filing jointly signing.')
  }

  const sendDateLabel = formatMmDdYyyy(new Date())
  const { clientFields: existingClientFormFields, spouseFields: existingSpouseFormFields } = buildBoldsignExistingFormFieldsFromAnswers(answers, { sentDateLabel: sendDateLabel })

  const existingDocumentId = String(answers?.[`${documentFieldPrefix}_document_id`] || '').trim()
  const shouldReuseExistingDocument = !forceNewDocument && Boolean(existingDocumentId) && !isForm8821FullySigned(answers)

  let documentId = ''
  if (shouldReuseExistingDocument) {
    documentId = existingDocumentId
  } else {
    const sendResult = isTemplateConfigured
      ? await boldsignFetch('v1/template/send', {
          method: 'POST',
          query: { templateId: selectedTemplateId },
          body: {
            Title: 'TaxRefresh R.E.D Packet',
            Message: '',
            ...(selectedBrandId ? { BrandId: selectedBrandId } : {}),
            ...(hideDocumentId ? { HideDocumentId: true } : {}),
            DisableEmails: disableEmails,
            EnableEmbeddedSigning: true,
            EnableSigningOrder: isMarriedJoint,
            ...(isMarriedJoint
              ? {
                  Roles: [
                    {
                      RoleIndex: 1,
                      SignerName: resolvedSignerName,
                      SignerEmail: resolvedSignerEmail,
                      SignerOrder: 1,
                      SignerType: 'Signer',
                      Locale: 'EN',
                      ExistingFormFields: existingClientFormFields,
                    },
                    {
                      RoleIndex: 2,
                      SignerName: spouseName || 'Spouse',
                      SignerEmail: spouseSignerEmailForBoldsign,
                      SignerOrder: 2,
                      SignerType: 'Signer',
                      Locale: 'EN',
                      ExistingFormFields: existingSpouseFormFields,
                    },
                  ],
                }
              : {
                  Roles: [
                    {
                      RoleIndex: 1,
                      SignerName: resolvedSignerName,
                      SignerEmail: resolvedSignerEmail,
                      SignerType: 'Signer',
                      Locale: 'EN',
                      ExistingFormFields: existingClientFormFields,
                    },
                  ],
                }),
          },
        })
      : await (async () => {
          const pdfDataUri = await loadBoldsign8821PdfDataUri()
          return boldsignFetch('v1/document/send', {
            method: 'POST',
            body: {
              Title: 'Form 8821 - Tax Information Authorization',
              Message: '',
              ...(selectedBrandId ? { BrandId: selectedBrandId } : {}),
              ...(hideDocumentId ? { HideDocumentId: true } : {}),
              DisableEmails: disableEmails,
              AutoDetectFields: true,
              EnableEmbeddedSigning: true,
              UseTextTags: false,
              Files: [
                {
                  base64: pdfDataUri,
                  fileName: 'Taxrefresh Form 8821.pdf',
                },
              ],
              Signers: [
                {
                  Name: resolvedSignerName,
                  EmailAddress: resolvedSignerEmail,
                  SignerType: 'Signer',
                  Locale: 'EN',
                },
              ],
            },
          })
        })

    documentId = String(
      sendResult?.documentId ||
        sendResult?.DocumentId ||
        (Array.isArray(sendResult?.documentIds) ? sendResult.documentIds[0] : '') ||
        sendResult?.data?.documentId ||
        sendResult?.data?.id ||
        sendResult?.id ||
        '',
    ).trim()
    logMemoryDiagnostics('createBoldsign8821SigningLink:after-document-create', {
      sessionCode: normalizedSessionCode,
      documentId,
      target: String(target || 'client'),
    })
  }
  if (!documentId) throw new Error('BoldSign did not return a documentId.')

  if (persistDocument) {
    const room = await ensureRoom(normalizedSessionCode)
    if (!shouldReuseExistingDocument) {
      const normalizedTarget = String(target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
      const nextReceiptEmail = String(receiptRecipientEmail || resolvedSignerEmail || '').trim()
      const nextSentAt = new Date().toISOString()
      const nextDocumentCode = String(room.state.answers.active_8821_document_code || room.state.answers.current_8821_document_code || '').trim() || createDocumentInstanceCode('red')
      room.state.answers[`${documentFieldPrefix}_document_id`] = documentId
      room.state.answers[`${documentFieldPrefix}_file_name`] = isTemplateConfigured ? 'TaxRefresh R.E.D Packet.pdf' : 'TaxRefresh Form 8821.pdf'
      room.state.answers[`${documentFieldPrefix}_sent_at`] = nextSentAt
      room.state.answers[`${documentFieldPrefix}_sender_email`] = String(onBehalfOf || '').trim()
      if (isTemplateConfigured && isMarriedJoint) {
        room.state.answers.boldsign_8821_spouse_signer_email = spouseSignerEmailForBoldsign
      }
      if (createReceiptOnCreate) {
        room.state.answers.current_8821_document_code = nextDocumentCode
        room.state.answers.active_8821_document_code = nextDocumentCode
        if (normalizedTarget === 'spouse') {
          room.state.answers.form8821_spouse_status = 'launching'
        } else {
          room.state.answers.form8821_status = 'launching'
        }
        room.state.answers.onboarding_status = 'documents_ready_for_signature'
        const receiptName = normalizedTarget === 'spouse' ? '8821 Spouse' : '8821 Document'
        room.state.answers.document_receipts = upsertDocumentReceipts(room.state.answers.document_receipts, [
          {
            name: receiptName,
            documentCode: nextDocumentCode,
            status: 'Sent',
            method: 'Experience',
            sentAt: nextSentAt,
            recipientEmail: nextReceiptEmail,
            sentBy: 'Experience',
          },
        ])
        room.state.answers.document_delivery_log = [
          {
            id: `doc_delivery_${Date.now().toString(36)}_${normalizedTarget}`,
            name: receiptName,
            documentCode: nextDocumentCode,
            status: 'Sent',
            method: 'Experience',
            sentAt: nextSentAt,
            recipientEmail: nextReceiptEmail,
            sentBy: 'Experience',
          },
          ...parseStoredObject(room.state.answers.document_delivery_log, []),
        ]
        const hiddenReceiptNames = parseStoredObject(room.state.answers.hidden_document_receipt_names, []).filter(
          (name) => typeof name === 'string' && name.trim(),
        )
        room.state.answers.hidden_document_receipt_names = hiddenReceiptNames.filter((name) => String(name || '').trim() !== receiptName)
      }
      room.state.updatedAt = Date.now()
      io.to(normalizedSessionCode).emit('room_state', room.state)
      try {
        await dbUpsertSession({ code: normalizedSessionCode, state: room.state })
      } catch {
        // ignore; room state still updates in-memory
      }
      if (createReceiptOnCreate) {
        emitDashboardRecordsUpdated({
          reason: 'experience_document_sent',
          sessionCode: normalizedSessionCode,
          target: normalizedTarget,
          documentCode: nextDocumentCode,
        })
      }
    }
  }

  try {
    const embeddedSignerEmail =
      String(target || 'client').trim().toLowerCase() === 'spouse' && spouseSignerEmailForBoldsign
        ? spouseSignerEmailForBoldsign
        : resolvedSignerEmail
    return {
      documentId,
      spouseSignerEmail: spouseSignerEmailForBoldsign,
      signingUrl: await getBoldsignEmbeddedSignLink({
        documentId,
        signerEmail: embeddedSignerEmail,
        redirectUrl: resolvedReturnUrl,
      }),
    }
  } catch (error) {
    logMemoryDiagnostics('createBoldsign8821SigningLink:error', {
      sessionCode: normalizedSessionCode,
      documentId,
      target: String(target || 'client'),
      message: String(error?.message || ''),
    })
    if (shouldReuseExistingDocument && isBoldsignCompletedDocumentError(error)) {
      const room = await ensureRoom(normalizedSessionCode)
      room.state.answers[`${documentFieldPrefix}_document_id`] = ''
      room.state.answers[`${documentFieldPrefix}_file_name`] = ''
      room.state.answers[`${documentFieldPrefix}_sent_at`] = ''
      room.state.answers[`${documentFieldPrefix}_sender_email`] = ''
      room.state.updatedAt = Date.now()
      io.to(normalizedSessionCode).emit('room_state', room.state)
      try {
        await dbUpsertSession({ code: normalizedSessionCode, state: room.state })
      } catch {
        // ignore; room state still updates in-memory
      }
      return createBoldsign8821SigningLink({
        sessionCode: normalizedSessionCode,
        signerName: resolvedSignerName,
        signerEmail: resolvedSignerEmail,
        returnUrl: resolvedReturnUrl,
        onBehalfOf,
        persistDocument,
        documentFieldPrefix,
        spouseSignerEmail: spouseEmail,
        spouseSignerName: spouseName,
        forceNewDocument: true,
      })
    }
    throw error
  }
}

async function retry(fn, { attempts = 8, delayMs = 1200 } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (error?.noRetry || error?.status === 429) break
      if (attempt >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

function getSyncAnswers(room) {
  const answers = room?.state?.answers || {}
  return {
    onboardingStatus: String(answers.onboarding_status || ''),
    form8821Status: String(answers.form8821_status || ''),
    completedAt: String(answers.completed_at || ''),
    name: getPrimaryAnswer(answers, ['full_name', 'name']),
    email: getPrimaryAnswer(answers, ['email', 'email_address']),
    phone: getPrimaryAnswer(answers, ['phone', 'phone_number']),
  }
}

function shouldSyncPatchToGhl(patch) {
  if (!patch || typeof patch !== 'object') return false
  if (patch.type === 'setRoute') return true
  if (patch.type !== 'setAnswer' || typeof patch.questionId !== 'string') return false
  return ['onboarding_status', 'form8821_status', 'completed_at'].includes(patch.questionId)
}

let ghlContactFieldCache = null
let ghlOpportunityFieldCache = null

function hasDirectGhlConfig() {
  return Boolean(GHL_API_BASE_URL && GHL_PRIVATE_INTEGRATION_TOKEN && GHL_LOCATION_ID)
}

async function ghlFetch(path, { method = 'GET', version = 'v3', query, body } = {}) {
  if (!hasDirectGhlConfig()) {
    throw new Error('Direct GHL API sync is not configured. Set GHL_API_BASE_URL, GHL_PRIVATE_INTEGRATION_TOKEN, and GHL_LOCATION_ID.')
  }

  const url = new URL(path, `${GHL_API_BASE_URL}/`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${GHL_PRIVATE_INTEGRATION_TOKEN}`,
      version,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const rawMessage = data?.message
    const message =
      (Array.isArray(rawMessage) ? rawMessage[0] : rawMessage) ||
      data?.error ||
      `GHL request failed (${response.status})`
    throw new Error(message)
  }
  return data
}

async function calendlyFetch(path, { method = 'GET', query, body } = {}) {
  if (!isCalendlyReady()) {
    throw new Error('Calendly is not configured. Set CALENDLY_PERSONAL_ACCESS_TOKEN to enable scheduling sync.')
  }
  const url = new URL(path, `${CALENDLY_API_BASE_URL}/`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${CALENDLY_PERSONAL_ACCESS_TOKEN}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      data?.title ||
      data?.message ||
      data?.error ||
      data?.details?.[0]?.message ||
      `Calendly request failed (${response.status})`
    throw new Error(message)
  }
  return data
}

async function getCalendlyIdentity(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && calendlyIdentityCache.resource && now - calendlyIdentityCache.fetchedAt < 10 * 60 * 1000) {
    return calendlyIdentityCache.resource
  }
  const data = await calendlyFetch('/users/me')
  const resource = data?.resource || {}
  calendlyIdentityCache = {
    fetchedAt: now,
    resource,
  }
  return resource
}

function normalizeCalendlyEventType(item = {}) {
  return {
    uri: normalizeCalendlyUri(item?.uri),
    name: String(item?.name || '').trim(),
    schedulingUrl: String(item?.scheduling_url || '').trim(),
    slug: String(item?.slug || '').trim(),
    duration: Number(item?.duration || 0) || 0,
    active: item?.active !== false,
    poolingType: String(item?.pooling_type || '').trim(),
    kind: String(item?.kind || '').trim(),
    color: String(item?.color || '').trim(),
  }
}

async function listCalendlyEventTypes() {
  const identity = await getCalendlyIdentity()
  const userUri = normalizeCalendlyUri(identity?.uri)
  const data = await calendlyFetch('/event_types', {
    query: {
      user: userUri,
      count: 100,
    },
  })
  const collection = Array.isArray(data?.collection) ? data.collection : []
  const allowedUris = new Set(CALENDLY_EVENT_TYPE_URIS.map((value) => normalizeCalendlyUri(value)))
  return collection
    .map((item) => normalizeCalendlyEventType(item))
    .filter((item) => item.active)
    .filter((item) => !allowedUris.size || allowedUris.has(item.uri))
}

function extractCalendlyUuidFromUri(value = '') {
  const raw = String(value || '').trim()
  const match = raw.match(/\/([^/]+)$/)
  return match ? match[1] : raw
}

async function listCalendlyScheduledEvents({ minStartTime = '', maxStartTime = '', status = '' } = {}) {
  const identity = await getCalendlyIdentity()
  const organizationUri = normalizeCalendlyUri(identity?.current_organization || identity?.organization)
  const userUri = normalizeCalendlyUri(identity?.uri)
  const data = await calendlyFetch('/scheduled_events', {
    query: {
      organization: organizationUri,
      user: userUri,
      min_start_time: minStartTime,
      max_start_time: maxStartTime,
      status,
      sort: 'start_time:asc',
      count: 100,
    },
  })
  return Array.isArray(data?.collection) ? data.collection : []
}

async function listCalendlyEventInvitees(eventUri = '') {
  const uuid = extractCalendlyUuidFromUri(eventUri)
  if (!uuid) return []
  const data = await calendlyFetch(`/scheduled_events/${encodeURIComponent(uuid)}/invitees`, {
    query: { count: 100 },
  })
  return Array.isArray(data?.collection) ? data.collection : []
}

function buildCalendlyAppointmentFromEventInvitee(event = {}, invitee = {}) {
  const host = Array.isArray(event?.event_memberships) ? event.event_memberships[0] : null
  return {
    id: String(invitee?.uri || event?.uri || '').trim(),
    inviteeUri: String(invitee?.uri || '').trim(),
    eventUri: String(event?.uri || invitee?.event || '').trim(),
    title: String(event?.name || invitee?.name || 'Calendly appointment').trim(),
    eventName: String(event?.name || '').trim(),
    eventTypeName: String(event?.name || '').trim(),
    startAt: String(event?.start_time || '').trim(),
    endAt: String(event?.end_time || '').trim(),
    status: String(invitee?.status || event?.status || '').trim(),
    assignedTo: String(host?.user_name || '').trim(),
    hostName: String(host?.user_name || '').trim(),
    calendarName: 'Calendly',
    cancelUrl: String(invitee?.cancel_url || '').trim(),
    rescheduleUrl: String(invitee?.reschedule_url || '').trim(),
    email: String(invitee?.email || '').trim(),
    name: String(invitee?.name || '').trim(),
    timezone: String(invitee?.timezone || '').trim(),
    tracking: invitee?.tracking || {},
    location: event?.location || null,
    source: 'calendly',
  }
}

async function importCalendlyScheduledEvents({ lookbackDays = 30, lookaheadDays = 120 } = {}) {
  if (!isCalendlyReady()) {
    return { ok: false, scanned: 0, matched: 0, imported: 0, message: 'Calendly is not configured.' }
  }
  const minStart = new Date(Date.now() - lookbackDays * 86400000).toISOString()
  const maxStart = new Date(Date.now() + lookaheadDays * 86400000).toISOString()
  const statuses = ['active', 'canceled']
  let scanned = 0
  let matched = 0
  let imported = 0

  for (const status of statuses) {
    const events = await listCalendlyScheduledEvents({ minStartTime: minStart, maxStartTime: maxStart, status })
    for (const event of events) {
      scanned += 1
      const invitees = await listCalendlyEventInvitees(event?.uri)
      for (const invitee of invitees) {
        const appointment = buildCalendlyAppointmentFromEventInvitee(event, invitee)
        const matchedRow = await findSessionForCalendlyPayload({
          ...invitee,
          scheduled_event: event,
        })
        if (!matchedRow?.session_code) continue
        matched += 1
        const sessionCode = String(matchedRow.session_code)
        const room = await ensureRoom(sessionCode)
        const nextState = room?.state || initialRoomState()
        const nextAnswers = { ...(nextState.answers || {}) }
        const existingAppointments = parseStoredCalendlyAppointments(nextAnswers.calendly_appointments)
        nextAnswers.calendly_appointments = stringifyStructuredValue(upsertCalendlyAppointment(existingAppointments, appointment), '[]')
        nextAnswers.calendly_last_event = `import:${status}`
        nextAnswers.calendly_last_synced_at = new Date().toISOString()
        nextAnswers.calendly_last_invitee_uri = appointment.inviteeUri
        nextAnswers.calendly_last_event_uri = appointment.eventUri
        nextAnswers.calendly_last_email = appointment.email
        nextAnswers.calendly_last_cancel_url = appointment.cancelUrl
        nextAnswers.calendly_last_reschedule_url = appointment.rescheduleUrl
        nextAnswers.calendly_sync_status = appointment.status || status
        nextState.answers = nextAnswers
        room.state = nextState
        await dbUpsertSession({
          code: sessionCode,
          contactId: room.contactId || matchedRow.ghl_contact_id || null,
          opportunityId: room.opportunityId || matchedRow.ghl_opportunity_id || null,
          state: nextState,
        })
        imported += 1
      }
    }
  }

  if (imported > 0) {
    emitDashboardRecordsUpdated({ reason: 'calendly_import_sync', imported })
  }

  return { ok: true, scanned, matched, imported, minStart, maxStart }
}

function buildCalendlyWebhookCallbackUrl(req) {
  return new URL('/webhooks/calendly', resolvePublicBaseUrl(req)).toString()
}

async function listCalendlyWebhookSubscriptions(req) {
  const identity = await getCalendlyIdentity()
  const organizationUri = normalizeCalendlyUri(identity?.current_organization || identity?.organization)
  const userUri = normalizeCalendlyUri(identity?.uri)
  const data = await calendlyFetch('/webhook_subscriptions', {
    query: {
      organization: organizationUri,
      scope: CALENDLY_WEBHOOK_SCOPE,
      ...(CALENDLY_WEBHOOK_SCOPE === 'user' ? { user: userUri } : {}),
      count: 100,
    },
  })
  const callbackUrl = buildCalendlyWebhookCallbackUrl(req)
  const collection = Array.isArray(data?.collection) ? data.collection : []
  return collection.filter((item) => String(item?.callback_url || '').trim() === callbackUrl)
}

async function ensureCalendlyWebhookSubscription(req) {
  if (!CALENDLY_WEBHOOK_SIGNING_KEY) {
    throw new Error('CALENDLY_WEBHOOK_SIGNING_KEY is required to enable secure Calendly webhook sync.')
  }
  const existing = await listCalendlyWebhookSubscriptions(req)
  const reusable = existing.find((item) => String(item?.state || '').trim() === 'active')
  if (reusable) return reusable
  const identity = await getCalendlyIdentity()
  const organizationUri = normalizeCalendlyUri(identity?.current_organization || identity?.organization)
  const userUri = normalizeCalendlyUri(identity?.uri)
  const data = await calendlyFetch('/webhook_subscriptions', {
    method: 'POST',
    body: {
      url: buildCalendlyWebhookCallbackUrl(req),
      events: ['invitee.created', 'invitee.canceled'],
      organization: organizationUri,
      scope: CALENDLY_WEBHOOK_SCOPE,
      ...(CALENDLY_WEBHOOK_SCOPE === 'user' ? { user: userUri } : {}),
      signing_key: CALENDLY_WEBHOOK_SIGNING_KEY,
    },
  })
  return data?.resource || null
}

function buildCalendlyBookingUrl(baseUrl, { sessionCode = '', clientName = '', clientEmail = '' } = {}) {
  const normalized = String(baseUrl || '').trim()
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    if (clientName) url.searchParams.set('name', clientName)
    if (clientEmail) url.searchParams.set('email', clientEmail)
    url.searchParams.set('utm_source', 'taxrefresh_dashboard')
    url.searchParams.set('utm_medium', 'admin_dashboard')
    url.searchParams.set('utm_campaign', 'client_scheduling')
    if (sessionCode) url.searchParams.set('utm_content', sessionCode)
    return url.toString()
  } catch {
    return normalized
  }
}

function parseCalendlyWebhookSignature(headerValue = '') {
  return String(headerValue || '')
    .split(',')
    .map((part) => part.trim())
    .reduce((acc, part) => {
      const [key, value] = part.split('=')
      if (key && value) acc[key] = value
      return acc
    }, {})
}

function verifyCalendlyWebhookSignature(rawBody = '', headerValue = '') {
  if (!CALENDLY_WEBHOOK_SIGNING_KEY) return false
  const parts = parseCalendlyWebhookSignature(headerValue)
  const timestamp = String(parts.t || '').trim()
  const signature = String(parts.v1 || '').trim()
  if (!timestamp || !signature) return false
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 3 * 60 * 1000) return false
  const expected = crypto.createHmac('sha256', CALENDLY_WEBHOOK_SIGNING_KEY).update(`${timestamp}.${rawBody}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

function normalizeFieldSlug(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/^contact\./, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function ensureGhlContactFields() {
  if (ghlContactFieldCache) return ghlContactFieldCache

  const existing = await ghlFetch(`locations/${encodeURIComponent(GHL_LOCATION_ID)}/customFields`, {
    query: { model: 'contact' },
  })
  const existingFields = Array.isArray(existing?.customFields) ? existing.customFields : []
  const ensured = []

  for (const spec of DEFAULT_GHL_CONTACT_FIELDS) {
    let field =
      existingFields.find((item) => normalizeFieldSlug(item?.fieldKey) === spec.slug) ||
      existingFields.find((item) => normalizeFieldSlug(item?.name) === spec.slug)

    if (!field) {
      const created = await ghlFetch(`locations/${encodeURIComponent(GHL_LOCATION_ID)}/customFields`, {
        method: 'POST',
        body: {
          name: spec.name,
          dataType: 'TEXT',
          model: 'contact',
        },
      })
      field = created?.customField || null
      if (field) existingFields.push(field)
    }

    if (field?.id || field?.fieldKey) {
      ensured.push({
        slug: spec.slug,
        id: String(field.id || ''),
        key: String(field.fieldKey || ''),
        name: String(field.name || spec.name),
      })
    }
  }

  ghlContactFieldCache = ensured
  return ensured
}

async function ensureGhlOpportunityFields() {
  if (ghlOpportunityFieldCache) return ghlOpportunityFieldCache

  const existing = await ghlFetch(`locations/${encodeURIComponent(GHL_LOCATION_ID)}/customFields`, {
    query: { model: 'opportunity' },
  })
  const existingFields = Array.isArray(existing?.customFields) ? existing.customFields : []
  const ensured = []

  for (const spec of DEFAULT_GHL_OPPORTUNITY_FIELDS) {
    let field =
      existingFields.find((item) => normalizeFieldSlug(item?.fieldKey) === spec.slug) ||
      existingFields.find((item) => normalizeFieldSlug(item?.name) === spec.slug)

    if (!field) {
      const created = await ghlFetch(`locations/${encodeURIComponent(GHL_LOCATION_ID)}/customFields`, {
        method: 'POST',
        body: {
          name: spec.name,
          dataType: 'TEXT',
          model: 'opportunity',
        },
      })
      field = created?.customField || null
      if (field) existingFields.push(field)
    }

    if (field?.id || field?.fieldKey) {
      ensured.push({
        slug: spec.slug,
        id: String(field.id || ''),
        key: String(field.fieldKey || ''),
        name: String(field.name || spec.name),
      })
    }
  }

  ghlOpportunityFieldCache = ensured
  return ensured
}

async function syncSessionToGhlDirect({ roomCode, room } = {}) {
  if (!hasDirectGhlConfig() || !roomCode || !room?.contactId) return

  const fields = await ensureGhlContactFields()
  const baseUrl = getPublicBaseUrl()
  const links = makePortalLinks(room.contactId, roomCode, baseUrl, room.opportunityId)
  const syncAnswers = getSyncAnswers(room)
  const valuesBySlug = {
    portal_session_code: roomCode,
    taxrefresh_client_portal_link: links.clientLink,
    taxrefresh_rep_portal_link: links.repLink,
    taxrefresh_onboarding_status: syncAnswers.onboardingStatus,
    taxrefresh_form_8821_status: syncAnswers.form8821Status,
    taxrefresh_completed_at: syncAnswers.completedAt,
  }

  const customFields = fields.map((field) => ({
    ...(field.id ? { id: field.id } : {}),
    ...(field.key ? { key: field.key } : {}),
    fieldValue: String(valuesBySlug[field.slug] || ''),
    field_value: String(valuesBySlug[field.slug] || ''),
  }))

  await ghlFetch(`contacts/${encodeURIComponent(room.contactId)}`, {
    method: 'PUT',
    version: '2023-02-21',
    body: {
      customFields,
      source: 'taxrefresh_portal',
    },
  })

  if (room.opportunityId) {
    const opportunityFields = await ensureGhlOpportunityFields()
    const opportunityValuesBySlug = {
      begin_red: links.repLink,
      red_session_code: roomCode,
      red_client_portal_link: links.clientLink,
      red_onboarding_status: syncAnswers.onboardingStatus,
      red_form_8821_status: syncAnswers.form8821Status,
      red_completed_at: syncAnswers.completedAt,
    }

    const customFields = opportunityFields.map((field) => ({
      ...(field.id ? { id: field.id } : {}),
      ...(field.key ? { key: field.key } : {}),
      fieldValue: String(opportunityValuesBySlug[field.slug] || ''),
    }))

    await ghlFetch(`opportunities/${encodeURIComponent(room.opportunityId)}`, {
      method: 'PUT',
      body: {
        customFields,
      },
    })
  }
}

function buildGhlPipelineMaps(pipelines = []) {
  const pipelineNameById = new Map()
  const stageNameById = new Map()

  for (const pipeline of Array.isArray(pipelines) ? pipelines : []) {
    const pipelineId = String(pipeline?.id || '')
    if (pipelineId) pipelineNameById.set(pipelineId, String(pipeline?.name || ''))
    for (const stage of Array.isArray(pipeline?.stages) ? pipeline.stages : []) {
      const stageId = String(stage?.id || '')
      if (stageId) stageNameById.set(stageId, String(stage?.name || ''))
    }
  }

  return { pipelineNameById, stageNameById }
}

async function fetchGhlPipelinesWithMaps() {
  if (!hasDirectGhlConfig()) {
    return { pipelines: [], pipelineNameById: new Map(), stageNameById: new Map() }
  }
  const pipelineResponse = await ghlFetch('opportunities/pipelines', {
    query: { locationId: GHL_LOCATION_ID },
  })
  const pipelines = Array.isArray(pipelineResponse?.pipelines) ? pipelineResponse.pipelines : []
  return { pipelines, ...buildGhlPipelineMaps(pipelines) }
}

async function findExistingSessionCodeByOpportunityId(opportunityId = '') {
  const normalized = String(opportunityId || '').trim()
  if (!normalized) return null
  if (pool) {
    const res = await pool.query('select session_code from ti_sessions where ghl_opportunity_id=$1 order by updated_at desc limit 1', [normalized])
    return res.rows[0]?.session_code ? String(res.rows[0].session_code) : null
  }
  return fallbackFindSessionCode({ opportunityId: normalized })
}

async function fetchGhlOpportunityById(opportunityId = '') {
  const normalized = String(opportunityId || '').trim()
  if (!normalized || !hasDirectGhlConfig()) return null
  const data = await ghlFetch(`opportunities/${encodeURIComponent(normalized)}`)
  return data?.opportunity || data || null
}

async function fetchGhlContactById(contactId = '') {
  const normalized = String(contactId || '').trim()
  if (!normalized || !hasDirectGhlConfig()) return null
  const data = await ghlFetch(`contacts/${encodeURIComponent(normalized)}`)
  return data?.contact || data || null
}

async function findGhlDuplicateContactByEmail(email = '') {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail || !hasDirectGhlConfig() || !GHL_LOCATION_ID) return null
  const data = await ghlFetch('contacts/search/duplicate', {
    method: 'GET',
    version: 'v3',
    query: {
      locationId: GHL_LOCATION_ID,
      email: normalizedEmail,
    },
  })
  const contact =
    data?.contact ||
    data?.duplicateContact ||
    data?.duplicate ||
    (Array.isArray(data?.contacts) ? data.contacts[0] : null) ||
    data ||
    null
  const id = String(contact?.id || contact?._id || '').trim()
  return id ? { id, contact } : null
}

function isGhlDuplicateContactError(error) {
  const message = String(error?.message || error?.error || '').toLowerCase()
  return message.includes('duplicated contacts') || message.includes('duplicate contact')
}

async function resolveGhlContactIdForEmail({ contactId = '', email = '', name = '', phone = '' } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!isValidEmailAddress(normalizedEmail)) throw new Error('A valid email is required to resolve the CRM contact.')

  let resolvedContactId = String(contactId || '').trim()
  if (!resolvedContactId) {
    // First try to reuse an existing contact for this email (works when duplicates are disabled).
    const duplicate = await findGhlDuplicateContactByEmail(normalizedEmail).catch(() => null)
    if (duplicate?.id) return String(duplicate.id)
    const created = await createGhlContactForEmail({ email: normalizedEmail, name, phone })
    return String(created?.id || '').trim()
  }

  const duplicate = await findGhlDuplicateContactByEmail(normalizedEmail).catch(() => null)
  if (duplicate?.id) return String(duplicate.id)

  // For messaging, an existing contact id is enough. Do not try to overwrite the
  // contact's email here because locations with duplicate protection enabled can
  // reject the update even though the existing contact is valid for sending.
  return resolvedContactId
}

async function createGhlContactForEmail({ email = '', name = '', phone = '' } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!hasDirectGhlConfig()) throw new Error('Direct CRM sync is not configured.')
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('A valid email is required to create the CRM contact.')
  if (!GHL_LOCATION_ID) throw new Error('CRM location id is not configured.')
  const payload = {
    locationId: GHL_LOCATION_ID,
    email: normalizedEmail,
    name: String(name || '').trim() || undefined,
    phone: String(phone || '').trim() || undefined,
    source: 'taxrefresh-dashboard',
  }
  try {
    const data = await ghlFetch('contacts/', { method: 'POST', version: 'v3', body: payload })
    const contact = data?.contact || data || null
    const id = String(contact?.id || '').trim()
    if (!id) throw new Error('CRM contact creation failed to return an id.')
    return { id, contact }
  } catch (error) {
    if (isGhlDuplicateContactError(error)) {
      // If this location disallows duplicates, reuse existing contact instead of failing.
      const duplicate = await findGhlDuplicateContactByEmail(normalizedEmail).catch(() => null)
      if (duplicate?.id) return duplicate
    }
    throw error
  }
}

async function ensureGhlContactEmail({ contactId = '', email = '', name = '', phone = '' } = {}) {
  const normalizedContactId = String(contactId || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedContactId) throw new Error('A CRM contact id is required before updating contact email.')
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('A valid recipient email is required before updating contact email.')
  await ghlFetch(`contacts/${encodeURIComponent(normalizedContactId)}`, {
    method: 'PUT',
    version: 'v3',
    body: {
      email: normalizedEmail,
      name: String(name || '').trim() || undefined,
      phone: String(phone || '').trim() || undefined,
      source: 'taxrefresh-dashboard',
    },
  })
}

async function fetchAllGhlOpportunities() {
  if (!hasDirectGhlConfig()) {
    throw new Error('Direct GHL API sync is not configured. Set GHL_API_BASE_URL, GHL_PRIVATE_INTEGRATION_TOKEN, and GHL_LOCATION_ID.')
  }

  const { pipelineNameById, stageNameById } = await fetchGhlPipelinesWithMaps()
  const all = []
  const seen = new Set()
  const limit = 100
  let page = 0
  let total = null

  while (page < 500) {
    const data = await ghlFetch('opportunities/search', {
      method: 'POST',
      body: {
        locationId: GHL_LOCATION_ID,
        query: '',
        limit,
        page,
        searchAfter: [],
        additionalDetails: {
          notes: false,
          tasks: false,
          calendarEvents: true,
          unReadConversations: false,
        },
      },
    })

    const opportunities = Array.isArray(data?.opportunities) ? data.opportunities : []
    if (typeof data?.total === 'number') total = data.total

    for (const item of opportunities) {
      const id = String(item?.id || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      all.push(item)
    }

    if (!opportunities.length) break
    if (total !== null && all.length >= total) break
    if (opportunities.length < limit) break
    page += 1
  }

  return { opportunities: all, pipelineNameById, stageNameById }
}

function buildStateFromGhlOpportunity(room, opportunity, pipelineNameById, stageNameById, explicitContact = null) {
  const existingState = room?.state || initialRoomState()
  const existingAnswers = existingState?.answers || {}
  const contact = explicitContact || opportunity?.contact || {}
  const calendarEvents = Array.isArray(opportunity?.calendarEvents) ? opportunity.calendarEvents : []
  const contactName = String(contact?.name || opportunity?.contactName || '')
  const contactEmail = String(contact?.email || '')
  const contactPhone = String(contact?.phone || '')
  const pipelineId = String(opportunity?.pipelineId || '')
  const stageId = String(opportunity?.pipelineStageId || '')
  const pipelineName = pipelineNameById.get(pipelineId) || ''
  const stageName = stageNameById.get(stageId) || ''
  const updatedAt = Date.parse(String(opportunity?.updatedAt || opportunity?.lastStatusChangeAt || '')) || Date.now()
  const ghlLiabilityValue = extractGhlLiabilityValue(opportunity, contact)

  return {
    ...existingState,
    updatedAt,
    answers: {
      ...existingAnswers,
      ghl_contact_id: String(opportunity?.contactId || room?.contactId || ''),
      ghl_opportunity_id: String(opportunity?.id || room?.opportunityId || ''),
      ghl_pipeline_id: pipelineId,
      ghl_pipeline_name: pipelineName,
      ghl_stage_id: stageId,
      ghl_stage_name: stageName,
      ghl_opportunity_name: String(opportunity?.name || ''),
      ghl_opportunity_status: String(opportunity?.status || ''),
      ghl_opportunity_value: String(opportunity?.monetaryValue ?? ''),
      ghl_liability_value: ghlLiabilityValue,
      ghl_assigned_to: String(opportunity?.assignedTo || ''),
      ghl_last_status_change_at: String(opportunity?.lastStatusChangeAt || ''),
      ghl_last_stage_change_at: String(opportunity?.lastStageChangeAt || ''),
      ghl_calendar_events: stringifyStructuredValue(calendarEvents, '[]'),
      name: String(existingAnswers.name || existingAnswers.full_name || existingAnswers.client_name || existingAnswers.clientName || '').trim() || contactName,
      full_name: String(existingAnswers.full_name || existingAnswers.name || existingAnswers.client_name || existingAnswers.clientName || '').trim() || contactName,
      client_name: String(existingAnswers.client_name || existingAnswers.clientName || existingAnswers.full_name || existingAnswers.name || '').trim() || contactName,
      clientName: String(existingAnswers.clientName || existingAnswers.client_name || existingAnswers.full_name || existingAnswers.name || '').trim() || contactName,
      email: contactEmail || String(existingAnswers.email || existingAnswers.email_address || ''),
      email_address: contactEmail || String(existingAnswers.email_address || existingAnswers.email || ''),
      phone: contactPhone || String(existingAnswers.phone || existingAnswers.phone_number || ''),
      phone_number: contactPhone || String(existingAnswers.phone_number || existingAnswers.phone || ''),
    },
  }
}

async function syncSingleGhlProspectToDashboard({ contactId = '', opportunityId = '', webhookPayload = null } = {}) {
  let resolvedContactId = String(contactId || '').trim()
  let resolvedOpportunityId = String(opportunityId || '').trim()
  let opportunity = null
  let contact = null
  let pipelineNameById = new Map()
  let stageNameById = new Map()
  const payloadContact = webhookPayload?.contact || {}
  const payloadOpportunity = webhookPayload?.opportunity || {}
  const hasPayloadContactSnapshot = Boolean(
    payloadContact && typeof payloadContact === 'object' && Object.keys(payloadContact).length > 0,
  )
  const hasPayloadOpportunitySnapshot = Boolean(
    payloadOpportunity && typeof payloadOpportunity === 'object' && Object.keys(payloadOpportunity).length > 0,
  )

  if (hasDirectGhlConfig()) {
    if (resolvedOpportunityId && !hasPayloadOpportunitySnapshot) {
      try {
        const pipelineMaps = await fetchGhlPipelinesWithMaps()
        pipelineNameById = pipelineMaps.pipelineNameById
        stageNameById = pipelineMaps.stageNameById
        opportunity = await fetchGhlOpportunityById(resolvedOpportunityId)
        if (!resolvedContactId && opportunity?.contactId) resolvedContactId = String(opportunity.contactId || '').trim()
      } catch (error) {
        console.error('Failed to fetch GHL opportunity from webhook sync:', error)
      }
    }
    if (resolvedContactId && !hasPayloadContactSnapshot) {
      try {
        contact = await fetchGhlContactById(resolvedContactId)
      } catch (error) {
        console.error('Failed to fetch GHL contact from webhook sync:', error)
      }
    }
  }

  const normalizedContact = contact || payloadContact || {}
  const normalizedOpportunity = opportunity || payloadOpportunity || {}

  if (!resolvedContactId) resolvedContactId = String(normalizedContact?.id || normalizedOpportunity?.contactId || '').trim()
  if (!resolvedOpportunityId) resolvedOpportunityId = String(normalizedOpportunity?.id || '').trim()
  if (!resolvedContactId) throw new Error('contactId missing in prospect sync payload')

  const code = await dbGetOrCreateSession({ contactId: resolvedContactId, opportunityId: resolvedOpportunityId })
  const room = await ensureRoom(code)
  room.contactId = resolvedContactId
  room.opportunityId = resolvedOpportunityId || room.opportunityId || null

  const nextState = buildStateFromGhlOpportunity(room, normalizedOpportunity, pipelineNameById, stageNameById, normalizedContact)
  room.state = nextState

  await dbUpsertSession({
    code,
    contactId: room.contactId,
    opportunityId: room.opportunityId,
    state: nextState,
  })

  return {
    code,
    room,
    contactId: room.contactId,
    opportunityId: room.opportunityId || '',
  }
}

function buildDashboardRecordUpdatePayload({ code = '', room = null, contactId = '', opportunityId = '' } = {}) {
  if (!code || !room?.state) return null
  return buildConsultationSummary({
    sessionCode: code,
    contactId: contactId || room.contactId || '',
    opportunityId: opportunityId || room.opportunityId || '',
    state: room.state,
    createdAt: new Date(room.state.updatedAt || Date.now()).toISOString(),
    updatedAt: new Date(room.state.updatedAt || Date.now()).toISOString(),
  })
}

async function syncAllGhlOpportunitiesToDashboard() {
  const { opportunities, pipelineNameById, stageNameById } = await fetchAllGhlOpportunities()
  let created = 0
  let updated = 0

  const batchSize = 10
  for (let offset = 0; offset < opportunities.length; offset += batchSize) {
    const batch = opportunities.slice(offset, offset + batchSize)
    const results = await Promise.all(
      batch.map(async (opportunity) => {
        const opportunityId = String(opportunity?.id || '').trim()
        if (!opportunityId) return null
        const contactId = String(opportunity?.contactId || '').trim()
        const existingCode = await findExistingSessionCodeByOpportunityId(opportunityId)
        const code = existingCode || (await dbGetOrCreateSession({ contactId, opportunityId }))
        const room = await ensureRoom(code)
        const nextState = buildStateFromGhlOpportunity(room, opportunity, pipelineNameById, stageNameById)

        room.contactId = contactId || room.contactId || null
        room.opportunityId = opportunityId
        room.state = nextState

        await dbUpsertSession({
          code,
          contactId: room.contactId,
          opportunityId,
          state: nextState,
        })

        return existingCode ? 'updated' : 'created'
      }),
    )

    for (const result of results) {
      if (result === 'created') created += 1
      if (result === 'updated') updated += 1
    }
  }

  const summary = {
    total: opportunities.length,
    created,
    updated,
    pipelines: pipelineNameById.size,
  }
  emitDashboardRecordsUpdated({ reason: 'ghl_full_sync', summary })
  return summary
}

function buildConsultationSummary(record) {
  const state = record?.state || {}
  const answers = state?.answers || {}
  normalizePersistedSigned8821State(answers)
  const rawIrsBalance = toNumberValue(
    getPrimaryAnswer(answers, ['irsBalance', 'irs_balance', 'federalBalance', 'federal_balance', 'irs_balance_amount']),
  )
  const stateBalance = toNumberValue(
    getPrimaryAnswer(answers, ['stateBalance', 'state_balance', 'stateTaxBalance', 'state_tax_balance']),
  )
  const directLiability = toNumberValue(
    getPrimaryAnswer(answers, ['taxLiability', 'tax_liability', 'totalLiability', 'total_liability', 'ghl_liability_value', 'ghl_opportunity_value']),
  )
  const irsBalance = rawIrsBalance > 0 ? rawIrsBalance : directLiability
  const stateUpdatedAt = Number(state?.updatedAt || 0)
  const recordUpdatedAt = record?.updatedAt ? new Date(record.updatedAt).getTime() : 0
  const updatedAtRaw = Math.max(stateUpdatedAt, recordUpdatedAt)
  const createdAtRaw = record?.createdAt ? new Date(record.createdAt).getTime() : 0
  const clientName = getPrimaryAnswer(answers, ['full_name', 'name', 'client_name', 'clientName']) || 'Unnamed client'
  const email = getPrimaryAnswer(answers, ['email', 'email_address'])
  const phone = getPrimaryAnswer(answers, ['phone', 'phone_number'])
  const clientState = String(getPrimaryAnswer(answers, ['mailing_state', 'mailingState', 'state', 'stateCode', 'expenseState']) || '').trim()
  const liability = Math.max(0, irsBalance + stateBalance, directLiability)
  const billingSchedule = getBillingScheduleRowsFromAnswers(answers)
  const processedPaymentCount = billingSchedule.filter((row) => getBillingStatusTone(row) === 'processed').length
  const hasProcessedPayment = processedPaymentCount > 0
  const investigationBillingSchedule = getScopedBillingScheduleRowsFromAnswers(answers, 'investigation')
  const investigationBillingInvoiceAmount = getBillingInvoiceAmountFromAnswers(answers, 'investigation')
  const investigationProcessedAmount = investigationBillingSchedule
    .filter((row) => getBillingStatusTone(row) === 'processed')
    .reduce((sum, row) => sum + toNumberValue(row?.amount), 0)
  const investigationBillingPaidInFull = Boolean(
    investigationBillingInvoiceAmount > 0 && investigationProcessedAmount >= investigationBillingInvoiceAmount,
  )
  const nextOutstandingBillingRow =
    getOutstandingBillingRows(billingSchedule).sort((a, b) => String(a?.date || '9999-12-31').localeCompare(String(b?.date || '9999-12-31')))[0] || null
  const nextBillingDate = String(nextOutstandingBillingRow?.date || '').trim()
  const nextBillingTimingTone = getBillingTimingTone(nextBillingDate)
  const resolutionBillingActive = hasResolutionBillingSignalsFromAnswers(answers)
  const resolutionBillingSchedule = getScopedBillingScheduleRowsFromAnswers(answers, 'resolution')
  const resolutionBillingInvoiceAmount = getBillingInvoiceAmountFromAnswers(answers, 'resolution')
  const resolutionOutstandingBillingRows = getOutstandingBillingRows(resolutionBillingSchedule).sort((a, b) =>
    String(a?.date || '9999-12-31').localeCompare(String(b?.date || '9999-12-31')),
  )
  const nextResolutionBillingRow = resolutionOutstandingBillingRows[0] || null
  const resolutionNextPaymentDate = String(nextResolutionBillingRow?.date || '').trim()
  const resolutionNextPaymentAmount = toNumberValue(nextResolutionBillingRow?.amount)
  const resolutionProcessedAmount = resolutionBillingSchedule
    .filter((row) => getBillingStatusTone(row) === 'processed')
    .reduce((sum, row) => sum + toNumberValue(row?.amount), 0)
  const resolutionBillingPaidInFull = Boolean(
    resolutionBillingActive &&
      (resolutionBillingInvoiceAmount > 0
        ? resolutionProcessedAmount >= resolutionBillingInvoiceAmount && resolutionOutstandingBillingRows.length === 0
        : resolutionBillingSchedule.length > 0 &&
            resolutionBillingSchedule.some((row) => getBillingStatusTone(row) === 'processed') &&
            resolutionOutstandingBillingRows.length === 0),
  )
  const resolutionNextPaymentTimingTone = resolutionBillingPaidInFull ? 'paid_in_full' : getBillingTimingTone(resolutionNextPaymentDate)
  const billingPaymentMethods = parseStoredPaymentMethods(answers.billing_payment_methods)
  const portalPaymentMethods = parseStoredPaymentMethods(answers.client_portal_payment_methods)
  const billingPaymentMethod = parseStoredObject(answers.billing_payment_method, null)
  const portalPaymentMethod = parseStoredObject(answers.client_portal_payment_method, null)
  const hasPaymentMethodOnFile = Boolean(
    billingPaymentMethods.length ||
      portalPaymentMethods.length ||
      (billingPaymentMethod && typeof billingPaymentMethod === 'object') ||
      (portalPaymentMethod && typeof portalPaymentMethod === 'object'),
  )
  const resolutionDocumentsSigned = hasSignedResolutionDocuments(answers)
  const investigationDocumentsSigned = hasAnySignedInvestigationDocuments(answers)
  const onboardingStatus = String(answers.onboarding_status || '').trim()
  const normalizedOnboardingStatus = onboardingStatus.toLowerCase()
  const effectiveOnboardingStatus =
    investigationDocumentsSigned &&
    (!normalizedOnboardingStatus ||
      normalizedOnboardingStatus === 'documents_ready_for_signature' ||
      normalizedOnboardingStatus === 'ready_for_signature' ||
      normalizedOnboardingStatus.includes('ready for signature'))
      ? 'documents_signed'
      : onboardingStatus
  const eaTranscriptsReadyForClient =
    answers.ea_transcripts_ready_for_client === true ||
    String(answers.ea_transcripts_ready_for_client || '')
      .trim()
      .toLowerCase() === 'true'
  const appointments = [
    ...parseStoredGhlCalendarEvents(answers.ghl_calendar_events).map((item) => normalizeGhlCalendarEvent(item)),
    ...parseStoredCalendlyAppointments(answers.calendly_appointments).map((item) => normalizeCalendlyAppointment(item)),
    ...parseStoredInternalAppointments(answers.internal_appointments).map((item) => normalizeInternalAppointment(item)),
  ]
    .filter((item) => item.startAt)
    .sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || '')))

  const rawDeliveryLog = parseStoredObject(answers.document_delivery_log, [])
  const rawReceipts = parseStoredObject(answers.document_receipts, [])
  const receiptPool = [
    ...(Array.isArray(rawDeliveryLog) ? rawDeliveryLog : []),
    ...(Array.isArray(rawReceipts) ? rawReceipts : []),
  ]
  const redDocumentViewedAt = receiptPool
    .filter((entry) => {
      const name = String(entry?.name || '').trim()
      return name === '8821 Document' || name === '8821 Spouse' || name === 'R.E.D Document'
    })
    .map((entry) => String(entry?.openedAt || entry?.opened_at || '').trim())
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || ''
  const resolutionDocumentsViewedAt = receiptPool
    .filter((entry) => String(entry?.name || '').trim() === 'Resolution Documents')
    .map((entry) => String(entry?.openedAt || entry?.opened_at || '').trim())
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || ''
  const resolutionSignedAt =
    String(answers.boldsign_resolution_signed_at || '').trim() ||
    receiptPool
      .filter((entry) => String(entry?.name || '').trim() === 'Resolution Documents')
      .map((entry) => String(entry?.signedAt || entry?.signed_at || '').trim())
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ||
    ''
  const consultationNotes = Array.isArray(answers.consultation_notes)
    ? answers.consultation_notes.filter(Boolean)
    : parseStoredObject(answers.consultation_notes, []).filter(Boolean)
  const activeConsultationNotes = consultationNotes.filter((entry) => !entry?.archived)
  const latestConsultationNote = activeConsultationNotes
    .slice()
    .sort((left, right) => {
      const leftAt = new Date(String(left?.updatedAt || left?.createdAt || '')).getTime()
      const rightAt = new Date(String(right?.updatedAt || right?.createdAt || '')).getTime()
      return rightAt - leftAt
    })[0] || null

  return {
    sessionCode: String(record?.sessionCode || ''),
    contactId: String(record?.contactId || ''),
    opportunityId: String(record?.opportunityId || ''),
    opportunityName: String(answers.ghl_opportunity_name || ''),
    opportunityStatus: String(answers.ghl_opportunity_status || ''),
    pipelineName: String(answers.ghl_pipeline_name || ''),
    stageName: String(answers.ghl_stage_name || ''),
    assignedTo: String(answers.ghl_assigned_to || ''),
    opportunityValue: toNumberValue(answers.ghl_opportunity_value),
    clientName,
    email,
    phone,
    clientState,
    claimedByName: String(answers.claimed_by_name || ''),
    claimedByEmail: String(answers.claimed_by_email || ''),
    assignedEaName: String(answers.assigned_ea_name || ''),
    assignedEaEmail: String(answers.assigned_ea_email || ''),
    eaAssignmentDate: String(answers.ea_assignment_date || ''),
    eaDueDate: String(answers.ea_due_date || ''),
    eaCaseStatus: String(answers.ea_case_status || ''),
    eaPriority: String(answers.ea_priority || ''),
    route: String(state?.route || '/session'),
    step: Number(state?.step || 0),
    onboardingStatus: effectiveOnboardingStatus,
    form8821Status: String(answers.form8821_status || ''),
    createdAt: createdAtRaw ? new Date(createdAtRaw).toISOString() : '',
    updatedAt: updatedAtRaw ? new Date(updatedAtRaw).toISOString() : '',
    liability,
    irsBalance,
    stateBalance,
    processedPaymentCount,
    hasProcessedPayment,
    investigationBillingInvoiceAmount,
    investigationProcessedAmount,
    investigationBillingPaidInFull,
    nextBillingDate,
    nextBillingTimingTone,
    resolutionBillingActive,
    resolutionBillingInvoiceAmount,
    resolutionNextPaymentDate,
    resolutionNextPaymentAmount,
    resolutionNextPaymentTimingTone,
    resolutionBillingPaidInFull,
    hasPaymentMethodOnFile,
    investigationDocumentsSigned,
    resolutionDocumentsSigned,
    resolutionSignedAt,
    eaTranscriptsReadyForClient,
    redDocumentViewedAt,
    resolutionDocumentsViewedAt,
    consultationNotesCount: activeConsultationNotes.length,
    latestConsultationNoteUpdatedAt: String(latestConsultationNote?.updatedAt || latestConsultationNote?.createdAt || '').trim(),
    latestConsultationNoteAuthor: String(latestConsultationNote?.author || '').trim(),
    latestConsultationNoteOwnerKey: String(latestConsultationNote?.ownerKey || '').trim().toLowerCase(),
    appointmentCount: appointments.length,
    nextAppointmentAt: appointments[0]?.startAt || '',
    appointments,
    hasPlan: String(getPrimaryAnswer(answers, ['hasPlan', 'has_plan']) || ''),
    paymentPlanSelected: String(getPrimaryAnswer(answers, ['paymentPlanSelected', 'payment_plan_selected']) || ''),
    planPriceOverride: String(getPrimaryAnswer(answers, ['planPriceOverride', 'plan_price_override']) || ''),
    readyForEnrolledAgent: String(getPrimaryAnswer(answers, ['ready_for_enrolled_agent']) || ''),
    leadType: String(getPrimaryAnswer(answers, ['leadType', 'lead_type']) || ''),
    isTrainingLead: String(getPrimaryAnswer(answers, ['isTrainingLead', 'is_training_lead']) || ''),
    cancellationRequestStatus: String(getPrimaryAnswer(answers, ['cancellation_request_status']) || ''),
    answerCount: Object.keys(answers).filter((key) => !key.startsWith('_ui_')).length,
  }
}

function parseStoredGhlCalendarEvents(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeGhlCalendarEvent(item = {}) {
  return {
    id: String(item?.id || item?._id || item?.calendarEventId || item?.appointmentId || item?.eventId || '').trim(),
    title: String(item?.title || item?.name || item?.appointmentTitle || item?.calendarName || item?.calendar?.name || 'Appointment').trim() || 'Appointment',
    status: String(item?.status || item?.appointmentStatus || item?.calendarEventStatus || '').trim(),
    startAt: String(
      item?.startTime || item?.startAt || item?.startDateTime || item?.startDate || item?.dateStart || item?.appointmentStartTime || '',
    ).trim(),
    endAt: String(
      item?.endTime || item?.endAt || item?.endDateTime || item?.endDate || item?.dateEnd || item?.appointmentEndTime || '',
    ).trim(),
    calendarName: String(item?.calendarName || item?.calendar?.name || item?.groupName || '').trim(),
    assignedTo: String(item?.assignedUserName || item?.assignedTo || item?.ownerName || item?.userName || item?.user?.name || '').trim(),
    source: 'ghl',
  }
}

function parseStoredCalendlyAppointments(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeCalendlyAppointment(item = {}) {
  return {
    id: String(item?.id || item?.inviteeUri || item?.eventUri || '').trim(),
    title: String(item?.title || item?.eventName || item?.calendarName || 'Calendly appointment').trim(),
    status: String(item?.status || '').trim(),
    startAt: String(item?.startAt || item?.start_time || '').trim(),
    endAt: String(item?.endAt || item?.end_time || '').trim(),
    calendarName: String(item?.calendarName || item?.eventTypeName || 'Calendly').trim(),
    assignedTo: String(item?.assignedTo || item?.hostName || '').trim(),
    inviteeUri: String(item?.inviteeUri || item?.uri || '').trim(),
    eventUri: String(item?.eventUri || item?.event || '').trim(),
    rescheduleUrl: String(item?.rescheduleUrl || item?.reschedule_url || '').trim(),
    cancelUrl: String(item?.cancelUrl || item?.cancel_url || '').trim(),
    email: String(item?.email || '').trim(),
    name: String(item?.name || '').trim(),
    timezone: String(item?.timezone || '').trim(),
    source: 'calendly',
  }
}

function parseStoredInternalAppointments(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeInternalAppointment(item = {}) {
  return {
    id: String(item?.id || '').trim(),
    title: String(item?.title || item?.eventName || 'Appointment').trim() || 'Appointment',
    status: String(item?.status || 'scheduled').trim() || 'scheduled',
    startAt: String(item?.startAt || item?.start_time || '').trim(),
    endAt: String(item?.endAt || item?.end_time || '').trim(),
    calendarName: String(item?.calendarName || 'Dashboard').trim() || 'Dashboard',
    assignedTo: String(item?.assignedTo || item?.ownerName || '').trim(),
    notes: String(item?.notes || '').trim(),
    createdByName: String(item?.createdByName || '').trim(),
    createdByEmail: String(item?.createdByEmail || '').trim(),
    updatedAt: String(item?.updatedAt || '').trim(),
    canceledAt: String(item?.canceledAt || '').trim(),
    source: 'internal',
  }
}

function upsertInternalAppointment(existingAppointments = [], nextItem = {}) {
  const normalized = normalizeInternalAppointment(nextItem)
  const nextList = Array.isArray(existingAppointments) ? [...existingAppointments] : []
  const index = nextList.findIndex((item) => String(item?.id || '').trim() === normalized.id)
  if (index >= 0) nextList[index] = { ...nextList[index], ...nextItem }
  else nextList.push(nextItem)
  return nextList
}

function generateInternalAppointmentId() {
  return `appt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function upsertCalendlyAppointment(existingAppointments = [], nextItem = {}) {
  const normalized = normalizeCalendlyAppointment(nextItem)
  const nextList = Array.isArray(existingAppointments) ? [...existingAppointments] : []
  const nextKey = normalized.id || `${normalized.startAt}_${normalized.title}`
  const index = nextList.findIndex((item) => {
    const current = normalizeCalendlyAppointment(item)
    const currentKey = current.id || `${current.startAt}_${current.title}`
    return currentKey === nextKey
  })
  if (index >= 0) {
    nextList[index] = { ...nextList[index], ...nextItem }
  } else {
    nextList.push(nextItem)
  }
  return nextList
}

function extractCalendlySessionCode(payload = {}) {
  const trackingSession = String(payload?.tracking?.utm_content || '').trim()
  if (trackingSession) return trackingSession
  const questionMatch = Array.isArray(payload?.questions_and_answers)
    ? payload.questions_and_answers.find((entry) => /session/i.test(String(entry?.question || '')))
    : null
  return String(questionMatch?.answer || '').trim()
}

function buildCalendlyAppointmentFromPayload(payload = {}) {
  const scheduledEvent = payload?.scheduled_event || {}
  const host = Array.isArray(scheduledEvent?.event_memberships) ? scheduledEvent.event_memberships[0] : null
  return {
    id: String(payload?.uri || scheduledEvent?.uri || '').trim(),
    inviteeUri: String(payload?.uri || '').trim(),
    eventUri: String(scheduledEvent?.uri || payload?.event || '').trim(),
    title: String(scheduledEvent?.name || payload?.name || 'Calendly appointment').trim(),
    eventName: String(scheduledEvent?.name || '').trim(),
    eventTypeName: String(scheduledEvent?.name || '').trim(),
    startAt: String(scheduledEvent?.start_time || '').trim(),
    endAt: String(scheduledEvent?.end_time || '').trim(),
    status: String(payload?.status || scheduledEvent?.status || '').trim(),
    assignedTo: String(host?.user_name || '').trim(),
    hostName: String(host?.user_name || '').trim(),
    calendarName: 'Calendly',
    cancelUrl: String(payload?.cancel_url || '').trim(),
    rescheduleUrl: String(payload?.reschedule_url || '').trim(),
    email: String(payload?.email || '').trim(),
    name: String(payload?.name || '').trim(),
    timezone: String(payload?.timezone || '').trim(),
    tracking: payload?.tracking || {},
    location: scheduledEvent?.location || null,
    source: 'calendly',
  }
}

async function findSessionForCalendlyPayload(payload = {}) {
  const sessionCode = extractCalendlySessionCode(payload)
  if (sessionCode) {
    const matched = await dbGetSession(sessionCode)
    if (matched) return matched
  }
  const email = String(payload?.email || '').trim()
  if (email) {
    return findLatestSessionByEmail(email)
  }
  return null
}

async function syncCalendlyPayloadToSession(eventName = '', payload = {}) {
  const matched = await findSessionForCalendlyPayload(payload)
  if (!matched?.session_code) {
    return { matched: false, sessionCode: '', action: 'ignored' }
  }
  const sessionCode = String(matched.session_code)
  const room = await ensureRoom(sessionCode)
  const nextState = room?.state || initialRoomState()
  const nextAnswers = { ...(nextState.answers || {}) }
  const existingAppointments = parseStoredCalendlyAppointments(nextAnswers.calendly_appointments)
  const appointment = buildCalendlyAppointmentFromPayload(payload)
  if (eventName === 'invitee.canceled') {
    appointment.status = 'canceled'
  }
  nextAnswers.calendly_appointments = stringifyStructuredValue(upsertCalendlyAppointment(existingAppointments, appointment), '[]')
  nextAnswers.calendly_last_event = String(eventName || '').trim()
  nextAnswers.calendly_last_synced_at = new Date().toISOString()
  nextAnswers.calendly_last_invitee_uri = appointment.inviteeUri
  nextAnswers.calendly_last_event_uri = appointment.eventUri
  nextAnswers.calendly_last_email = appointment.email
  nextAnswers.calendly_last_cancel_url = appointment.cancelUrl
  nextAnswers.calendly_last_reschedule_url = appointment.rescheduleUrl
  nextAnswers.calendly_sync_status = appointment.status || 'active'
  nextState.answers = nextAnswers
  room.state = nextState
  await dbUpsertSession({
    code: sessionCode,
    contactId: room.contactId || matched.ghl_contact_id || null,
    opportunityId: room.opportunityId || matched.ghl_opportunity_id || null,
    state: nextState,
  })
  emitDashboardRecordsUpdated({ reason: 'calendly_webhook', sessionCode, eventName })
  return { matched: true, sessionCode, action: eventName }
}

function parseSoftCreditHistory(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function isSoftCreditConsentGranted(answers = {}) {
  const normalized = String(answers.soft_credit_check_consent_status || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'granted', 'authorized', 'authorized_soft_pull'].includes(normalized)
}

function parseStoredDob(value = '') {
  const digits = digitsOnly(value)
  if (digits.length !== 8) return ''
  const month = Number(digits.slice(0, 2))
  const day = Number(digits.slice(2, 4))
  const year = Number(digits.slice(4, 8))
  if (!month || month > 12 || !day || day > 31 || year < 1900) return ''
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function resolveApplicantName(answers = {}) {
  const explicitFullName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || '').trim()
  const explicitFirstName = String(getPrimaryAnswer(answers, ['first_name', 'firstName']) || '').trim()
  const explicitLastName = String(getPrimaryAnswer(answers, ['last_name', 'lastName']) || '').trim()
  const parsedParts = explicitFullName.split(/\s+/).filter(Boolean)
  const firstName = explicitFirstName || parsedParts[0] || ''
  const lastName = explicitLastName || (parsedParts.length > 1 ? parsedParts.slice(1).join(' ') : '')
  const fullName = explicitFullName || [firstName, lastName].filter(Boolean).join(' ')
  return {
    fullName,
    firstName,
    lastName,
  }
}

function collectSoftCreditApplicant(answers = {}) {
  const { fullName, firstName, lastName } = resolveApplicantName(answers)
  const street = String(getPrimaryAnswer(answers, ['address1', 'street', 'address']) || '').trim()
  const city = String(getPrimaryAnswer(answers, ['city']) || '').trim()
  const state = String(getPrimaryAnswer(answers, ['state']) || '').trim()
  const zip = digitsOnly(String(getPrimaryAnswer(answers, ['zip', 'postalCode', 'postal_code']) || '')).slice(0, 5)
  const ssn = digitsOnly(String(getPrimaryAnswer(answers, ['ssn']) || '')).slice(0, 9)
  const dob = parseStoredDob(String(getPrimaryAnswer(answers, ['dob', 'date_of_birth', 'birthdate']) || ''))
  const missingFields = []
  if (!fullName || !firstName || !lastName) missingFields.push('full name')
  if (!ssn || ssn.length !== 9) missingFields.push('SSN')
  if (!dob) missingFields.push('date of birth')
  if (!street) missingFields.push('street address')
  if (!city) missingFields.push('city')
  if (!state) missingFields.push('state')
  if (!zip || zip.length < 5) missingFields.push('ZIP code')
  return {
    missingFields,
    applicant: {
      fullName,
      firstName,
      lastName,
      ssn,
      dob,
      address1: street,
      address2: String(getPrimaryAnswer(answers, ['address2', 'apt', 'unit']) || '').trim(),
      city,
      state,
      zip,
      email: String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim(),
      phone: String(getPrimaryAnswer(answers, ['phone', 'phone_number']) || '').trim(),
    },
  }
}

function findNestedValueByKeys(input, matcher) {
  const queue = [input]
  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item))
      continue
    }
    for (const [key, value] of Object.entries(current)) {
      if (matcher(key, value)) return value
      if (value && typeof value === 'object') queue.push(value)
    }
  }
  return undefined
}

function findNestedArrayByKeys(input, matcher) {
  const queue = [input]
  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      if (matcher('', current)) return current
      current.forEach((item) => queue.push(item))
      continue
    }
    for (const [key, value] of Object.entries(current)) {
      if (Array.isArray(value) && matcher(key, value)) return value
      if (value && typeof value === 'object') queue.push(value)
    }
  }
  return []
}

function normalizeCurrencyValue(value) {
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return Math.round(parsed)
  if (typeof value === 'string') {
    const digits = value.replace(/[^\d.-]/g, '')
    const next = Number(digits)
    return Number.isFinite(next) ? Math.round(next) : ''
  }
  return ''
}

function normalizeCountValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : ''
}

function normalizePercentValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : ''
}

function stringifyStructuredValue(value, fallback = '[]') {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback))
  } catch {
    return fallback
  }
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function normalizeTradeline(item = {}) {
  const paymentHistory = normalizeTextList(item?.paymentHistory || item?.payment_history || item?.history || item?.paymentStatuses)
  return {
    creditor: String(item?.creditor || item?.subscriberName || item?.lender || item?.name || '').trim(),
    accountType: String(item?.accountType || item?.type || item?.portfolioType || '').trim(),
    accountStatus: String(item?.accountStatus || item?.status || item?.paymentStatus || '').trim(),
    balance: normalizeCurrencyValue(item?.balance || item?.currentBalance || item?.amountOwed),
    creditLimit: normalizeCurrencyValue(item?.creditLimit || item?.limit || item?.highCredit),
    monthlyPayment: normalizeCurrencyValue(item?.monthlyPayment || item?.scheduledPayment || item?.minimumPayment),
    pastDue: normalizeCurrencyValue(item?.pastDue || item?.pastDueAmount || item?.amountPastDue),
    openedAt: String(item?.openedAt || item?.dateOpened || item?.openedDate || '').trim(),
    lastReportedAt: String(item?.lastReportedAt || item?.reportedDate || item?.dateReported || '').trim(),
    remarks: String(item?.remarks || item?.comment || item?.description || '').trim(),
    paymentHistory,
  }
}

function normalizeInquiry(item = {}, fallbackType = 'Inquiry') {
  return {
    type: String(item?.type || item?.inquiryType || fallbackType).trim(),
    subscriberName: String(item?.subscriberName || item?.creditor || item?.name || '').trim(),
    bureau: String(item?.bureau || item?.bureauName || '').trim(),
    inquiredAt: String(item?.inquiredAt || item?.date || item?.inquiryDate || '').trim(),
  }
}

function normalizeAlert(item = {}) {
  return {
    title: String(item?.title || item?.type || item?.name || 'Alert').trim(),
    description: String(item?.description || item?.message || item?.detail || '').trim(),
    severity: String(item?.severity || item?.status || '').trim(),
  }
}

function normalizePublicRecord(item = {}) {
  return {
    type: String(item?.type || item?.recordType || item?.name || '').trim(),
    status: String(item?.status || item?.filingStatus || '').trim(),
    amount: normalizeCurrencyValue(item?.amount || item?.balance || item?.liability),
    filedAt: String(item?.filedAt || item?.dateFiled || item?.openedAt || '').trim(),
    reference: String(item?.reference || item?.court || item?.identifier || '').trim(),
  }
}

function normalizeSoftCreditResult(payload = {}) {
  const bureau = String(
    payload?.bureau ||
      payload?.creditBureau ||
      payload?.bureauName ||
      findNestedValueByKeys(payload, (key, value) => /bureau/i.test(key) && typeof value === 'string') ||
      SOFT_CREDIT_CHECK_PROVIDER,
  ).trim() || SOFT_CREDIT_CHECK_PROVIDER
  const referenceId = String(
    payload?.referenceId ||
      payload?.transactionId ||
      payload?.requestId ||
      payload?.reportId ||
      findNestedValueByKeys(payload, (key, value) => /reference|transaction|request|report.*id/i.test(key) && typeof value !== 'object'),
  ).trim()
  const scoreValueRaw =
    payload?.score ??
    payload?.creditScore ??
    payload?.vantageScore ??
    payload?.ficoScore ??
    findNestedValueByKeys(payload, (key, value) => /score/i.test(key) && typeof value === 'number')
  const scoreValue = Number(scoreValueRaw)
  const score = Number.isFinite(scoreValue) ? Math.round(scoreValue) : ''
  const rangeMin = Number(
    payload?.scoreRangeMin ??
      payload?.scoreMin ??
      findNestedValueByKeys(payload, (key, value) => /(score.*min|min.*score)/i.test(key) && typeof value === 'number'),
  )
  const rangeMax = Number(
    payload?.scoreRangeMax ??
      payload?.scoreMax ??
      findNestedValueByKeys(payload, (key, value) => /(score.*max|max.*score)/i.test(key) && typeof value === 'number'),
  )
  const scoreRange =
    Number.isFinite(rangeMin) && Number.isFinite(rangeMax) ? `${Math.round(rangeMin)}-${Math.round(rangeMax)}` : score ? `${Math.floor(score / 10) * 10}-${Math.floor(score / 10) * 10 + 9}` : ''
  const model = String(
    payload?.scoreModel ||
      payload?.model ||
      payload?.scoreName ||
      findNestedValueByKeys(payload, (key, value) => /model|score.*name/i.test(key) && typeof value === 'string') ||
      '',
  ).trim()
  const reasons = Array.isArray(payload?.reasonCodes)
    ? payload.reasonCodes.filter(Boolean).map((value) => String(value))
    : []
  const tradelines = (
    payload?.tradelines ||
    payload?.tradeLines ||
    payload?.accounts ||
    payload?.creditAccounts ||
    findNestedArrayByKeys(payload, (key) => /(tradeline|trade.?line|credit.?account|account)s?$/i.test(key))
  )
    .filter(Boolean)
    .map((item) => normalizeTradeline(item))
    .filter((item) => item.creditor || item.accountType || item.balance !== '')
  const inquiries = [
    ...(
      payload?.inquiries ||
      findNestedArrayByKeys(payload, (key) => /^inquiries?$|hardInquiries|softInquiries/i.test(key))
    )
      .filter(Boolean)
      .map((item) => normalizeInquiry(item)),
    ...(Array.isArray(payload?.hardInquiries) ? payload.hardInquiries.map((item) => normalizeInquiry(item, 'Hard Inquiry')) : []),
    ...(Array.isArray(payload?.softInquiries) ? payload.softInquiries.map((item) => normalizeInquiry(item, 'Soft Inquiry')) : []),
  ].filter((item) => item.subscriberName || item.inquiredAt || item.type)
  const alerts = (
    payload?.alerts ||
    payload?.messages ||
    findNestedArrayByKeys(payload, (key) => /alerts?|messages?|notifications?/i.test(key))
  )
    .filter(Boolean)
    .map((item) => normalizeAlert(item))
    .filter((item) => item.title || item.description)
  const publicRecords = (
    payload?.publicRecords ||
    payload?.legalItems ||
    findNestedArrayByKeys(payload, (key) => /public.?records?|legal.?items?/i.test(key))
  )
    .filter(Boolean)
    .map((item) => normalizePublicRecord(item))
    .filter((item) => item.type || item.reference)
  const totalDebt =
    normalizeCurrencyValue(
      payload?.totalDebt ||
        payload?.totalBalances ||
        payload?.summary?.totalDebt ||
        findNestedValueByKeys(payload, (key, value) => /(total.*debt|total.*balance)/i.test(key) && typeof value !== 'object'),
    ) || tradelines.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)
  const totalCreditLimit =
    normalizeCurrencyValue(
      payload?.totalCreditLimit ||
        payload?.creditLimitTotal ||
        payload?.summary?.totalCreditLimit ||
        findNestedValueByKeys(payload, (key, value) => /(total.*credit.*limit|credit.*limit.*total)/i.test(key) && typeof value !== 'object'),
    ) || tradelines.reduce((sum, item) => sum + (Number(item.creditLimit) || 0), 0)
  const pastDueAmount =
    normalizeCurrencyValue(
      payload?.pastDueAmount ||
        payload?.totalPastDue ||
        payload?.summary?.pastDueAmount ||
        findNestedValueByKeys(payload, (key, value) => /(past.*due|amount.*past.*due)/i.test(key) && typeof value !== 'object'),
    ) || tradelines.reduce((sum, item) => sum + (Number(item.pastDue) || 0), 0)
  const monthlyPayment =
    normalizeCurrencyValue(
      payload?.monthlyPayment ||
        payload?.totalMonthlyPayment ||
        findNestedValueByKeys(payload, (key, value) => /(monthly.*payment|scheduled.*payment)/i.test(key) && typeof value !== 'object'),
    ) || tradelines.reduce((sum, item) => sum + (Number(item.monthlyPayment) || 0), 0)
  const availableCredit =
    normalizeCurrencyValue(
      payload?.availableCredit ||
        payload?.summary?.availableCredit ||
        findNestedValueByKeys(payload, (key, value) => /(available.*credit)/i.test(key) && typeof value !== 'object'),
    ) || (Number(totalCreditLimit) || 0) - (Number(totalDebt) || 0)
  const revolvingUtilization =
    normalizePercentValue(
      payload?.revolvingUtilization ||
        payload?.creditUtilization ||
        payload?.utilizationRate ||
        findNestedValueByKeys(payload, (key, value) => /(utilization|credit.*usage)/i.test(key) && typeof value !== 'object'),
    ) ||
    ((Number(totalCreditLimit) || 0) > 0 ? Math.round(((Number(totalDebt) || 0) / Number(totalCreditLimit)) * 1000) / 10 : '')
  const openAccounts =
    normalizeCountValue(
      payload?.openAccounts ||
        payload?.summary?.openAccounts ||
        findNestedValueByKeys(payload, (key, value) => /(open.*accounts?)/i.test(key) && typeof value !== 'object'),
    ) || tradelines.filter((item) => !/closed|paid/i.test(item.accountStatus || '')).length
  const closedAccounts =
    normalizeCountValue(
      payload?.closedAccounts ||
        payload?.summary?.closedAccounts ||
        findNestedValueByKeys(payload, (key, value) => /(closed.*accounts?)/i.test(key) && typeof value !== 'object'),
    ) || tradelines.filter((item) => /closed|paid/i.test(item.accountStatus || '')).length
  const delinquentAccounts =
    normalizeCountValue(
      payload?.delinquentAccounts ||
        payload?.lateAccounts ||
        findNestedValueByKeys(payload, (key, value) => /(delinquent|late).*accounts?/i.test(key) && typeof value !== 'object'),
    ) || tradelines.filter((item) => (Number(item.pastDue) || 0) > 0).length
  const derogatoryAccounts =
    normalizeCountValue(
      payload?.derogatoryAccounts ||
        payload?.negativeAccounts ||
        findNestedValueByKeys(payload, (key, value) => /(derogatory|negative).*accounts?/i.test(key) && typeof value !== 'object'),
    )
  const collectionsCount =
    normalizeCountValue(
      payload?.collectionsCount ||
        findNestedValueByKeys(payload, (key, value) => /(collections?.*count|count.*collections?)/i.test(key) && typeof value !== 'object'),
    )
  const publicRecordsCount = normalizeCountValue(payload?.publicRecordsCount || publicRecords.length)
  const inquiryCount =
    normalizeCountValue(
      payload?.inquiryCount ||
        payload?.inquiriesCount ||
        findNestedValueByKeys(payload, (key, value) => /(inquiries?.*count|count.*inquiries?)/i.test(key) && typeof value !== 'object'),
    ) || inquiries.length
  const oldestAccountAgeMonths = normalizeCountValue(
    payload?.oldestAccountAgeMonths ||
      payload?.summary?.oldestAccountAgeMonths ||
      findNestedValueByKeys(payload, (key, value) => /(oldest.*account.*age)/i.test(key) && typeof value !== 'object'),
  )
  const averageAccountAgeMonths = normalizeCountValue(
    payload?.averageAccountAgeMonths ||
      payload?.summary?.averageAccountAgeMonths ||
      findNestedValueByKeys(payload, (key, value) => /(average.*account.*age|avg.*account.*age)/i.test(key) && typeof value !== 'object'),
  )
  return {
    status: score ? 'completed' : 'failed',
    provider: SOFT_CREDIT_CHECK_PROVIDER,
    bureau,
    score,
    scoreRange,
    model,
    referenceId,
    reasons,
    totalDebt,
    totalCreditLimit,
    availableCredit: availableCredit < 0 ? '' : availableCredit,
    revolvingUtilization,
    monthlyPayment,
    pastDueAmount,
    openAccounts,
    closedAccounts,
    delinquentAccounts,
    derogatoryAccounts,
    collectionsCount,
    publicRecordsCount,
    inquiryCount,
    oldestAccountAgeMonths,
    averageAccountAgeMonths,
    tradelines,
    inquiries,
    alerts,
    publicRecords,
    rawStatus: String(payload?.status || payload?.result || '').trim(),
  }
}

function buildSoftCreditSnapshot(answers = {}) {
  return {
    provider: String(answers.soft_credit_check_provider || SOFT_CREDIT_CHECK_PROVIDER).trim() || SOFT_CREDIT_CHECK_PROVIDER,
    status: String(answers.soft_credit_check_status || 'not_started').trim() || 'not_started',
    score: String(answers.soft_credit_check_score || '').trim(),
    scoreRange: String(answers.soft_credit_check_score_range || '').trim(),
    model: String(answers.soft_credit_check_model || '').trim(),
    bureau: String(answers.soft_credit_check_bureau || '').trim(),
    referenceId: String(answers.soft_credit_check_reference_id || '').trim(),
    consentStatus: String(answers.soft_credit_check_consent_status || '').trim(),
    consentAt: String(answers.soft_credit_check_consent_at || '').trim(),
    consentTextVersion: String(answers.soft_credit_check_consent_text_version || '').trim(),
    requestedAt: String(answers.soft_credit_check_last_requested_at || '').trim(),
    completedAt: String(answers.soft_credit_check_completed_at || '').trim(),
    error: String(answers.soft_credit_check_error || '').trim(),
    errorCode: String(answers.soft_credit_check_error_code || '').trim(),
    lastSource: String(answers.soft_credit_check_last_source || '').trim(),
    totalDebt: String(answers.soft_credit_check_total_debt || '').trim(),
    totalCreditLimit: String(answers.soft_credit_check_total_credit_limit || '').trim(),
    availableCredit: String(answers.soft_credit_check_available_credit || '').trim(),
    revolvingUtilization: String(answers.soft_credit_check_revolving_utilization || '').trim(),
    monthlyPayment: String(answers.soft_credit_check_monthly_payment || '').trim(),
    pastDueAmount: String(answers.soft_credit_check_past_due_amount || '').trim(),
    openAccounts: String(answers.soft_credit_check_open_accounts || '').trim(),
    closedAccounts: String(answers.soft_credit_check_closed_accounts || '').trim(),
    delinquentAccounts: String(answers.soft_credit_check_delinquent_accounts || '').trim(),
    derogatoryAccounts: String(answers.soft_credit_check_derogatory_accounts || '').trim(),
    collectionsCount: String(answers.soft_credit_check_collections_count || '').trim(),
    publicRecordsCount: String(answers.soft_credit_check_public_records_count || '').trim(),
    inquiryCount: String(answers.soft_credit_check_inquiry_count || '').trim(),
    oldestAccountAgeMonths: String(answers.soft_credit_check_oldest_account_age_months || '').trim(),
    averageAccountAgeMonths: String(answers.soft_credit_check_average_account_age_months || '').trim(),
    scoreFactors: String(answers.soft_credit_check_score_factors || '').trim(),
    tradelines: String(answers.soft_credit_check_tradelines || '').trim(),
    inquiries: String(answers.soft_credit_check_inquiries || '').trim(),
    alerts: String(answers.soft_credit_check_alerts || '').trim(),
    publicRecords: String(answers.soft_credit_check_public_records || '').trim(),
    history: parseSoftCreditHistory(answers.soft_credit_check_history),
  }
}

function getReadableSoftCreditFailureMessage(error) {
  const raw = error instanceof Error ? String(error.message || '').trim() : String(error || '').trim()
  if (!raw) return 'Soft credit check failed.'
  const normalized = raw.toLowerCase()
  if (
    normalized.includes('client network socket disconnected') ||
    normalized.includes('secure tls connection') ||
    normalized.includes('fetch failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror')
  ) {
    return 'The soft credit provider could not be reached. Please retry shortly.'
  }
  return raw
}

function appendSoftCreditHistoryEntry(answers = {}, entry = {}) {
  const existing = parseSoftCreditHistory(answers.soft_credit_check_history)
  answers.soft_credit_check_history = [
    {
      id: `soft_credit_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    },
    ...existing,
  ].slice(0, 12)
}

function buildSoftCreditPatches(answers = {}) {
  const keys = [
    'soft_credit_check_provider',
    'soft_credit_check_status',
    'soft_credit_check_score',
    'soft_credit_check_score_range',
    'soft_credit_check_model',
    'soft_credit_check_bureau',
    'soft_credit_check_reference_id',
    'soft_credit_check_total_debt',
    'soft_credit_check_total_credit_limit',
    'soft_credit_check_available_credit',
    'soft_credit_check_revolving_utilization',
    'soft_credit_check_monthly_payment',
    'soft_credit_check_past_due_amount',
    'soft_credit_check_open_accounts',
    'soft_credit_check_closed_accounts',
    'soft_credit_check_delinquent_accounts',
    'soft_credit_check_derogatory_accounts',
    'soft_credit_check_collections_count',
    'soft_credit_check_public_records_count',
    'soft_credit_check_inquiry_count',
    'soft_credit_check_oldest_account_age_months',
    'soft_credit_check_average_account_age_months',
    'soft_credit_check_score_factors',
    'soft_credit_check_tradelines',
    'soft_credit_check_inquiries',
    'soft_credit_check_alerts',
    'soft_credit_check_public_records',
    'soft_credit_check_consent_status',
    'soft_credit_check_consent_at',
    'soft_credit_check_consent_text_version',
    'soft_credit_check_consent_source',
    'soft_credit_check_consent_ip',
    'soft_credit_check_last_requested_at',
    'soft_credit_check_completed_at',
    'soft_credit_check_error',
    'soft_credit_check_error_code',
    'soft_credit_check_last_source',
    'soft_credit_check_history',
  ]
  return keys.map((questionId) => ({
    type: 'setAnswer',
    questionId,
    value: answers[questionId] ?? '',
  }))
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim()
  return forwarded || String(req.ip || '').trim()
}

function applySoftCreditConsent(answers = {}, { source = '', textVersion = '', ipAddress = '', userAgent = '' } = {}) {
  const grantedAt = new Date().toISOString()
  answers.soft_credit_check_consent_status = 'granted'
  answers.soft_credit_check_consent_at = String(answers.soft_credit_check_consent_at || '').trim() || grantedAt
  answers.soft_credit_check_consent_text_version = String(textVersion || SOFT_CREDIT_CHECK_CONSENT_VERSION).trim() || SOFT_CREDIT_CHECK_CONSENT_VERSION
  answers.soft_credit_check_consent_source = String(source || 'document_signed').trim() || 'document_signed'
  if (ipAddress) answers.soft_credit_check_consent_ip = ipAddress
  if (userAgent) answers.soft_credit_check_consent_user_agent = userAgent
}

function splitCsvValues(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatExperianDob(value = '') {
  const digits = digitsOnly(value)
  if (digits.length !== 8) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())) {
    const year = digits.slice(0, 4)
    const month = digits.slice(4, 6)
    const day = digits.slice(6, 8)
    return `${month}${day}${year}`
  }
  const month = digits.slice(0, 2)
  const day = digits.slice(2, 4)
  const year = digits.slice(4, 8)
  return `${month}${day}${year}`
}

function getExperianRequestConfigMissingFields() {
  const missing = []
  if (!EXPERIAN_REQUESTOR_SUBSCRIBER_CODE) missing.push('EXPERIAN_REQUESTOR_SUBSCRIBER_CODE')
  if (!EXPERIAN_PERMISSIBLE_PURPOSE_TYPE) missing.push('EXPERIAN_PERMISSIBLE_PURPOSE_TYPE')
  if (!EXPERIAN_PERMISSIBLE_PURPOSE_TERMS) missing.push('EXPERIAN_PERMISSIBLE_PURPOSE_TERMS')
  if (!EXPERIAN_PERMISSIBLE_PURPOSE_ABBREVIATED_AMOUNT) missing.push('EXPERIAN_PERMISSIBLE_PURPOSE_ABBREVIATED_AMOUNT')
  return missing
}

function hasExperianRequestConfig() {
  return getExperianRequestConfigMissingFields().length === 0
}

function buildExperianCreditProfileRequest({ sessionCode = '', applicant = {} } = {}) {
  const riskModelIndicators = splitCsvValues(EXPERIAN_RISK_MODEL_INDICATORS)
  const summaryTypes = splitCsvValues(EXPERIAN_SUMMARY_TYPES)
  const addOns = {}
  if (riskModelIndicators.length) {
    addOns.riskModels = {
      modelIndicator: riskModelIndicators,
    }
    if (EXPERIAN_RISK_MODEL_SCORE_PERCENTILE) {
      addOns.riskModels.scorePercentile = EXPERIAN_RISK_MODEL_SCORE_PERCENTILE
    }
  }
  if (summaryTypes.length) {
    addOns.summaries = {
      summaryType: summaryTypes,
    }
  }
  if (EXPERIAN_OUTPUT_TYPE) {
    addOns.outputType = EXPERIAN_OUTPUT_TYPE
    if (EXPERIAN_OUTPUT_HEADING) {
      addOns.outputTypeData = {
        heading: EXPERIAN_OUTPUT_HEADING,
      }
    }
  }

  const primaryApplicant = {
    name: {
      lastName: applicant.lastName,
      firstName: applicant.firstName,
    },
    dob: {
      dob: formatExperianDob(applicant.dob),
    },
    ssn: {
      ssn: applicant.ssn,
    },
    currentAddress: {
      line1: applicant.address1,
      city: applicant.city,
      state: applicant.state,
      zipCode: applicant.zip,
      country: 'USA',
    },
  }
  if (applicant.address2) primaryApplicant.currentAddress.line2 = applicant.address2
  if (applicant.email) {
    primaryApplicant.emailId = {
      emailId: applicant.email,
    }
  }

  return {
    consumerPii: {
      primaryApplicant,
    },
    requestor: {
      subscriberCode: EXPERIAN_REQUESTOR_SUBSCRIBER_CODE,
    },
    permissiblePurpose: {
      type: EXPERIAN_PERMISSIBLE_PURPOSE_TYPE,
      terms: EXPERIAN_PERMISSIBLE_PURPOSE_TERMS,
      abbreviatedAmount: EXPERIAN_PERMISSIBLE_PURPOSE_ABBREVIATED_AMOUNT,
    },
    ...(Object.keys(addOns).length ? { addOns } : {}),
  }
}

function hasExperianOAuthConfig() {
  return Boolean(
    EXPERIAN_OAUTH_TOKEN_URL &&
      EXPERIAN_OAUTH_CLIENT_ID &&
      EXPERIAN_OAUTH_CLIENT_SECRET &&
      EXPERIAN_OAUTH_USERNAME &&
      EXPERIAN_OAUTH_PASSWORD,
  )
}

async function fetchExperianOAuthAccessToken() {
  const now = Date.now()
  if (experianOAuthTokenCache.accessToken && experianOAuthTokenCache.expiresAt - 30000 > now) {
    return experianOAuthTokenCache.accessToken
  }
  if (!hasExperianOAuthConfig()) return ''

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), EXPERIAN_SOFT_PULL_TIMEOUT_MS)
  try {
    const body = new URLSearchParams()
    body.set('grant_type', 'password')
    body.set('username', EXPERIAN_OAUTH_USERNAME)
    body.set('password', EXPERIAN_OAUTH_PASSWORD)
    if (EXPERIAN_OAUTH_SCOPE) body.set('scope', EXPERIAN_OAUTH_SCOPE)

    const response = await fetch(EXPERIAN_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${EXPERIAN_OAUTH_CLIENT_ID}:${EXPERIAN_OAUTH_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: body.toString(),
      signal: controller.signal,
    })
    const rawText = await response.text()
    let payload = {}
    try {
      payload = rawText ? JSON.parse(rawText) : {}
    } catch {
      payload = { rawText }
    }
    if (!response.ok) {
      const error = new Error(
        String(payload?.error_description || payload?.error || payload?.message || `Experian OAuth token request failed with status ${response.status}`),
      )
      error.status = response.status
      error.payload = payload
      throw error
    }
    const accessToken = String(payload?.access_token || '').trim()
    const expiresInSeconds = Math.max(60, Number(payload?.expires_in || 3600) || 3600)
    if (!accessToken) throw new Error('Experian OAuth token response did not include an access_token.')
    experianOAuthTokenCache = {
      accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    }
    return accessToken
  } finally {
    clearTimeout(timeoutId)
  }
}

async function buildExperianSoftPullHeaders() {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    clientReferenceId: EXPERIAN_CLIENT_REFERENCE_ID,
  }
  if (EXPERIAN_SOFT_PULL_BEARER_TOKEN) {
    headers.authorization = `Bearer ${EXPERIAN_SOFT_PULL_BEARER_TOKEN}`
  } else if (hasExperianOAuthConfig()) {
    const accessToken = await fetchExperianOAuthAccessToken()
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
  } else if (EXPERIAN_SOFT_PULL_USERNAME && EXPERIAN_SOFT_PULL_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(`${EXPERIAN_SOFT_PULL_USERNAME}:${EXPERIAN_SOFT_PULL_PASSWORD}`).toString('base64')}`
  }
  if (EXPERIAN_SOFT_PULL_API_KEY && EXPERIAN_SOFT_PULL_API_KEY_HEADER) {
    headers[EXPERIAN_SOFT_PULL_API_KEY_HEADER] = EXPERIAN_SOFT_PULL_API_KEY
  }
  return headers
}

function buildMockSoftCreditResult({ sessionCode = '', applicant = {} } = {}) {
  const seed = crypto.createHash('sha256').update(`${sessionCode}:${applicant?.ssn || ''}`).digest()
  const score = 620 + (seed[0] % 121)
  const totalDebt = 13240 + seed[1] * 18
  const totalCreditLimit = 24500 + seed[2] * 30
  const pastDueAmount = 320 + (seed[3] % 4) * 140
  return {
    status: 'completed',
    provider: SOFT_CREDIT_CHECK_PROVIDER,
    bureau: SOFT_CREDIT_CHECK_PROVIDER,
    score,
    scoreRange: `${Math.floor(score / 10) * 10}-${Math.floor(score / 10) * 10 + 9}`,
    model: 'Experian VantageScore 3.0',
    referenceId: `mock_${Date.now().toString(36)}`,
    reasons: ['High revolving utilization', 'Recent delinquency on revolving account', 'Limited age of open installment accounts'],
    totalDebt,
    totalCreditLimit,
    availableCredit: totalCreditLimit - totalDebt,
    revolvingUtilization: Math.round((totalDebt / totalCreditLimit) * 1000) / 10,
    monthlyPayment: 612,
    pastDueAmount,
    openAccounts: 7,
    closedAccounts: 11,
    delinquentAccounts: 1,
    derogatoryAccounts: 1,
    collectionsCount: 1,
    publicRecordsCount: 0,
    inquiryCount: 4,
    oldestAccountAgeMonths: 118,
    averageAccountAgeMonths: 49,
    tradelines: [
      {
        creditor: 'Capital One',
        accountType: 'Revolving',
        accountStatus: '30 days past due',
        balance: 2840,
        creditLimit: 4000,
        monthlyPayment: 95,
        pastDue: pastDueAmount,
        openedAt: '2019-02-11',
        lastReportedAt: new Date().toISOString(),
        remarks: 'Primary revolving line',
        paymentHistory: ['Current', 'Current', '30 Late', '30 Late'],
      },
      {
        creditor: 'Chase Auto',
        accountType: 'Installment',
        accountStatus: 'Current',
        balance: 8640,
        creditLimit: '',
        monthlyPayment: 417,
        pastDue: '',
        openedAt: '2021-09-01',
        lastReportedAt: new Date().toISOString(),
        remarks: 'Auto loan',
        paymentHistory: ['Current', 'Current', 'Current', 'Current'],
      },
      {
        creditor: 'Amex Blue',
        accountType: 'Revolving',
        accountStatus: 'Current',
        balance: 1760,
        creditLimit: 6500,
        monthlyPayment: 100,
        pastDue: '',
        openedAt: '2020-06-14',
        lastReportedAt: new Date().toISOString(),
        remarks: 'Open credit card',
        paymentHistory: ['Current', 'Current', 'Current', 'Current'],
      },
    ],
    inquiries: [
      { type: 'Hard Inquiry', subscriberName: 'Toyota Financial', bureau: SOFT_CREDIT_CHECK_PROVIDER, inquiredAt: '2025-11-02' },
      { type: 'Hard Inquiry', subscriberName: 'Citi Cards', bureau: SOFT_CREDIT_CHECK_PROVIDER, inquiredAt: '2025-08-14' },
      { type: 'Soft Inquiry', subscriberName: 'TaxRefresh', bureau: SOFT_CREDIT_CHECK_PROVIDER, inquiredAt: new Date().toISOString() },
    ],
    alerts: [
      { title: 'Past due balance', description: 'One revolving account is currently past due.', severity: 'warning' },
      { title: 'High utilization', description: 'Overall revolving utilization is above the preferred range.', severity: 'info' },
    ],
    publicRecords: [],
    rawStatus: 'mock_success',
  }
}

function extractExperianErrorDetails(payload = {}, rawText = '') {
  const parts = []
  const push = (value) => {
    const normalized = String(value || '').trim()
    if (!normalized) return
    if (!parts.includes(normalized)) parts.push(normalized)
  }

  push(payload?.error)
  push(payload?.message)
  push(payload?.error_description)
  push(payload?.detail)
  push(payload?.title)
  push(payload?.description)
  push(payload?.statusDescription)

  if (Array.isArray(payload?.errors)) {
    payload.errors.forEach((entry) => {
      if (!entry) return
      if (typeof entry === 'string') {
        push(entry)
        return
      }
      push(entry.message)
      push(entry.description)
      push(entry.detail)
      push(entry.code ? `${entry.code}: ${entry.message || entry.description || entry.detail || ''}` : '')
    })
  }

  if (!parts.length && rawText) {
    const compact = String(rawText).replace(/\s+/g, ' ').trim()
    if (compact) parts.push(compact)
  }

  return parts.join(' | ').slice(0, 1200)
}

function maskExperianDebugValue(key = '', value = '') {
  const normalizedKey = String(key || '').toLowerCase()
  const raw = String(value || '')
  if (!raw) return raw
  if (normalizedKey.includes('authorization') || normalizedKey.includes('token') || normalizedKey.includes('secret') || normalizedKey.includes('password') || normalizedKey.includes('api_key') || normalizedKey.includes('api-key')) {
    return '[redacted]'
  }
  if (normalizedKey.includes('ssn')) {
    const digits = raw.replace(/\D/g, '')
    return digits ? `***-**-${digits.slice(-4)}` : '[redacted]'
  }
  return raw
}

function buildExperianDebugPayload(input) {
  if (Array.isArray(input)) return input.map((item) => buildExperianDebugPayload(item))
  if (!input || typeof input !== 'object') return input
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (value && typeof value === 'object') return [key, buildExperianDebugPayload(value)]
      return [key, maskExperianDebugValue(key, value)]
    }),
  )
}

async function requestExperianSoftCreditCheck({ sessionCode = '', applicant = {}, consent = {} } = {}) {
  if (EXPERIAN_SOFT_PULL_USE_MOCK) {
    return buildMockSoftCreditResult({ sessionCode, applicant })
  }
  if (!EXPERIAN_SOFT_PULL_URL) {
    return {
      status: 'configuration_required',
      provider: SOFT_CREDIT_CHECK_PROVIDER,
      bureau: SOFT_CREDIT_CHECK_PROVIDER,
      score: '',
      scoreRange: '',
      model: '',
      referenceId: '',
      reasons: [],
      rawStatus: 'missing_configuration',
      error: 'Experian soft-pull credentials are not configured yet.',
    }
  }
  if (!EXPERIAN_SOFT_PULL_BEARER_TOKEN && !hasExperianOAuthConfig() && !(EXPERIAN_SOFT_PULL_USERNAME && EXPERIAN_SOFT_PULL_PASSWORD)) {
    return {
      status: 'configuration_required',
      provider: SOFT_CREDIT_CHECK_PROVIDER,
      bureau: SOFT_CREDIT_CHECK_PROVIDER,
      score: '',
      scoreRange: '',
      model: '',
      referenceId: '',
      reasons: [],
      rawStatus: 'missing_credentials',
      error: 'Experian OAuth or direct soft-pull credentials are not configured yet.',
    }
  }
  if (!hasExperianRequestConfig()) {
    return {
      status: 'configuration_required',
      provider: SOFT_CREDIT_CHECK_PROVIDER,
      bureau: SOFT_CREDIT_CHECK_PROVIDER,
      score: '',
      scoreRange: '',
      model: '',
      referenceId: '',
      reasons: [],
      rawStatus: 'missing_request_configuration',
      error: `Experian request settings are incomplete: ${getExperianRequestConfigMissingFields().join(', ')}`,
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), EXPERIAN_SOFT_PULL_TIMEOUT_MS)
  try {
    const requestBody = buildExperianCreditProfileRequest({ sessionCode, applicant, consent })
    const requestHeaders = await buildExperianSoftPullHeaders()
    console.log('Experian soft pull request debug:', {
      sessionCode,
      url: EXPERIAN_SOFT_PULL_URL,
      headers: JSON.stringify(buildExperianDebugPayload(requestHeaders), null, 2),
      body: JSON.stringify(buildExperianDebugPayload(requestBody), null, 2),
    })
    const response = await fetch(EXPERIAN_SOFT_PULL_URL, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
    const rawText = await response.text()
    let payload = {}
    try {
      payload = rawText ? JSON.parse(rawText) : {}
    } catch {
      payload = { rawText }
    }
    if (!response.ok) {
      const errorDetails = extractExperianErrorDetails(payload, rawText)
      console.error('Experian soft pull response debug:', {
        sessionCode,
        status: response.status,
        statusText: response.statusText,
        payload: JSON.stringify(buildExperianDebugPayload(payload), null, 2),
        rawText,
      })
      const error = new Error(errorDetails ? `Experian soft pull failed (${response.status}): ${errorDetails}` : `Experian soft pull failed with status ${response.status}`)
      error.status = response.status
      error.payload = payload
      throw error
    }
    return normalizeSoftCreditResult(payload)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function runSoftCreditCheckForRoom({
  roomCode = '',
  room,
  consentGranted = false,
  source = 'manual',
  force = false,
  requestedBy = '',
  ipAddress = '',
  userAgent = '',
} = {}) {
  const answers = room?.state?.answers || {}
  if (!roomCode || !room) throw new Error('A valid room is required to run a soft credit check.')

  if (consentGranted) {
    applySoftCreditConsent(answers, {
      source,
      ipAddress,
      userAgent,
    })
  }

  if (!isForm8821FullySigned(answers)) {
    answers.soft_credit_check_status = 'not_ready'
    answers.soft_credit_check_error = 'The document must be fully signed before a soft credit check can run.'
    answers.soft_credit_check_error_code = 'document_not_signed'
    await persistRoomState(roomCode, room, buildSoftCreditPatches(answers))
    return buildSoftCreditSnapshot(answers)
  }

  if (!isSoftCreditConsentGranted(answers)) {
    answers.soft_credit_check_status = 'consent_required'
    answers.soft_credit_check_error = 'Soft credit check consent is required before the score can be retrieved.'
    answers.soft_credit_check_error_code = 'consent_required'
    await persistRoomState(roomCode, room, buildSoftCreditPatches(answers))
    return buildSoftCreditSnapshot(answers)
  }

  const currentStatus = String(answers.soft_credit_check_status || '').trim().toLowerCase()
  if (!force && (currentStatus === 'processing' || currentStatus === 'completed')) {
    return buildSoftCreditSnapshot(answers)
  }

  const { applicant, missingFields } = collectSoftCreditApplicant(answers)
  if (missingFields.length) {
    answers.soft_credit_check_status = 'failed'
    answers.soft_credit_check_error = `Missing required applicant information: ${missingFields.join(', ')}.`
    answers.soft_credit_check_error_code = 'missing_required_fields'
    answers.soft_credit_check_last_source = source
    appendSoftCreditHistoryEntry(answers, {
      status: 'failed',
      source,
      error: answers.soft_credit_check_error,
      requestedBy,
    })
    await persistRoomState(roomCode, room, buildSoftCreditPatches(answers))
    return buildSoftCreditSnapshot(answers)
  }

  answers.soft_credit_check_provider = SOFT_CREDIT_CHECK_PROVIDER
  answers.soft_credit_check_status = 'processing'
  answers.soft_credit_check_last_requested_at = new Date().toISOString()
  answers.soft_credit_check_error = ''
  answers.soft_credit_check_error_code = ''
  answers.soft_credit_check_last_source = source
  await persistRoomState(roomCode, room, buildSoftCreditPatches(answers))

  try {
    const result = await requestExperianSoftCreditCheck({
      sessionCode: roomCode,
      applicant,
      consent: {
        grantedAt: answers.soft_credit_check_consent_at,
        textVersion: answers.soft_credit_check_consent_text_version,
        source: answers.soft_credit_check_consent_source,
        ipAddress: answers.soft_credit_check_consent_ip,
      },
    })
    answers.soft_credit_check_provider = result.provider || SOFT_CREDIT_CHECK_PROVIDER
    answers.soft_credit_check_bureau = result.bureau || SOFT_CREDIT_CHECK_PROVIDER
    answers.soft_credit_check_status = result.status || 'completed'
    answers.soft_credit_check_score = result.score === '' ? '' : String(result.score)
    answers.soft_credit_check_score_range = result.scoreRange || ''
    answers.soft_credit_check_model = result.model || ''
    answers.soft_credit_check_reference_id = result.referenceId || ''
    answers.soft_credit_check_total_debt = result.totalDebt === '' ? '' : String(result.totalDebt)
    answers.soft_credit_check_total_credit_limit = result.totalCreditLimit === '' ? '' : String(result.totalCreditLimit)
    answers.soft_credit_check_available_credit = result.availableCredit === '' ? '' : String(result.availableCredit)
    answers.soft_credit_check_revolving_utilization = result.revolvingUtilization === '' ? '' : String(result.revolvingUtilization)
    answers.soft_credit_check_monthly_payment = result.monthlyPayment === '' ? '' : String(result.monthlyPayment)
    answers.soft_credit_check_past_due_amount = result.pastDueAmount === '' ? '' : String(result.pastDueAmount)
    answers.soft_credit_check_open_accounts = result.openAccounts === '' ? '' : String(result.openAccounts)
    answers.soft_credit_check_closed_accounts = result.closedAccounts === '' ? '' : String(result.closedAccounts)
    answers.soft_credit_check_delinquent_accounts = result.delinquentAccounts === '' ? '' : String(result.delinquentAccounts)
    answers.soft_credit_check_derogatory_accounts = result.derogatoryAccounts === '' ? '' : String(result.derogatoryAccounts)
    answers.soft_credit_check_collections_count = result.collectionsCount === '' ? '' : String(result.collectionsCount)
    answers.soft_credit_check_public_records_count = result.publicRecordsCount === '' ? '' : String(result.publicRecordsCount)
    answers.soft_credit_check_inquiry_count = result.inquiryCount === '' ? '' : String(result.inquiryCount)
    answers.soft_credit_check_oldest_account_age_months = result.oldestAccountAgeMonths === '' ? '' : String(result.oldestAccountAgeMonths)
    answers.soft_credit_check_average_account_age_months = result.averageAccountAgeMonths === '' ? '' : String(result.averageAccountAgeMonths)
    answers.soft_credit_check_score_factors = stringifyStructuredValue(result.reasons || [], '[]')
    answers.soft_credit_check_tradelines = stringifyStructuredValue(result.tradelines || [], '[]')
    answers.soft_credit_check_inquiries = stringifyStructuredValue(result.inquiries || [], '[]')
    answers.soft_credit_check_alerts = stringifyStructuredValue(result.alerts || [], '[]')
    answers.soft_credit_check_public_records = stringifyStructuredValue(result.publicRecords || [], '[]')
    answers.soft_credit_check_completed_at = new Date().toISOString()
    answers.soft_credit_check_error = result.error || ''
    answers.soft_credit_check_error_code = result.status === 'configuration_required' ? 'configuration_required' : ''
    appendSoftCreditHistoryEntry(answers, {
      status: answers.soft_credit_check_status,
      source,
      requestedBy,
      score: answers.soft_credit_check_score,
      referenceId: answers.soft_credit_check_reference_id,
      error: answers.soft_credit_check_error,
    })
    await persistRoomState(roomCode, room, buildSoftCreditPatches(answers))
    return buildSoftCreditSnapshot(answers)
  } catch (error) {
    answers.soft_credit_check_status = 'failed'
    answers.soft_credit_check_completed_at = new Date().toISOString()
    answers.soft_credit_check_error = getReadableSoftCreditFailureMessage(error)
    answers.soft_credit_check_error_code = String(error?.status || 'soft_pull_failed')
    appendSoftCreditHistoryEntry(answers, {
      status: 'failed',
      source,
      requestedBy,
      error: answers.soft_credit_check_error,
    })
    await persistRoomState(roomCode, room, buildSoftCreditPatches(answers))
    return buildSoftCreditSnapshot(answers)
  }
}

function isEnrolledAgentHandoffSent(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'ready', 'completed', 'sent'].includes(normalized)
}

function isMarriedJointFilingAnswers(answers = {}) {
  const filingStatus = getNormalizedFilingStatus(answers)
  return filingStatus === 'married_joint'
}

function isSingleFilingAnswers(answers = {}) {
  const filingStatus = getNormalizedFilingStatus(answers)
  return filingStatus === 'single'
}

function isForm8821FullySigned(answers = {}) {
  const form8821Status = String(answers.form8821_status || '').trim().toLowerCase()
  if (form8821Status !== 'completed') return false
  if (!isMarriedJointFilingAnswers(answers)) return true
  const spouseStatus = String(answers.form8821_spouse_status || '').trim().toLowerCase()
  return spouseStatus === 'completed' || spouseStatus === 'not_required'
}

function canEnrolledAgentAccessItem(item, account) {
  if (!item || !account) return false
  if (String(account.designatedPosition || '').trim() !== 'Enrolled Agent') return true
  const assignedEmail = String(item.assignedEaEmail || '').trim().toLowerCase()
  const currentEmail = String(account.email || '').trim().toLowerCase()
  if (!assignedEmail || assignedEmail !== currentEmail) return false
  return isEnrolledAgentHandoffSent(item.readyForEnrolledAgent)
}

function buildConsultationDetail(record) {
  const state = record?.state || {}
  const answers = state?.answers || {}
  normalizePersistedSigned8821State(answers)
  const summary = buildConsultationSummary(record)
  const links = buildExternalDocumentLinks(summary.sessionCode, record)
  const answerEntries = Object.entries(answers)
    .filter(([key, value]) => !key.startsWith('_ui_') && value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value }))
  const irsBalanceEntryIndex = answerEntries.findIndex((entry) => entry.key === 'irsBalance')
  const currentIrsBalanceEntryValue = irsBalanceEntryIndex >= 0 ? toNumberValue(answerEntries[irsBalanceEntryIndex]?.value) : 0
  if (summary.irsBalance > 0 && currentIrsBalanceEntryValue <= 0) {
    if (irsBalanceEntryIndex >= 0) {
      answerEntries[irsBalanceEntryIndex] = { key: 'irsBalance', value: String(summary.irsBalance) }
    } else {
      answerEntries.push({ key: 'irsBalance', value: String(summary.irsBalance) })
    }
  }
  answerEntries.sort((a, b) => a.key.localeCompare(b.key))
  return {
    ...summary,
    answers,
    links,
    answerEntries,
  }
}

async function attachSmsThreadToConsultationDetail(detail) {
  if (!detail) return null
  const answers = detail?.answers || {}
  const storedThread = parseStoredSmsThread(answers.consultation_sms_thread)
  const contactId = String(detail?.contactId || answers?.ghl_contact_id || '').trim()
  const storedConversationId = getStoredSmsConversationId(answers, storedThread)
  const discoveredConversationIds = await findRecentGhlConversationIdsByContact(contactId)
  const conversationCandidates = Array.from(new Set([storedConversationId, ...discoveredConversationIds].filter(Boolean)))
  let fetchedThread = []
  let finalConversationId = conversationCandidates[0] || ''
  for (const conversationId of conversationCandidates) {
    const candidateThread = await fetchRecentGhlSmsMessages(conversationId, 25)
    if (candidateThread.length) {
      fetchedThread = candidateThread
      finalConversationId = conversationId
      break
    }
  }
  const smsThread = mergeSmsThreadEntries(storedThread, fetchedThread)
  return {
    ...detail,
    smsConversationId: finalConversationId,
    smsPhone: normalizePhoneForSms(detail?.phone || answers?.phone || answers?.phone_number || ''),
    smsThread,
  }
}

async function persistSmsThreadForRoom({ roomCode, room, entries = [], conversationId = '', contactId = '' }) {
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode || !room) return []
  const existingThread = parseStoredSmsThread(room.state?.answers?.consultation_sms_thread)
  const mergedThread = mergeSmsThreadEntries(existingThread, entries)
  room.state.answers.consultation_sms_thread = mergedThread
  if (conversationId) {
    room.state.answers.ghl_conversation_id = String(conversationId).trim()
    room.state.answers.ghl_sms_conversation_id = String(conversationId).trim()
  }
  if (contactId) {
    room.contactId = String(contactId).trim() || room.contactId || null
    room.state.answers.ghl_contact_id = String(contactId).trim()
  }
  room.state.updatedAt = Date.now()
  io.to(normalizedRoomCode).emit('room_patch', {
    patch: { type: 'setAnswer', questionId: 'consultation_sms_thread', value: mergedThread },
    updatedAt: room.state.updatedAt,
  })
  io.to(normalizedRoomCode).emit('room_state', room.state)
  await dbUpsertSession({ code: normalizedRoomCode, contactId: room.contactId, opportunityId: room.opportunityId, state: room.state })
  return mergedThread
}

function normalizeConsultationSearchDigits(value = '') {
  return String(value || '').replace(/\D+/g, '')
}

function getConsultationSearchTokens(search = '') {
  return String(search || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

function consultationMatchesSearch(summary, search = '') {
  const tokens = getConsultationSearchTokens(search)
  if (tokens.length === 0) return true

  const textFields = [
    summary.clientName,
    summary.email,
    summary.phone,
    summary.sessionCode,
    summary.contactId,
    summary.opportunityId,
    summary.opportunityName,
    summary.claimedByName,
    summary.assignedTo,
    summary.onboardingStatus,
    summary.form8821Status,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  const digitFields = [summary.phone, summary.sessionCode, summary.contactId, summary.opportunityId]
    .map((value) => normalizeConsultationSearchDigits(value))
    .filter(Boolean)

  return tokens.every((token) => {
    const digitToken = normalizeConsultationSearchDigits(token)
    return textFields.some((value) => value.includes(token)) || (!!digitToken && digitFields.some((value) => value.includes(digitToken)))
  })
}

function getConsultationSearchRank(summary, rawQuery = '') {
  const normalizedQuery = String(rawQuery || '').trim().toLowerCase()
  if (!normalizedQuery) return 0

  const tokens = getConsultationSearchTokens(normalizedQuery)
  const normalizedDigits = normalizeConsultationSearchDigits(normalizedQuery)
  const name = String(summary.clientName || '').trim().toLowerCase()
  const email = String(summary.email || '').trim().toLowerCase()
  const phone = String(summary.phone || '').trim().toLowerCase()
  const sessionCode = String(summary.sessionCode || '').trim().toLowerCase()
  const opportunityName = String(summary.opportunityName || '').trim().toLowerCase()
  const opportunityId = String(summary.opportunityId || '').trim().toLowerCase()
  const contactId = String(summary.contactId || '').trim().toLowerCase()
  const ownerName = String(summary.claimedByName || summary.assignedTo || '').trim().toLowerCase()
  const textFields = [name, email, phone, sessionCode, opportunityName, opportunityId, contactId, ownerName].filter(Boolean)
  const digitFields = [phone, sessionCode, opportunityId, contactId].map(normalizeConsultationSearchDigits).filter(Boolean)

  const matchesAllTokens =
    tokens.length === 0 ||
    tokens.every((token) => {
      const tokenDigits = normalizeConsultationSearchDigits(token)
      return textFields.some((value) => value.includes(token)) || (!!tokenDigits && digitFields.some((value) => value.includes(tokenDigits)))
    })

  if (!matchesAllTokens) return 0

  let score = 0
  if (name.startsWith(normalizedQuery)) score = Math.max(score, 160)
  if (tokens.length > 1 && tokens.every((token) => name.includes(token))) score = Math.max(score, 150)
  if (email.startsWith(normalizedQuery)) score = Math.max(score, 150)
  if (opportunityName.startsWith(normalizedQuery)) score = Math.max(score, 145)
  if (sessionCode.startsWith(normalizedQuery)) score = Math.max(score, 140)
  if (contactId.startsWith(normalizedQuery) || opportunityId.startsWith(normalizedQuery)) score = Math.max(score, 135)
  if (name.includes(normalizedQuery)) score = Math.max(score, 130)
  if (normalizedDigits) {
    if (digitFields.some((value) => value.startsWith(normalizedDigits))) score = Math.max(score, 125)
    else if (digitFields.some((value) => value.includes(normalizedDigits))) score = Math.max(score, 95)
  }
  if (email.includes(normalizedQuery)) score = Math.max(score, 120)
  if (opportunityName.includes(normalizedQuery)) score = Math.max(score, 115)
  if (ownerName.includes(normalizedQuery)) score = Math.max(score, 105)
  if (sessionCode.includes(normalizedQuery) || contactId.includes(normalizedQuery) || opportunityId.includes(normalizedQuery)) {
    score = Math.max(score, 100)
  }

  score += tokens.reduce((total, token) => {
    const tokenDigits = normalizeConsultationSearchDigits(token)
    if (name.startsWith(token) || email.startsWith(token) || opportunityName.startsWith(token)) return total + 12
    if (textFields.some((value) => value.includes(token))) return total + 7
    if (tokenDigits && digitFields.some((value) => value.includes(tokenDigits))) return total + 7
    return total
  }, 0)

  return score
}

function getConsultationUpdatedAtValue(summary) {
  const raw = summary?.updatedAt
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const parsed = Date.parse(String(raw || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function initialRoomState() {
  return { step: 0, route: '/session', answers: {}, updatedAt: Date.now() }
}

const CRITICAL_SESSION_ANSWER_KEYS = [
  'billing_schedule',
  'investigation_billing_schedule',
  'resolution_billing_schedule',
  'billing_invoice_amount',
  'billing_invoice_created_at',
  'investigation_billing_invoice_amount',
  'investigation_billing_invoice_created_at',
  'resolution_billing_invoice_amount',
  'resolution_billing_invoice_created_at',
  'document_receipts',
  'document_delivery_log',
  'document_email_log',
  'hidden_document_receipt_names',
  'ea_documents',
  'consultation_notes',
  'ea_activity_timeline',
  'boldsign_8821_document_id',
  'boldsign_8821_spouse_document_id',
  'boldsign_8821_sent_at',
  'boldsign_8821_signed_at',
  'signed_8821_saved_at',
  'signed_8821_file_name',
  'signed_8821_first_page_saved_at',
  'signed_8821_first_page_file_name',
  'signed_8821_render_version',
  'signed_8821_first_page_render_version',
  'boldsign_resolution_document_id',
  'boldsign_resolution_sent_at',
  'boldsign_resolution_signed_at',
]

function hasMeaningfulSessionValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function mergeSessionAnswersForPersistence(existingAnswers = {}, incomingAnswers = {}, { code = '', source = '' } = {}) {
  const mergedAnswers = { ...(existingAnswers && typeof existingAnswers === 'object' ? existingAnswers : {}) }
  const safeIncomingAnswers = incomingAnswers && typeof incomingAnswers === 'object' ? incomingAnswers : {}
  Object.keys(safeIncomingAnswers).forEach((key) => {
    const nextValue = safeIncomingAnswers[key]
    if (nextValue !== undefined) mergedAnswers[key] = nextValue
  })

  const protectedKeys = CRITICAL_SESSION_ANSWER_KEYS.filter((key) => {
    if (!hasMeaningfulSessionValue(existingAnswers?.[key])) return false
    return !Object.prototype.hasOwnProperty.call(safeIncomingAnswers, key)
  })

  if (protectedKeys.length) {
    console.warn('session persistence guard preserved missing critical answers', {
      code: String(code || '').trim(),
      source: String(source || '').trim(),
      protectedKeys,
    })
  }

  return sanitizeSensitiveBillingAnswers(mergedAnswers)
}

function mergeSessionStateForPersistence(existingState = null, incomingState = null, { code = '', source = '' } = {}) {
  const baseState = existingState && typeof existingState === 'object' ? existingState : initialRoomState()
  const nextState = incomingState && typeof incomingState === 'object' ? incomingState : {}
  const mergedAnswers = mergeSessionAnswersForPersistence(baseState.answers, nextState.answers, { code, source })
  return {
    ...baseState,
    ...nextState,
    answers: mergedAnswers,
    updatedAt: Number(nextState?.updatedAt || 0) || Date.now(),
  }
}

function isStripeReady() {
  return Boolean(stripe && STRIPE_PUBLISHABLE_KEY)
}

function parseStoredPaymentMethods(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function buildStripePaymentMethodRecord(paymentMethod, { customerId = '', setupIntentId = '' } = {}) {
  const type = String(paymentMethod?.type || '').trim()
  if (type === 'card') {
    const brandRaw = String(paymentMethod?.card?.brand || 'card').trim()
    const brand = brandRaw ? brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1) : 'Card'
    const last4 = String(paymentMethod?.card?.last4 || '').trim()
    const expMonth = Number(paymentMethod?.card?.exp_month || 0) || null
    const expYear = Number(paymentMethod?.card?.exp_year || 0) || null
    const expiration = expMonth && expYear ? `${String(expMonth).padStart(2, '0')}/${String(expYear).slice(-2)}` : ''
    return {
      provider: 'stripe',
      type: 'Card',
      stripeType: 'card',
      stripePaymentMethodId: paymentMethod.id,
      stripeCustomerId: customerId || '',
      stripeSetupIntentId: setupIntentId || '',
      label: last4 ? `${brand} ending in ${last4}` : `${brand} card`,
      cardType: brand,
      cardFunding: String(paymentMethod?.card?.funding || '').trim()
        ? String(paymentMethod.card.funding).charAt(0).toUpperCase() + String(paymentMethod.card.funding).slice(1)
        : '',
      cardholderName: String(paymentMethod?.billing_details?.name || '').trim(),
      last4,
      expiration,
      expMonth,
      expYear,
      addedAt: new Date().toISOString(),
    }
  }
  if (type === 'us_bank_account') {
    const last4 = String(paymentMethod?.us_bank_account?.last4 || '').trim()
    const bankName = String(paymentMethod?.us_bank_account?.bank_name || '').trim()
    const accountTypeRaw = String(paymentMethod?.us_bank_account?.account_type || '').trim()
    const bankAccountType = accountTypeRaw ? accountTypeRaw.charAt(0).toUpperCase() + accountTypeRaw.slice(1) : ''
    const labelParts = [bankName || 'ACH', bankAccountType ? `${bankAccountType.toLowerCase()} account` : 'account', last4 ? `ending in ${last4}` : '']
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      provider: 'stripe',
      type: 'ACH',
      stripeType: 'us_bank_account',
      stripePaymentMethodId: paymentMethod.id,
      stripeCustomerId: customerId || '',
      stripeSetupIntentId: setupIntentId || '',
      label: labelParts || (last4 ? `ACH ending in ${last4}` : 'ACH account'),
      institutionName: bankName,
      bankAccountType,
      accountHolderName: String(paymentMethod?.billing_details?.name || '').trim(),
      last4,
      addedAt: new Date().toISOString(),
    }
  }
  return {
    provider: 'stripe',
    type: type ? type.toUpperCase() : 'Payment Method',
    stripeType: type,
    stripePaymentMethodId: paymentMethod?.id || '',
    stripeCustomerId: customerId || '',
    stripeSetupIntentId: setupIntentId || '',
    label: paymentMethod?.id || 'Stripe payment method',
    cardholderName: String(paymentMethod?.billing_details?.name || '').trim(),
    addedAt: new Date().toISOString(),
  }
}

function buildClientPortalPaymentMethodRecord(method) {
  const holder = String(method?.cardholderName || method?.accountHolderName || '').trim()
  const brand = String(method?.cardBrand || method?.cardType || method?.institutionName || method?.type || 'Card').trim() || 'Card'
  const last4 = String(method?.last4 || method?.accountNumber || method?.cardNumber || '')
    .replace(/\D/g, '')
    .slice(-4)
  const exp = String(method?.expiration || '').trim()
  return { holder, brand, last4, exp }
}

async function persistRoomPaymentMethodAnswers(roomCode, room, nextMethods, nextMethod) {
  const portalMethods = nextMethods.map(buildClientPortalPaymentMethodRecord).filter((entry) => entry && (entry.holder || entry.last4))
  const portalMethod = portalMethods[portalMethods.length - 1] || null
  room.state.answers.billing_payment_methods = nextMethods
  room.state.answers.billing_payment_method = nextMethod
  room.state.answers.client_portal_payment_methods = portalMethods
  room.state.answers.client_portal_payment_method = portalMethod
  await persistRoomState(roomCode, room, [
    { type: 'setAnswer', questionId: 'billing_payment_methods', value: nextMethods },
    { type: 'setAnswer', questionId: 'billing_payment_method', value: nextMethod },
    { type: 'setAnswer', questionId: 'client_portal_payment_methods', value: portalMethods },
    { type: 'setAnswer', questionId: 'client_portal_payment_method', value: portalMethod },
  ])
}

function normalizeRawCardDigits(value = '') {
  return String(value || '').replace(/\D/g, '')
}

function parseCardExpirationParts(value = '') {
  const digits = normalizeRawCardDigits(value).slice(0, 4)
  if (digits.length !== 4) return null
  const month = Number.parseInt(digits.slice(0, 2), 10)
  const shortYear = Number.parseInt(digits.slice(2, 4), 10)
  if (!month || month < 1 || month > 12 || !Number.isFinite(shortYear)) return null
  return {
    month,
    year: 2000 + shortYear,
    formatted: `${String(month).padStart(2, '0')}/${String(shortYear).padStart(2, '0')}`,
  }
}

async function createStripeLinkedCardForRoom(roomCode, room, { cardholderName = '', cardNumber = '', expiration = '', cvv = '', billingZip = '' } = {}) {
  if (!stripe) throw new Error('Stripe is not configured.')
  const digits = normalizeRawCardDigits(cardNumber)
  const cvc = normalizeRawCardDigits(cvv).slice(0, 4)
  const exp = parseCardExpirationParts(expiration)
  const postalCode = normalizeRawCardDigits(billingZip).slice(0, 9)
  if (!digits || digits.length < 15) throw new Error('A valid card number is required.')
  if (!exp) throw new Error('A valid card expiration is required.')
  if (!cvc || cvc.length < 3) throw new Error('A valid card security code is required.')
  const customerId = await ensureStripeCustomerForRoom(roomCode, room)
  let paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: {
      number: digits,
      exp_month: exp.month,
      exp_year: exp.year,
      cvc,
    },
    billing_details: {
      name: String(cardholderName || '').trim() || undefined,
      email: String(room?.state?.answers?.email || '').trim() || undefined,
      phone: String(room?.state?.answers?.phone || '').trim() || undefined,
      address: postalCode ? { postal_code: postalCode } : undefined,
    },
    metadata: {
      sessionCode: roomCode,
      source: 'legacy_saved_card',
    },
  })
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method: paymentMethod.id,
    confirm: true,
    usage: 'off_session',
    payment_method_types: ['card'],
    payment_method_options: {
      card: {
        request_three_d_secure: 'automatic',
      },
    },
    metadata: {
      sessionCode: roomCode,
      source: 'legacy_saved_card',
    },
  })
  if (setupIntent.status === 'requires_action') {
    throw new Error('This card requires additional verification before it can be saved. Please try a different card.')
  }
  if (setupIntent.status !== 'succeeded') {
    const setupMessage = String(setupIntent?.last_setup_error?.message || '').trim()
    throw new Error(setupMessage || 'Stripe could not verify this card. Please double-check the details and try again.')
  }
  paymentMethod = await stripe.paymentMethods.retrieve(paymentMethod.id)
  const cvcCheck = String(paymentMethod?.card?.checks?.cvc_check || '').trim().toLowerCase()
  const zipCheck = String(paymentMethod?.card?.checks?.address_postal_code_check || '').trim().toLowerCase()
  if (cvcCheck === 'fail') throw new Error('Stripe could not verify the security code on this card.')
  if (postalCode && zipCheck === 'fail') throw new Error('Stripe could not verify the billing ZIP code for this card.')
  if (String(paymentMethod.customer || '') !== customerId) {
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId })
  }
  try {
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethod.id,
      },
    })
  } catch {
    // Ignore default-payment-method update failures; the reusable method is still attached.
  }
  return {
    customerId,
    paymentMethod,
    setupIntent,
    nextMethod: buildStripePaymentMethodRecord(paymentMethod, { customerId, setupIntentId: setupIntent.id }),
  }
}

async function persistRoomState(roomCode, room, patches = []) {
  room.state.updatedAt = Date.now()
  // Sanitize sensitive billing/payment fields immediately so they are never broadcasted or persisted.
  // (Do not store CVV/PAN in memory, sockets, or database.)
  if (room?.state?.answers && typeof room.state.answers === 'object') {
    room.state.answers = sanitizeSensitiveBillingAnswers(room.state.answers)
  }
  patches.forEach((patch) => {
    io.to(roomCode).emit('room_patch', {
      patch,
      updatedAt: room.state.updatedAt,
    })
  })
  if (patches.length) io.to(roomCode).emit('room_state', room.state)
  await schedulePersistRoomState(roomCode, room)

  // If document receipts were updated, also persist a durable projection to ti_document_receipts.
  // This prevents "receipts vanished" feelings due to mixed sources or session overwrites.
  if (patches.some((patch) => patch?.type === 'setAnswer' && String(patch?.questionId || '').trim() === 'document_receipts')) {
    await dbSyncDocumentReceiptsFromAnswers({ sessionCode: roomCode, answers: room?.state?.answers || {}, actorEmail: '' })
  }
}

function schedulePersistRoomState(roomCode, room) {
  const normalizedRoomCode = String(roomCode || '').trim()
  if (!normalizedRoomCode) return Promise.resolve()
  const existing = pendingSessionPersists.get(normalizedRoomCode)
  if (existing) {
    clearTimeout(existing.timer)
    existing.timer = setTimeout(async () => {
      pendingSessionPersists.delete(normalizedRoomCode)
      try {
        await dbUpsertSession({ code: normalizedRoomCode, state: room.state })
        existing.resolve()
      } catch (error) {
        existing.reject(error)
      }
    }, SESSION_PERSIST_DEBOUNCE_MS)
    return existing.promise
  }

  let resolvePromise = () => {}
  let rejectPromise = () => {}
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const entry = {
    timer: setTimeout(async () => {
      pendingSessionPersists.delete(normalizedRoomCode)
      try {
        await dbUpsertSession({ code: normalizedRoomCode, state: room.state })
        resolvePromise()
      } catch (error) {
        rejectPromise(error)
      }
    }, SESSION_PERSIST_DEBOUNCE_MS),
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
  pendingSessionPersists.set(normalizedRoomCode, entry)
  return promise
}

async function ensureStripeCustomerForRoom(roomCode, room) {
  if (!stripe) throw new Error('Stripe is not configured.')
  const answers = room?.state?.answers || {}
  const existingCustomerId = String(answers.stripe_customer_id || '').trim()
  if (existingCustomerId) return existingCustomerId
  const customer = await stripe.customers.create({
    name: String(answers.full_name || answers.name || answers.first_name || '').trim() || undefined,
    email: String(answers.email || '').trim() || undefined,
    phone: String(answers.phone || '').trim() || undefined,
    metadata: {
      sessionCode: roomCode,
    },
  })
  room.state.answers.stripe_customer_id = customer.id
  await persistRoomState(roomCode, room, [{ type: 'setAnswer', questionId: 'stripe_customer_id', value: customer.id }])
  return customer.id
}

async function persistStripeCustomerIdForRoom(roomCode, room, customerId = '') {
  const normalizedCustomerId = String(customerId || '').trim()
  if (!normalizedCustomerId) return ''
  if (String(room?.state?.answers?.stripe_customer_id || '').trim() === normalizedCustomerId) return normalizedCustomerId
  room.state.answers.stripe_customer_id = normalizedCustomerId
  await persistRoomState(roomCode, room, [{ type: 'setAnswer', questionId: 'stripe_customer_id', value: normalizedCustomerId }])
  return normalizedCustomerId
}

async function dbGetSession(code) {
  if (!pool) return fallbackGetSession(code)
  if (isDbCircuitOpen()) return fallbackGetSession(code)
  try {
    for (const candidate of getCodeVariants(code)) {
      const res = await pool.query('select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at from ti_sessions where session_code=$1', [
        candidate,
      ])
      const row = res.rows[0]
      if (row) {
        // During short DB outages we may have persisted to the file store; when DB returns,
        // prefer the most recently updated copy to avoid the UI "going backwards".
        if (dbLastFailureAt && Date.now() - dbLastFailureAt < DB_RECOVERY_MERGE_WINDOW_MS) {
          const fallback = await fallbackGetSession(code).catch(() => null)
          const fallbackUpdatedAt = fallback?.updated_at ? new Date(fallback.updated_at).getTime() : 0
          const dbUpdatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : 0
          if (fallback && fallbackUpdatedAt > dbUpdatedAt) return fallback
        }
        return row
      }
    }
    return null
  } catch (error) {
    recordDbFailure('dbGetSession failed, falling back to file store:', error, { code: String(code || '').trim() })
    return fallbackGetSession(code)
  }
}

async function dbGetSessionStrict(code) {
  if (!pool) return fallbackGetSession(code)
  if (isDbCircuitOpen()) {
    const error = new Error('Database is temporarily unavailable.')
    error.isTransientDb = true
    throw error
  }
  try {
    const result = await retry(
      async () => {
        try {
          for (const candidate of getCodeVariants(code)) {
            const res = await pool.query(
              'select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at from ti_sessions where session_code=$1',
              [candidate],
            )
            if (res.rows?.[0]) return res.rows[0]
          }
          return null
        } catch (error) {
          if (!isTransientDbConnectionError(error)) error.noRetry = true
          throw error
        }
      },
      { attempts: 6, delayMs: 1000 },
    )
    return result
  } catch (error) {
    if (isTransientDbConnectionError(error)) {
      const wrapped = new Error('Database is waking up.')
      wrapped.isTransientDb = true
      throw wrapped
    }
    throw error
  }
}

async function dbUpsertSession({ code, contactId = null, opportunityId = null, state }) {
  if (!pool || isDbCircuitOpen()) {
    if (STRICT_DB_MODE) {
      const error = new Error('Database is temporarily unavailable.')
      error.isTransientDb = true
      throw error
    }
    return fallbackUpsertSession({ code, contactId, opportunityId, state })
  }
  try {
    const existing = await dbGetSession(code)
    const resolvedCode = String(existing?.session_code || code)
    const nextState = mergeSessionStateForPersistence(existing?.state, state, { code: resolvedCode, source: 'database' })
    await pool.query(
      `
      insert into ti_sessions(session_code, ghl_contact_id, ghl_opportunity_id, state)
      values ($1, $2, $3, $4)
      on conflict (session_code) do update
        set ghl_contact_id = coalesce(excluded.ghl_contact_id, ti_sessions.ghl_contact_id),
            ghl_opportunity_id = coalesce(excluded.ghl_opportunity_id, ti_sessions.ghl_opportunity_id),
            state = excluded.state,
            updated_at = now()
    `,
      [resolvedCode, contactId, opportunityId, nextState],
    )
    await dbInsertSessionBackup({
      sessionCode: resolvedCode,
      contactId: contactId ?? existing?.ghl_contact_id ?? '',
      opportunityId: opportunityId ?? existing?.ghl_opportunity_id ?? '',
      state: nextState,
      previousState: existing?.state || null,
      reason: 'session_upsert',
    })
    invalidateDashboardAnalyticsCache()
  } catch (error) {
    recordDbFailure('dbUpsertSession failed, falling back to file store:', error, { code: String(code || '').trim() })
    if (STRICT_DB_MODE) {
      const wrapped = new Error('Database is temporarily unavailable.')
      wrapped.isTransientDb = true
      throw wrapped
    }
    await fallbackUpsertSession({ code, contactId, opportunityId, state })
  }
}

async function dbDeleteSession(code) {
  if (!pool || isDbCircuitOpen()) {
    if (STRICT_DB_MODE) {
      const error = new Error('Database is temporarily unavailable.')
      error.isTransientDb = true
      throw error
    }
    return fallbackDeleteSession(code)
  }
  try {
    const existing = await dbGetSession(code)
    if (!existing?.session_code) return false
    await pool.query('delete from ti_sessions where session_code=$1', [existing.session_code])
    invalidateDashboardAnalyticsCache()
    return true
  } catch (error) {
    recordDbFailure('dbDeleteSession failed, falling back to file store:', error, { code: String(code || '').trim() })
    if (STRICT_DB_MODE) {
      const wrapped = new Error('Database is temporarily unavailable.')
      wrapped.isTransientDb = true
      throw wrapped
    }
    return fallbackDeleteSession(code)
  }
}

async function dbGetOrCreateSession({ contactId = '', opportunityId = '' } = {}) {
  if (!pool || isDbCircuitOpen()) {
    if (STRICT_DB_MODE) {
      const error = new Error('Database is temporarily unavailable.')
      error.isTransientDb = true
      throw error
    }
    // Legacy behavior: allow creating sessions in fallback store.
    const existingCode =
      (opportunityId ? await fallbackFindSessionCode({ opportunityId }) : null) ||
      (contactId ? await fallbackFindSessionCode({ contactId }) : null)
    if (existingCode) return existingCode
    let code = generateSessionId()
    while (await fallbackGetSession(code)) code = generateSessionId()
    const state = initialRoomState()
    if (opportunityId) state.answers.ghl_opportunity_id = opportunityId
    if (contactId) state.answers.ghl_contact_id = contactId
    await fallbackUpsertSession({ code, contactId, opportunityId, state })
    return code
  }
  try {
    let res = null
    if (opportunityId) {
      res = await pool.query('select session_code from ti_sessions where ghl_opportunity_id=$1 order by updated_at desc limit 1', [opportunityId])
    }
    if (!res?.rows?.[0] && contactId) {
      res = await pool.query('select session_code from ti_sessions where ghl_contact_id=$1 order by updated_at desc limit 1', [contactId])
    }
    if (res.rows[0]?.session_code) return String(res.rows[0].session_code)
    let code = generateSessionId()
    // Extremely low collision chance, but just in case:
    while (await dbGetSession(code)) code = generateSessionId()
    const state = initialRoomState()
    if (opportunityId) state.answers.ghl_opportunity_id = opportunityId
    if (contactId) state.answers.ghl_contact_id = contactId
    await dbUpsertSession({ code, contactId, opportunityId, state })
    return code
  } catch (error) {
    recordDbFailure('dbGetOrCreateSession failed, falling back to file store:', error, {
      contactId: String(contactId || '').trim(),
      opportunityId: String(opportunityId || '').trim(),
    })
    if (STRICT_DB_MODE) {
      const wrapped = new Error('Database is temporarily unavailable.')
      wrapped.isTransientDb = true
      throw wrapped
    }
    const existingCode =
      (opportunityId ? await fallbackFindSessionCode({ opportunityId }) : null) ||
      (contactId ? await fallbackFindSessionCode({ contactId }) : null)
    if (existingCode) return existingCode
    let code = generateSessionId()
    while (await fallbackGetSession(code)) code = generateSessionId()
    const state = initialRoomState()
    if (opportunityId) state.answers.ghl_opportunity_id = opportunityId
    if (contactId) state.answers.ghl_contact_id = contactId
    await fallbackUpsertSession({ code, contactId, opportunityId, state })
    return code
  }
}

function getConsultationIdentityKey(item = {}) {
  const opportunityId = String(item?.opportunityId || '').trim()
  if (opportunityId) return `opp:${opportunityId}`
  const contactId = String(item?.contactId || '').trim()
  if (contactId) return `contact:${contactId}`
  const email = String(item?.email || '').trim().toLowerCase()
  if (email) return `email:${email}`
  return `session:${String(item?.sessionCode || '').trim()}`
}

function getConsultationIdentityUpdatedAt(item = {}) {
  return new Date(item?.updatedAt || item?.createdAt || 0).getTime()
}

function dedupeConsultationRecords(items = []) {
  const deduped = new Map()
  items.forEach((item) => {
    if (!item) return
    const key = getConsultationIdentityKey(item)
    const existing = deduped.get(key)
    if (!existing || getConsultationIdentityUpdatedAt(item) >= getConsultationIdentityUpdatedAt(existing)) {
      deduped.set(key, item)
    }
  })
  return Array.from(deduped.values())
}

function getPlaidClient() {
  const clientId = process.env.PLAID_CLIENT_ID
  const secret = process.env.PLAID_SECRET
  const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase()

  if (!clientId || !secret) return null

  const basePath =
    env === 'production'
      ? PlaidEnvironments.production
      : env === 'development'
        ? PlaidEnvironments.development
        : PlaidEnvironments.sandbox

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  })

  return new PlaidApi(configuration)
}

// In-memory Plaid token store (demo/dev only).
// For production: store access tokens encrypted in your DB, keyed by your user/customer id.
const plaidTokens = new Map()

app.post('/api/plaid/create_link_token', async (req, res) => {
  const plaid = getPlaidClient()
  if (!plaid) {
    return res.status(500).json({
      error: 'Missing Plaid environment variables. Set PLAID_CLIENT_ID and PLAID_SECRET on the server.',
    })
  }

  try {
    const clientUserId = String(req.body?.client_user_id || req.body?.userId || nanoid())
    const redirectUri = process.env.PLAID_REDIRECT_URI || undefined

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: clientUserId },
      client_name: 'TaxRefresh',
      products: ['auth'],
      country_codes: ['US'],
      language: 'en',
      redirect_uri: redirectUri,
    })

    return res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
      client_user_id: clientUserId,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Plaid linkTokenCreate failed:', err?.response?.data || err)
    return res.status(500).json({ error: 'Failed to create Plaid link token' })
  }
})

app.post('/api/plaid/exchange_public_token', async (req, res) => {
  const plaid = getPlaidClient()
  if (!plaid) {
    return res.status(500).json({
      error: 'Missing Plaid environment variables. Set PLAID_CLIENT_ID and PLAID_SECRET on the server.',
    })
  }

  const publicToken = String(req.body?.public_token || '')
  const clientUserId = String(req.body?.client_user_id || req.body?.userId || '')

  if (!publicToken) return res.status(400).json({ error: 'public_token is required' })

  try {
    const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id

    if (clientUserId) plaidTokens.set(clientUserId, { accessToken, itemId, createdAt: Date.now() })

    return res.json({ ok: true, item_id: itemId })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Plaid itemPublicTokenExchange failed:', err?.response?.data || err)
    return res.status(500).json({ error: 'Failed to exchange Plaid public token' })
  }
})

/**
 * In-memory room store (ephemeral runtime state: participants, screenshare, rep control).
 * Durable form state is persisted in Postgres (ti_sessions.state) when DATABASE_URL is set.
 */
const rooms = new Map()
const ROOM_MEMORY_IDLE_MS = 2 * 60 * 1000

function canReleaseRoomFromMemory(room) {
  if (!room) return false
  if (room.participants?.size) return false
  if (room.screenshareActive || room.pendingScreenshareFrom || room.repSocketId) return false
  if (room.repControlEnabled || room.repControlFrom) return false
  const lastPresenceAt = Number(room.lastClientPresenceAt || 0)
  if (lastPresenceAt && Date.now() - lastPresenceAt < ROOM_MEMORY_IDLE_MS) return false
  return true
}

function releaseRoomFromMemory(code = '', expectedRoom = null) {
  const variants = getCodeVariants(code)
  variants.forEach((variant) => {
    const current = rooms.get(variant)
    if (!current) return
    if (expectedRoom && current !== expectedRoom) return
    rooms.delete(variant)
  })
}

setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    if (canReleaseRoomFromMemory(room)) {
      releaseRoomFromMemory(code, room)
    }
  }
}, 60 * 1000).unref()

async function ensureRoom(code) {
  for (const candidate of getCodeVariants(code)) {
    if (rooms.has(candidate)) return rooms.get(candidate)
  }

  // Load durable state from DB/file store if available, otherwise start fresh.
  let state = initialRoomState()
  let contactId = null
  let opportunityId = null
  const row = await dbGetSession(code)
  if (row?.state) state = row.state
  if (row?.ghl_contact_id) contactId = String(row.ghl_contact_id)
  if (row?.ghl_opportunity_id) opportunityId = String(row.ghl_opportunity_id)
  if (!row) await dbUpsertSession({ code, state })
  const canonicalCode = String(row?.session_code || code)

  const room = {
    state,
    contactId,
    opportunityId,
    participants: new Map(),
    lastClientPresenceAt: 0,
    pendingScreenshareFrom: null,
    pendingScreenshareAt: null,
    screenshareActive: false,
    screenshareStartedAt: null,
    repSocketId: null,
    repControlEnabled: false,
    repControlFrom: null,
    repControlAt: null,
    lastGhlSyncSignature: '',
  }
  rooms.set(canonicalCode, room)
  return room
}

async function getSessionStateForCode(code) {
  const normalized = String(code || '').trim()
  if (!normalized) return null
  if (pool) {
    const variants = Array.from(new Set([normalized, normalized.toUpperCase(), normalized.toLowerCase()])).filter(Boolean)
    for (const candidate of variants) {
      const row = await dbGetSession(candidate)
      if (row?.state) return row.state
    }
    return null
  }
  const room = await ensureRoom(normalized)
  return room?.state || null
}

async function findLatestSessionByEmail(email = '') {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null

  if (pool) {
    const query = `
      select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
      from ti_sessions
      where
        lower(coalesce(state->'answers'->>'email', '')) = $1
        or lower(coalesce(state->'answers'->>'email_address', '')) = $1
      order by updated_at desc
      limit 1
    `
    const res = await pool.query(query, [normalized])
    return res.rows?.[0] || null
  }

  const persistedRows = await fallbackListSessions()
  const candidates = persistedRows
    .map((row) => {
      const answers = row?.state?.answers || {}
      const rowEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim().toLowerCase()
      if (!rowEmail || rowEmail !== normalized) return null
      return row
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  if (candidates[0]) return candidates[0]

  const liveCandidates = Array.from(rooms.entries())
    .map(([sessionCode, room]) => {
      const answers = room?.state?.answers || {}
      const rowEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim().toLowerCase()
      if (!rowEmail || rowEmail !== normalized) return null
      return {
        session_code: sessionCode,
        ghl_contact_id: room?.contactId || null,
        ghl_opportunity_id: room?.opportunityId || null,
        state: room?.state || null,
        created_at: null,
        updated_at: new Date(Number(room?.state?.updatedAt) || Date.now()),
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  return liveCandidates[0] || null
}

function getPortalPhoneDigits(value = '') {
  const digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.slice(0, 10)
}

function getDashboardPhoneForPortal(answers = {}) {
  return normalizePhoneForSms(getPrimaryAnswer(answers, ['phone', 'phone_number']) || '')
}

function maskPortalPhoneNumber(value = '') {
  const digits = getPortalPhoneDigits(value)
  if (digits.length !== 10) return String(value || '').trim()
  return `(***) ***-${digits.slice(6)}`
}

async function findLatestSessionByPhone(phone = '') {
  const normalizedDigits = getPortalPhoneDigits(phone)
  if (normalizedDigits.length !== 10) return null

  if (pool) {
    const query = `
      select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
      from ti_sessions
      where
        right(regexp_replace(coalesce(state->'answers'->>'phone', ''), '[^0-9]', '', 'g'), 10) = $1
        or right(regexp_replace(coalesce(state->'answers'->>'phone_number', ''), '[^0-9]', '', 'g'), 10) = $1
        or right(regexp_replace(coalesce(state->'answers'->>'mobile', ''), '[^0-9]', '', 'g'), 10) = $1
        or right(regexp_replace(coalesce(state->'answers'->>'mobile_phone', ''), '[^0-9]', '', 'g'), 10) = $1
        or right(regexp_replace(coalesce(state->'answers'->>'cell', ''), '[^0-9]', '', 'g'), 10) = $1
        or right(regexp_replace(coalesce(state->'answers'->>'cell_phone', ''), '[^0-9]', '', 'g'), 10) = $1
      order by updated_at desc
      limit 1
    `
    const res = await pool.query(query, [normalizedDigits])
    return res.rows?.[0] || null
  }

  const persistedRows = await fallbackListSessions()
  const candidates = persistedRows
    .map((row) => {
      const answers = row?.state?.answers || {}
      const rowDigits = getPortalPhoneDigits(getDashboardPhoneForPortal(answers))
      if (!rowDigits || rowDigits !== normalizedDigits) return null
      return row
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  if (candidates[0]) return candidates[0]

  const liveCandidates = Array.from(rooms.entries())
    .map(([sessionCode, room]) => {
      const answers = room?.state?.answers || {}
      const rowDigits = getPortalPhoneDigits(getDashboardPhoneForPortal(answers))
      if (!rowDigits || rowDigits !== normalizedDigits) return null
      return {
        session_code: sessionCode,
        ghl_contact_id: room?.contactId || null,
        ghl_opportunity_id: room?.opportunityId || null,
        state: room?.state || null,
        created_at: null,
        updated_at: new Date(Number(room?.state?.updatedAt) || Date.now()),
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  return liveCandidates[0] || null
}

function createPortalAuthSuccessPayload(row) {
  const answers = row?.state?.answers || {}
  return {
    code: String(row?.session_code || ''),
    clientName: String(getPrimaryAnswer(answers, ['full_name', 'name']) || '').trim(),
    contactId: row?.ghl_contact_id || '',
    opportunityId: row?.ghl_opportunity_id || '',
  }
}

function createPortalSmsCode() {
  const max = 10 ** CLIENT_PORTAL_SMS_CODE_LENGTH
  return String(crypto.randomInt(0, max)).padStart(CLIENT_PORTAL_SMS_CODE_LENGTH, '0')
}

function getPortalSmsMessage(code = '') {
  const minutes = Math.max(1, Math.round(CLIENT_PORTAL_SMS_CODE_TTL_MS / 60_000))
  return `TaxRefresh sign-in code: ${String(code || '').trim()}. This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

function cleanupExpiredPortalSmsCodes() {
  const now = Date.now()
  for (const [key, entry] of portalSmsCodeStore.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) portalSmsCodeStore.delete(key)
  }
}
function getAnswerSsnLast4(answers = {}) {
  const candidates = [
    'ssn_last4',
    'ssn_last_4',
    'ssn4',
    'last4_ssn',
    'ssn_last_four',
    'ssn_last_four_digits',
  ]
  for (const key of candidates) {
    const raw = answers?.[key]
    if (raw === null || raw === undefined) continue
    const digits = String(raw).replace(/\D/g, '')
    if (digits.length === 4) return digits
  }
  return ''
}

async function listConsultationRecords({ search = '', limit = 100 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(5000, Number(limit) || 100))
  if (pool) {
    const tokens = getConsultationSearchTokens(search)
    const hasSearch = tokens.length > 0
    const searchQueryLimit = hasSearch ? Math.min(1200, Math.max(normalizedLimit * 4, 400)) : normalizedLimit
    const params = []
    let whereClause = ''
    if (hasSearch) {
      const tokenClauses = tokens.map((token) => {
        const likeParamIndex = params.push(`%${token}%`)
        const digitToken = normalizeConsultationSearchDigits(token)
        const digitParamIndex = digitToken ? params.push(`%${digitToken}%`) : 0
        return `(
          coalesce(state->'answers'->>'name', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'full_name', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'email', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'email_address', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'phone', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'phone_number', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'ghl_opportunity_name', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'claimed_by_name', '') ilike $${likeParamIndex}
          or coalesce(state->'answers'->>'ghl_assigned_to', '') ilike $${likeParamIndex}
          or session_code ilike $${likeParamIndex}
          or coalesce(ghl_contact_id, '') ilike $${likeParamIndex}
          or coalesce(ghl_opportunity_id, '') ilike $${likeParamIndex}
          ${digitParamIndex ? `or regexp_replace(coalesce(state->'answers'->>'phone', ''), '\\D', '', 'g') ilike $${digitParamIndex}
          or regexp_replace(coalesce(state->'answers'->>'phone_number', ''), '\\D', '', 'g') ilike $${digitParamIndex}
          or regexp_replace(coalesce(session_code, ''), '\\D', '', 'g') ilike $${digitParamIndex}
          or regexp_replace(coalesce(ghl_contact_id, ''), '\\D', '', 'g') ilike $${digitParamIndex}
          or regexp_replace(coalesce(ghl_opportunity_id, ''), '\\D', '', 'g') ilike $${digitParamIndex}` : ''}
        )`
      })
      whereClause = `where ${tokenClauses.join('\n          and ')}`
    }
    params.push(searchQueryLimit)
    const query = hasSearch
      ? `
        select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
        from ti_sessions
        ${whereClause}
        order by updated_at desc
        limit $${params.length}
      `
      : `
        select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
        from ti_sessions
        order by updated_at desc
        limit $1
      `
    const res = await retry(
      async () => {
        try {
          return await pool.query(query, params)
        } catch (error) {
          if (!isTransientDbConnectionError(error)) error.noRetry = true
          throw error
        }
      },
      { attempts: 6, delayMs: 1000 },
    )
    const items = dedupeConsultationRecords(res.rows.map((row) =>
      buildConsultationSummary({
        sessionCode: row.session_code,
        contactId: row.ghl_contact_id,
        opportunityId: row.ghl_opportunity_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ))
    if (!hasSearch) return items
    return items
      .sort(
        (a, b) =>
          getConsultationSearchRank(b, search) - getConsultationSearchRank(a, search) ||
          getConsultationUpdatedAtValue(b) - getConsultationUpdatedAtValue(a) ||
          String(a.clientName || '').localeCompare(String(b.clientName || '')),
      )
      .slice(0, normalizedLimit)
  }

  const persistedRows = await fallbackListSessions()
  const persistedByCode = new Map(
    persistedRows.map((row) => [
      String(row.session_code),
      buildConsultationSummary({
        sessionCode: row.session_code,
        contactId: row.ghl_contact_id,
        opportunityId: row.ghl_opportunity_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ]),
  )

  Array.from(rooms.entries()).forEach(([sessionCode, room]) => {
    persistedByCode.set(
      sessionCode,
      buildConsultationSummary({
        sessionCode,
        contactId: room?.contactId,
        opportunityId: room?.opportunityId,
        state: room?.state,
        createdAt: room?.state?.updatedAt || Date.now(),
        updatedAt: room?.state?.updatedAt || Date.now(),
      }),
    )
  })

  return dedupeConsultationRecords(Array.from(persistedByCode.values()))
    .filter((entry) => consultationMatchesSearch(entry, search))
    .sort(
      (a, b) =>
        getConsultationSearchRank(b, search) - getConsultationSearchRank(a, search) ||
        getConsultationUpdatedAtValue(b) - getConsultationUpdatedAtValue(a) ||
        String(a.clientName || '').localeCompare(String(b.clientName || '')),
    )
    .slice(0, normalizedLimit)
}

async function getConsultationRecordByCode(code) {
  const normalized = String(code || '').trim()
  if (!normalized) return null
  const row = await dbGetSession(normalized)
  if (row) {
    const repairKey = String(row.session_code || normalized).trim()
    const lastRepairAt = consultationIntegrityRepairTimestamps.get(repairKey) || 0
    if (Date.now() - lastRepairAt >= CONSULTATION_INTEGRITY_REPAIR_COOLDOWN_MS) {
      consultationIntegrityRepairTimestamps.set(repairKey, Date.now())
      void repairConsultationRecordIntegrity({
        roomCode: row.session_code,
        state: row.state,
        persist: async (nextState) => {
          row.state = nextState
          await dbUpsertSession({ code: row.session_code, state: nextState })
        },
      }).catch(() => {})
    }
    return attachSmsThreadToConsultationDetail(buildConsultationDetail({
      sessionCode: row.session_code,
      contactId: row.ghl_contact_id,
      opportunityId: row.ghl_opportunity_id,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }
  const room = rooms.get(normalized) || rooms.get(normalized.toUpperCase()) || rooms.get(normalized.toLowerCase())
  if (!room) return null
  const lastRepairAt = consultationIntegrityRepairTimestamps.get(normalized) || 0
  if (Date.now() - lastRepairAt >= CONSULTATION_INTEGRITY_REPAIR_COOLDOWN_MS) {
    consultationIntegrityRepairTimestamps.set(normalized, Date.now())
    void repairConsultationRecordIntegrity({
      roomCode: normalized,
      state: room.state,
      persist: async (nextState) => {
        room.state = nextState
        await dbUpsertSession({ code: normalized, state: nextState })
      },
    }).catch(() => {})
  }
  return attachSmsThreadToConsultationDetail(buildConsultationDetail({
    sessionCode: normalized,
    contactId: room.contactId,
    opportunityId: room.opportunityId,
    state: room.state,
    createdAt: room.state?.updatedAt || Date.now(),
    updatedAt: room.state?.updatedAt || Date.now(),
  }))
}

app.post('/api/admin/consultations/auth', (req, res) => {
  if (!requireAdminAccess(req, res)) return
  return res.json({
    ok: true,
    user: req.adminUser || null,
    designatedPositions: ADMIN_DESIGNATED_POSITIONS,
    adminUsers: listAdminDirectory(),
  })
})

app.get('/api/admin/diagnostics/data', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const now = Date.now()
    const diagnostics = {
      at: new Date(now).toISOString(),
      poolConfigured: Boolean(pool),
      dbCircuitOpen: Boolean(isDbCircuitOpen()),
      dbCircuitOpenForMs: Math.max(0, dbCircuitOpenUntil - now),
      dbLastFailureAt: dbLastFailureAt ? new Date(dbLastFailureAt).toISOString() : '',
      dbLastFailureMessage,
      fallbackStorePath: SESSION_STORE_PATH,
      fallbackStoreLoaded: Boolean(fallbackStoreLoaded),
      fallbackSessionCount: fallbackSessions.size,
      liveRoomCount: rooms.size,
      dbReady: false,
      dbSessionCount: null,
      dbLatestUpdatedAt: '',
      dbBackupCount: null,
    }

    if (!pool) return res.json({ ok: true, diagnostics })

    // Quick "is the DB accepting connections" check + counts (read-only).
    try {
      const ready = await retry(
        async () => {
          try {
            await pool.query('select 1 as ok')
            return true
          } catch (error) {
            if (!isTransientDbConnectionError(error)) error.noRetry = true
            throw error
          }
        },
        { attempts: 3, delayMs: 800 },
      )
      diagnostics.dbReady = Boolean(ready)
    } catch (error) {
      recordDbFailure('diagnostics db readiness check failed:', error, {})
      diagnostics.dbReady = false
    }

    if (diagnostics.dbReady) {
      try {
        const counts = await pool.query(
          `select
              (select count(*)::int from ti_sessions) as session_count,
              (select coalesce(max(updated_at), now()) from ti_sessions) as latest_updated_at,
              (select count(*)::int from ti_session_backups) as backup_count
          `,
        )
        diagnostics.dbSessionCount = counts?.rows?.[0]?.session_count ?? null
        diagnostics.dbLatestUpdatedAt = counts?.rows?.[0]?.latest_updated_at
          ? new Date(counts.rows[0].latest_updated_at).toISOString()
          : ''
        diagnostics.dbBackupCount = counts?.rows?.[0]?.backup_count ?? null
      } catch (error) {
        recordDbFailure('diagnostics db count query failed:', error, {})
      }
    }

    return res.json({ ok: true, diagnostics })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load diagnostics' })
  }
})

app.get('/api/admin/diagnostics/consultation/:code', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })

    const diagnostics = {
      requestedCode: roomCode,
      codeVariants: getCodeVariants(roomCode),
      dbReady: Boolean(pool) && !isDbCircuitOpen(),
      sessionFound: false,
      backupCount: 0,
      sessionCode: '',
      sessionUpdatedAt: '',
      sessionCreatedAt: '',
      currentAnswerStats: {
        nonEmptyCriticalKeyCount: 0,
        missingCriticalKeys: [],
      },
      currentPreview: null,
      currentSparsity: null,
      backupLatestAt: '',
      backupAnswerStats: {
        nonEmptyCriticalKeyCount: 0,
        missingCriticalKeys: [],
      },
      backupPreview: null,
      backupSparsity: null,
      restorableKeys: [],
      likelyBlankRecord: false,
    }

    if (!pool) return res.status(503).json({ error: 'Database is not configured.', diagnostics })
    if (isDbCircuitOpen()) return res.status(503).json({ error: 'Database temporarily unavailable.', reason: 'db_circuit_open', diagnostics })

    const variantList = diagnostics.codeVariants
    const [sessionRes, backupCountRes, latestBackupRes] = await Promise.all([
      pool.query(
        `select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
         from ti_sessions
         where session_code = any($1::text[])
         order by updated_at desc
         limit 1`,
        [variantList],
      ),
      pool.query(
        `select count(*)::int as backup_count
         from ti_session_backups
         where session_code = any($1::text[])`,
        [variantList],
      ),
      pool.query(
        `select session_code, payload, created_at
         from ti_session_backups
         where session_code = any($1::text[])
         order by created_at desc
         limit 1`,
        [variantList],
      ),
    ])

    const row = sessionRes.rows?.[0] || null
    const latestBackup = latestBackupRes.rows?.[0] || null
    diagnostics.backupCount = backupCountRes.rows?.[0]?.backup_count ?? 0

    if (row) {
      diagnostics.sessionFound = true
      diagnostics.sessionCode = String(row.session_code || '').trim()
      diagnostics.sessionUpdatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : ''
      diagnostics.sessionCreatedAt = row.created_at ? new Date(row.created_at).toISOString() : ''
      const currentAnswers = row.state?.answers && typeof row.state.answers === 'object' ? row.state.answers : {}
      const missingCriticalKeys = getMissingCriticalAnswerKeys(currentAnswers)
      diagnostics.currentAnswerStats.nonEmptyCriticalKeyCount = SESSION_BACKUP_RESTORE_ANSWER_KEYS.length - missingCriticalKeys.length
      diagnostics.currentAnswerStats.missingCriticalKeys = missingCriticalKeys
      diagnostics.currentPreview = buildConsultationAnswersPreview(currentAnswers)
      diagnostics.currentSparsity = getConsultationSparsityFlags(currentAnswers)
    }

    if (latestBackup?.payload?.answers && typeof latestBackup.payload.answers === 'object') {
      const backupAnswers = latestBackup.payload.answers
      const missingBackupKeys = getMissingCriticalAnswerKeys(backupAnswers)
      diagnostics.backupLatestAt = latestBackup.created_at ? new Date(latestBackup.created_at).toISOString() : ''
      diagnostics.backupAnswerStats.nonEmptyCriticalKeyCount = SESSION_BACKUP_RESTORE_ANSWER_KEYS.length - missingBackupKeys.length
      diagnostics.backupAnswerStats.missingCriticalKeys = missingBackupKeys
      diagnostics.backupPreview = buildConsultationAnswersPreview(backupAnswers)
      diagnostics.backupSparsity = getConsultationSparsityFlags(backupAnswers)
      diagnostics.restorableKeys = getRestorableCriticalAnswerKeys(row?.state?.answers || {}, backupAnswers)
    }

    diagnostics.likelyBlankRecord = Boolean(
      diagnostics.sessionFound &&
        diagnostics.currentSparsity &&
        diagnostics.currentSparsity.coreProfileSparse &&
        diagnostics.currentSparsity.workflowSparse,
    )

    return res.json({ ok: true, diagnostics })
  } catch (error) {
    if (isTransientDbConnectionError(error) || error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load consultation diagnostics' })
  }
})

app.get('/api/admin/consultations/:code/events', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const limitRaw = Number(req.query?.limit)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!pool) return res.status(503).json({ error: 'Database is not configured.' })
    if (isDbCircuitOpen()) return res.status(503).json({ error: 'Database temporarily unavailable.', reason: 'db_circuit_open' })

    const { rows } = await pool.query(
      `
      select id, session_code as "sessionCode", event_type as "eventType", domain, actor_email as "actorEmail",
             idempotency_key as "idempotencyKey", request_id as "requestId", payload, created_at as "createdAt"
      from ti_events
      where session_code = $1
      order by created_at desc
      limit $2
    `,
      [roomCode, limit],
    )

    return res.json({ ok: true, sessionCode: roomCode, events: rows })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load event log' })
  }
})

app.get('/api/admin/consultations', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    let items = await listConsultationRecords({
      search: String(req.query?.search || ''),
      limit: Number(req.query?.limit || 100),
    })
    if (String(req.adminUser?.designatedPosition || '').trim() === 'Enrolled Agent') {
      items = items.filter((item) => canEnrolledAgentAccessItem(item, req.adminUser))
    }
    const snapshot = buildSnapshotMetaFromItems(items, { source: Boolean(pool) && !isDbCircuitOpen() ? 'db' : 'fallback' })
    return res.json({ items, snapshot })
  } catch (error) {
    if (isTransientDbConnectionError(error)) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load consultation records' })
  }
})

app.get('/api/admin/consultations/analytics', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const cacheKey = getDashboardAnalyticsCacheKey(req.adminUser || null)
    const cachedAnalytics = getCachedDashboardAnalytics(cacheKey)
    if (cachedAnalytics) {
      return res.json({ analytics: cachedAnalytics, snapshot: buildSnapshotMeta({ source: Boolean(pool) && !isDbCircuitOpen() ? 'db' : 'fallback', updatedAt: Date.now() }) })
    }
    const items = await listAllConsultationDetails()
    const analytics = buildConsultationAnalytics(items, req.adminUser || null)
    setCachedDashboardAnalytics(cacheKey, analytics)
    return res.json({
      analytics,
      snapshot: buildSnapshotMetaFromItems(items, { source: Boolean(pool) && !isDbCircuitOpen() ? 'db' : 'fallback' }),
    })
  } catch (error) {
    if (isTransientDbConnectionError(error)) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load dashboard analytics' })
  }
})

app.post('/api/admin/consultations/sync-ghl', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const summary = await syncAllGhlOpportunitiesToDashboard()
    return res.json({ ok: true, summary })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync GoHighLevel opportunities' })
  }
})

app.get('/api/admin/calendly', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const diagnostics = getCalendlyConfigDiagnostics()
    if (!diagnostics.ready) {
      return res.json({
        ready: false,
        webhookConnected: false,
        callbackUrl: buildCalendlyWebhookCallbackUrl(req),
        statusMessage: diagnostics.statusMessage,
        missingEnvVars: diagnostics.missingEnvVars,
        eventTypes: [],
      })
    }
    const [identity, eventTypes, subscriptions] = await Promise.all([
      getCalendlyIdentity(),
      listCalendlyEventTypes(),
      listCalendlyWebhookSubscriptions(req),
    ])
    return res.json({
      ready: true,
      callbackUrl: buildCalendlyWebhookCallbackUrl(req),
      webhookConnected: subscriptions.some((item) => String(item?.state || '').trim() === 'active'),
      statusMessage: diagnostics.statusMessage,
      missingEnvVars: diagnostics.missingEnvVars,
      user: {
        uri: normalizeCalendlyUri(identity?.uri),
        name: String(identity?.name || '').trim(),
        email: String(identity?.email || '').trim(),
        organization: normalizeCalendlyUri(identity?.current_organization || identity?.organization),
      },
      eventTypes,
    })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load Calendly configuration.' })
  }
})

app.post('/api/admin/calendly/connect', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const subscription = await ensureCalendlyWebhookSubscription(req)
    return res.json({ ok: true, subscription })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to connect Calendly webhook sync.' })
  }
})

app.post('/api/admin/calendly/sync', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const summary = await importCalendlyScheduledEvents()
    return res.json({ ok: true, summary })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync Calendly scheduled events.' })
  }
})

app.post('/api/admin/consultations/:code/calendly/booking-link', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const currentItem = await getConsultationRecordByCode(roomCode)
    if (!currentItem) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(currentItem, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    const eventTypeUri = normalizeCalendlyUri(req.body?.eventTypeUri)
    if (!eventTypeUri) return res.status(400).json({ error: 'Calendly event type is required.' })
    const eventTypes = await listCalendlyEventTypes()
    const selectedEventType = eventTypes.find((item) => item.uri === eventTypeUri)
    if (!selectedEventType?.schedulingUrl) {
      return res.status(400).json({ error: 'Selected Calendly event type is unavailable for booking.' })
    }
    const bookingUrl = buildCalendlyBookingUrl(selectedEventType.schedulingUrl, {
      sessionCode: roomCode,
      clientName: currentItem.clientName || '',
      clientEmail: currentItem.email || '',
    })
    const room = await ensureRoom(roomCode)
    const nextState = room?.state || initialRoomState()
    const nextAnswers = { ...(nextState.answers || {}) }
    nextAnswers.calendly_selected_event_type_uri = selectedEventType.uri
    nextAnswers.calendly_selected_event_type_name = selectedEventType.name
    nextAnswers.calendly_last_booking_url = bookingUrl
    nextAnswers.calendly_last_booking_url_created_at = new Date().toISOString()
    nextState.answers = nextAnswers
    room.state = nextState
    await dbUpsertSession({
      code: roomCode,
      contactId: room.contactId || currentItem.contactId || null,
      opportunityId: room.opportunityId || currentItem.opportunityId || null,
      state: nextState,
    })
    return res.json({
      ok: true,
      bookingUrl,
      eventType: selectedEventType,
    })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create Calendly booking link.' })
  }
})

app.get('/api/admin/consultations/:code', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    // Strict read for admin: never show partial data from fallback store when Postgres is down.
    // If Postgres is unavailable, return a 503 so the UI can retry instead of showing empty fields.
    const row = await dbGetSessionStrict(req.params.code)
    if (!row) return res.status(404).json({ error: 'Consultation record not found' })
    await restoreCriticalSessionDataFromBackupIfMissing({
      roomCode: row.session_code,
      state: row.state,
      persist: async (nextState) => {
        row.state = nextState
        await dbUpsertSession({
          code: row.session_code,
          contactId: row.ghl_contact_id,
          opportunityId: row.ghl_opportunity_id,
          state: nextState,
        })
      },
    })
    const item = await attachSmsThreadToConsultationDetail(buildConsultationDetail({
      sessionCode: row.session_code,
      contactId: row.ghl_contact_id,
      opportunityId: row.ghl_opportunity_id,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    if (!item) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    return res.json({ item, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: row.updated_at || item?.updatedAt || null }) })
  } catch (error) {
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    if (isTransientDbConnectionError(error)) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load consultation detail' })
  }
})

app.delete('/api/admin/consultations/:code', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const item = await getConsultationRecordByCode(roomCode)
    if (!item) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    await dbDeleteSession(item.sessionCode)
    for (const candidate of getCodeVariants(item.sessionCode)) {
      if (rooms.has(candidate)) rooms.delete(candidate)
    }
    io.to(item.sessionCode).emit('room_deleted', { sessionCode: item.sessionCode, deletedAt: new Date().toISOString() })
    return res.json({ ok: true, deletedCode: item.sessionCode })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete consultation record' })
  }
})

app.post('/api/admin/consultations/:code/appointments/internal', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const currentItem = await getConsultationRecordByCode(roomCode)
    if (!currentItem) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(currentItem, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }

    const title = String(req.body?.title || '').trim() || 'Appointment'
    const startAt = String(req.body?.startAt || '').trim()
    const endAt = String(req.body?.endAt || '').trim()
    const notes = String(req.body?.notes || '').trim()
    const assignedTo = String(req.body?.assignedTo || '').trim()
    if (!startAt || !endAt) return res.status(400).json({ error: 'Start and end time are required.' })
    if (Number.isNaN(new Date(startAt).getTime()) || Number.isNaN(new Date(endAt).getTime())) {
      return res.status(400).json({ error: 'Start and end time must be valid date values.' })
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return res.status(400).json({ error: 'End time must be after the start time.' })
    }

    const room = await ensureRoom(roomCode)
    const nextState = room?.state || initialRoomState()
    const nextAnswers = { ...(nextState.answers || {}) }
    const existingAppointments = parseStoredInternalAppointments(nextAnswers.internal_appointments)
    const appointment = {
      id: generateInternalAppointmentId(),
      title,
      status: 'scheduled',
      startAt,
      endAt,
      notes,
      calendarName: 'Dashboard',
      assignedTo: assignedTo || String(currentItem.claimedByName || currentItem.assignedEaName || currentItem.assignedTo || req.adminUser?.displayName || '').trim(),
      createdByName: String(req.adminUser?.displayName || '').trim(),
      createdByEmail: String(req.adminUser?.email || '').trim(),
      updatedAt: new Date().toISOString(),
      source: 'internal',
    }
    nextAnswers.internal_appointments = stringifyStructuredValue(upsertInternalAppointment(existingAppointments, appointment), '[]')
    nextState.answers = nextAnswers
    room.state = nextState
    await dbUpsertSession({
      code: roomCode,
      contactId: room.contactId || currentItem.contactId || null,
      opportunityId: room.opportunityId || currentItem.opportunityId || null,
      state: nextState,
    })

    const item = await getConsultationRecordByCode(roomCode)
    emitDashboardRecordsUpdated({ reason: 'internal_appointment_created', roomCode, appointmentId: appointment.id })
    return res.json({ ok: true, appointment: normalizeInternalAppointment(appointment), item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create appointment.' })
  }
})

app.patch('/api/admin/consultations/:code/appointments/internal/:appointmentId', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const appointmentId = String(req.params.appointmentId || '').trim()
    if (!roomCode || !appointmentId) return res.status(400).json({ error: 'Consultation code and appointment ID are required.' })
    const currentItem = await getConsultationRecordByCode(roomCode)
    if (!currentItem) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(currentItem, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }

    const room = await ensureRoom(roomCode)
    const nextState = room?.state || initialRoomState()
    const nextAnswers = { ...(nextState.answers || {}) }
    const existingAppointments = parseStoredInternalAppointments(nextAnswers.internal_appointments)
    const index = existingAppointments.findIndex((item) => String(item?.id || '').trim() === appointmentId)
    if (index < 0) return res.status(404).json({ error: 'Appointment not found.' })
    const currentAppointment = normalizeInternalAppointment(existingAppointments[index])
    const title = req.body?.title === undefined ? currentAppointment.title : String(req.body?.title || '').trim() || 'Appointment'
    const startAt = req.body?.startAt === undefined ? currentAppointment.startAt : String(req.body?.startAt || '').trim()
    const endAt = req.body?.endAt === undefined ? currentAppointment.endAt : String(req.body?.endAt || '').trim()
    const notes = req.body?.notes === undefined ? currentAppointment.notes : String(req.body?.notes || '').trim()
    const status = req.body?.status === undefined ? currentAppointment.status : String(req.body?.status || '').trim() || currentAppointment.status
    const assignedTo = req.body?.assignedTo === undefined ? currentAppointment.assignedTo : String(req.body?.assignedTo || '').trim()
    if (!startAt || !endAt) return res.status(400).json({ error: 'Start and end time are required.' })
    if (Number.isNaN(new Date(startAt).getTime()) || Number.isNaN(new Date(endAt).getTime())) {
      return res.status(400).json({ error: 'Start and end time must be valid date values.' })
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return res.status(400).json({ error: 'End time must be after the start time.' })
    }

    const nextAppointment = {
      ...existingAppointments[index],
      ...currentAppointment,
      title,
      startAt,
      endAt,
      notes,
      status,
      assignedTo,
      updatedAt: new Date().toISOString(),
      canceledAt: status === 'canceled' ? new Date().toISOString() : '',
    }
    existingAppointments[index] = nextAppointment
    nextAnswers.internal_appointments = stringifyStructuredValue(existingAppointments, '[]')
    nextState.answers = nextAnswers
    room.state = nextState
    await dbUpsertSession({
      code: roomCode,
      contactId: room.contactId || currentItem.contactId || null,
      opportunityId: room.opportunityId || currentItem.opportunityId || null,
      state: nextState,
    })

    const item = await getConsultationRecordByCode(roomCode)
    emitDashboardRecordsUpdated({ reason: 'internal_appointment_updated', roomCode, appointmentId })
    return res.json({ ok: true, appointment: normalizeInternalAppointment(nextAppointment), item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update appointment.' })
  }
})

app.post('/api/admin/consultations/:code/soft-credit-check', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const currentItem = await getConsultationRecordByCode(roomCode)
    if (!currentItem) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(currentItem, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    const room = await ensureRoom(roomCode)
    const creditCheck = await runSoftCreditCheckForRoom({
      roomCode,
      room,
      consentGranted: true,
      source: 'admin_dashboard',
      force: Boolean(req.body?.force),
      requestedBy: String(req.adminUser?.email || req.adminUser?.uid || 'dashboard').trim(),
      ipAddress: getRequestIp(req),
      userAgent: String(req.headers['user-agent'] || '').trim(),
    })
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, creditCheck, item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to run soft credit check.' })
  }
})

app.post('/api/admin/consultations/:code/sms', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const message = String(req.body?.message || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!message) return res.status(400).json({ error: 'SMS message is required' })

    const room = await ensureRoom(roomCode)
    const currentItem = await getConsultationRecordByCode(roomCode)
    if (!currentItem) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(currentItem, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }

    const contactId = String(room.contactId || currentItem.contactId || currentItem.answers?.ghl_contact_id || '').trim()
    const phoneNumber = normalizePhoneForSms(currentItem.phone || currentItem.answers?.phone || currentItem.answers?.phone_number || '')
    if (!contactId) return res.status(400).json({ error: 'This consultation is missing a GoHighLevel contact id.' })
    if (!phoneNumber) return res.status(400).json({ error: 'This consultation is missing a valid phone number for SMS.' })

    const response = await sendGhlSmsMessage({ contactId, phoneNumber, message })
    const conversationId = String(response?.conversationId || currentItem.smsConversationId || '').trim()
    const outboundEntry = normalizeSmsThreadEntry({
      id: String(response?.messageId || '').trim(),
      conversationId,
      contactId,
      body: message,
      direction: 'outbound',
      status: 'delivered',
      messageType: 'SMS',
      dateAdded: new Date().toISOString(),
      from: '',
      to: phoneNumber,
      source: 'dashboard',
      userId: String(req.adminUser?.email || '').trim(),
    })

    await persistSmsThreadForRoom({ roomCode, room, entries: [outboundEntry], conversationId, contactId })
    emitDashboardRecordsUpdated({ reason: 'ghl_sms_outbound', sessionCode: roomCode, contactId, opportunityId: room.opportunityId || '' })

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, conversationId, messageId: String(response?.messageId || '') })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send SMS message.' })
  }
})

app.get('/api/admin/consultations/:code/signed-8821', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const item = await getConsultationRecordByCode(req.params.code)
    if (!item) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }

    const answers = item.answers || {}
    if (!String(answers.boldsign_8821_document_id || '').trim()) {
      return res.status(404).json({ error: 'No signed Form 8821 document is available for this client yet.' })
    }
    if (!isForm8821FullySigned(answers)) {
      return res.status(409).json({ error: 'Form 8821 is not fully signed yet.' })
    }

    const roomCode = String(item.sessionCode || req.params.code || '').toUpperCase().trim()
    const room = await ensureRoom(roomCode)
    await reconcileBoldsign8821Status({
      roomCode,
      state: room?.state,
      persist: async (nextState) => {
        if (!room) return
        room.state = nextState
        await dbUpsertSession({ code: roomCode, state: nextState })
      },
    })
    const payload = await loadSigned8821DocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      await ensureSigned8821StoredOnRecord(roomCode, room).catch(() => false)
      const retryPayload = await loadSigned8821DocumentPayload(roomCode, room)
      if (!retryPayload?.fileBuffer?.length) {
        return res.status(404).json({ error: 'No signed Form 8821 document is available for this client yet.' })
      }
      res.setHeader('Content-Type', retryPayload.contentType || 'application/pdf')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader(
        'Content-Disposition',
        `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${retryPayload.filename || 'signed-document.pdf'}"`,
      )
      return res.send(retryPayload.fileBuffer)
    }

    res.setHeader('Content-Type', payload.contentType || 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${payload.filename || 'signed-document.pdf'}"`)
    return res.send(payload.fileBuffer)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signed Form 8821.' })
  }
})

app.get('/api/admin/consultations/:code/signed-8821-page-1', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const item = await getConsultationRecordByCode(req.params.code)
    if (!item) return res.status(404).json({ error: 'Consultation not found.' })
    const answers = item.answers || {}
    if (!String(answers.boldsign_8821_document_id || '').trim()) {
      return res.status(404).json({ error: 'No signed Form 8821 page 1 document is available for this client yet.' })
    }
    if (!isForm8821FullySigned(answers)) {
      return res.status(409).json({ error: 'Form 8821 is not fully signed yet.' })
    }
    const roomCode = String(item.sessionCode || req.params.code || '').toUpperCase().trim()
    const room = await ensureRoom(roomCode)
    await reconcileBoldsign8821Status({
      roomCode,
      state: room?.state,
      persist: async (nextState) => {
        if (!room) return
        room.state = nextState
        await dbUpsertSession({ code: roomCode, state: nextState })
      },
    })
    const payload = await loadSigned8821FirstPageDocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      await ensureSigned8821StoredOnRecord(roomCode, room).catch(() => false)
      const retryPayload = await loadSigned8821FirstPageDocumentPayload(roomCode, room)
      if (!retryPayload?.fileBuffer?.length) {
        return res.status(404).json({ error: 'No signed Form 8821 page 1 document is available for this client yet.' })
      }
      res.setHeader('Content-Type', retryPayload.contentType || 'application/pdf')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader(
        'Content-Disposition',
        `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${retryPayload.filename || 'signed-8821-page-1.pdf'}"`,
      )
      return res.send(retryPayload.fileBuffer)
    }
    res.setHeader('Content-Type', payload.contentType || 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${payload.filename || 'signed-8821-page-1.pdf'}"`)
    return res.send(payload.fileBuffer)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signed Form 8821 page 1.' })
  }
})

app.get('/api/admin/consultations/:code/signed-resolution', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const item = await getConsultationRecordByCode(req.params.code)
    if (!item) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }

    const answers = item.answers || {}
    const documentId = String(answers.boldsign_resolution_document_id || '').trim()
    if (!documentId) {
      return res.status(404).json({ error: 'No signed Form 2848 document is available for this client yet.' })
    }
    if (!String(answers.boldsign_resolution_signed_at || '').trim()) {
      return res.status(409).json({ error: 'Form 2848 is not fully signed yet.' })
    }

    const download = await boldsignDownloadDocument(documentId, {
      onBehalfOf: String(answers.boldsign_resolution_sender_email || '').trim() || undefined,
    })
    if (!download?.fileBuffer?.length) {
      return res.status(404).json({ error: 'No signed Form 2848 document is available for this client yet.' })
    }

    const filenameRaw = String(answers.boldsign_resolution_file_name || '').trim()
    const filename = filenameRaw ? (/\.pdf$/i.test(filenameRaw) ? filenameRaw : `${filenameRaw}.pdf`) : getSavedResolutionFilename(answers)
    res.setHeader('Content-Type', download.contentType || 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`)
    return res.send(download.fileBuffer)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signed Form 2848.' })
  }
})

app.get('/api/session/:code/signed-8821', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').toUpperCase().trim()
    if (!roomCode) return res.status(400).json({ error: 'Session code is required.' })

    const room = await ensureRoom(roomCode)
    await reconcileBoldsign8821Status({
      roomCode,
      state: room?.state,
      persist: async (nextState) => {
        if (!room) return
        room.state = nextState
        await dbUpsertSession({ code: roomCode, state: nextState })
      },
    })
    const answers = room?.state?.answers || {}
    if (!isForm8821FullySigned(answers)) return res.status(409).json({ error: 'Form 8821 is not fully signed yet.' })

    const payload = await loadSigned8821DocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      await ensureSigned8821StoredOnRecord(roomCode, room).catch(() => false)
      const retryPayload = await loadSigned8821DocumentPayload(roomCode, room)
      if (!retryPayload?.fileBuffer?.length) {
        return res.status(404).json({ error: 'No signed Form 8821 document is available for this session yet.' })
      }
      res.setHeader('Content-Type', retryPayload.contentType || 'application/pdf')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader(
        'Content-Disposition',
        `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${retryPayload.filename || 'signed-document.pdf'}"`,
      )
      return res.send(retryPayload.fileBuffer)
    }

    res.setHeader('Content-Type', payload.contentType || 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${payload.filename || 'signed-document.pdf'}"`)
    return res.send(payload.fileBuffer)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signed Form 8821.' })
  }
})

app.get('/api/session/:code/signed-8821-page-1', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').toUpperCase().trim()
    if (!roomCode) return res.status(400).json({ error: 'Session code is required.' })
    const room = await ensureRoom(roomCode)
    if (!room) return res.status(404).json({ error: 'Session not found.' })
    await reconcileBoldsign8821Status({
      roomCode,
      state: room?.state,
      persist: async (nextState) => {
        room.state = nextState
        await dbUpsertSession({ code: roomCode, state: nextState })
      },
    })
    const answers = room.state.answers || {}
    if (!isForm8821FullySigned(answers)) return res.status(409).json({ error: 'Form 8821 is not fully signed yet.' })
    const payload = await loadSigned8821FirstPageDocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      await ensureSigned8821StoredOnRecord(roomCode, room).catch(() => false)
      const retryPayload = await loadSigned8821FirstPageDocumentPayload(roomCode, room)
      if (!retryPayload?.fileBuffer?.length) {
        return res.status(404).json({ error: 'No signed Form 8821 page 1 document is available for this session.' })
      }
      res.setHeader('Content-Type', retryPayload.contentType || 'application/pdf')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader(
        'Content-Disposition',
        `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${retryPayload.filename || 'signed-8821-page-1.pdf'}"`,
      )
      return res.send(retryPayload.fileBuffer)
    }
    res.setHeader('Content-Type', payload.contentType || 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${payload.filename || 'signed-8821-page-1.pdf'}"`)
    return res.send(payload.fileBuffer)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signed Form 8821 page 1.' })
  }
})

app.patch('/api/admin/consultations/:code/answers/:key', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const answerKey = String(req.params.key || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!answerKey) return res.status(400).json({ error: 'Answer key is required' })
    if (String(req.adminUser?.designatedPosition || '').trim() === 'Enrolled Agent' && !ENROLLED_AGENT_ALLOWED_ANSWER_KEYS.has(answerKey)) {
      return res.status(403).json({ error: 'You do not have permission to update this field.' })
    }

    const room = await ensureRoom(roomCode)
    if (String(req.adminUser?.designatedPosition || '').trim() === 'Enrolled Agent') {
      const currentItem = await getConsultationRecordByCode(roomCode)
      if (!canEnrolledAgentAccessItem(currentItem, req.adminUser)) {
        return res.status(403).json({ error: 'You do not have access to this consultation record.' })
      }
    }
    const nextValue = req.body?.value
    const normalizedValue = nextValue === null || nextValue === undefined ? '' : nextValue
    const previousNotes = answerKey === 'consultation_notes' ? room.state.answers?.consultation_notes : null
    room.state.answers[answerKey] = normalizedValue
    mirrorAnswerAliases(room.state.answers, answerKey, normalizedValue)
    if (answerKey === 'name' || answerKey === 'full_name') {
      const fullName = String(room.state.answers[answerKey] || '').trim()
      const { firstName, lastName } = deriveNameParts(fullName)
      room.state.answers.name = fullName
      room.state.answers.full_name = fullName
      room.state.answers.first_name = firstName
      room.state.answers.last_name = lastName
    } else if (answerKey === 'first_name' || answerKey === 'last_name') {
      const firstName = String(answerKey === 'first_name' ? room.state.answers.first_name : room.state.answers.first_name || '').trim()
      const lastName = String(answerKey === 'last_name' ? room.state.answers.last_name : room.state.answers.last_name || '').trim()
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
      room.state.answers.name = fullName
      room.state.answers.full_name = fullName
    }
    const patches = [{ type: 'setAnswer', questionId: answerKey, value: room.state.answers[answerKey] }]
    if (answerKey === 'name' || answerKey === 'full_name') {
      patches.push({ type: 'setAnswer', questionId: 'name', value: room.state.answers.name })
      patches.push({ type: 'setAnswer', questionId: 'full_name', value: room.state.answers.full_name })
      patches.push({ type: 'setAnswer', questionId: 'first_name', value: room.state.answers.first_name })
      patches.push({ type: 'setAnswer', questionId: 'last_name', value: room.state.answers.last_name })
    } else if (answerKey === 'first_name' || answerKey === 'last_name') {
      patches.push({ type: 'setAnswer', questionId: 'name', value: room.state.answers.name })
      patches.push({ type: 'setAnswer', questionId: 'full_name', value: room.state.answers.full_name })
    }

    await adminPersistRoomStateAndLog({
      req,
      roomCode,
      room,
      patches,
      eventType: 'answer_updated',
      domain: 'answers',
      actorEmail: String(req.adminUser?.email || ''),
      payload: {
        key: answerKey,
        valuePreview: typeof normalizedValue === 'string' ? normalizedValue.slice(0, 200) : normalizedValue,
        at: new Date().toISOString(),
      },
      previousNotes,
      nextNotes: answerKey === 'consultation_notes' ? room.state.answers?.consultation_notes : null,
    })

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: item?.updatedAt || null }) })
  } catch (error) {
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update consultation field' })
  }
})

app.patch('/api/admin/consultations/:code/billing', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })

    const room = await ensureRoom(roomCode)
    const billingMode = String(req.body?.billingMode || '').trim().toLowerCase() === 'resolution' ? 'resolution' : 'investigation'
    const invoiceAmountFieldKey = billingMode === 'resolution' ? 'resolution_billing_invoice_amount' : 'investigation_billing_invoice_amount'
    const invoiceCreatedAtFieldKey = billingMode === 'resolution' ? 'resolution_billing_invoice_created_at' : 'investigation_billing_invoice_created_at'
    const scheduleFieldKey = billingMode === 'resolution' ? 'resolution_billing_schedule' : 'investigation_billing_schedule'
    const invoiceAmount = req.body?.invoiceAmount
    const invoiceCreatedAt = req.body?.invoiceCreatedAt
    const incomingSchedule = Array.isArray(req.body?.schedule) ? req.body.schedule : []
    const parseScheduleValue = (value) => {
      if (Array.isArray(value)) return value
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    }
    const existingSchedule = (() => {
      const scoped = parseScheduleValue(room.state.answers[scheduleFieldKey])
      if (scoped.length) return scoped
      if (billingMode === 'investigation') return parseScheduleValue(room.state.answers.billing_schedule)
      return []
    })()
    const schedule = sanitizeBillingScheduleRowsForPersistence(incomingSchedule, existingSchedule)

    room.state.answers[invoiceAmountFieldKey] = invoiceAmount === null || invoiceAmount === undefined ? '' : invoiceAmount
    room.state.answers[invoiceCreatedAtFieldKey] = invoiceCreatedAt === null || invoiceCreatedAt === undefined ? '' : invoiceCreatedAt
    room.state.answers[scheduleFieldKey] = schedule
    if (billingMode === 'investigation') {
      room.state.answers.billing_invoice_amount = room.state.answers[invoiceAmountFieldKey]
      room.state.answers.billing_invoice_created_at = room.state.answers[invoiceCreatedAtFieldKey]
      room.state.answers.billing_schedule = schedule
    }
    const patches = [
      { type: 'setAnswer', questionId: invoiceAmountFieldKey, value: room.state.answers[invoiceAmountFieldKey] },
      { type: 'setAnswer', questionId: invoiceCreatedAtFieldKey, value: room.state.answers[invoiceCreatedAtFieldKey] },
      { type: 'setAnswer', questionId: scheduleFieldKey, value: room.state.answers[scheduleFieldKey] },
    ]
    if (billingMode === 'investigation') {
      patches.push({ type: 'setAnswer', questionId: 'billing_invoice_amount', value: room.state.answers.billing_invoice_amount })
      patches.push({ type: 'setAnswer', questionId: 'billing_invoice_created_at', value: room.state.answers.billing_invoice_created_at })
      patches.push({ type: 'setAnswer', questionId: 'billing_schedule', value: room.state.answers.billing_schedule })
    }

    await adminPersistRoomStateAndLog({
      req,
      roomCode,
      room,
      patches,
      eventType: 'billing_updated',
      domain: 'billing',
      actorEmail: String(req.adminUser?.email || ''),
      payload: {
        billingMode,
        invoiceAmount,
        invoiceCreatedAt,
        scheduleLength: Array.isArray(schedule) ? schedule.length : 0,
        at: new Date().toISOString(),
      },
    })

    // Immutable audit trail of billing edits (so invoice dates/amounts/schedules can be recovered).
    void dbInsertBillingAudit({
      sessionCode: roomCode,
      eventType: 'billing_updated',
      billingMode,
      actorEmail: String(req.adminUser?.email || ''),
      payload: {
        billingMode,
        invoiceAmountFieldKey,
        invoiceCreatedAtFieldKey,
        scheduleFieldKey,
        invoiceAmount,
        invoiceCreatedAt,
        scheduleLength: Array.isArray(schedule) ? schedule.length : 0,
        at: new Date().toISOString(),
      },
    })

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: item?.updatedAt || null }) })
  } catch (error) {
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update billing adjustments' })
  }
})

app.post('/api/admin/consultations/:code/billing/mark-processed', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const scheduledDateRaw = String(req.body?.scheduledDate || '').trim()
    const scheduledAmount = Number(req.body?.scheduledAmount)
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const normalizedDate = normalizeBillingDateValue(scheduledDateRaw)
    if (!normalizedDate) return res.status(400).json({ error: 'scheduledDate is required' })
    if (!Number.isFinite(scheduledAmount) || scheduledAmount <= 0) {
      return res.status(400).json({ error: 'scheduledAmount is required' })
    }

    const room = await ensureRoom(roomCode)
    const nowIso = new Date().toISOString()
    const actorEmail = String(req.adminUser?.email || '')

    const parseScheduleValue = (value) => {
      if (Array.isArray(value)) return value
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    }

    const scheduleKeys = ['billing_schedule', 'investigation_billing_schedule', 'resolution_billing_schedule']
    const nextAnswers = room.state.answers || {}
    const persistPatches = []
    let updatedCount = 0

    scheduleKeys.forEach((key) => {
      const existingSchedule = normalizeBillingScheduleRows(parseScheduleValue(nextAnswers[key]))
      if (!existingSchedule.length) return

      let keyUpdated = 0
      const nextSchedule = existingSchedule.map((row) => {
        const rowDate = normalizeBillingDateValue(row?.date || getBillingProcessedAtValue(row) || '')
        const rowAmount = toNumberValue(row?.amount)
        const dateMatches = rowDate === normalizedDate
        const amountMatches = Math.abs(Number(rowAmount) - Number(scheduledAmount)) < 0.01
        if (!dateMatches || !amountMatches) return row
        if (getBillingStatusTone(row) === 'processed') return row
        updatedCount += 1
        keyUpdated += 1
        return {
          ...(row || {}),
          status: 'processed',
          failureReason: '',
          processorReason: '',
          reason: '',
          processedAt: getBillingProcessedAtValue(row) || nowIso,
          processedManually: true,
          processedManualBy: actorEmail,
          processedManualAt: nowIso,
        }
      })

      if (keyUpdated === 0) return
      const sanitized = sanitizeBillingScheduleRowsForPersistence(nextSchedule, existingSchedule)
      nextAnswers[key] = sanitized
      persistPatches.push({ type: 'setAnswer', questionId: key, value: sanitized })
    })

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'No matching billing schedule row was found to mark processed.' })
    }

    room.state.answers = nextAnswers
    await adminPersistRoomStateAndLog({
      req,
      roomCode,
      room,
      patches: persistPatches,
      eventType: 'payment_marked_processed',
      domain: 'billing',
      actorEmail,
      payload: {
        scheduledDate: normalizedDate,
        scheduledAmount,
        updatedCount,
        at: nowIso,
      },
    })
    void dbInsertBillingAudit({
      sessionCode: roomCode,
      eventType: 'payment_marked_processed',
      billingMode: '',
      actorEmail,
      payload: {
        scheduledDate: normalizedDate,
        scheduledAmount,
        updatedCount,
        at: nowIso,
      },
    })
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, updatedCount, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: item?.updatedAt || null }) })
  } catch (error) {
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to mark payment processed' })
  }
})

app.post('/api/admin/consultations/:code/billing/record-manual-payment', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const billingModeRaw = String(req.body?.billingMode || '').trim().toLowerCase()
    const billingMode = billingModeRaw === 'resolution' ? 'resolution' : 'investigation'
    const paymentMethodRaw = String(req.body?.paymentMethod || req.body?.method || '').trim().toLowerCase()
    const paymentMethod = paymentMethodRaw === 'cash' ? 'cash' : paymentMethodRaw ? paymentMethodRaw : 'manual'
    const manualNote = String(req.body?.note || req.body?.manualNote || '').trim()
    const scheduledAmount = Number(req.body?.scheduledAmount ?? req.body?.amount)
    const scheduledDateRaw = String(req.body?.scheduledDate || req.body?.date || '').trim()
    const normalizedDate = normalizeBillingDateValue(scheduledDateRaw || getTodayBillingDateValue())

    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!normalizedDate) return res.status(400).json({ error: 'scheduledDate is required' })
    if (!Number.isFinite(scheduledAmount) || scheduledAmount <= 0) {
      return res.status(400).json({ error: 'scheduledAmount is required' })
    }

    const room = await ensureRoom(roomCode)
    const nowIso = new Date().toISOString()
    const actorEmail = String(req.adminUser?.email || '')

    const parseScheduleValue = (value) => {
      if (Array.isArray(value)) return value
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    }

    const scheduleFieldKey = billingMode === 'resolution' ? 'resolution_billing_schedule' : 'investigation_billing_schedule'
    const nextAnswers = room.state.answers || {}
    const existingSchedule = normalizeBillingScheduleRows(parseScheduleValue(nextAnswers[scheduleFieldKey]))
    const manualLabel = paymentMethod === 'cash' ? 'Cash payment' : `${paymentMethod} payment`
    const manualReason = manualNote ? `${manualLabel}: ${manualNote}` : manualLabel

    let updatedCount = 0
    let appended = false

    const nextSchedule = existingSchedule.map((row) => {
      const rowDate = normalizeBillingDateValue(row?.date || getBillingProcessedAtValue(row) || '')
      const rowAmount = toNumberValue(row?.amount)
      const dateMatches = rowDate === normalizedDate
      const amountMatches = Math.abs(Number(rowAmount) - Number(scheduledAmount)) < 0.01
      if (!dateMatches || !amountMatches) return row
      if (getBillingStatusTone(row) === 'processed') return row
      updatedCount += 1
      return {
        ...(row || {}),
        status: 'processed',
        failureReason: '',
        processorReason: manualReason,
        reason: manualReason,
        processedAt: getBillingProcessedAtValue(row) || nowIso,
        processedManually: true,
        processedManualBy: actorEmail,
        processedManualAt: nowIso,
        processedManualMethod: paymentMethod,
        processedManualNote: manualNote,
      }
    })

    if (updatedCount === 0) {
      appended = true
      nextSchedule.push({
        date: normalizedDate,
        amount: scheduledAmount,
        status: 'processed',
        failureReason: '',
        processorReason: manualReason,
        reason: manualReason,
        processedAt: nowIso,
        processedManually: true,
        processedManualBy: actorEmail,
        processedManualAt: nowIso,
        processedManualMethod: paymentMethod,
        processedManualNote: manualNote,
      })
    }

    const sanitized = sanitizeBillingScheduleRowsForPersistence(nextSchedule, existingSchedule)
    nextAnswers[scheduleFieldKey] = sanitized
    const persistPatches = [{ type: 'setAnswer', questionId: scheduleFieldKey, value: sanitized }]

    room.state.answers = nextAnswers
    await persistRoomState(roomCode, room, persistPatches)

    void dbInsertBillingAudit({
      sessionCode: roomCode,
      eventType: 'payment_recorded_manual',
      billingMode,
      actorEmail,
      payload: {
        billingMode,
        scheduleFieldKey,
        scheduledDate: normalizedDate,
        scheduledAmount,
        paymentMethod,
        note: manualNote,
        updatedCount,
        appended,
        at: nowIso,
      },
    })

    const item = await getConsultationRecordByCode(roomCode)
    const eventOk = await dbInsertEvent({
      sessionCode: roomCode,
      eventType: 'payment_recorded_manual',
      domain: 'billing',
      actorEmail,
      requestId: getRequestId(req),
      payload: {
        billingMode,
        scheduledDate: normalizedDate,
        scheduledAmount,
        paymentMethod,
        updatedCount,
        appended,
        at: nowIso,
      },
    })
    if (!eventOk && STRICT_DB_MODE) throw new Error('Failed to insert payment_recorded_manual event.')
    return res.json({ ok: true, item, updatedCount, appended, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: item?.updatedAt || null }) })
  } catch (error) {
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to record manual payment' })
  }
})

app.post('/api/admin/consultations/:code/stripe/setup-intent', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!isStripeReady()) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const room = await ensureRoom(roomCode)
    const customerId = await ensureStripeCustomerForRoom(roomCode, room)
    const requestedType = String(req.body?.paymentMethodType || 'card').trim().toLowerCase()
    const paymentMethodType = requestedType === 'us_bank_account' || requestedType === 'ach' ? 'us_bank_account' : 'card'
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: [paymentMethodType],
      ...(paymentMethodType === 'us_bank_account'
        ? {
            payment_method_options: {
              us_bank_account: {
                verification_method: 'microdeposits',
              },
            },
          }
        : {}),
      metadata: {
        sessionCode: roomCode,
        createdBy: String(req.adminUser?.email || ''),
        paymentMethodType,
      },
    })
    return res.json({
      ok: true,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      clientSecret: intent.client_secret,
      customerId,
      setupIntentId: intent.id,
      paymentMethodType,
    })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create Stripe setup intent' })
  }
})

app.post('/api/admin/consultations/:code/stripe/payment-methods', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim()
    const setupIntentId = String(req.body?.setupIntentId || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' })
    const room = await ensureRoom(roomCode)
    let customerId = await ensureStripeCustomerForRoom(roomCode, room)
    let setupIntentCustomerId = ''
    if (setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
      if (setupIntent.status !== 'succeeded') return res.status(400).json({ error: 'Stripe setup has not completed yet.' })
      setupIntentCustomerId = String(setupIntent.customer || '').trim()
      if (setupIntentCustomerId && setupIntentCustomerId !== customerId) {
        customerId = await persistStripeCustomerIdForRoom(roomCode, room, setupIntentCustomerId)
      }
    }
    let paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    const paymentMethodCustomerId = String(paymentMethod.customer || '').trim()
    if (paymentMethodCustomerId && paymentMethodCustomerId !== customerId) {
      if (setupIntentCustomerId && paymentMethodCustomerId === setupIntentCustomerId) {
        customerId = await persistStripeCustomerIdForRoom(roomCode, room, paymentMethodCustomerId)
      } else {
        return res.status(400).json({ error: 'This payment method is linked to a different Stripe customer. Please try adding it again.' })
      }
    }
    if (String(paymentMethod.customer || '').trim() !== customerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    }
    const nextMethod = buildStripePaymentMethodRecord(paymentMethod, { customerId, setupIntentId })
    const existingMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods).filter(
      (entry) => String(entry?.stripePaymentMethodId || '') !== paymentMethodId,
    )
    const nextMethods = [...existingMethods, nextMethod]
    await persistRoomPaymentMethodAnswers(roomCode, room, nextMethods, nextMethod)
    void dbInsertBillingAudit({
      sessionCode: roomCode,
      eventType: 'stripe_payment_method_attached',
      billingMode: '',
      actorEmail: String(req.adminUser?.email || ''),
      payload: {
        stripeCustomerId: customerId,
        stripePaymentMethodId: paymentMethodId,
        setupIntentId,
        at: new Date().toISOString(),
      },
    })
    const eventOk = await dbInsertEvent({
      sessionCode: roomCode,
      eventType: 'payment_method_attached',
      domain: 'billing',
      actorEmail: String(req.adminUser?.email || ''),
      idempotencyKey: `stripe_pm_attach:${paymentMethodId}`,
      requestId: getRequestId(req),
      payload: {
        stripeCustomerId: customerId,
        stripePaymentMethodId: paymentMethodId,
        setupIntentId,
        at: new Date().toISOString(),
      },
    })
    if (!eventOk && STRICT_DB_MODE) throw new Error('Failed to insert payment_method_attached event.')
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentMethod: nextMethod, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: item?.updatedAt || null }) })
  } catch (error) {
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to attach Stripe payment method' })
  }
})

app.post('/api/admin/consultations/:code/stripe/sync-payment-methods', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })

    const room = await ensureRoom(roomCode)
    const customerId = await ensureStripeCustomerForRoom(roomCode, room)

    const existingMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods)
    const existingById = new Map(existingMethods.map((entry) => [String(entry?.stripePaymentMethodId || '').trim(), entry]))

    const nextStripeMethods = []
    const cardMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 100 })
    cardMethods.data.forEach((method) => {
      const record = buildStripePaymentMethodRecord(method, { customerId, setupIntentId: '' })
      if (record?.stripePaymentMethodId) nextStripeMethods.push(record)
    })

    const bankMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'us_bank_account', limit: 100 })
    bankMethods.data.forEach((method) => {
      const record = buildStripePaymentMethodRecord(method, { customerId, setupIntentId: '' })
      if (record?.stripePaymentMethodId) nextStripeMethods.push(record)
    })

    const merged = []
    // Keep any existing stored methods that are not Stripe-linked (legacy) first.
    existingMethods.forEach((entry) => {
      if (!String(entry?.stripePaymentMethodId || '').trim()) merged.push(entry)
    })
    // Then merge Stripe-linked methods from Stripe, preserving any stored metadata where possible.
    nextStripeMethods.forEach((entry) => {
      const id = String(entry?.stripePaymentMethodId || '').trim()
      if (!id) return
      const existing = existingById.get(id)
      merged.push(existing && typeof existing === 'object' ? { ...entry, ...existing } : entry)
    })

    if (!merged.length) return res.json({ ok: true, item: await getConsultationRecordByCode(roomCode), paymentMethods: [] })

    const nextMethod = merged.findLast((entry) => String(entry?.stripePaymentMethodId || '').trim()) || merged[merged.length - 1]
    await persistRoomPaymentMethodAnswers(roomCode, room, merged, nextMethod)

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentMethods: merged })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync Stripe payment methods' })
  }
})

app.post('/api/admin/consultations/:code/stripe/restore-billing', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })

    const billingMode = String(req.body?.billingMode || '').trim().toLowerCase() === 'resolution' ? 'resolution' : 'investigation'
    const invoiceAmountFieldKey = billingMode === 'resolution' ? 'resolution_billing_invoice_amount' : 'investigation_billing_invoice_amount'
    const invoiceCreatedAtFieldKey = billingMode === 'resolution'
      ? 'resolution_billing_invoice_created_at'
      : 'investigation_billing_invoice_created_at'
    const scheduleFieldKey = billingMode === 'resolution' ? 'resolution_billing_schedule' : 'investigation_billing_schedule'

    const room = await ensureRoom(roomCode)

    // Prefer the persisted customer id so we don't accidentally create a new customer (which would have no history).
    let customerId = String(room?.state?.answers?.stripe_customer_id || '').trim()
    if (!customerId) {
      const email = String(room?.state?.answers?.email || '').trim()
      if (email) {
        const candidates = await stripe.customers.list({ email, limit: 10 })
        const match =
          candidates.data.find((customer) => String(customer?.metadata?.sessionCode || '').trim() === roomCode) ||
          candidates.data[0]
        customerId = String(match?.id || '').trim()
        if (customerId) {
          await persistStripeCustomerIdForRoom(roomCode, room, customerId)
        }
      }
    }
    if (!customerId) {
      return res.status(400).json({
        error: 'No Stripe customer is linked to this consultation, so billing history cannot be restored.',
      })
    }

    const intents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 100,
      expand: ['data.payment_method'],
    })

    const candidates = intents.data
      .filter((intent) => intent && (intent.status === 'succeeded' || intent.status === 'requires_capture'))
      .map((intent) => {
        const received = Number(intent.amount_received || intent.amount || 0)
        const amount = received ? received / 100 : 0
        const processedAt = new Date(Number(intent.created || 0) * 1000).toISOString()
        const normalizedDate = normalizeBillingDateValue(processedAt)
        const paymentMethod = intent.payment_method
        const paymentMethodId = typeof paymentMethod === 'string' ? paymentMethod : String(paymentMethod?.id || '')
        let brand = ''
        let last4 = ''
        let methodType = ''
        if (paymentMethod && typeof paymentMethod === 'object') {
          methodType = String(paymentMethod?.type || '').trim()
          if (paymentMethod.type === 'card') {
            brand = String(paymentMethod?.card?.brand || '').trim()
            last4 = String(paymentMethod?.card?.last4 || '').trim()
          } else if (paymentMethod.type === 'us_bank_account') {
            brand = 'bank'
            last4 = String(paymentMethod?.us_bank_account?.last4 || '').trim()
          }
        } else if (Array.isArray(intent.payment_method_types) && intent.payment_method_types.length) {
          methodType = String(intent.payment_method_types[0] || '').trim()
        }
        return {
          date: normalizedDate,
          amount,
          status: 'processed',
          stripePaymentIntentId: String(intent.id || '').trim(),
          processedAt,
          processedStripeCustomerId: customerId,
          processedStripePaymentMethodId: String(paymentMethodId || '').trim(),
          processedPaymentMethodBrand: brand,
          processedPaymentMethodLast4: last4,
          processedPaymentMethodType: methodType,
        }
      })
      .filter((row) => Boolean(row?.stripePaymentIntentId) && Number(row?.amount || 0) > 0 && Boolean(row?.date))

    const parseScheduleValue = (value) => {
      if (Array.isArray(value)) return value
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    }

    const existingSchedule = (() => {
      const scoped = parseScheduleValue(room.state.answers[scheduleFieldKey])
      if (scoped.length) return scoped
      if (billingMode === 'investigation') return parseScheduleValue(room.state.answers.billing_schedule)
      return []
    })()

    const normalizedExisting = normalizeBillingScheduleRows(existingSchedule)
    const existingByKey = new Map()
    const existingIntentIds = new Set(
      normalizedExisting.map((row) => getBillingStripePaymentIntentIdValue(row)).filter(Boolean),
    )
    normalizedExisting.forEach((row) => {
      const key = getBillingRowMatchKey(row)
      if (!key) return
      const bucket = existingByKey.get(key)
      if (bucket) bucket.push(row)
      else existingByKey.set(key, [row])
    })

    const merged = [...normalizedExisting]
    candidates.forEach((candidate) => {
      const intentId = getBillingStripePaymentIntentIdValue(candidate)
      if (intentId && existingIntentIds.has(intentId)) return
      const key = getBillingRowMatchKey(candidate)
      if (!key) return
      const bucket = existingByKey.get(key)
      const match = Array.isArray(bucket) && bucket.length ? bucket[0] : null
      if (match) {
        if (hasBillingProcessingEvidence(match)) return
        Object.assign(match, candidate)
        existingIntentIds.add(intentId)
        return
      }
      merged.push(candidate)
      existingIntentIds.add(intentId)
    })

    const nextSchedule = sanitizeBillingScheduleRowsForPersistence(merged, existingSchedule)

    room.state.answers[scheduleFieldKey] = nextSchedule
    // Keep generic investigation fields aligned for older records.
    if (billingMode === 'investigation') {
      room.state.answers.billing_schedule = nextSchedule
      room.state.answers.billing_invoice_amount = room.state.answers[invoiceAmountFieldKey]
      room.state.answers.billing_invoice_created_at = room.state.answers[invoiceCreatedAtFieldKey]
    }
    room.state.updatedAt = Date.now()

    io.to(roomCode).emit('room_patch', {
      patch: { type: 'setAnswer', questionId: scheduleFieldKey, value: room.state.answers[scheduleFieldKey] },
      updatedAt: room.state.updatedAt,
    })
    if (billingMode === 'investigation') {
      io.to(roomCode).emit('room_patch', {
        patch: { type: 'setAnswer', questionId: 'billing_schedule', value: room.state.answers.billing_schedule },
        updatedAt: room.state.updatedAt,
      })
    }
    io.to(roomCode).emit('room_state', room.state)

    await dbUpsertSession({ code: roomCode, state: room.state })

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, restoredCount: candidates.length })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to restore billing history' })
  }
})

app.post('/api/admin/consultations/:code/stripe/link-stored-card', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!isStripeReady()) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    const room = await ensureRoom(roomCode)
    const storedMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods)
    const requestedIndexRaw = Number(req.body?.methodIndex)
    const requestedIndex = Number.isInteger(requestedIndexRaw) ? requestedIndexRaw : -1
    const fallbackIndex = storedMethods.findLastIndex(
      (entry) => entry && !String(entry?.stripePaymentMethodId || '').trim() && String(entry?.type || '').trim().toLowerCase() !== 'ach',
    )
    const targetIndex = requestedIndex >= 0 && requestedIndex < storedMethods.length ? requestedIndex : fallbackIndex
    const targetMethod = targetIndex >= 0 ? storedMethods[targetIndex] : null
    const cardholderName = String(targetMethod?.cardholderName || room.state.answers.payment_cardholder_name || room.state.answers.full_name || room.state.answers.name || '').trim()
    const cardNumber = String(targetMethod?.cardNumber || room.state.answers.payment_card_number || room.state.answers._ui_pay_cardNumber || '').trim()
    const expiration = String(targetMethod?.expiration || room.state.answers.payment_card_expiration || room.state.answers._ui_pay_expiry || '').trim()
    const cvv = String(targetMethod?.cvv || room.state.answers.payment_card_cvv || room.state.answers._ui_pay_cvv || '').trim()
    if (!targetMethod && !cardNumber) return res.status(400).json({ error: 'No saved card is available to link.' })
    const { nextMethod } = await createStripeLinkedCardForRoom(roomCode, room, { cardholderName, cardNumber, expiration, cvv })
    const nextMethods = storedMethods.filter((_, index) => index !== targetIndex && String(storedMethods[index]?.stripePaymentMethodId || '') !== nextMethod.stripePaymentMethodId)
    nextMethods.push(nextMethod)
    room.state.answers.billing_payment_methods = nextMethods
    room.state.answers.billing_payment_method = nextMethod
    await persistRoomState(roomCode, room, [
      { type: 'setAnswer', questionId: 'billing_payment_methods', value: nextMethods },
      { type: 'setAnswer', questionId: 'billing_payment_method', value: nextMethod },
    ])
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentMethod: nextMethod })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to link saved card to Stripe' })
  }
})

app.delete('/api/admin/consultations/:code/payment-methods/:paymentMethodId', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const paymentMethodId = String(req.params.paymentMethodId || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' })
    const room = await ensureRoom(roomCode)
    const existingMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods)
    const nextMethods = existingMethods.filter((entry) => String(entry?.stripePaymentMethodId || '') !== paymentMethodId)
    const nextMethod = nextMethods.at(-1) || ''
    room.state.answers.billing_payment_methods = nextMethods
    room.state.answers.billing_payment_method = nextMethod
    if (stripe) {
      try {
        await stripe.paymentMethods.detach(paymentMethodId)
      } catch {
        // ignore detach errors for already-detached methods
      }
    }
    await persistRoomState(roomCode, room, [
      { type: 'setAnswer', questionId: 'billing_payment_methods', value: nextMethods },
      { type: 'setAnswer', questionId: 'billing_payment_method', value: nextMethod },
    ])
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to remove payment method' })
  }
})

// Client-facing Stripe setup intent for saving a reusable card without sending raw card data to the Stripe API.
// This is used by the R.E.D. experience payment method flow.
app.post('/api/session/:code/stripe/setup-intent', async (req, res) => {
  if (!isStripeReady()) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Session code is required' })
    const room = await ensureRoom(roomCode)
    const customerId = await ensureStripeCustomerForRoom(roomCode, room)
    const requestedType = String(req.body?.paymentMethodType || 'card').trim().toLowerCase()
    const paymentMethodType = requestedType === 'us_bank_account' || requestedType === 'ach' ? 'us_bank_account' : 'card'
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: [paymentMethodType],
      ...(paymentMethodType === 'us_bank_account'
        ? {
            payment_method_options: {
              us_bank_account: {
                verification_method: 'microdeposits',
              },
            },
          }
        : {}),
      metadata: {
        sessionCode: roomCode,
        paymentMethodType,
        source: 'client_red_payment_method',
      },
    })
    return res.json({
      ok: true,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      clientSecret: intent.client_secret,
      customerId,
      setupIntentId: intent.id,
      paymentMethodType,
    })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create Stripe setup intent' })
  }
})

app.post('/api/session/:code/stripe/payment-methods', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim()
    const setupIntentId = String(req.body?.setupIntentId || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Session code is required' })
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' })
    const room = await ensureRoom(roomCode)
    let customerId = await ensureStripeCustomerForRoom(roomCode, room)
    let setupIntentCustomerId = ''

    if (setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
      if (setupIntent.status !== 'succeeded') return res.status(400).json({ error: 'Stripe setup has not completed yet.' })
      setupIntentCustomerId = String(setupIntent.customer || '').trim()
      if (setupIntentCustomerId && setupIntentCustomerId !== customerId) {
        customerId = await persistStripeCustomerIdForRoom(roomCode, room, setupIntentCustomerId)
      }
    }

    let paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    const paymentMethodCustomerId = String(paymentMethod.customer || '').trim()
    if (paymentMethodCustomerId && paymentMethodCustomerId !== customerId) {
      if (setupIntentCustomerId && paymentMethodCustomerId === setupIntentCustomerId) {
        customerId = await persistStripeCustomerIdForRoom(roomCode, room, paymentMethodCustomerId)
      } else {
        return res.status(400).json({ error: 'This payment method is linked to a different Stripe customer. Please try adding it again.' })
      }
    }
    if (String(paymentMethod.customer || '').trim() !== customerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    }
    const nextMethod = buildStripePaymentMethodRecord(paymentMethod, { customerId, setupIntentId })
    const existingMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods).filter(
      (entry) => String(entry?.stripePaymentMethodId || '') !== paymentMethodId,
    )
    const nextMethods = [...existingMethods, nextMethod]
    await persistRoomPaymentMethodAnswers(roomCode, room, nextMethods, nextMethod)
    return res.json({ ok: true, paymentMethod: nextMethod })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to attach Stripe payment method' })
  }
})

app.post('/api/session/:code/stripe/link-card', async (req, res) => {
  if (!isStripeReady()) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Session code is required' })
    const room = await ensureRoom(roomCode)
    const cardholderName = String(req.body?.cardholderName || room.state.answers.payment_cardholder_name || room.state.answers.full_name || room.state.answers.name || '').trim()
    const cardNumber = String(req.body?.cardNumber || '').trim()
    const expiration = String(req.body?.expiration || '').trim()
    const cvv = String(req.body?.cvv || '').trim()
    const billingZip = String(req.body?.billingZip || room.state.answers.payment_billing_zip || room.state.answers._ui_pay_billingZip || '').trim()
    const { nextMethod } = await createStripeLinkedCardForRoom(roomCode, room, { cardholderName, cardNumber, expiration, cvv, billingZip })
    const existingMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods).filter(
      (entry) => String(entry?.stripePaymentMethodId || '') !== nextMethod.stripePaymentMethodId,
    )
    const nextMethods = [...existingMethods, nextMethod]
    await persistRoomPaymentMethodAnswers(roomCode, room, nextMethods, nextMethod)
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentMethod: nextMethod })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to link card to Stripe' })
  }
})

function getStripePaymentFailureReason(error) {
  const raw = error?.raw || {}
  const declineCode = String(raw.decline_code || error?.decline_code || '').trim().toLowerCase()
  const code = String(raw.code || error?.code || '').trim().toLowerCase()
  const message = String(raw.message || error?.message || '').trim()
  const detector = declineCode || code

  switch (detector) {
    case 'incorrect_number':
    case 'invalid_number':
      return 'Payment failed: invalid card number.'
    case 'incorrect_cvc':
    case 'invalid_cvc':
      return 'Payment failed: incorrect security code (CVC).'
    case 'expired_card':
      return 'Payment failed: the card is expired.'
    case 'incorrect_zip':
      return 'Payment failed: the billing ZIP/postal code did not match.'
    case 'insufficient_funds':
      return 'Payment failed: insufficient funds.'
    case 'do_not_honor':
      return 'Payment failed: do not honor. The issuer declined the charge.'
    case 'generic_decline':
      return 'Payment failed: the card was declined by the issuer.'
    case 'processing_error':
      return 'Payment failed: the processor returned a temporary processing error. Please try again.'
    case 'card_not_supported':
      return 'Payment failed: this card does not support this type of charge.'
    case 'transaction_not_allowed':
      return 'Payment failed: this transaction is not allowed on the card.'
    case 'pickup_card':
    case 'lost_card':
    case 'stolen_card':
      return 'Payment failed: the issuer rejected the card.'
    case 'authentication_required':
      return 'Payment failed: the card requires authentication before it can be charged.'
    default:
      break
  }

  const normalizedMessage = message.toLowerCase()
  if (normalizedMessage.includes('microdeposit') || normalizedMessage.includes('micro-deposit') || normalizedMessage.includes('verify')) {
    return 'Payment failed: this ACH bank account needs to be verified before it can be charged.'
  }
  if (normalizedMessage.includes('insufficient funds')) return 'Payment failed: insufficient funds.'
  if (normalizedMessage.includes('do not honor')) return 'Payment failed: do not honor. The issuer declined the charge.'
  if (normalizedMessage.includes('invalid card number')) return 'Payment failed: invalid card number.'
  if (normalizedMessage.includes('incorrect number')) return 'Payment failed: invalid card number.'
  if (normalizedMessage.includes('incorrect cvc') || normalizedMessage.includes('invalid cvc')) {
    return 'Payment failed: incorrect security code (CVC).'
  }
  if (normalizedMessage.includes('expired card')) return 'Payment failed: the card is expired.'
  if (normalizedMessage.includes('authentication required')) {
    return 'Payment failed: the card requires authentication before it can be charged.'
  }

  return message || 'Payment failed: processor declined the charge.'
}

app.post('/api/admin/consultations/:code/run-payment', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' })
  try {
    const roomCode = String(req.params.code || '').trim()
    const billingMode = String(req.body?.billingMode || '').trim().toLowerCase() === 'resolution' ? 'resolution' : 'investigation'
    const scheduleIndex = Number(req.body?.scheduleIndex)
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim()
    const scheduledDate = String(req.body?.scheduledDate || '').trim()
    const scheduledAmount = Number(req.body?.scheduledAmount)
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!Number.isInteger(scheduleIndex) || scheduleIndex < 0) return res.status(400).json({ error: 'A valid scheduleIndex is required' })
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' })
    const room = await ensureRoom(roomCode)
    const cancellationStatus = String(room?.state?.answers?.cancellation_request_status || '').trim().toLowerCase()
    if (cancellationStatus.includes('cancel')) {
      return res.status(409).json({ error: 'This record is marked as requesting cancellation. Payments are disabled.' })
    }
    const scheduleFieldKey = billingMode === 'resolution' ? 'resolution_billing_schedule' : 'investigation_billing_schedule'
    const parseScheduleValue = (value) => {
      if (Array.isArray(value)) return value
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    }
    const schedule = (() => {
      const scoped = parseScheduleValue(room.state.answers[scheduleFieldKey])
      if (scoped.length) return scoped
      if (billingMode === 'investigation') return parseScheduleValue(room.state.answers.billing_schedule)
      return []
    })()
    const rows = Array.isArray(schedule) ? schedule.map((row) => ({ ...(row || {}) })) : []
    let targetRow = rows[scheduleIndex]
    let targetScheduleIndex = scheduleIndex
    if (
      (!targetRow || (scheduledDate && String(targetRow?.date || '').trim() !== scheduledDate) || (Number.isFinite(scheduledAmount) && Number(targetRow?.amount || 0) !== scheduledAmount)) &&
      (scheduledDate || Number.isFinite(scheduledAmount))
    ) {
      const matchedIndex = rows.findIndex((row) => {
        const rowDate = String(row?.date || '').trim()
        const rowAmount = Number(row?.amount || 0)
        const dateMatches = scheduledDate ? rowDate === scheduledDate : true
        const amountMatches = Number.isFinite(scheduledAmount) ? rowAmount === scheduledAmount : true
        return dateMatches && amountMatches
      })
      if (matchedIndex >= 0) {
        targetScheduleIndex = matchedIndex
        targetRow = rows[matchedIndex]
      }
    }
    if (!targetRow) return res.status(404).json({ error: 'Billing schedule row not found' })
    const amount = Number(targetRow.amount || 0)
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'The scheduled amount is invalid.' })
    let customerId = await ensureStripeCustomerForRoom(roomCode, room)
    let paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    const paymentMethodCustomerId = String(paymentMethod?.customer || '').trim()
    if (paymentMethodCustomerId && paymentMethodCustomerId !== customerId) {
      customerId = await persistStripeCustomerIdForRoom(roomCode, room, paymentMethodCustomerId)
    }
    if (!String(paymentMethod?.customer || '').trim()) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    }
    const isUsBankAccount = String(paymentMethod?.type || '').trim().toLowerCase() === 'us_bank_account'

    const processedPaymentMethodLast4 = (() => {
      if (!paymentMethod || typeof paymentMethod !== 'object') return ''
      const type = String(paymentMethod.type || '').trim().toLowerCase()
      if (type === 'card') return String(paymentMethod.card?.last4 || '').trim()
      if (type === 'us_bank_account') return String(paymentMethod.us_bank_account?.last4 || '').trim()
      return ''
    })()

    const processedPaymentMethodBrand = (() => {
      if (!paymentMethod || typeof paymentMethod !== 'object') return ''
      const type = String(paymentMethod.type || '').trim().toLowerCase()
      if (type === 'card') return String(paymentMethod.card?.brand || '').trim()
      if (type === 'us_bank_account') return String(paymentMethod.us_bank_account?.bank_name || 'ACH').trim()
      return ''
    })()

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: !isUsBankAccount,
      metadata: {
        sessionCode: roomCode,
        scheduleIndex: String(targetScheduleIndex),
        billingMode,
        amount: String(amount),
      },
    })
    rows[targetScheduleIndex] = {
      ...targetRow,
      status: intent.status === 'succeeded' ? 'Processed' : intent.status === 'processing' ? 'Processing' : 'Processed',
      failureReason: '',
      processorReason: '',
      reason: '',
      stripePaymentIntentId: intent.id,
      processedAt: new Date().toISOString(),
      processedPaymentMethodLast4,
      processedPaymentMethodBrand,
      processedStripePaymentMethodId: paymentMethodId,
      processedStripeCustomerId: customerId,
      processedPaymentMethodType: String(paymentMethod?.type || '').trim(),
    }
    room.state.answers[scheduleFieldKey] = rows
    const persistPatches = [{ type: 'setAnswer', questionId: scheduleFieldKey, value: rows }]
    if (billingMode === 'investigation') {
      room.state.answers.billing_schedule = rows
      persistPatches.push({ type: 'setAnswer', questionId: 'billing_schedule', value: rows })
    }
    await persistRoomState(roomCode, room, persistPatches)
    void dbInsertBillingAudit({
      sessionCode: roomCode,
      eventType: 'payment_processed',
      billingMode,
      actorEmail: String(req.adminUser?.email || ''),
      payload: {
        billingMode,
        scheduleIndex: targetScheduleIndex,
        amount,
        paymentMethodId,
        stripeCustomerId: customerId,
        stripePaymentIntentId: intent.id,
        status: intent.status,
        processedAt: rows[targetScheduleIndex]?.processedAt || new Date().toISOString(),
      },
    })
    const eventOk = await dbInsertEvent({
      sessionCode: roomCode,
      eventType: 'payment_processed',
      domain: 'billing',
      actorEmail: String(req.adminUser?.email || ''),
      idempotencyKey: `stripe_pi:${String(intent.id || '').trim()}`,
      requestId: getRequestId(req),
      payload: {
        billingMode,
        scheduleIndex: targetScheduleIndex,
        amount,
        stripePaymentIntentId: intent.id,
        stripeCustomerId: customerId,
        processedStripePaymentMethodId: paymentMethodId,
        status: intent.status,
        processedAt: rows[targetScheduleIndex]?.processedAt || new Date().toISOString(),
      },
    })
    if (!eventOk && STRICT_DB_MODE) throw new Error('Failed to insert payment_processed event.')
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentIntentId: intent.id, status: intent.status, snapshot: buildSnapshotMeta({ source: 'db', updatedAt: item?.updatedAt || null }) })
  } catch (error) {
    const roomCode = String(req.params.code || '').trim()
    const billingMode = String(req.body?.billingMode || '').trim().toLowerCase() === 'resolution' ? 'resolution' : 'investigation'
    const scheduleIndex = Number(req.body?.scheduleIndex)
    if (roomCode && Number.isInteger(scheduleIndex) && scheduleIndex >= 0) {
      try {
        const room = await ensureRoom(roomCode)
        const scheduleFieldKey = billingMode === 'resolution' ? 'resolution_billing_schedule' : 'investigation_billing_schedule'
        const parseScheduleValue = (value) => {
          if (Array.isArray(value)) return value
          if (typeof value === 'string' && value.trim()) {
            try {
              const parsed = JSON.parse(value)
              return Array.isArray(parsed) ? parsed : []
            } catch {
              return []
            }
          }
          return []
        }
        const rows = (() => {
          const scoped = parseScheduleValue(room.state.answers[scheduleFieldKey]).map((row) => ({ ...(row || {}) }))
          if (scoped.length) return scoped
          if (billingMode === 'investigation') return parseScheduleValue(room.state.answers.billing_schedule).map((row) => ({ ...(row || {}) }))
          return []
        })()
        if (rows[scheduleIndex]) {
          const reason = getStripePaymentFailureReason(error)
          rows[scheduleIndex] = {
            ...rows[scheduleIndex],
            status: 'Failed',
            failureReason: reason,
            processorReason: reason,
            reason,
            processedPaymentMethodLast4: '',
            processedPaymentMethodBrand: '',
          }
          room.state.answers[scheduleFieldKey] = rows
          const persistPatches = [{ type: 'setAnswer', questionId: scheduleFieldKey, value: rows }]
          if (billingMode === 'investigation') {
            room.state.answers.billing_schedule = rows
            persistPatches.push({ type: 'setAnswer', questionId: 'billing_schedule', value: rows })
          }
          await persistRoomState(roomCode, room, persistPatches)
        }
      } catch {
        // ignore persistence errors during failure handling
      }
    }
    return res.status(400).json({
      error: getStripePaymentFailureReason(error),
    })
  }
})

app.post('/api/admin/consultations/:code/send-document-email', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    const documentType = String(req.body?.documentType || '').trim()
    const recipientEmail = String(req.body?.recipientEmail || '').trim()
    const spouseRecipientEmail = String(req.body?.spouseRecipientEmail || '').trim()
    const baseUrl = String(req.body?.baseUrl || req.body?.base_url || req.headers.origin || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required.' })
    if (!['8821 Document', 'Resolution Documents'].includes(documentType)) {
      return res.status(400).json({ error: 'A supported document type is required.' })
    }
    if (OUTBOUND_EMAILS_DISABLED) {
      return res.status(503).json({ error: 'Outbound client emails are temporarily disabled.' })
    }

    const room = await ensureRoom(roomCode)
    const item = await getConsultationRecordByCode(roomCode)
    if (!item) return res.status(404).json({ error: 'Consultation record not found.' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser) && String(req.adminUser?.designatedPosition || '').trim() === 'Enrolled Agent') {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    const wantsCustomEmail = false
    const requiresCrmEmail = documentType !== '8821 Document'
    if (requiresCrmEmail && !hasDirectGhlConfig()) {
      return res.status(503).json({ error: 'CRM email sending is not configured.' })
    }

    const answers = room.state.answers || {}
    const recordEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || item.email || '').trim()
    const resolvedRecipientEmail = isValidEmailAddress(recipientEmail) ? recipientEmail : recordEmail
    if (!isValidEmailAddress(resolvedRecipientEmail)) {
      return res.status(400).json({ error: 'No valid client email is attached to this record yet.' })
    }
    answers.email = resolvedRecipientEmail
    answers.email_address = resolvedRecipientEmail
    let links = buildExternalDocumentLinks(roomCode, room, baseUrl)
    const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || item.clientName || 'Client').trim() || 'Client'
    const phone = String(getPrimaryAnswer(answers, ['phone', 'phone_number']) || item.phone || '').trim()
    let contactId = String(room.contactId || answers.ghl_contact_id || item.contactId || '').trim()
    if (requiresCrmEmail) {
      const resolved = await resolveGhlContactIdForEmail({ contactId, email: resolvedRecipientEmail, name: clientName, phone })
      contactId = String(resolved || '').trim()
      if (!contactId) throw new Error('A CRM contact id is required before emailing this document.')
      room.contactId = contactId
      room.state.answers.ghl_contact_id = contactId
      room.state.answers.ghl_contact_created_at = room.state.answers.ghl_contact_created_at || new Date().toISOString()
      try {
        await dbUpsertSession({ code: roomCode, contactId, state: room.state })
      } catch {
        // ignore; state still updates in-memory
      }
    }

    const documentEmailLog = Array.isArray(answers.document_email_log) ? answers.document_email_log : parseStoredObject(answers.document_email_log, [])
    const documentDeliveryLog = Array.isArray(answers.document_delivery_log) ? answers.document_delivery_log : parseStoredObject(answers.document_delivery_log, [])
    const hiddenDocumentReceiptNames = (
      Array.isArray(answers.hidden_document_receipt_names)
        ? answers.hidden_document_receipt_names
        : parseStoredObject(answers.hidden_document_receipt_names, [])
    ).filter((name) => typeof name === 'string' && name.trim())
    const sentAt = new Date().toISOString()
    const nextReceipts = []
    const logEntries = []
    const deliveryEntries = []

    if (documentType === '8821 Document') {
      const documentCode = createDocumentInstanceCode('red')
      answers.current_8821_document_code = documentCode
      answers.active_8821_document_code = documentCode
      answers.boldsign_8821_document_id = ''
      answers.boldsign_8821_spouse_document_id = ''
      answers.boldsign_8821_file_name = ''
      answers.boldsign_8821_spouse_file_name = ''
      answers.boldsign_8821_sent_at = ''
      answers.boldsign_8821_spouse_sent_at = ''
      answers.boldsign_8821_sender_email = ''
      answers.boldsign_8821_spouse_sender_email = ''
      clearSigned8821DocumentRecord(answers)
      clearSigned8821FirstPageDocumentRecord(answers)
      answers.boldsign_8821_signed_at = ''
      answers.signed_8821_saved_at = ''
      answers.signed_8821_first_page_saved_at = ''
      answers.signed_8821_client_emailed_at = ''
      answers.signed_8821_client_email_sending_at = ''
      answers.signed_8821_render_version = ''
      answers.signed_8821_first_page_render_version = ''
      answers.form8821_spouse_release_error = ''
      answers.form8821_spouse_release_attempted_at = ''
      answers.form8821_spouse_released_at = ''
      answers.boldsign_8821_delivery_mode = 'boldsign_email'
      answers.form8821_status = 'launching'

      // Ensure we create the BoldSign document immediately when the rep clicks
      // "Send Document" so the client only has to sign (everything else is prefilled).
      const backendBase = String(getBackendBaseUrl() || '').trim().replace(/\/+$/, '')
      const clientReturnUrl = backendBase
        ? `${backendBase}/api/session/${encodeURIComponent(roomCode)}/document-complete?target=client`
        : ''
      const spouseReturnUrl = backendBase
        ? `${backendBase}/api/session/${encodeURIComponent(roomCode)}/document-complete?target=spouse`
        : ''

      const isMarriedJoint = isMarriedJointFilingAnswers(answers)
      const boldsignConfig = getBoldsignConfig()
      const mfjTemplateId = String(boldsignConfig.templateIdMfj || boldsignConfig.templateId || '').trim()
      if (isMarriedJoint) {
        if (!isValidEmailAddress(spouseRecipientEmail)) {
          return res.status(400).json({ error: 'Spouse email is required for married filing jointly.' })
        }
        if (!mfjTemplateId) {
          return res.status(503).json({ error: 'The married filing jointly BoldSign template is not configured yet.' })
        }
        // Store spouse email so template sending can attach spouse as RoleIndex 2.
        answers.spouse_email = spouseRecipientEmail
        answers.form8821_spouse_status = 'awaiting_client_signature'
      } else {
        answers.form8821_spouse_status = 'not_required'
      }

      const created = await createBoldsign8821SigningLink({
        sessionCode: roomCode,
        signerName: clientName,
        signerEmail: resolvedRecipientEmail,
        spouseSignerName: String(getSpouseSignerNameFromAnswers(answers) || '').trim(),
        spouseSignerEmail: String(answers.spouse_email || spouseRecipientEmail || '').trim(),
        returnUrl: clientReturnUrl,
        onBehalfOf: String(req.adminUser?.email || '').trim(),
        disableEmails: false,
        persistDocument: true,
        documentFieldPrefix: 'boldsign_8821',
        forceNewDocument: true,
      })

      const clientSigningUrl = String(created?.signingUrl || '').trim()
      links = {
        ...links,
        form8821ClientLink: clientSigningUrl,
        form8821SpouseLink: '',
      }

      nextReceipts.push({ name: '8821 Document', documentCode, status: 'Sent' })
      logEntries.push({
        id: `doc_email_${Date.now().toString(36)}_client`,
        documentType: '8821 Document',
        documentCode,
        recipientEmail: resolvedRecipientEmail,
        link: links.form8821ClientLink || '',
        sentAt,
        sentBy: String(req.adminUser?.email || '').trim(),
      })
      deliveryEntries.push({
        id: `doc_delivery_${Date.now().toString(36)}_client`,
        name: '8821 Document',
        documentCode,
        status: 'Sent',
        method: 'BoldSign Email',
        sentAt,
        recipientEmail: resolvedRecipientEmail,
        sentBy: String(req.adminUser?.email || '').trim(),
      })

      answers.onboarding_status = 'documents_ready_for_signature'
    } else {
      const isMarriedJoint = isMarriedJointFilingAnswers(answers)
      const resolvedSpouseRecipientEmail = String(answers.spouse_email || spouseRecipientEmail || '').trim()
      if (isMarriedJoint && !isValidEmailAddress(resolvedSpouseRecipientEmail)) {
        return res.status(400).json({ error: 'Spouse email is required for married filing jointly resolution documents.' })
      }
      answers.spouse_email = resolvedSpouseRecipientEmail || answers.spouse_email || ''
      answers.boldsign_resolution_signed_at = ''
      await createBoldsignResolutionSigningLink({
        sessionCode: roomCode,
        signerName: clientName,
        signerEmail: resolvedRecipientEmail,
        spouseSignerName: String(getSpouseSignerNameFromAnswers(answers) || '').trim(),
        spouseSignerEmail: resolvedSpouseRecipientEmail,
        onBehalfOf: String(req.adminUser?.email || '').trim(),
        disableEmails: false,
        persistDocument: true,
      })
      const resolutionDocumentCode = String(answers.boldsign_resolution_document_id || '').trim()
      nextReceipts.push({ name: 'Resolution Documents', documentCode: resolutionDocumentCode, status: 'Sent' })
      logEntries.push({
        id: `doc_email_${Date.now().toString(36)}_resolution`,
        documentType: 'Resolution Documents',
        documentCode: resolutionDocumentCode,
        recipientEmail: resolvedRecipientEmail,
        link: '',
        sentAt,
        sentBy: String(req.adminUser?.email || '').trim(),
      })
      deliveryEntries.push({
        id: `doc_delivery_${Date.now().toString(36)}_resolution`,
        name: 'Resolution Documents',
        documentCode: resolutionDocumentCode,
        status: 'Sent',
        method: 'BoldSign Email',
        sentAt,
        recipientEmail: resolvedRecipientEmail,
        sentBy: String(req.adminUser?.email || '').trim(),
      })
    }

    const resentNames = new Set(nextReceipts.map((receipt) => String(receipt?.name || '').trim()).filter(Boolean))
    answers.document_receipts = upsertDocumentReceipts(answers.document_receipts, nextReceipts)
    answers.hidden_document_receipt_names = hiddenDocumentReceiptNames.filter((name) => !resentNames.has(String(name || '').trim()))
    answers.document_email_log = [...logEntries, ...(Array.isArray(documentEmailLog) ? documentEmailLog : [])]
    answers.document_delivery_log = [...deliveryEntries, ...(Array.isArray(documentDeliveryLog) ? documentDeliveryLog : [])]
    answers.last_document_email_sent_at = sentAt
    room.state.updatedAt = Date.now()

    await persistRoomState(roomCode, room, [
      { type: 'setAnswer', questionId: 'document_receipts', value: answers.document_receipts },
      { type: 'setAnswer', questionId: 'hidden_document_receipt_names', value: answers.hidden_document_receipt_names },
      { type: 'setAnswer', questionId: 'document_email_log', value: answers.document_email_log },
      { type: 'setAnswer', questionId: 'document_delivery_log', value: answers.document_delivery_log },
      { type: 'setAnswer', questionId: 'last_document_email_sent_at', value: sentAt },
      ...(documentType === '8821 Document'
        ? [
            { type: 'setAnswer', questionId: 'onboarding_status', value: answers.onboarding_status },
            { type: 'setAnswer', questionId: 'current_8821_document_code', value: answers.current_8821_document_code },
            { type: 'setAnswer', questionId: 'active_8821_document_code', value: answers.active_8821_document_code },
            { type: 'setAnswer', questionId: 'form8821_status', value: answers.form8821_status },
            { type: 'setAnswer', questionId: 'form8821_spouse_status', value: answers.form8821_spouse_status || '' },
            { type: 'setAnswer', questionId: 'spouse_email', value: answers.spouse_email || '' },
            { type: 'setAnswer', questionId: 'boldsign_8821_signed_at', value: answers.boldsign_8821_signed_at },
            { type: 'setAnswer', questionId: 'signed_8821_saved_at', value: answers.signed_8821_saved_at },
            { type: 'setAnswer', questionId: 'signed_8821_first_page_saved_at', value: answers.signed_8821_first_page_saved_at },
            { type: 'setAnswer', questionId: 'signed_8821_client_emailed_at', value: answers.signed_8821_client_emailed_at },
            { type: 'setAnswer', questionId: 'signed_8821_render_version', value: answers.signed_8821_render_version },
            { type: 'setAnswer', questionId: 'signed_8821_first_page_render_version', value: answers.signed_8821_first_page_render_version },
          ]
        : documentType === 'Resolution Documents'
          ? [
              { type: 'setAnswer', questionId: 'spouse_email', value: answers.spouse_email || '' },
              { type: 'setAnswer', questionId: 'boldsign_resolution_document_id', value: answers.boldsign_resolution_document_id || '' },
              { type: 'setAnswer', questionId: 'boldsign_resolution_file_name', value: answers.boldsign_resolution_file_name || '' },
              { type: 'setAnswer', questionId: 'boldsign_resolution_sent_at', value: answers.boldsign_resolution_sent_at || '' },
              { type: 'setAnswer', questionId: 'boldsign_resolution_signed_at', value: answers.boldsign_resolution_signed_at || '' },
              { type: 'setAnswer', questionId: 'boldsign_resolution_sender_email', value: answers.boldsign_resolution_sender_email || '' },
              { type: 'setAnswer', questionId: 'boldsign_resolution_spouse_signer_email', value: answers.boldsign_resolution_spouse_signer_email || '' },
            ]
          : []),
    ])

    const refreshedItem = buildConsultationDetail({
      sessionCode: roomCode,
      contactId: room.contactId,
      opportunityId: room.opportunityId,
      state: room.state,
      createdAt: room.state?.updatedAt || Date.now(),
      updatedAt: room.state?.updatedAt || Date.now(),
    })
    emitDashboardRecordsUpdated({ reason: 'document_sent', sessionCode: roomCode })
    const eventOk = await dbInsertEvent({
      sessionCode: roomCode,
      eventType: 'document_email_sent',
      domain: 'documents',
      actorEmail: String(req.adminUser?.email || ''),
      requestId: getRequestId(req),
      payload: {
        documentType,
        recipientEmail: resolvedRecipientEmail,
        spouseRecipientEmail: spouseRecipientEmail || '',
        sentAt,
      },
    })
    if (!eventOk && STRICT_DB_MODE) throw new Error('Failed to insert document_email_sent event.')
    return res.json({
      ok: true,
      item: refreshedItem,
      sentAt,
      link: documentType === '8821 Document' ? links.form8821ClientLink : links.clientPortalLink,
      spouseLink: documentType === '8821 Document' && spouseRecipientEmail ? links.form8821SpouseLink : '',
      snapshot: buildSnapshotMeta({ source: 'db', updatedAt: room?.state?.updatedAt || Date.now() }),
    })
  } catch (error) {
    if (error?.boldsign) {
      console.error('BoldSign send-document-email debug:', error.boldsign)
    }
    const status = typeof error?.status === 'number' ? error.status : 500
    if (status === 429) {
      const retryAfterSeconds = typeof error?.retryAfterSeconds === 'number' && Number.isFinite(error.retryAfterSeconds) ? error.retryAfterSeconds : 60
      return res
        .status(429)
        .json({ error: `BoldSign is rate limiting right now. Please wait ${retryAfterSeconds} seconds and try again.` })
    }
    return res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to send document email.' })
  }
})

app.post('/api/admin/consultations/:code/release-spouse-document-email', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required.' })
    if (OUTBOUND_EMAILS_DISABLED) {
      return res.status(503).json({ error: 'Outbound client emails are temporarily disabled.' })
    }

    const room = await ensureRoom(roomCode)
    const item = await getConsultationRecordByCode(roomCode)
    if (!item) return res.status(404).json({ error: 'Consultation record not found.' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser) && String(req.adminUser?.designatedPosition || '').trim() === 'Enrolled Agent') {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    if (!hasDirectGhlConfig()) {
      return res.status(503).json({ error: 'CRM email sending is not configured.' })
    }

    const answers = room.state.answers || {}
    if (!isMarriedJointFilingAnswers(answers)) {
      return res.status(400).json({ error: 'Spouse document release only applies to married filing jointly records.' })
    }
    if (String(answers.form8821_status || '').trim().toLowerCase() !== 'completed') {
      return res.status(409).json({ error: 'The client must complete signing before the spouse email can be released.' })
    }
    if (String(answers.form8821_spouse_status || '').trim().toLowerCase() === 'completed') {
      return res.status(409).json({ error: 'The spouse signature is already complete for this document.' })
    }

    answers.form8821_spouse_release_attempted_at = new Date().toISOString()
    answers.form8821_spouse_release_error = ''

    const overrideSpouseRecipientEmail = String(req.body?.spouseRecipientEmail || '').trim()
    if (overrideSpouseRecipientEmail) {
      answers.spouse_email = overrideSpouseRecipientEmail
    }
    const releaseResult = await releasePendingMfj8821SpouseEmail({
      roomCode,
      room,
      senderEmail: String(req.adminUser?.email || answers.boldsign_8821_sender_email || '').trim(),
      spouseRecipientEmail: overrideSpouseRecipientEmail,
    })

    room.state.updatedAt = Date.now()
    await persistRoomState(roomCode, room, [
      { type: 'setAnswer', questionId: 'form8821_spouse_status', value: answers.form8821_spouse_status || '' },
      { type: 'setAnswer', questionId: 'form8821_spouse_release_error', value: answers.form8821_spouse_release_error || '' },
      { type: 'setAnswer', questionId: 'form8821_spouse_release_attempted_at', value: answers.form8821_spouse_release_attempted_at || '' },
      { type: 'setAnswer', questionId: 'form8821_spouse_released_at', value: answers.form8821_spouse_released_at || '' },
      { type: 'setAnswer', questionId: 'spouse_email', value: answers.spouse_email || '' },
      { type: 'setAnswer', questionId: 'document_receipts', value: answers.document_receipts },
      { type: 'setAnswer', questionId: 'hidden_document_receipt_names', value: answers.hidden_document_receipt_names },
      { type: 'setAnswer', questionId: 'document_email_log', value: answers.document_email_log },
      { type: 'setAnswer', questionId: 'document_delivery_log', value: answers.document_delivery_log },
    ])

    const refreshedItem = buildConsultationDetail({
      sessionCode: roomCode,
      contactId: room.contactId,
      opportunityId: room.opportunityId,
      state: room.state,
      createdAt: room.state?.updatedAt || Date.now(),
      updatedAt: room.state?.updatedAt || Date.now(),
    })
    emitDashboardRecordsUpdated({ reason: 'spouse_document_released', sessionCode: roomCode })
    const eventOk = await dbInsertEvent({
      sessionCode: roomCode,
      eventType: 'document_email_released_spouse',
      domain: 'documents',
      actorEmail: String(req.adminUser?.email || ''),
      requestId: getRequestId(req),
      payload: {
        sentAt: releaseResult.sentAt || answers.form8821_spouse_released_at || '',
        spouseRecipientEmail: releaseResult.recipientEmail || answers.spouse_email || '',
        spouseStatus: answers.form8821_spouse_status || '',
      },
    })
    if (!eventOk && STRICT_DB_MODE) throw new Error('Failed to insert document_email_released_spouse event.')
    return res.json({
      ok: true,
      item: refreshedItem,
      sentAt: releaseResult.sentAt || answers.form8821_spouse_released_at || '',
      spouseRecipientEmail: releaseResult.recipientEmail || answers.spouse_email || '',
      spouseLink: releaseResult.signingUrl || '',
      snapshot: buildSnapshotMeta({ source: 'db', updatedAt: room?.state?.updatedAt || Date.now() }),
    })
  } catch (error) {
    try {
      const roomCode = String(req.params.code || '').trim()
      if (roomCode) {
        const room = await ensureRoom(roomCode)
        const answers = room.state.answers || {}
        answers.form8821_spouse_status = 'release_failed'
        answers.form8821_spouse_release_error = error instanceof Error ? error.message : 'Unable to release the spouse signing email.'
        answers.form8821_spouse_release_attempted_at = answers.form8821_spouse_release_attempted_at || new Date().toISOString()
        room.state.updatedAt = Date.now()
        await persistRoomState(roomCode, room, [
          { type: 'setAnswer', questionId: 'form8821_spouse_status', value: answers.form8821_spouse_status || '' },
          { type: 'setAnswer', questionId: 'form8821_spouse_release_error', value: answers.form8821_spouse_release_error || '' },
          { type: 'setAnswer', questionId: 'form8821_spouse_release_attempted_at', value: answers.form8821_spouse_release_attempted_at || '' },
        ])
      }
    } catch (persistError) {
      console.error('Failed to persist spouse release error state:', persistError instanceof Error ? persistError.message : String(persistError || ''))
    }
    if (error?.isTransientDb) {
      return res.status(503).json({ error: 'Database is waking up. Please refresh again in 10–30 seconds.' })
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to release spouse document email.' })
  }
})

app.post('/api/session/:code/release-spouse-document-email', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').toUpperCase().trim()
    if (!roomCode) return res.status(400).json({ error: 'code is required' })

    const room = await ensureRoom(roomCode)
    const answers = room.state.answers || {}
    if (!isMarriedJointFilingAnswers(answers)) {
      return res.status(400).json({ error: 'This session does not require a spouse signature.' })
    }
    if (String(answers.form8821_status || '').trim().toLowerCase() !== 'completed') {
      return res.status(409).json({ error: 'The client must finish signing before the spouse email can be released.' })
    }

    const spouseStatus = String(answers.form8821_spouse_status || '').trim().toLowerCase()
    if (spouseStatus === 'completed') {
      return res.json({
        ok: true,
        spouseStatus: 'completed',
        spouseReleasedAt: answers.form8821_spouse_released_at || '',
        spouseRecipientEmail: answers.spouse_email || '',
      })
    }
    if (spouseStatus === 'launching' || spouseStatus === 'signing') {
      return res.json({
        ok: true,
        spouseStatus,
        spouseReleasedAt: answers.form8821_spouse_released_at || '',
        spouseRecipientEmail: answers.spouse_email || '',
      })
    }

    answers.form8821_spouse_release_attempted_at = new Date().toISOString()
    answers.form8821_spouse_release_error = ''

    const releaseResult = await releasePendingMfj8821SpouseEmail({
      roomCode,
      room,
      senderEmail: String(answers.boldsign_8821_sender_email || '').trim(),
    })

    if (!releaseResult.sent && releaseResult.reason === 'already_sent') {
      answers.form8821_spouse_status = answers.form8821_spouse_status || 'launching'
    }

    room.state.updatedAt = Date.now()
    await persistRoomState(roomCode, room, [
      { type: 'setAnswer', questionId: 'form8821_spouse_status', value: answers.form8821_spouse_status || '' },
      { type: 'setAnswer', questionId: 'form8821_spouse_release_error', value: answers.form8821_spouse_release_error || '' },
      { type: 'setAnswer', questionId: 'form8821_spouse_release_attempted_at', value: answers.form8821_spouse_release_attempted_at || '' },
      { type: 'setAnswer', questionId: 'form8821_spouse_released_at', value: answers.form8821_spouse_released_at || '' },
      { type: 'setAnswer', questionId: 'document_receipts', value: answers.document_receipts },
      { type: 'setAnswer', questionId: 'hidden_document_receipt_names', value: answers.hidden_document_receipt_names },
      { type: 'setAnswer', questionId: 'document_email_log', value: answers.document_email_log },
      { type: 'setAnswer', questionId: 'document_delivery_log', value: answers.document_delivery_log },
    ])

    return res.json({
      ok: true,
      spouseStatus: answers.form8821_spouse_status || '',
      spouseReleasedAt: answers.form8821_spouse_released_at || '',
      spouseRecipientEmail: releaseResult.recipientEmail || answers.spouse_email || '',
    })
  } catch (error) {
    try {
      const roomCode = String(req.params.code || '').toUpperCase().trim()
      if (roomCode) {
        const room = await ensureRoom(roomCode)
        const answers = room.state.answers || {}
        answers.form8821_spouse_status = 'release_failed'
        answers.form8821_spouse_release_error = error instanceof Error ? error.message : 'Unable to release the spouse signing email.'
        answers.form8821_spouse_release_attempted_at = answers.form8821_spouse_release_attempted_at || new Date().toISOString()
        room.state.updatedAt = Date.now()
        await persistRoomState(roomCode, room, [
          { type: 'setAnswer', questionId: 'form8821_spouse_status', value: answers.form8821_spouse_status || '' },
          { type: 'setAnswer', questionId: 'form8821_spouse_release_error', value: answers.form8821_spouse_release_error || '' },
          { type: 'setAnswer', questionId: 'form8821_spouse_release_attempted_at', value: answers.form8821_spouse_release_attempted_at || '' },
        ])
      }
    } catch {
      // ignore persistence failures during error handling
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to release spouse document email.' })
  }
})

app.post('/api/session', (_req, res) => {
  ;(async () => {
    let code = generateSessionId()
    while (await dbGetSession(code)) code = generateSessionId()
    if (pool) await dbUpsertSession({ code, state: initialRoomState() })
    else await ensureRoom(code)
    res.json({ code })
  })().catch(() => res.status(500).json({ error: 'Failed to create session' }))
})

app.post('/api/session/:code/soft-credit-check', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').toUpperCase().trim()
    if (!roomCode) return res.status(400).json({ error: 'code is required' })
    const room = await ensureRoom(roomCode)
    const creditCheck = await runSoftCreditCheckForRoom({
      roomCode,
      room,
      consentGranted: Boolean(req.body?.consentGranted),
      source: String(req.body?.source || 'document_signed').trim() || 'document_signed',
      force: Boolean(req.body?.force),
      ipAddress: getRequestIp(req),
      userAgent: String(req.headers['user-agent'] || '').trim(),
    })
    return res.json({ ok: true, creditCheck })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to run soft credit check.' })
  }
})

app.post('/api/session/:code/presence', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').toUpperCase().trim()
    if (!roomCode) return res.status(400).json({ error: 'code is required' })
    const room = await ensureRoom(roomCode)
    const isMirror = Boolean(req.body?.isMirror)
    const safePageVisible = typeof req.body?.pageVisible === 'boolean' ? req.body.pageVisible : true
    const safePageFocused = typeof req.body?.pageFocused === 'boolean' ? req.body.pageFocused : safePageVisible
    if (!isMirror) {
      room.lastClientPresenceAt = Date.now()
      room.lastClientPageVisible = safePageVisible
      room.lastClientPageFocused = safePageFocused
    }
    return res.json({ ok: true, clientPresent: !isMirror })
  } catch {
    return res.status(500).json({ error: 'Failed to record presence' })
  }
})

app.get('/api/boldsign/config', (_req, res) => {
  const config = getBoldsignConfig()
  res.json({ ready: config.ready })
})

app.post('/api/boldsign/8821/recipient-view', async (req, res) => {
  try {
    const sessionCode = String(req.body?.sessionCode || '').trim()
    if (!sessionCode) return res.status(400).json({ error: 'sessionCode is required' })
    const target = String(req.body?.target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
    const roomState = await getSessionStateForCode(sessionCode)
    const answers = roomState?.answers || {}
    const boldsignConfig = getBoldsignConfig()
    const isMarriedJoint = isMarriedJointFilingAnswers(answers)
    const isSingleFiling = isSingleFilingAnswers(answers)
    const selectedTemplateId = isMarriedJoint
      ? String(boldsignConfig.templateIdMfj || '').trim()
      : String(boldsignConfig.templateIdSingle || '').trim()
    const templateConfigured = Boolean(selectedTemplateId)
    if (
      target === 'spouse' &&
      isMarriedJoint &&
      String(answers.form8821_status || '').trim().toLowerCase() !== 'completed'
    ) {
      return res.status(409).json({ error: 'The spouse signing link is released only after the client completes the first signature.' })
    }
    const documentFieldPrefix = templateConfigured ? 'boldsign_8821' : target === 'spouse' ? 'boldsign_8821_spouse' : 'boldsign_8821'
    const existingDocumentId = String(answers[`${documentFieldPrefix}_document_id`] || '').trim()
    if (existingDocumentId && is8821TargetAlreadySigned(answers, target)) {
      return res.json({ alreadySigned: true, documentId: existingDocumentId, target })
    }
    const result = await createBoldsign8821SigningLink({
      sessionCode,
      signerName: String(req.body?.name || '').trim(),
      signerEmail: String(req.body?.email || '').trim(),
      returnUrl: String(req.body?.returnUrl || '').trim(),
      onBehalfOf: String(req.body?.onBehalfOf || '').trim(),
      persistDocument: true,
      createReceiptOnCreate: true,
      receiptRecipientEmail: String(req.body?.email || '').trim(),
      documentFieldPrefix,
      target,
    })
    return res.json(result)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('BoldSign 8821 recipient view failed:', error)
    if (error?.boldsign) {
      console.error('BoldSign 8821 recipient view debug:', error.boldsign)
    }
    const status = typeof error?.status === 'number' ? error.status : 500
    if (status === 429) {
      const retryAfterSeconds = typeof error?.retryAfterSeconds === 'number' && Number.isFinite(error.retryAfterSeconds) ? error.retryAfterSeconds : 60
      return res
        .status(429)
        .json({ error: `BoldSign is rate limiting right now. Please wait ${retryAfterSeconds} seconds and try again.` })
    }
    return res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to create BoldSign signing view.' })
  }
})

app.get('/api/session/:code/document-complete', async (req, res) => {
  const roomCode = String(req.params.code || '').toUpperCase().trim()
  const target = String(req.query?.target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
  if (roomCode) {
    try {
      await markBoldsign8821Completed({ roomCode, target })
    } catch (error) {
      console.error('Standalone BoldSign completion failed:', error)
    }
  }
  res.set('Cache-Control', 'no-store')
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Document complete</title>
    <style>
      body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f4f8fb; color:#16253d; }
      .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
      .card { width:min(560px, 100%); background:#fff; border:1px solid rgba(18,32,51,.08); border-radius:24px; padding:32px; box-shadow:0 22px 60px rgba(12,25,45,.12); }
      .eyebrow { margin:0 0 10px; color:#5d8f41; font-size:11px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
      h1 { margin:0 0 12px; font-size:32px; line-height:1.05; letter-spacing:-.04em; }
      p { margin:0; color:#5d6d84; font-size:15px; line-height:1.6; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="eyebrow">Document complete</p>
        <h1>Document signing finished</h1>
        <p>This standalone document session is complete. You can close this window now.</p>
      </div>
    </div>
  </body>
</html>`)
})

app.get('/api/session/:code/document-link', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').trim()
    const target = String(req.query?.target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
    if (!roomCode) return res.status(400).json({ error: 'sessionCode is required' })

    const roomState = await getSessionStateForCode(roomCode)
    if (!roomState) return res.status(404).json({ error: 'Session not found' })
    const answers = roomState.answers || {}
    const clientEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
    const logEntries = Array.isArray(answers.document_email_log) ? answers.document_email_log : parseStoredObject(answers.document_email_log, [])
    const targetLog = Array.isArray(logEntries)
      ? logEntries.find((entry) => String(entry?.documentType || '').trim() === (target === 'spouse' ? '8821 Spouse' : '8821 Document'))
      : null
    const signerName =
      target === 'spouse'
        ? String(
            req.query?.name ||
              getNormalizedSpouseName(answers) ||
              'Spouse',
          ).trim()
        : String(req.query?.name || getPrimaryAnswer(answers, ['full_name', 'name']) || 'Client').trim()
    const signerEmail =
      target === 'spouse'
        ? String(req.query?.email || targetLog?.recipientEmail || '').trim()
        : String(req.query?.email || getPrimaryAnswer(answers, ['email', 'email_address']) || targetLog?.recipientEmail || '').trim()
    if (!isValidEmailAddress(signerEmail)) {
      return res.status(400).json({ error: `No valid ${target === 'spouse' ? 'spouse' : 'client'} email is attached to this document yet.` })
    }
    const embeddedSignerEmail =
      target === 'spouse' ? getStoredBoldsignSpouseSignerEmail(answers, { clientEmail }) || resolveBoldsignSignerEmail(signerEmail, { target: 'spouse', primaryEmail: clientEmail }) : signerEmail

    const backendBase = getBackendBaseUrl()
    const returnUrl =
      String(req.query?.returnUrl || '').trim() ||
      (backendBase ? `${backendBase}/api/session/${encodeURIComponent(roomCode)}/document-complete?target=${target}` : '')

    const boldsignConfig = getBoldsignConfig()
    const isMarriedJoint = isMarriedJointFilingAnswers(answers)
    const isSingleFiling = isSingleFilingAnswers(answers)
    const selectedTemplateId = isMarriedJoint
      ? String(boldsignConfig.templateIdMfj || '').trim()
      : String(boldsignConfig.templateIdSingle || '').trim()
    const templateConfigured = Boolean(selectedTemplateId)
    if (
      target === 'spouse' &&
      isMarriedJoint &&
      String(answers.form8821_status || '').trim().toLowerCase() !== 'completed'
    ) {
      return res.status(409).json({ error: 'The spouse signing link is released only after the client completes the first signature.' })
    }

    // When we use a BoldSign template (client + spouse roles), we keep a single
    // BoldSign document id (`boldsign_8821_document_id`) and just generate
    // separate embedded signing links for each signer email.
    const documentFieldPrefix = templateConfigured ? 'boldsign_8821' : target === 'spouse' ? 'boldsign_8821_spouse' : 'boldsign_8821'
    const existingDocumentId = String(answers[`${documentFieldPrefix}_document_id`] || '').trim()
    const allowExistingDocumentReuse = Boolean(existingDocumentId) && !isForm8821FullySigned(answers)
    let signingUrl = ''

    if (allowExistingDocumentReuse && returnUrl) {
      try {
        signingUrl = await getBoldsignEmbeddedSignLink({
          documentId: existingDocumentId,
          signerEmail: embeddedSignerEmail,
          redirectUrl: returnUrl,
        })
      } catch {
        signingUrl = ''
      }
    }

    if (!signingUrl) {
      if (templateConfigured && target === 'spouse') {
        // Ensure spouse email is stored for MFJ template sending.
        if (!String(answers.spouse_email || '').trim()) answers.spouse_email = signerEmail
        const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || 'Client').trim()
        if (!isValidEmailAddress(clientEmail)) {
          return res.status(400).json({ error: 'No valid client email is attached to this record yet.' })
        }
        const created = await createBoldsign8821SigningLink({
          sessionCode: roomCode,
          signerName: clientName,
          signerEmail: clientEmail,
          returnUrl,
          persistDocument: true,
          documentFieldPrefix: 'boldsign_8821',
        })
        signingUrl = await getBoldsignEmbeddedSignLink({
          documentId: String(created?.documentId || '').trim(),
          signerEmail: String(created?.spouseSignerEmail || embeddedSignerEmail || signerEmail).trim(),
          redirectUrl: returnUrl,
        })
      } else {
        const created = await createBoldsign8821SigningLink({
          sessionCode: roomCode,
          signerName,
          signerEmail,
          returnUrl,
          persistDocument: true,
          documentFieldPrefix,
        })
        signingUrl = String(created.signingUrl || '').trim()
      }
    }

    if (!signingUrl) return res.status(500).json({ error: 'Unable to create a standalone document link.' })
    return res.redirect(signingUrl)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create document link.' })
  }
})

app.get('/api/session/:code', (req, res) => {
  ;(async () => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.set('Pragma', 'no-cache')
    res.set('Expires', '0')
    const rawCode = String(req.params.code || '').trim()
    const variants = Array.from(new Set([rawCode, rawCode.toUpperCase(), rawCode.toLowerCase()])).filter(Boolean)
    const liveRoom = getMostRelevantLiveRoom(rawCode)
    const primaryClient = getPrimaryLiveClient(liveRoom)
    const clientPresent = Boolean(
      hasLiveClientParticipant(liveRoom) ||
        (liveRoom?.lastClientPresenceAt && Date.now() - liveRoom.lastClientPresenceAt < 12000),
    )
    const clientPageVisible =
      typeof primaryClient?.pageVisible === 'boolean'
        ? primaryClient.pageVisible
        : typeof liveRoom?.lastClientPageVisible === 'boolean'
          ? liveRoom.lastClientPageVisible
          : true
    const clientPageFocused =
      typeof primaryClient?.pageFocused === 'boolean'
        ? primaryClient.pageFocused
        : typeof liveRoom?.lastClientPageFocused === 'boolean'
          ? liveRoom.lastClientPageFocused
          : true
    if (pool) {
      let row = null
      for (const code of variants) {
        row = await dbGetSession(code)
        if (row) break
      }
      res.json({
        exists: Boolean(row),
        route: row?.state?.route || '/session',
        clientPresent,
        clientPageVisible,
        clientPageFocused,
        updatedAt:
          Number(row?.state?.updatedAt) ||
          (row?.updated_at ? new Date(row.updated_at).getTime() : 0),
      })
      return
    }
    let room = null
    for (const code of variants) {
      room = rooms.get(code)
      if (room) break
    }
    res.json({
      exists: Boolean(room),
      route: room?.state?.route || '/session',
      clientPresent,
      clientPageVisible,
      clientPageFocused,
      updatedAt: Number(room?.state?.updatedAt) || 0,
    })
  })().catch(() => res.status(500).json({ exists: false }))
})

// Resolve/create a session for a given GoHighLevel contact id
app.get('/api/client/:contactId/session', (req, res) => {
  ;(async () => {
    const contactId = String(req.params.contactId || '').trim()
    const opportunityId = String(req.query?.opportunityId || '').trim()
    if (!contactId) return res.status(400).json({ error: 'contactId is required' })
    const code = await dbGetOrCreateSession({ contactId, opportunityId })
    return res.json({ code })
  })().catch(() => res.status(500).json({ error: 'Failed to resolve session' }))
})

// Standalone Client Portal (email + last4) auth endpoints
app.post('/api/client-portal/check-email', (req, res) => {
  ;(async () => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' })
    const row = await findLatestSessionByEmail(email)
    const answers = row?.state?.answers || {}
    const authorized = Boolean(row?.session_code) && isPortalAuthorizedForAnswers(answers)
    return res.json({
      exists: Boolean(row),
      authorized,
      message: authorized
        ? ''
        : 'Your client portal access will unlock after your signed Form 8821 authorization is received.',
    })
  })().catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to check email' }))
})

app.post('/api/client-portal/auth', (req, res) => {
  ;(async () => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const ssn4 = String(req.body?.ssn4 || '').replace(/\D/g, '').slice(0, 4)
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' })
    if (ssn4.length !== 4) return res.status(400).json({ error: 'Last 4 digits are required.' })

    const row = await findLatestSessionByEmail(email)
    if (!row?.session_code) return res.status(404).json({ error: 'No client portal record found for that email.' })

    const answers = row?.state?.answers || {}
    if (!isPortalAuthorizedForAnswers(answers)) {
      return res
        .status(403)
        .json({ error: 'Your client portal access will unlock after your signed Form 8821 authorization is received.' })
    }
    const storedLast4 = getAnswerSsnLast4(answers)
    if (storedLast4 && storedLast4 !== ssn4) {
      return res.status(401).json({ error: "We couldn't verify your account with that SSN. Please try again or contact support for help signing in." })
    }

    return res.json(createPortalAuthSuccessPayload(row))
  })().catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to verify client portal account' }))
})

app.post('/api/client-portal/send-sms-code', (req, res) => {
  ;(async () => {
    cleanupExpiredPortalSmsCodes()
    const phone = String(req.body?.phone || '').trim()
    const normalizedPhone = normalizePhoneForSms(phone)
    const phoneDigits = getPortalPhoneDigits(normalizedPhone)
    if (phoneDigits.length !== 10) return res.status(400).json({ error: 'A valid 10-digit phone number is required.' })

    const row = await findLatestSessionByPhone(normalizedPhone)
    if (!row?.session_code) return res.status(404).json({ error: 'No client portal record found for that phone number.' })

    const answers = row?.state?.answers || {}
    if (!isPortalAuthorizedForAnswers(answers)) {
      return res
        .status(403)
        .json({ error: 'Your client portal access will unlock after your signed Form 8821 authorization is received.' })
    }

    const storedPhone = getDashboardPhoneForPortal(answers)
    const storedDigits = getPortalPhoneDigits(storedPhone)
    if (storedDigits.length !== 10 || storedDigits !== phoneDigits) {
      return res.status(401).json({ error: "We couldn't verify your account with that phone number. Please try again or contact support for help signing in." })
    }

    const contactId = String(row.ghl_contact_id || '').trim()
    if (!contactId) {
      return res
        .status(400)
        .json({ error: 'We found your phone number, but this account is not fully set up for text verification yet. Please contact TaxRefresh for help signing in.' })
    }

    const existing = portalSmsCodeStore.get(storedDigits)
    const now = Date.now()
    if (existing && Number(existing.nextSendAt || 0) > now) {
      const waitSeconds = Math.max(1, Math.ceil((Number(existing.nextSendAt || 0) - now) / 1000))
      return res.status(429).json({ error: `Please wait ${waitSeconds} seconds before requesting another code.` })
    }

    const code = createPortalSmsCode()
    const message = getPortalSmsMessage(code)
    const roomCode = String(row.session_code || '').trim().toUpperCase()
    const room = await ensureRoom(roomCode)
    const response = await sendGhlSmsMessage({ contactId, phoneNumber: storedPhone, message })
    const conversationId = String(response?.conversationId || answers?.ghl_sms_conversation_id || answers?.ghl_conversation_id || '').trim()
    const outboundEntry = normalizeSmsThreadEntry({
      id: String(response?.messageId || '').trim(),
      conversationId,
      contactId,
      body: message,
      direction: 'outbound',
      status: 'delivered',
      messageType: 'SMS',
      dateAdded: new Date().toISOString(),
      from: '',
      to: normalizedPhone,
      source: 'client_portal_auth',
    })
    await persistSmsThreadForRoom({ roomCode, room, entries: [outboundEntry], conversationId, contactId })

    portalSmsCodeStore.set(storedDigits, {
      code,
      expiresAt: now + CLIENT_PORTAL_SMS_CODE_TTL_MS,
      nextSendAt: now + CLIENT_PORTAL_SMS_SEND_COOLDOWN_MS,
      attempts: 0,
      sessionCode: String(row.session_code || '').trim(),
      ghlContactId: contactId,
      ghlOpportunityId: String(row.ghl_opportunity_id || '').trim(),
      clientName: String(getPrimaryAnswer(answers, ['full_name', 'name']) || '').trim(),
      phone: normalizedPhone,
    })

    return res.json({
      ok: true,
      maskedPhone: maskPortalPhoneNumber(normalizedPhone),
      expiresInSeconds: Math.floor(CLIENT_PORTAL_SMS_CODE_TTL_MS / 1000),
    })
  })().catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send sign-in code' }))
})

app.post('/api/client-portal/verify-sms-code', (req, res) => {
  ;(async () => {
    cleanupExpiredPortalSmsCodes()
    const phone = String(req.body?.phone || '').trim()
    const submittedCode = String(req.body?.code || '').replace(/\D/g, '').slice(0, CLIENT_PORTAL_SMS_CODE_LENGTH)
    const phoneDigits = getPortalPhoneDigits(phone)
    if (phoneDigits.length !== 10) return res.status(400).json({ error: 'A valid 10-digit phone number is required.' })
    if (submittedCode.length !== CLIENT_PORTAL_SMS_CODE_LENGTH) {
      return res.status(400).json({ error: `Enter the ${CLIENT_PORTAL_SMS_CODE_LENGTH}-digit code from your text message.` })
    }

    const pending = portalSmsCodeStore.get(phoneDigits)
    if (!pending) return res.status(400).json({ error: 'Please request a new sign-in code.' })
    if (Number(pending.expiresAt || 0) <= Date.now()) {
      portalSmsCodeStore.delete(phoneDigits)
      return res.status(410).json({ error: 'That code has expired. Please request a new sign-in code.' })
    }
    if (String(pending.code || '') !== submittedCode) {
      pending.attempts = Number(pending.attempts || 0) + 1
      if (pending.attempts >= CLIENT_PORTAL_SMS_VERIFY_MAX_ATTEMPTS) {
        portalSmsCodeStore.delete(phoneDigits)
        return res.status(401).json({ error: 'Too many incorrect attempts. Please request a new sign-in code.' })
      }
      portalSmsCodeStore.set(phoneDigits, pending)
      return res.status(401).json({ error: 'That code did not match. Please try again.' })
    }

    portalSmsCodeStore.delete(phoneDigits)
    return res.json({
      ok: true,
      code: String(pending.sessionCode || ''),
      clientName: String(pending.clientName || '').trim(),
      contactId: String(pending.ghlContactId || '').trim(),
      opportunityId: String(pending.ghlOpportunityId || '').trim(),
    })
  })().catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to verify sign-in code' }))
})

// Rep login (single shared password) -> JWT
app.post('/api/rep/login', (req, res) => {
  const password = String(req.body?.password || '')
  if (!REP_PASSWORD) return res.status(500).json({ error: 'REP_PASSWORD not configured' })
  if (!REP_JWT_SECRET) return res.status(500).json({ error: 'REP_JWT_SECRET not configured' })
  if (!password || password !== REP_PASSWORD) return res.status(401).json({ error: 'Invalid credentials' })
  const token = signRepToken({ role: 'rep' })
  return res.json({ token })
})

// GoHighLevel inbound webhook (provisions session + returns links)
app.post('/webhooks/ghl', (req, res) => {
  ;(async () => {
    if (!GHL_WEBHOOK_SECRET) return res.status(500).json({ error: 'GHL_WEBHOOK_SECRET not configured' })

    const secret = String(
      req.headers['x-ghl-signature'] ||
        req.headers['x-webhook-secret'] ||
        req.body?.webhookSecret ||
        req.body?.webhook_secret ||
        req.body?.secret ||
        '',
    )
    if (secret !== GHL_WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' })

    const contactId = String(req.body?.contactId || req.body?.contact_id || req.body?.contact?.id || '').trim()
    const opportunityId = String(req.body?.opportunityId || req.body?.opportunity_id || req.body?.opportunity?.id || req.body?.id || '').trim()
    if (!contactId) return res.status(400).json({ error: 'contactId missing in webhook payload' })

    const webhookType = String(req.body?.type || '').trim()
    const messageType = String(req.body?.messageType || req.body?.message_type || '').trim().toUpperCase()
    if (webhookType === 'InboundMessage' && (messageType === 'SMS' || messageType === 'TYPE_SMS')) {
      const synced = await syncSingleGhlProspectToDashboard({
        contactId,
        opportunityId,
        webhookPayload: req.body || {},
      })
      const code = synced.code
      const room = synced.room
      const conversationId = String(req.body?.conversationId || req.body?.conversation_id || '').trim()
      const inboundEntry = normalizeSmsThreadEntry({
        id: String(req.body?.messageId || req.body?.message_id || '').trim(),
        conversationId,
        contactId,
        body: String(req.body?.body || req.body?.message || '').trim(),
        direction: 'inbound',
        status: String(req.body?.status || '').trim(),
        messageType: 'SMS',
        dateAdded: String(req.body?.dateAdded || req.body?.date_added || new Date().toISOString()).trim(),
        from: String(req.body?.from || '').trim(),
        to: Array.isArray(req.body?.to) ? String(req.body.to[0] || '').trim() : String(req.body?.to || '').trim(),
        source: 'ghl_webhook',
        userId: String(req.body?.userId || req.body?.user_id || '').trim(),
        attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
      })
      await persistSmsThreadForRoom({ roomCode: code, room, entries: [inboundEntry], conversationId, contactId })
      emitDashboardRecordsUpdated({
        reason: 'ghl_sms_inbound',
        sessionCode: code,
        contactId,
        opportunityId: room.opportunityId || '',
        opportunityName: String(room.state?.answers?.ghl_opportunity_name || ''),
        item: buildDashboardRecordUpdatePayload({
          code,
          room,
          contactId,
          opportunityId: room.opportunityId || '',
        }),
      })
      return res.json({ ok: true, contactId, opportunityId: room.opportunityId || '', code, conversationId })
    }

    const base = String(req.body?.baseUrl || req.body?.base_url || process.env.PUBLIC_BASE_URL || '').trim()
    const synced = await syncSingleGhlProspectToDashboard({
      contactId,
      opportunityId,
      webhookPayload: req.body || {},
    })
    const code = synced.code
    const room = synced.room
    const { repLink, clientLink } = makePortalLinks(contactId, code, base, room.opportunityId)
    emitDashboardRecordsUpdated({
      reason: 'ghl_webhook',
      sessionCode: code,
      contactId,
      opportunityId: room.opportunityId || '',
      opportunityName: String(room.state?.answers?.ghl_opportunity_name || ''),
      item: buildDashboardRecordUpdatePayload({
        code,
        room,
        contactId,
        opportunityId: room.opportunityId || '',
      }),
    })
    void syncSessionToGhl({ roomCode: code, room, reason: 'session_provisioned', force: true }).catch((error) => {
      console.error('GHL session provision sync failed:', error)
    })
    if (!base) return res.status(200).json({ ok: true, contactId, opportunityId: room.opportunityId, code })
    return res.json({ ok: true, contactId, opportunityId: room.opportunityId, code, repLink, clientLink })
  })().catch(() => res.status(500).json({ error: 'Webhook failed' }))
})

app.post('/api/boldsign/8821/complete', async (req, res) => {
  try {
    const roomCode = String(req.body?.sessionCode || req.body?.code || '').toUpperCase().trim()
    const completedDocumentCode = String(req.body?.documentCode || req.body?.document_code || '').trim()
    const target = String(req.body?.target || req.body?.signer || 'client').trim().toLowerCase()
    if (!roomCode) return res.status(400).json({ error: 'sessionCode is required' })
    await markBoldsign8821Completed({ roomCode, completedDocumentCode, target })
    emitDashboardRecordsUpdated({
      reason: 'boldsign_complete_endpoint',
      roomCode,
      target,
      documentCode: completedDocumentCode,
    })
    return res.json({ ok: true })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to mark Form 8821 complete.' })
  }
})

const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(','),
    credentials: true,
  },
})

function emitDashboardRecordsUpdated(payload = {}) {
  io.emit('dashboard_records_updated', {
    at: Date.now(),
    ...payload,
  })
}

function broadcastParticipants(code) {
  const room = getMostRelevantLiveRoom(code)
  if (!room) return
  const participants = Array.from(room.participants.values())
  io.to(code).emit('participants', participants)
}

function hasLiveClientParticipant(room) {
  if (!room?.participants) return false
  return Array.from(room.participants.values()).some((p) => p?.role === 'client' && p?.isMirror !== true)
}

function getPrimaryLiveClient(room) {
  if (!room?.participants) return null
  return Array.from(room.participants.values()).find((p) => p?.role === 'client' && p?.isMirror !== true) || null
}

function getMostRelevantLiveRoom(code = '') {
  const variants = Array.from(new Set([String(code || '').trim(), String(code || '').trim().toUpperCase(), String(code || '').trim().toLowerCase()])).filter(Boolean)
  const candidateRooms = variants.map((variant) => rooms.get(variant)).filter(Boolean)
  if (candidateRooms.length === 0) return null
  return (
    candidateRooms.find((room) => hasLiveClientParticipant(room)) ||
    candidateRooms.find((room) => room?.lastClientPresenceAt && Date.now() - room.lastClientPresenceAt < 12000) ||
    candidateRooms[0]
  )
}

function getStoredRoomByCode(code = '') {
  const variants = Array.from(new Set([String(code || '').trim(), String(code || '').trim().toUpperCase(), String(code || '').trim().toLowerCase()])).filter(Boolean)
  for (const variant of variants) {
    const room = rooms.get(variant)
    if (room) return room
  }
  return null
}

async function listAllConsultationDetails() {
  if (pool) {
    const res = await retry(
      async () => {
        try {
          return await pool.query(`
            select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
            from ti_sessions
            order by updated_at desc
          `)
        } catch (error) {
          if (!isTransientDbConnectionError(error)) error.noRetry = true
          throw error
        }
      },
      { attempts: 6, delayMs: 1000 },
    )
    return dedupeConsultationRecords(res.rows.map((row) =>
      buildConsultationDetail({
        sessionCode: row.session_code,
        contactId: row.ghl_contact_id,
        opportunityId: row.ghl_opportunity_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ))
  }

  const persistedRows = await fallbackListSessions()
  const persistedByCode = new Map(
    persistedRows.map((row) => [
      String(row.session_code),
      buildConsultationDetail({
        sessionCode: row.session_code,
        contactId: row.ghl_contact_id,
        opportunityId: row.ghl_opportunity_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ]),
  )
  for (const [sessionCode, room] of rooms.entries()) {
    persistedByCode.set(
      sessionCode,
      buildConsultationDetail({
        sessionCode,
        contactId: room?.contactId,
        opportunityId: room?.opportunityId,
        state: room?.state,
        createdAt: room?.state?.createdAt || null,
        updatedAt: room?.state?.updatedAt || Date.now(),
      }),
    )
  }
  return dedupeConsultationRecords(Array.from(persistedByCode.values())).sort(
    (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
  )
}

function buildConsultationAnalytics(items = [], account = null) {
  const accessibleItems = String(account?.designatedPosition || '').trim() === 'Enrolled Agent'
    ? items.filter((item) => canEnrolledAgentAccessItem(item, account))
    : items
  const analyticsItems = accessibleItems.filter((item) => !isTrainingLeadItem(item))

  const monthlyRevenue = new Map()
  const pipelineBuckets = new Map()
  const stageBuckets = new Map()
  const paymentSchedules = []
  const failedPayments = []
  let processedRevenueTotal = 0
  let pendingRevenueTotal = 0
  let failedRevenueTotal = 0
  let openTasks = 0
  let documentsUploaded = 0
  const todayKey = normalizeBillingDateValue(new Date().toISOString())

  const topOpportunities = analyticsItems
    .map((item) => {
      const answers = item?.answers || {}
      const cancellationStatus = String(getPrimaryAnswer(answers, ['cancellation_request_status']) || '')
        .trim()
        .toLowerCase()
      const isCancellationRequested = cancellationStatus.includes('cancel')
      const docsSignedEligible = hasSignedPendingRevenueDocuments(answers)
      const pendingRevenueEligible = docsSignedEligible && hasStoredPaymentMethodOnFile(answers)
      const scheduleRows = getBillingScheduleRowsFromAnswers(answers)
      if (!isCancellationRequested) {
        const hasAnyStripeSignal =
          Boolean(String(answers?.stripe_customer_id || '').trim()) || Boolean(String(answers?.email || '').trim())
        const hasEvidence = scheduleRows.some((row) => hasBillingProcessingEvidence(row))
        if (!hasEvidence && hasAnyStripeSignal) {
          queueStripeBillingRestore(String(item.sessionCode || '').trim())
        }
      }
      let processedRevenue = 0
      let pendingRevenue = 0
      let failedRevenue = 0
      if (!isCancellationRequested) {
        const countedProcessedIntentIds = new Set()
        const countedProcessedMatchKeys = new Set()
        const countedPendingMatchKeys = new Set()
        const countedFailedMatchKeys = new Set()
        scheduleRows.forEach((row, rowIndex) => {
          const amount = toNumberValue(row?.amount)
          const tone = getBillingStatusTone(row)
          if (tone === 'pending' && !docsSignedEligible) return
          const normalizedDate = normalizeBillingDateValue(getBillingProcessedAtValue(row) || row?.date || '')
          const monthKey = normalizedDate.slice(0, 7)
          const isPastDuePending = tone === 'pending' && Boolean(normalizedDate) && normalizedDate < todayKey
          const statusLabel = tone === 'processed' ? 'Processed' : tone === 'failed' ? 'Failed' : isPastDuePending ? 'Past due' : 'Pending'
          const failureReason = String(row?.failureReason || row?.processorReason || row?.reason || '').trim()
          const matchKey = getBillingRowMatchKey({ date: normalizedDate, amount })
          const paymentIntentId = getBillingStripePaymentIntentIdValue(row)
          if (tone === 'processed') {
            if (paymentIntentId) {
              if (countedProcessedIntentIds.has(paymentIntentId)) return
              countedProcessedIntentIds.add(paymentIntentId)
            } else if (matchKey) {
              // Some schedule representations can duplicate a processed payment without storing the payment_intent.
              // When we don't have an intent id, collapse by date+amount to prevent double counting.
              if (countedProcessedMatchKeys.has(matchKey)) return
              countedProcessedMatchKeys.add(matchKey)
            }
          } else if (tone === 'failed') {
            if (matchKey) {
              if (countedFailedMatchKeys.has(matchKey)) return
              countedFailedMatchKeys.add(matchKey)
            }
          } else if (!isPastDuePending && pendingRevenueEligible) {
            if (matchKey) {
              if (countedPendingMatchKeys.has(matchKey)) return
              countedPendingMatchKeys.add(matchKey)
            }
          }
          const paymentScheduleEntry = {
            id: `${String(item.sessionCode || '').trim()}_${normalizedDate || 'undated'}_${rowIndex}`,
            sessionCode: String(item.sessionCode || '').trim(),
            clientName: String(item.clientName || 'Unknown client').trim() || 'Unknown client',
            pipelineName: String(item.pipelineName || 'No pipeline').trim() || 'No pipeline',
            stageName: String(item.stageName || '').trim(),
            scheduledDate: normalizedDate,
            amount,
            statusTone: isPastDuePending ? 'past_due' : tone,
            statusLabel,
            failureReason,
            updatedAt: String(item.updatedAt || '').trim(),
          }
          paymentSchedules.push(paymentScheduleEntry)
          if (tone === 'processed') {
            processedRevenue += amount
            processedRevenueTotal += amount
            if (monthKey) {
              const existing = monthlyRevenue.get(monthKey) || {
                month: monthKey,
                label: formatMonthLabel(monthKey),
                revenue: 0,
                processedCount: 0,
              }
              existing.revenue += amount
              existing.processedCount += 1
              monthlyRevenue.set(monthKey, existing)
            }
          } else if (tone === 'failed') {
            failedRevenue += amount
            failedRevenueTotal += amount
            failedPayments.push(paymentScheduleEntry)
          } else if (!isPastDuePending && pendingRevenueEligible) {
            pendingRevenue += amount
            pendingRevenueTotal += amount
          }
        })
      }

      const eaTasks = parseStoredObject(answers?.ea_tasks, [])
      const eaDocuments = parseStoredObject(answers?.ea_documents, [])
      openTasks += Array.isArray(eaTasks) ? eaTasks.filter((task) => !task?.completed).length : 0
      documentsUploaded += Array.isArray(eaDocuments) ? eaDocuments.length : 0

      const lifecycle = getLifecycleLabel(item)
      const pipelineName = String(item.pipelineName || 'No pipeline').trim() || 'No pipeline'
      const stageName = String(item.stageName || lifecycle).trim() || lifecycle
      const opportunityValue = Math.max(Number(item.opportunityValue || 0), Number(item.liability || 0), processedRevenue + pendingRevenue)

      const pipelineBucket = pipelineBuckets.get(pipelineName) || { name: pipelineName, count: 0, value: 0 }
      pipelineBucket.count += 1
      pipelineBucket.value += opportunityValue
      pipelineBuckets.set(pipelineName, pipelineBucket)

      const stageBucket = stageBuckets.get(stageName) || { name: stageName, count: 0, value: 0 }
      stageBucket.count += 1
      stageBucket.value += opportunityValue
      stageBuckets.set(stageName, stageBucket)

      return {
        sessionCode: item.sessionCode,
        clientName: item.clientName,
        lifecycle,
        pipelineName,
        stageName,
        opportunityStatus: item.opportunityStatus || lifecycle,
        assignedTo: item.assignedTo || item.claimedByName || 'Unassigned',
        assignedEaName: item.assignedEaName || 'Unassigned',
        liability: item.liability || 0,
        opportunityValue,
        processedRevenue,
        pendingRevenue,
        failedRevenue,
        eaCaseStatus: item.eaCaseStatus || '',
        updatedAt: item.updatedAt || '',
      }
    })
    .sort((a, b) => b.opportunityValue - a.opportunityValue)

  const activeClients = analyticsItems.filter((item) => getLifecycleLabel(item) === 'Active Client').length
  const activeProspects = analyticsItems.filter((item) => getLifecycleLabel(item) === 'Active Prospect').length
  const pendingEaReview = analyticsItems.filter((item) => String(item.eaCaseStatus || '').trim() === 'Pending EA Review').length
  const sentToEa = analyticsItems.filter((item) => isEnrolledAgentHandoffSent(item.readyForEnrolledAgent)).length
  const averageLiability = analyticsItems.length
    ? analyticsItems.reduce((sum, item) => sum + Number(item.liability || 0), 0) / analyticsItems.length
    : 0

  return {
    overview: {
      totalRecords: analyticsItems.length,
      activeClients,
      activeProspects,
      sentToEa,
      pendingEaReview,
      processedRevenueTotal,
      pendingRevenueTotal,
      failedRevenueTotal,
      openTasks,
      documentsUploaded,
      averageLiability,
    },
    monthlyRevenue: Array.from(monthlyRevenue.values())
      .sort((a, b) => String(a.month).localeCompare(String(b.month)))
      .slice(-8),
    paymentSchedules: paymentSchedules.sort((a, b) => {
      const leftDate = String(a.scheduledDate || '9999-12-31')
      const rightDate = String(b.scheduledDate || '9999-12-31')
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
      return String(a.clientName || '').localeCompare(String(b.clientName || ''))
    }),
    failedPayments: failedPayments.sort((a, b) => {
      const leftDate = String(a.scheduledDate || '')
      const rightDate = String(b.scheduledDate || '')
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
      return String(a.clientName || '').localeCompare(String(b.clientName || ''))
    }),
    pipelines: Array.from(pipelineBuckets.values()).sort((a, b) => b.value - a.value),
    stages: Array.from(stageBuckets.values()).sort((a, b) => b.count - a.count),
    topOpportunities: topOpportunities.slice(0, 12),
    recentUpdates: [...topOpportunities]
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 8),
  }
}

async function syncSessionToGhl({ roomCode, room, reason = 'session_update', force = false } = {}) {
  if (!roomCode || !room?.contactId) return
  const baseUrl = getPublicBaseUrl()
  if (!baseUrl && !hasDirectGhlConfig()) return

  const syncAnswers = getSyncAnswers(room)
  const signature = JSON.stringify({
    route: String(room?.state?.route || ''),
    step: Number(room?.state?.step || 0),
    onboardingStatus: syncAnswers.onboardingStatus,
    form8821Status: syncAnswers.form8821Status,
    completedAt: syncAnswers.completedAt,
    screenshareActive: Boolean(room?.screenshareActive),
    repControlEnabled: Boolean(room?.repControlEnabled),
    reason,
  })
  if (!force && room.lastGhlSyncSignature === signature) return

  const tasks = []

  if (GHL_SYNC_WEBHOOK_URL) {
    const headers = { 'content-type': 'application/json' }
    if (GHL_SYNC_WEBHOOK_SECRET && GHL_SYNC_WEBHOOK_HEADER) headers[GHL_SYNC_WEBHOOK_HEADER] = GHL_SYNC_WEBHOOK_SECRET

    const payload = {
      source: 'taxrefresh_portal',
      event: reason,
      contactId: room.contactId,
    opportunityId: room.opportunityId || '',
      sessionCode: roomCode,
      route: String(room?.state?.route || ''),
      step: Number(room?.state?.step || 0),
      updatedAt: new Date(Number(room?.state?.updatedAt || Date.now())).toISOString(),
      onboardingStatus: syncAnswers.onboardingStatus,
      form8821Status: syncAnswers.form8821Status,
      completedAt: syncAnswers.completedAt,
      screenshareActive: Boolean(room?.screenshareActive),
      repControlEnabled: Boolean(room?.repControlEnabled),
      clientPresent: Boolean(hasLiveClientParticipant(room) || (room?.lastClientPresenceAt && Date.now() - room.lastClientPresenceAt < 12000)),
      links: makePortalLinks(room.contactId, roomCode, baseUrl, room.opportunityId),
      contact: {
        name: syncAnswers.name,
        email: syncAnswers.email,
        phone: syncAnswers.phone,
      },
    }

    tasks.push(
      fetch(GHL_SYNC_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }).then(async (response) => {
        if (!response.ok) {
          const message = await response.text().catch(() => '')
          throw new Error(message || `GHL sync webhook failed (${response.status})`)
        }
      }),
    )
  }

  if (hasDirectGhlConfig()) {
    tasks.push(syncSessionToGhlDirect({ roomCode, room }))
  }

  await Promise.all(tasks)
  room.lastGhlSyncSignature = signature
}

io.on('connection', (socket) => {
  socket.on('join', async ({ code, name, role, token, isMirror, pageVisible, pageFocused }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    const safeName = String(name || 'Guest').slice(0, 40)
    const safeRole = role === 'rep' ? 'rep' : role === 'observer' ? 'observer' : 'client'
    const safeIsMirror = Boolean(isMirror)
    const safePageVisible = typeof pageVisible === 'boolean' ? pageVisible : true
    const safePageFocused = typeof pageFocused === 'boolean' ? pageFocused : safePageVisible
    if (!roomCode) return

    // Rep auth is temporarily disabled for preview/testing so the rep console can open directly.

    const room = await ensureRoom(roomCode)

    socket.join(roomCode)
    room.participants.set(socket.id, {
      id: socket.id,
      name: safeName,
      role: safeRole,
      isMirror: safeRole === 'client' ? safeIsMirror : false,
      pageVisible: safeRole === 'client' ? safePageVisible : true,
      pageFocused: safeRole === 'client' ? safePageFocused : true,
      joinedAt: Date.now(),
    })
    if (safeRole === 'client' && !safeIsMirror) {
      room.lastClientPresenceAt = Date.now()
      room.lastClientPageVisible = safePageVisible
      room.lastClientPageFocused = safePageFocused
    }

    if (safeRole === 'rep') {
      room.repSocketId = socket.id
      // If a screenshare session is active, broadcast the updated rep socket id to clients so they can reconnect.
      if (room.screenshareActive) {
        room.pendingScreenshareFrom = room.repSocketId
        room.pendingScreenshareAt = Date.now()
        io.to(roomCode).emit('screenshare_state', {
          active: true,
          repSocketId: room.repSocketId,
          startedAt: room.screenshareStartedAt || Date.now(),
        })
        // Rep refreshed: re-trigger the normal request flow so clients re-offer to the new rep socket id.
        socket.to(roomCode).emit('screenshare_request', { from: room.repSocketId })
        // Back-compat: also emit a reconnect hint.
        socket.to(roomCode).emit('screenshare_reconnect', { from: room.repSocketId, at: Date.now() })
      }
    }

    socket.emit('room_state', room.state)
    broadcastParticipants(roomCode)

    // Send current screenshare session state to the joining socket.
    socket.emit('screenshare_state', {
      active: Boolean(room.screenshareActive),
      repSocketId: room.repSocketId,
      startedAt: room.screenshareStartedAt,
    })

    // If screenshare session is active, immediately prompt/activate for late-joining clients.
    if (room?.screenshareActive && room?.repSocketId && safeRole !== 'rep' && socket.id !== room.repSocketId) {
      socket.emit('screenshare_request', { from: room.repSocketId })
    } else if (room?.pendingScreenshareFrom && room?.pendingScreenshareAt) {
      // Backward compatible: pending request
      const ageMs = Date.now() - room.pendingScreenshareAt
      if (ageMs < 2 * 60 * 1000 && socket.id !== room.pendingScreenshareFrom) {
        socket.emit('screenshare_request', { from: room.pendingScreenshareFrom })
      }
    }

    // If rep control is enabled, inform late-joining clients immediately.
    if (room?.repControlEnabled && room?.repControlFrom) {
      socket.emit('rep_control_state', { enabled: true, from: room.repControlFrom, at: room.repControlAt || Date.now() })
    }
  })

  socket.on('leave', ({ code }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = getStoredRoomByCode(roomCode)
    socket.leave(roomCode)
    if (!room) return
    if (room.participants.delete(socket.id)) {
      if (room.repSocketId === socket.id) room.repSocketId = null
      if (!hasLiveClientParticipant(room)) room.lastClientPresenceAt = 0
      broadcastParticipants(roomCode)
      if (canReleaseRoomFromMemory(room)) releaseRoomFromMemory(roomCode, room)
    }
  })

  // Rep → Client screenshare request
  socket.on('screenshare_request', async ({ code }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = await ensureRoom(roomCode)
    room.screenshareActive = false
    room.screenshareStartedAt = null
    room.pendingScreenshareFrom = socket.id
    room.pendingScreenshareAt = Date.now()
    room.repSocketId = socket.id
    io.to(roomCode).emit('screenshare_state', {
      active: false,
      repSocketId: room.repSocketId,
      startedAt: null,
    })
    socket.to(roomCode).emit('screenshare_request', { from: socket.id })

    try {
      const all = await io.in(roomCode).allSockets()
      const deliveredTo = Math.max(0, all.size - 1) // exclude requester
      socket.emit('screenshare_request_sent', { code: roomCode, deliveredTo })
    } catch {
      socket.emit('screenshare_request_sent', { code: roomCode, deliveredTo: 0 })
    }
  })

  socket.on('screenshare_response', ({ code, to, accepted }) => {
    const target = String(to || '').trim()
    if (!target) return
    const didAccept = Boolean(accepted)
    io.to(target).emit('screenshare_response', { from: socket.id, accepted: didAccept })

    const roomCode = String(code || '').toUpperCase().trim()
    const room = getStoredRoomByCode(roomCode)
    if (room?.pendingScreenshareFrom === target) {
      if (didAccept) {
        room.screenshareActive = true
        room.screenshareStartedAt = Date.now()
        room.repSocketId = target
        void syncSessionToGhl({ roomCode, room, reason: 'screenshare_started' }).catch((error) => {
          console.error('GHL screenshare start sync failed:', error)
        })
        io.to(roomCode).emit('screenshare_state', {
          active: true,
          repSocketId: room.repSocketId,
          startedAt: room.screenshareStartedAt,
        })
      }
      room.pendingScreenshareFrom = null
      room.pendingScreenshareAt = null
    }
  })

  socket.on('screenshare_end', async ({ code }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = await ensureRoom(roomCode)
    room.screenshareActive = false
    room.screenshareStartedAt = null
    room.pendingScreenshareFrom = null
    room.pendingScreenshareAt = null
    void syncSessionToGhl({ roomCode, room, reason: 'screenshare_ended' }).catch((error) => {
      console.error('GHL screenshare end sync failed:', error)
    })
    io.to(roomCode).emit('screenshare_state', { active: false, repSocketId: room.repSocketId, startedAt: null })
    io.to(roomCode).emit('screenshare_end', { at: Date.now() })
  })

  // WebRTC signaling
  socket.on('webrtc_offer', ({ to, sdp }) => {
    const target = String(to || '').trim()
    if (!target) return
    io.to(target).emit('webrtc_offer', { from: socket.id, sdp })
  })

  socket.on('webrtc_answer', ({ to, sdp }) => {
    const target = String(to || '').trim()
    if (!target) return
    io.to(target).emit('webrtc_answer', { from: socket.id, sdp })
  })

  socket.on('webrtc_ice', ({ to, candidate }) => {
    const target = String(to || '').trim()
    if (!target) return
    io.to(target).emit('webrtc_ice', { from: socket.id, candidate })
  })

  // Rep can request the client to re-send an offer (useful for Safari refresh/reconnect races).
  socket.on('webrtc_need_offer', ({ to }) => {
    const target = String(to || '').trim()
    if (!target) return
    io.to(target).emit('webrtc_need_offer', { from: socket.id, at: Date.now() })
  })

  // Client cursor → Rep (in-app pointer overlay)
  socket.on('cursor', ({ code, x, y, down }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const nx = typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0
    const ny = typeof y === 'number' ? Math.max(0, Math.min(1, y)) : 0
    socket.to(roomCode).emit('cursor', { x: nx, y: ny, down: Boolean(down), at: Date.now() })
  })

  socket.on('viewport_sync', ({ code, y, path, origin, vw, vh }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const safeY = Number.isFinite(y) ? Math.max(0, Math.min(50000, Math.round(Number(y)))) : 0
    const safePath = typeof path === 'string' ? path.slice(0, 500) : ''
    const safeOrigin = origin === 'mirror' ? 'mirror' : 'client'
    const safeVw = Number.isFinite(vw) ? Math.max(1, Math.min(8000, Math.round(Number(vw)))) : undefined
    const safeVh = Number.isFinite(vh) ? Math.max(1, Math.min(8000, Math.round(Number(vh)))) : undefined
    socket.to(roomCode).emit('viewport_sync', {
      y: safeY,
      path: safePath,
      origin: safeOrigin,
      vw: safeVw,
      vh: safeVh,
      at: Date.now(),
    })
  })

  socket.on('client_presence', async ({ code, name, isMirror, pageVisible, pageFocused }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = await ensureRoom(roomCode)
    const safeName = String(name || 'Client').slice(0, 40)
    const safeIsMirror = Boolean(isMirror)
    const existing = room.participants.get(socket.id)
    const safePageVisible = typeof pageVisible === 'boolean' ? pageVisible : existing?.pageVisible ?? true
    const safePageFocused = typeof pageFocused === 'boolean' ? pageFocused : existing?.pageFocused ?? safePageVisible

    room.participants.set(socket.id, {
      id: socket.id,
      name: safeName,
      role: 'client',
      isMirror: safeIsMirror,
      pageVisible: !safeIsMirror ? safePageVisible : existing?.pageVisible ?? true,
      pageFocused: !safeIsMirror ? safePageFocused : existing?.pageFocused ?? true,
      joinedAt: existing?.joinedAt || Date.now(),
    })
    if (!safeIsMirror) {
      room.lastClientPresenceAt = Date.now()
      room.lastClientPageVisible = safePageVisible
      room.lastClientPageFocused = safePageFocused
    }

    broadcastParticipants(roomCode)
  })

  // Rep annotations → Client (draw/highlight overlay)
  socket.on('annot', ({ code, tool, color, size, points }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const safeTool = tool === 'erase' ? 'erase' : 'draw'
    const safeColor = typeof color === 'string' ? color.slice(0, 32) : '#0b66a6'
    const safeSize = Number.isFinite(size) ? Math.max(1, Math.min(24, Number(size))) : 6
    const safePoints = Array.isArray(points)
      ? points
          .slice(0, 200)
          .map((p) => ({ x: Math.max(0, Math.min(1, Number(p?.x) || 0)), y: Math.max(0, Math.min(1, Number(p?.y) || 0)) }))
      : []
    socket.to(roomCode).emit('annot', { tool: safeTool, color: safeColor, size: safeSize, points: safePoints, at: Date.now() })
  })

  socket.on('annot_clear', ({ code }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    socket.to(roomCode).emit('annot_clear', { at: Date.now() })
  })

  // Rep control (in-app remote assistance)
  socket.on('rep_control_toggle', async ({ code, enabled }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = await ensureRoom(roomCode)
    room.repControlEnabled = Boolean(enabled)
    room.repControlFrom = room.repControlEnabled ? socket.id : null
    room.repControlAt = Date.now()
    void syncSessionToGhl({ roomCode, room, reason: room.repControlEnabled ? 'rep_control_enabled' : 'rep_control_disabled' }).catch((error) => {
      console.error('GHL rep control sync failed:', error)
    })
    io.to(roomCode).emit('rep_control_state', {
      enabled: room.repControlEnabled,
      from: room.repControlFrom,
      at: room.repControlAt,
    })
  })

  function relayRepCursorMove(code, x, y, down) {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const nx = typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0
    const ny = typeof y === 'number' ? Math.max(0, Math.min(1, y)) : 0
    io.to(roomCode).volatile.emit('rep_cursor', {
      x: nx,
      y: ny,
      down: Boolean(down),
      visible: true,
      at: Date.now(),
    })
  }

  socket.on('rep_cursor_move', ({ code, x, y, down }) => {
    relayRepCursorMove(code, x, y, down)
  })

  socket.on('rep_cursor', ({ code, x, y, down, visible }) => {
    if (visible === false) {
      const roomCode = String(code || '').toUpperCase().trim()
      if (!roomCode) return
      const nx = typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0
      const ny = typeof y === 'number' ? Math.max(0, Math.min(1, y)) : 0
      socket.to(roomCode).emit('rep_cursor', {
        x: nx,
        y: ny,
        down: Boolean(down),
        visible: false,
        at: Date.now(),
      })
      return
    }
    relayRepCursorMove(code, x, y, down)
  })

  socket.on('rep_cursor_state', ({ code, x, y, down, visible }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const nx = typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0
    const ny = typeof y === 'number' ? Math.max(0, Math.min(1, y)) : 0
    socket.to(roomCode).emit('rep_cursor', {
      x: nx,
      y: ny,
      down: Boolean(down),
      visible: visible === false ? false : true,
      at: Date.now(),
    })
  })

  socket.on('rep_action', ({ code, action, x, y, deltaY, id }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = getStoredRoomByCode(roomCode)
    if (!room?.repControlEnabled || room?.repControlFrom !== socket.id) return
    const safeAction = action === 'scroll' ? 'scroll' : 'click'
    const nx = typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0
    const ny = typeof y === 'number' ? Math.max(0, Math.min(1, y)) : 0
    const dy = Number.isFinite(deltaY) ? Math.max(-1600, Math.min(1600, Number(deltaY))) : 0
    const safeId = typeof id === 'string' ? id.slice(0, 64) : undefined
    socket.to(roomCode).emit('rep_action', { action: safeAction, x: nx, y: ny, deltaY: dy, at: Date.now(), id: safeId })
  })

  socket.on('rep_key', ({ code, key, ctrlKey, altKey, shiftKey, metaKey }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = getStoredRoomByCode(roomCode)
    if (!room?.repControlEnabled || room?.repControlFrom !== socket.id) return
    const safeKey = typeof key === 'string' ? key.slice(0, 40) : ''
    socket.to(roomCode).emit('rep_key', {
      key: safeKey,
      ctrlKey: Boolean(ctrlKey),
      altKey: Boolean(altKey),
      shiftKey: Boolean(shiftKey),
      metaKey: Boolean(metaKey),
      at: Date.now(),
    })
  })

  socket.on('rep_text', ({ code, text }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = getStoredRoomByCode(roomCode)
    if (!room?.repControlEnabled || room?.repControlFrom !== socket.id) return
    const safeText = typeof text === 'string' ? text.slice(0, 2000) : ''
    if (!safeText) return
    socket.to(roomCode).emit('rep_text', { text: safeText, at: Date.now() })
  })

  socket.on('patch', async ({ code, patch }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = await ensureRoom(roomCode)
    let experienceReceiptUpdate = null

    // Basic last-write-wins patching
    if (patch?.type === 'setStep' && Number.isInteger(patch.step)) {
      room.state.step = patch.step
      room.state.updatedAt = Date.now()
    }

    if (patch?.type === 'setAnswer' && typeof patch.questionId === 'string') {
      room.state.answers[patch.questionId] = patch.value
      room.state.updatedAt = Date.now()
      if (
        patch.questionId === 'form8821_status' ||
        patch.questionId === 'form8821_spouse_status' ||
        patch.questionId === 'esign_signatures_by_target' ||
        patch.questionId === 'esign_dates_by_target'
      ) {
        void ensureSigned8821StoredOnRecord(roomCode, room).catch((error) => {
          console.error('Auto-save signed 8821 failed:', error)
        })
      }
    }

    if (patch?.type === 'setRoute' && typeof patch.route === 'string') {
      const previousRoute = String(room.state.route || '').trim()
      room.state.route = patch.route.slice(0, 500)
      experienceReceiptUpdate = maybeTrackExperienceDocumentRoute(roomCode, room, room.state.route, previousRoute)
      room.state.updatedAt = Date.now()
    }

    io.to(roomCode).emit('room_patch', {
      patch,
      updatedAt: room.state.updatedAt || Date.now(),
    })
    io.to(roomCode).emit('room_state', room.state)

    // Persist durable state after broadcasting so the live shared session feels immediate.
    try {
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch {
      // ignore; session will still work in-memory
    }
    if (experienceReceiptUpdate) {
      emitDashboardRecordsUpdated({
        reason: 'experience_route_sent',
        sessionCode: roomCode,
        target: experienceReceiptUpdate.target,
        documentCode: experienceReceiptUpdate.documentCode,
      })
    }
    if (shouldSyncPatchToGhl(patch)) {
      void syncSessionToGhl({ roomCode, room, reason: patch.type === 'setRoute' ? 'route_changed' : `answer_${patch.questionId}` }).catch((error) => {
        console.error('GHL patch sync failed:', error)
      })
    }
  })

  socket.on('rep_reset_consultation', async ({ code }) => {
    const roomCode = String(code || '').toUpperCase().trim()
    if (!roomCode) return
    const room = await ensureRoom(roomCode)

    room.state = initialRoomState()
    room.repControlEnabled = false
    room.repControlFrom = null
    room.repControlAt = Date.now()

    io.to(roomCode).emit('room_state', room.state)
    io.to(roomCode).emit('rep_control_state', {
      enabled: false,
      from: null,
      at: room.repControlAt,
    })
    io.to(roomCode).emit('consultation_reset', {
      route: '/',
      at: Date.now(),
    })

    try {
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch {
      // ignore; session will still work in-memory
    }
    void syncSessionToGhl({ roomCode, room, reason: 'consultation_reset', force: true }).catch((error) => {
      console.error('GHL consultation reset sync failed:', error)
    })
  })

  socket.on('disconnect', () => {
    // Remove from any rooms it was tracked in
    for (const [code, room] of rooms.entries()) {
      if (room.participants.delete(socket.id)) {
        if (room.repSocketId === socket.id) room.repSocketId = null
        if (!hasLiveClientParticipant(room)) room.lastClientPresenceAt = 0
        broadcastParticipants(code)
        if (canReleaseRoomFromMemory(room)) releaseRoomFromMemory(code, room)
      }
    }
  })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`)

  // Background repair: rebuild missing billing, signed-document, and payment-method evidence
  // gradually without any manual UI action.
  if (INTEGRITY_REPAIR_WORKER_DISABLED) {
    console.log('Consultation integrity repair worker disabled by env flag.')
    return
  }
  try {
    startStripeBillingRestoreWorker()
  } catch (error) {
    console.error('Failed to start consultation integrity repair worker:', error)
  }
  void seedStripeBillingRestoreQueue(RECORD_INTEGRITY_REPAIR_STARTUP_LIMIT)
    .then((queuedCount) => {
      console.log(`Queued ${queuedCount} consultation records for integrity repair`)
    })
    .catch((error) => {
      console.error('Failed to seed consultation integrity repair queue:', error)
    })
})
