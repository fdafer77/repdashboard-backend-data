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
const SESSION_STORE_PATH = path.resolve(process.env.SESSION_STORE_PATH || path.join(process.cwd(), '.data', 'sessions.json'))
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim()
const STRIPE_PUBLISHABLE_KEY = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim()

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
const fallbackSessions = new Map()
let fallbackStoreLoaded = false
let fallbackStoreLoadPromise = null
let fallbackStoreWritePromise = Promise.resolve()

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
  await ensureFallbackStoreLoaded()
  const existing = await fallbackGetSession(code)
  const resolvedCode = String(existing?.session_code || code)
  const createdAt = existing?.created_at || new Date().toISOString()
  const updatedAt = new Date().toISOString()
  fallbackSessions.set(resolvedCode, {
    sessionCode: resolvedCode,
    contactId: contactId ?? existing?.ghl_contact_id ?? null,
    opportunityId: opportunityId ?? existing?.ghl_opportunity_id ?? null,
    state,
    createdAt: existing?.created_at || createdAt,
    updatedAt,
  })
  await scheduleFallbackPersist()
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
app.use(express.json())
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

app.post('/webhooks/boldsign', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : ''
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

function getPrimaryAnswer(answers, keys = []) {
  for (const key of keys) {
    const value = answers?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function toNumberValue(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  const digits = String(input ?? '').replace(/[^\d.-]/g, '')
  const parsed = Number.parseFloat(digits)
  return Number.isFinite(parsed) ? parsed : 0
}

function digitsOnly(input = '') {
  return String(input || '').replace(/\D/g, '')
}

function parseStoredTargetMap(value) {
  const parsed = parseStoredObject(value, {})
  return Object.fromEntries(
    Object.entries(parsed || {}).filter((entry) => typeof entry[0] === 'string' && typeof entry[1] === 'string'),
  )
}

function getNormalizedFilingStatus(answers = {}) {
  const profilePayload = parseStoredObject(answers?.client_portal_financial_profile_payload, null)
  const payloadValue =
    profilePayload && typeof profilePayload === 'object' ? String(profilePayload.filing_status || profilePayload.filingStatus || '').trim().toLowerCase() : ''
  if (payloadValue) return payloadValue
  const direct = String(getPrimaryAnswer(answers, ['filingStatus', 'filing_status']) || '').trim().toLowerCase()
  return direct
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

function maybeTrackExperienceDocumentRoute(roomCode, room, nextRoute = '', previousRoute = '') {
  const normalizedNextRoute = String(nextRoute || '').trim()
  const normalizedPreviousRoute = String(previousRoute || '').trim()
  if (!normalizedNextRoute || normalizedNextRoute === normalizedPreviousRoute) return false
  if (normalizedNextRoute !== '/session/sign-form-8821' && normalizedNextRoute !== '/session/sign-form-8821-spouse') return false

  const answers = room?.state?.answers || {}
  const recipientEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
  const sentAt = new Date().toISOString()
  appendDocumentDeliveryLogEntry(answers, {
    id: `doc_experience_${Date.now().toString(36)}_${normalizedNextRoute.endsWith('-spouse') ? 'spouse' : 'client'}`,
    name: normalizedNextRoute.endsWith('-spouse') ? '8821 Spouse' : '8821 Document',
    documentCode: getActive8821DocumentCode(answers),
    status: 'Sent',
    method: 'Experience',
    sentAt,
    recipientEmail,
    sentBy: '',
    route: normalizedNextRoute,
    sessionCode: roomCode,
  })
  answers.last_document_experience_sent_at = sentAt
  return true
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
  const spouseFullName = String(
    getPrimaryAnswer(answers, ['spouse_full_name', 'spouseFullName', 'spouse_name']) ||
      [getPrimaryAnswer(answers, ['spouseFirstName', 'spouse_first_name']), getPrimaryAnswer(answers, ['spouseLastName', 'spouse_last_name'])].filter(Boolean).join(' '),
  ).trim()
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
  const spouseFullName = String(
    getPrimaryAnswer(answers, ['spouse_full_name', 'spouseFullName', 'spouse_name']) || [spouseFirstName, spouseLastName].filter(Boolean).join(' '),
  ).trim()
  const spouseSsn = formatSsnLabel(getPrimaryAnswer(answers, ['spouse_ssn', 'spouseSsn']))
  const spouseDob = formatDobValue(getPrimaryAnswer(answers, ['spouse_dob', 'spouseDob']))
  const spousePhone = String(getPrimaryAnswer(answers, ['spouse_phone', 'spousePhone']) || '').trim()
  const taxTypeValue = String(getPrimaryAnswer(answers, ['taxType']) || '').trim().toLowerCase()
  const taxTypeLabel = taxTypeValue === 'personal' ? 'Personal' : taxTypeValue === 'business' ? 'Business' : taxTypeValue === 'both' ? 'Both' : ''
  const taxAgencyLabel = normalizeTaxAgencyLabel(String(getPrimaryAnswer(answers, ['taxAgency', 'tax_agency']) || getPrimaryAnswer(answers, ['owe']) || '').trim())
  const irs = Number(typeof answers['irsBalance'] === 'string' ? digitsOnly(answers['irsBalance']) : answers['irsBalance'] || 0)
  const state = Number(typeof answers['stateBalance'] === 'string' ? digitsOnly(answers['stateBalance']) : answers['stateBalance'] || 0)
  const aliasTotal = Number(
    typeof answers['taxLiability'] === 'string'
      ? digitsOnly(answers['taxLiability'])
      : typeof answers['tax_liability'] === 'string'
        ? digitsOnly(answers['tax_liability'])
        : typeof answers['totalLiability'] === 'string'
          ? digitsOnly(answers['totalLiability'])
          : typeof answers['total_liability'] === 'string'
            ? digitsOnly(answers['total_liability'])
            : typeof answers['ghl_opportunity_value'] === 'string'
              ? digitsOnly(answers['ghl_opportunity_value'])
              : answers['taxLiability'] || answers['tax_liability'] || answers['totalLiability'] || answers['total_liability'] || answers['ghl_opportunity_value'] || 0,
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
  const answers = room?.state?.answers || {}
  if (!isForm8821FullySigned(answers)) return false

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
    } catch {
      pdfBuffer = null
    }
  }
  if (!pdfBuffer?.length) {
    pdfBuffer = await buildSigned8821PdfBuffer(answers)
  }
  const firstPagePdfBuffer = await buildSigned8821FirstPagePdfBuffer(answers)
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
    await dbUpsertSession({ code: roomCode, state: room.state })
  } catch {
    // ignore; state still updates in-memory
  }
  void sendSigned8821CopyEmail({ roomCode, room }).catch((error) => {
    console.error('Signed 8821 client email failed:', error)
  })
  return true
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
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toISOString().slice(0, 10)
}

function getBillingScheduleRowsFromAnswers(answers = {}) {
  const directSchedule = parseStoredObject(answers?.billing_schedule, [])
  if (Array.isArray(directSchedule) && directSchedule.length) {
    return directSchedule
      .map((row) => ({
        ...row,
        date: normalizeBillingDateValue(row?.date),
        amount: String(row?.amount ?? ''),
        status: String(row?.status || ''),
        failureReason: String(row?.failureReason || row?.processorReason || row?.reason || ''),
      }))
      .filter((row) => row && (row.date || row.amount))
  }

  return parseStoredObject(answers?.client_portal_pending_payments, [])
    .map((row) => ({
      date: normalizeBillingDateValue(row?.isoDate || row?.date || ''),
      amount: String(row?.amount ?? ''),
      status: String(row?.status || ''),
      failureReason: String(row?.failureReason || ''),
    }))
    .filter((row) => row && (row.date || row.amount))
}

function getBillingStatusTone(row = {}) {
  const rawStatus = String(row?.status || '').trim().toLowerCase()
  if (['processed', 'paid', 'succeeded', 'successful', 'complete', 'completed'].includes(rawStatus)) return 'processed'
  if (['failed', 'declined', 'rejected', 'error'].includes(rawStatus)) return 'failed'
  return 'pending'
}

function isTrainingLeadItem(item = {}) {
  if (String(item.leadType || '').trim().toLowerCase() === 'training') return true
  if (String(item.isTrainingLead || '').trim().toLowerCase() === 'true') return true
  const searchable = `${String(item.clientName || '').trim().toLowerCase()} ${String(item.email || '').trim().toLowerCase()}`
  return /\btest\b|\btraining\b/.test(searchable)
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
const ADMIN_LOGIN_PASSWORD = String(process.env.ADMIN_DASHBOARD_PASSWORD || 'TAXREFRESH26').trim()
const ADMIN_EMAIL_DOMAIN_ALLOWLIST = ['taxrefresh.info']
const ENROLLED_AGENT_ALLOWED_ANSWER_KEYS = new Set([
  'consultation_notes',
  'ea_case_status',
  'ea_due_date',
  'ea_priority',
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

function buildDefaultAdminAccount(email = '') {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) return null
  const [, domain = ''] = normalized.split('@')
  if (!ADMIN_EMAIL_DOMAIN_ALLOWLIST.includes(String(domain || '').trim().toLowerCase())) return null
  const local = normalized.split('@')[0] || ''
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return {
    email: normalized,
    name: name || normalized,
    designatedPosition: 'Management',
  }
}

function authenticateAdmin(req) {
  const { email, password } = readAdminCredentials(req)
  if (!ADMIN_LOGIN_PASSWORD) return null
  if (!safeEqualText(password, ADMIN_LOGIN_PASSWORD)) return null
  const account = ADMIN_ALLOWED_USERS[email] || buildDefaultAdminAccount(email)
  if (!account) return null
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
      emailTo: normalizedEmail,
      subject: String(subject || '').trim(),
      html: String(html || '').trim(),
      message: String(message || '').trim(),
      status: 'delivered',
    },
  })
}

function upsertDocumentReceipts(existingReceipts, nextReceipts) {
  const current = Array.isArray(existingReceipts) ? existingReceipts : parseStoredObject(existingReceipts, [])
  const currentList = Array.isArray(current) ? current : []
  const remaining = currentList.filter((entry) => !nextReceipts.some((next) => next?.name === entry?.name))
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

function build8821EmailHtml({ clientName, signingLink }) {
  const safeName = escapeHtml(getClientFirstName(clientName))
  const safeLink = String(signingLink || '').trim()
  const safeHref = escapeHtml(safeLink || '#')
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
  if (completedDocumentCode) {
    room.state.answers.active_8821_document_code = completedDocumentCode
  }

  const normalizedTarget = String(target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
  if (normalizedTarget === 'spouse') {
    room.state.answers.form8821_spouse_status = 'completed'
  } else {
    room.state.answers.form8821_status = 'completed'
    if (!isMarriedJointFilingAnswers(room.state.answers)) {
      room.state.answers.form8821_spouse_status = room.state.answers.form8821_spouse_status || 'not_required'
    }
  }

  if (isForm8821FullySigned(room.state.answers)) {
    room.state.answers.onboarding_status = 'documents_signed'
    room.state.answers.completed_at = room.state.answers.completed_at || new Date().toISOString()
    room.state.answers.boldsign_8821_signed_at = new Date().toISOString()
    markSigned8821DeliveryEntries(room.state.answers, room.state.answers.boldsign_8821_signed_at, completedDocumentCode)
    await ensureSigned8821StoredOnRecord(roomCode, room)
    void sendSigned8821CopyEmail({ roomCode, room }).catch((error) => {
      console.error('Signed 8821 client email failed:', error)
    })
  }

  room.state.updatedAt = Date.now()
  io.to(roomCode).emit('room_state', room.state)
  try {
    await dbUpsertSession({ code: roomCode, state: room.state })
  } catch {
    // ignore; session still works in-memory
  }
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
       order by updated_at desc
       limit 1`,
      [normalized],
    )
    if (res.rows[0]) return res.rows[0]
  }
  await ensureFallbackStoreLoaded()
  for (const entry of fallbackSessions.values()) {
    const answers = entry?.state?.answers || {}
    if (String(answers.boldsign_8821_document_id || '').trim() === normalized || String(answers.boldsign_8821_spouse_document_id || '').trim() === normalized) {
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
  const activeDocumentCode = String(answers.active_8821_document_code || answers.current_8821_document_code || '').trim()
  const sentAt = new Date().toISOString()
  const normalizedType = eventType.toLowerCase()
  const signerEmail = String(data?.signer?.emailAddress || data?.signer?.email || document?.signerEmail || '').trim().toLowerCase()
  const spouseEmail = String(getSpouseSignerEmailFromAnswers(answers) || answers.spouse_email || '').trim().toLowerCase()
  const target = signerEmail && spouseEmail && signerEmail === spouseEmail ? 'spouse' : 'client'

  if (normalizedType.includes('verification')) return { handled: true, reason: 'verification', roomCode, eventType }

  if (normalizedType.includes('sent') || normalizedType.includes('created')) {
    const receiptName = target === 'spouse' ? '8821 Spouse' : '8821 Document'
    const receiptEntry = {
      id: `boldsign_${documentId}_${normalizedType}_${target}`,
      name: receiptName,
      documentCode: activeDocumentCode,
      status: 'Sent',
      method: 'Email',
      sentAt,
      recipientEmail: signerEmail,
      sentBy: 'BoldSign',
    }
    answers.document_delivery_log = [receiptEntry, ...parseStoredObject(answers.document_delivery_log, [])]
    answers.document_receipts = upsertDocumentReceipts(answers.document_receipts, [
      { name: receiptName, documentCode: activeDocumentCode, status: 'Sent' },
    ])
  }

  if (normalizedType.includes('signed') || normalizedType.includes('completed')) {
    await markBoldsign8821Completed({ roomCode, completedDocumentCode: activeDocumentCode, target })
    return { handled: true, reason: 'completed', roomCode, eventType, target }
  }

  room.state.updatedAt = Date.now()
  try {
    await dbUpsertSession({ code: roomCode, contactId: room.contactId, opportunityId: room.opportunityId, state: room.state })
  } catch {
    // ignore; room state is still updated in memory
  }
  emitDashboardRecordsUpdated({ reason: 'boldsign_webhook', roomCode, eventType, target })
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

function getBoldsignConfig() {
  const apiBase = String(process.env.BOLDSIGN_BASE_URI || 'https://api.boldsign.com').trim().replace(/\/$/, '')
  const apiKey = String(process.env.BOLDSIGN_API_KEY || '').trim()
  const pdfPath = process.env.BOLDSIGN_8821_PDF_PATH?.trim() || new URL('./assets/f8821.pdf', import.meta.url)
  const templateId = String(process.env.BOLDSIGN_8821_TEMPLATE_ID || '').trim()
  const templateIdMfj = String(process.env.BOLDSIGN_8821_TEMPLATE_ID_MFJ || '').trim()
  const templateIdSingle = String(process.env.BOLDSIGN_8821_TEMPLATE_ID_SINGLE || '').trim()

  return {
    apiBase,
    apiKey,
    pdfPath,
    templateId,
    templateIdMfj,
    templateIdSingle,
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
    if (retryAfterSeconds) error.retryAfterSeconds = retryAfterSeconds
    if (response.status === 429) error.noRetry = true
    error.boldsign = {
      path,
      method,
      status: response.status,
      retryAfterSeconds,
      response: data,
      request: summarizeBoldsignRequest({ path, query, body }),
    }
    throw error
  }
  return data
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

function getSpouseSignerNameFromAnswers(answers = {}) {
  const direct = String(getPrimaryAnswer(answers, ['spouse_full_name', 'spouseFullName', 'spouse_name']) || '').trim()
  if (direct) return direct
  const first = String(getPrimaryAnswer(answers, ['spouse_first_name', 'spouseFirstName']) || '').trim()
  const last = String(getPrimaryAnswer(answers, ['spouse_last_name', 'spouseLastName']) || '').trim()
  return [first, last].filter(Boolean).join(' ') || 'Spouse'
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

  const clientFields = {
    // Client identity
    Client_First_Name: String(context.firstName || '').trim(),
    Client_Last_Name: String(context.lastName || '').trim(),
    Client_Middle_Name: String(getPrimaryAnswer(answers, ['middle_name', 'middleName', 'client_middle_name']) || '').trim(),
    Client_Full_Name: fullName,
    Client_Full_Name2: fullName,
    Client_Full_Name3: fullName,
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
    Years_Owed: String(context.unfiledYearsLabel || '').trim(),
    Years_Owed_Unfiled: String(context.unfiledYearsLabel || '').trim(),
    Estimated_Tax_Liability: String(context.estimatedLiabilityLabel || '').trim(),

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
  }

  return {
    clientFields: Object.entries(clientFields).map(([Id, Value]) => ({ Id, Value: String(Value ?? '') })),
    spouseFields: Object.entries(spouseFields).map(([Id, Value]) => ({ Id, Value: String(Value ?? '') })),
  }
}

async function createBoldsign8821SigningLink({
  sessionCode,
  signerName,
  signerEmail,
  returnUrl = '',
  onBehalfOf = '',
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
  const selectedTemplateId = isMarriedJoint
    ? String(boldsignConfig.templateIdMfj || boldsignConfig.templateId || '').trim()
    : String(boldsignConfig.templateIdSingle || boldsignConfig.templateId || '').trim()
  const isTemplateConfigured = Boolean(selectedTemplateId)
  const spouseEmail = isMarriedJoint ? String(spouseSignerEmail || getSpouseSignerEmailFromAnswers(answers) || '').trim() : ''
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
            DisableEmails: true,
            EnableEmbeddedSigning: true,
            EnableSigningOrder: false,
            ...(isMarriedJoint
              ? {
                  Roles: [
                    {
                      RoleIndex: 1,
                      SignerName: resolvedSignerName,
                      SignerEmail: resolvedSignerEmail,
                      SignerType: 'Signer',
                      Locale: 'EN',
                      ExistingFormFields: existingClientFormFields,
                    },
                    {
                      RoleIndex: 2,
                      SignerName: spouseName || 'Spouse',
                      SignerEmail: spouseEmail,
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
              DisableEmails: true,
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

    documentId = String(sendResult?.documentId || '').trim()
  }
  if (!documentId) throw new Error('BoldSign did not return a documentId.')

  if (persistDocument) {
    const room = await ensureRoom(normalizedSessionCode)
    if (!shouldReuseExistingDocument) {
      const normalizedTarget = String(target || 'client').trim().toLowerCase() === 'spouse' ? 'spouse' : 'client'
      const nextReceiptEmail = String(receiptRecipientEmail || resolvedSignerEmail || '').trim()
      const nextSentAt = new Date().toISOString()
      const nextDocumentCode =
        createReceiptOnCreate || !String(room.state.answers.current_8821_document_code || room.state.answers.active_8821_document_code || '').trim()
          ? createDocumentInstanceCode('red')
          : String(room.state.answers.active_8821_document_code || room.state.answers.current_8821_document_code || '').trim()
      room.state.answers[`${documentFieldPrefix}_document_id`] = documentId
      room.state.answers[`${documentFieldPrefix}_file_name`] = isTemplateConfigured ? 'TaxRefresh R.E.D Packet.pdf' : 'TaxRefresh Form 8821.pdf'
      room.state.answers[`${documentFieldPrefix}_sent_at`] = nextSentAt
      room.state.answers[`${documentFieldPrefix}_sender_email`] = String(onBehalfOf || '').trim()
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
    }
  }

  try {
    return {
      documentId,
      signingUrl: await getBoldsignEmbeddedSignLink({
        documentId,
        signerEmail: resolvedSignerEmail,
        redirectUrl: resolvedReturnUrl,
      }),
    }
  } catch (error) {
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
  const data = await ghlFetch('contacts/', { method: 'POST', version: 'v3', body: payload })
  const contact = data?.contact || data || null
  const id = String(contact?.id || '').trim()
  if (!id) throw new Error('CRM contact creation failed to return an id.')
  return { id, contact }
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
          calendarEvents: false,
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
  const contactName = String(contact?.name || opportunity?.contactName || '')
  const contactEmail = String(contact?.email || '')
  const contactPhone = String(contact?.phone || '')
  const pipelineId = String(opportunity?.pipelineId || '')
  const stageId = String(opportunity?.pipelineStageId || '')
  const pipelineName = pipelineNameById.get(pipelineId) || ''
  const stageName = stageNameById.get(stageId) || ''
  const updatedAt = Date.parse(String(opportunity?.updatedAt || opportunity?.lastStatusChangeAt || '')) || Date.now()

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
      ghl_assigned_to: String(opportunity?.assignedTo || ''),
      ghl_last_status_change_at: String(opportunity?.lastStatusChangeAt || ''),
      ghl_last_stage_change_at: String(opportunity?.lastStageChangeAt || ''),
      name: contactName || String(existingAnswers.name || ''),
      full_name: contactName || String(existingAnswers.full_name || ''),
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

  if (hasDirectGhlConfig()) {
    if (resolvedOpportunityId) {
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
    if (resolvedContactId) {
      try {
        contact = await fetchGhlContactById(resolvedContactId)
      } catch (error) {
        console.error('Failed to fetch GHL contact from webhook sync:', error)
      }
    }
  }

  const payloadContact = webhookPayload?.contact || {}
  const payloadOpportunity = webhookPayload?.opportunity || {}
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
  const irsBalance = toNumberValue(
    getPrimaryAnswer(answers, ['irsBalance', 'irs_balance', 'federalBalance', 'federal_balance', 'irs_balance_amount']),
  )
  const stateBalance = toNumberValue(
    getPrimaryAnswer(answers, ['stateBalance', 'state_balance', 'stateTaxBalance', 'state_tax_balance']),
  )
  const directLiability = toNumberValue(
    getPrimaryAnswer(answers, ['taxLiability', 'tax_liability', 'totalLiability', 'total_liability', 'ghl_opportunity_value']),
  )
  const stateUpdatedAt = Number(state?.updatedAt || 0)
  const recordUpdatedAt = record?.updatedAt ? new Date(record.updatedAt).getTime() : 0
  const updatedAtRaw = Math.max(stateUpdatedAt, recordUpdatedAt)
  const createdAtRaw = record?.createdAt ? new Date(record.createdAt).getTime() : 0
  const clientName = getPrimaryAnswer(answers, ['full_name', 'name']) || 'Unnamed client'
  const email = getPrimaryAnswer(answers, ['email', 'email_address'])
  const phone = getPrimaryAnswer(answers, ['phone', 'phone_number'])
  const liability = Math.max(0, irsBalance + stateBalance, directLiability)
  const billingSchedule = getBillingScheduleRowsFromAnswers(answers)
  const processedPaymentCount = billingSchedule.filter((row) => getBillingStatusTone(row) === 'processed').length
  const hasProcessedPayment = processedPaymentCount > 0
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
    onboardingStatus: String(answers.onboarding_status || ''),
    form8821Status: String(answers.form8821_status || ''),
    createdAt: createdAtRaw ? new Date(createdAtRaw).toISOString() : '',
    updatedAt: updatedAtRaw ? new Date(updatedAtRaw).toISOString() : '',
    liability,
    irsBalance,
    stateBalance,
    processedPaymentCount,
    hasProcessedPayment,
    hasPlan: String(getPrimaryAnswer(answers, ['hasPlan', 'has_plan']) || ''),
    paymentPlanSelected: String(getPrimaryAnswer(answers, ['paymentPlanSelected', 'payment_plan_selected']) || ''),
    planPriceOverride: String(getPrimaryAnswer(answers, ['planPriceOverride', 'plan_price_override']) || ''),
    readyForEnrolledAgent: String(getPrimaryAnswer(answers, ['ready_for_enrolled_agent']) || ''),
    leadType: String(getPrimaryAnswer(answers, ['leadType', 'lead_type']) || ''),
    isTrainingLead: String(getPrimaryAnswer(answers, ['isTrainingLead', 'is_training_lead']) || ''),
    answerCount: Object.keys(answers).filter((key) => !key.startsWith('_ui_')).length,
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
    .sort((a, b) => a.key.localeCompare(b.key))
  return {
    ...summary,
    answers,
    links,
    answerEntries,
  }
}

function consultationMatchesSearch(summary, search = '') {
  if (!search) return true
  const haystack = [
    summary.clientName,
    summary.email,
    summary.phone,
    summary.sessionCode,
    summary.contactId,
    summary.opportunityId,
    summary.onboardingStatus,
    summary.form8821Status,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(search.toLowerCase())
}

function initialRoomState() {
  return { step: 0, route: '/session', answers: {}, updatedAt: Date.now() }
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

async function persistRoomState(roomCode, room, patches = []) {
  room.state.updatedAt = Date.now()
  patches.forEach((patch) => {
    io.to(roomCode).emit('room_patch', {
      patch,
      updatedAt: room.state.updatedAt,
    })
  })
  if (patches.length) io.to(roomCode).emit('room_state', room.state)
  await dbUpsertSession({ code: roomCode, state: room.state })
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

async function dbGetSession(code) {
  if (!pool) return fallbackGetSession(code)
  for (const candidate of getCodeVariants(code)) {
    const res = await pool.query('select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at from ti_sessions where session_code=$1', [
      candidate,
    ])
    if (res.rows[0]) return res.rows[0]
  }
  return null
}

async function dbUpsertSession({ code, contactId = null, opportunityId = null, state }) {
  if (!pool) return fallbackUpsertSession({ code, contactId, opportunityId, state })
  const existing = await dbGetSession(code)
  const resolvedCode = String(existing?.session_code || code)
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
    [resolvedCode, contactId, opportunityId, state],
  )
}

async function dbGetOrCreateSession({ contactId = '', opportunityId = '' } = {}) {
  if (!pool) {
    const existingCode = await fallbackFindSessionCode({ contactId, opportunityId })
    if (existingCode) return existingCode
    let code = generateSessionId()
    while (await dbGetSession(code)) code = generateSessionId()
    const state = initialRoomState()
    if (opportunityId) state.answers.ghl_opportunity_id = opportunityId
    if (contactId) state.answers.ghl_contact_id = contactId
    await dbUpsertSession({ code, contactId, opportunityId, state })
    return code
  }
  let res
  if (opportunityId) {
    res = await pool.query('select session_code from ti_sessions where ghl_opportunity_id=$1 order by updated_at desc limit 1', [opportunityId])
  } else {
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
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 100))
  if (pool) {
    const like = `%${String(search || '').trim()}%`
    const hasSearch = Boolean(String(search || '').trim())
    const params = hasSearch ? [like, normalizedLimit] : [normalizedLimit]
    const query = hasSearch
      ? `
        select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
        from ti_sessions
        where
          coalesce(state->'answers'->>'name', '') ilike $1
          or coalesce(state->'answers'->>'full_name', '') ilike $1
          or coalesce(state->'answers'->>'email', '') ilike $1
          or coalesce(state->'answers'->>'email_address', '') ilike $1
          or coalesce(state->'answers'->>'phone', '') ilike $1
          or coalesce(state->'answers'->>'phone_number', '') ilike $1
          or session_code ilike $1
          or coalesce(ghl_contact_id, '') ilike $1
          or coalesce(ghl_opportunity_id, '') ilike $1
        order by updated_at desc
        limit $2
      `
      : `
        select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
        from ti_sessions
        order by updated_at desc
        limit $1
      `
    const res = await pool.query(query, params)
    return res.rows.map((row) =>
      buildConsultationSummary({
        sessionCode: row.session_code,
        contactId: row.ghl_contact_id,
        opportunityId: row.ghl_opportunity_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    )
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

  return Array.from(persistedByCode.values())
    .filter((entry) => consultationMatchesSearch(entry, search))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, normalizedLimit)
}

async function getConsultationRecordByCode(code) {
  const normalized = String(code || '').trim()
  if (!normalized) return null
  const row = await dbGetSession(normalized)
  if (row) {
    return buildConsultationDetail({
      sessionCode: row.session_code,
      contactId: row.ghl_contact_id,
      opportunityId: row.ghl_opportunity_id,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  }
  const room = rooms.get(normalized) || rooms.get(normalized.toUpperCase()) || rooms.get(normalized.toLowerCase())
  if (!room) return null
  return buildConsultationDetail({
    sessionCode: normalized,
    contactId: room.contactId,
    opportunityId: room.opportunityId,
    state: room.state,
    createdAt: room.state?.updatedAt || Date.now(),
    updatedAt: room.state?.updatedAt || Date.now(),
  })
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
    return res.json({ items })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load consultation records' })
  }
})

app.get('/api/admin/consultations/analytics', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const items = await listAllConsultationDetails()
    const analytics = buildConsultationAnalytics(items, req.adminUser || null)
    return res.json({ analytics })
  } catch (error) {
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

app.get('/api/admin/consultations/:code', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const item = await getConsultationRecordByCode(req.params.code)
    if (!item) return res.status(404).json({ error: 'Consultation record not found' })
    if (!canEnrolledAgentAccessItem(item, req.adminUser)) {
      return res.status(403).json({ error: 'You do not have access to this consultation record.' })
    }
    return res.json({ item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load consultation detail' })
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
    const payload = await loadSigned8821DocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      return res.status(404).json({ error: 'No signed Form 8821 document is available for this client yet.' })
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
    const payload = await loadSigned8821FirstPageDocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      return res.status(404).json({ error: 'No signed Form 8821 page 1 document is available for this client yet.' })
    }
    res.setHeader('Content-Type', payload.contentType || 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `${String(req.query?.download || '') === '1' ? 'attachment' : 'inline'}; filename="${payload.filename || 'signed-8821-page-1.pdf'}"`)
    return res.send(payload.fileBuffer)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load signed Form 8821 page 1.' })
  }
})

app.get('/api/session/:code/signed-8821', async (req, res) => {
  try {
    const roomCode = String(req.params.code || '').toUpperCase().trim()
    if (!roomCode) return res.status(400).json({ error: 'Session code is required.' })

    const room = await ensureRoom(roomCode)
    const answers = room?.state?.answers || {}
    if (!isForm8821FullySigned(answers)) {
      return res.status(409).json({ error: 'Form 8821 is not fully signed yet.' })
    }

    const payload = await loadSigned8821DocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      return res.status(404).json({ error: 'No signed Form 8821 document is available for this session yet.' })
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
    const answers = room.state.answers || {}
    if (!isForm8821FullySigned(answers)) {
      return res.status(409).json({ error: 'Form 8821 is not fully signed yet.' })
    }
    const payload = await loadSigned8821FirstPageDocumentPayload(roomCode, room)
    if (!payload?.fileBuffer?.length) {
      return res.status(404).json({ error: 'No signed Form 8821 page 1 document is available for this session.' })
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
    room.state.answers[answerKey] = nextValue === null || nextValue === undefined ? '' : nextValue
    room.state.updatedAt = Date.now()

    io.to(roomCode).emit('room_patch', {
      patch: { type: 'setAnswer', questionId: answerKey, value: room.state.answers[answerKey] },
      updatedAt: room.state.updatedAt,
    })
    io.to(roomCode).emit('room_state', room.state)

    try {
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch {
      // ignore; record will still update in-memory
    }

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update consultation field' })
  }
})

app.patch('/api/admin/consultations/:code/billing', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const roomCode = String(req.params.code || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })

    const room = await ensureRoom(roomCode)
    const invoiceAmount = req.body?.invoiceAmount
    const invoiceCreatedAt = req.body?.invoiceCreatedAt
    const schedule = Array.isArray(req.body?.schedule) ? req.body.schedule : []

    room.state.answers.billing_invoice_amount = invoiceAmount === null || invoiceAmount === undefined ? '' : invoiceAmount
    room.state.answers.billing_invoice_created_at = invoiceCreatedAt === null || invoiceCreatedAt === undefined ? '' : invoiceCreatedAt
    room.state.answers.billing_schedule = schedule
    room.state.updatedAt = Date.now()

    io.to(roomCode).emit('room_patch', {
      patch: { type: 'setAnswer', questionId: 'billing_invoice_amount', value: room.state.answers.billing_invoice_amount },
      updatedAt: room.state.updatedAt,
    })
    io.to(roomCode).emit('room_patch', {
      patch: { type: 'setAnswer', questionId: 'billing_invoice_created_at', value: room.state.answers.billing_invoice_created_at },
      updatedAt: room.state.updatedAt,
    })
    io.to(roomCode).emit('room_patch', {
      patch: { type: 'setAnswer', questionId: 'billing_schedule', value: room.state.answers.billing_schedule },
      updatedAt: room.state.updatedAt,
    })
    io.to(roomCode).emit('room_state', room.state)

    try {
      await dbUpsertSession({ code: roomCode, state: room.state })
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to persist billing adjustments' })
    }

    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update billing adjustments' })
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
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        sessionCode: roomCode,
        createdBy: String(req.adminUser?.email || ''),
      },
    })
    return res.json({
      ok: true,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      clientSecret: intent.client_secret,
      customerId,
      setupIntentId: intent.id,
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
    const customerId = await ensureStripeCustomerForRoom(roomCode, room)
    if (setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
      if (setupIntent.status !== 'succeeded') return res.status(400).json({ error: 'Stripe setup has not completed yet.' })
      if (String(setupIntent.customer || '') !== customerId) return res.status(400).json({ error: 'Stripe customer mismatch.' })
    }
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    if (String(paymentMethod.customer || '') !== customerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    }
    const nextMethod = buildStripePaymentMethodRecord(paymentMethod, { customerId, setupIntentId })
    const existingMethods = parseStoredPaymentMethods(room.state.answers.billing_payment_methods).filter(
      (entry) => String(entry?.stripePaymentMethodId || '') !== paymentMethodId,
    )
    const nextMethods = [...existingMethods, nextMethod]
    room.state.answers.billing_payment_methods = nextMethods
    room.state.answers.billing_payment_method = nextMethod
    await persistRoomState(roomCode, room, [
      { type: 'setAnswer', questionId: 'billing_payment_methods', value: nextMethods },
      { type: 'setAnswer', questionId: 'billing_payment_method', value: nextMethod },
    ])
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentMethod: nextMethod })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to attach Stripe payment method' })
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
    const scheduleIndex = Number(req.body?.scheduleIndex)
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim()
    if (!roomCode) return res.status(400).json({ error: 'Consultation code is required' })
    if (!Number.isInteger(scheduleIndex) || scheduleIndex < 0) return res.status(400).json({ error: 'A valid scheduleIndex is required' })
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' })
    const room = await ensureRoom(roomCode)
    const schedule = Array.isArray(room.state.answers.billing_schedule) ? room.state.answers.billing_schedule : []
    const rows = Array.isArray(schedule) ? schedule.map((row) => ({ ...(row || {}) })) : []
    const targetRow = rows[scheduleIndex]
    if (!targetRow) return res.status(404).json({ error: 'Billing schedule row not found' })
    const amount = Number(targetRow.amount || 0)
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'The scheduled amount is invalid.' })
    const customerId = await ensureStripeCustomerForRoom(roomCode, room)
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        sessionCode: roomCode,
        scheduleIndex: String(scheduleIndex),
        amount: String(amount),
      },
    })
    rows[scheduleIndex] = {
      ...targetRow,
      status: 'Processed',
      failureReason: '',
      processorReason: '',
      reason: '',
      stripePaymentIntentId: intent.id,
      processedAt: new Date().toISOString(),
    }
    room.state.answers.billing_schedule = rows
    await persistRoomState(roomCode, room, [{ type: 'setAnswer', questionId: 'billing_schedule', value: rows }])
    const item = await getConsultationRecordByCode(roomCode)
    return res.json({ ok: true, item, paymentIntentId: intent.id, status: intent.status })
  } catch (error) {
    const roomCode = String(req.params.code || '').trim()
    const scheduleIndex = Number(req.body?.scheduleIndex)
    if (roomCode && Number.isInteger(scheduleIndex) && scheduleIndex >= 0) {
      try {
        const room = await ensureRoom(roomCode)
        const rows = Array.isArray(room.state.answers.billing_schedule) ? room.state.answers.billing_schedule.map((row) => ({ ...(row || {}) })) : []
        if (rows[scheduleIndex]) {
          const reason = getStripePaymentFailureReason(error)
          rows[scheduleIndex] = {
            ...rows[scheduleIndex],
            status: 'Failed',
            failureReason: reason,
            processorReason: reason,
            reason,
          }
          room.state.answers.billing_schedule = rows
          await persistRoomState(roomCode, room, [{ type: 'setAnswer', questionId: 'billing_schedule', value: rows }])
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
    if (!contactId) {
      const created = await createGhlContactForEmail({ email: resolvedRecipientEmail, name: clientName, phone })
      contactId = created.id
      room.contactId = contactId
      room.state.answers.ghl_contact_id = contactId
      room.state.answers.ghl_contact_created_at = new Date().toISOString()
      try {
        await dbUpsertSession({ code: roomCode, contactId, state: room.state })
      } catch {
        // ignore; state still updates in-memory
      }
    }
    await ensureGhlContactEmail({ contactId, email: resolvedRecipientEmail, name: clientName, phone })

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
      if (isMarriedJoint) {
        if (!isValidEmailAddress(spouseRecipientEmail)) {
          return res.status(400).json({ error: 'Spouse email is required for married filing jointly.' })
        }
        // Store spouse email so template sending can attach spouse as RoleIndex 2.
        answers.spouse_email = spouseRecipientEmail
        answers.form8821_spouse_status = 'launching'
      } else {
        answers.form8821_spouse_status = 'not_required'
      }

      const created = await createBoldsign8821SigningLink({
        sessionCode: roomCode,
        signerName: clientName,
        signerEmail: resolvedRecipientEmail,
        returnUrl: clientReturnUrl,
        onBehalfOf: String(req.adminUser?.email || '').trim(),
        persistDocument: true,
        documentFieldPrefix: 'boldsign_8821',
        forceNewDocument: true,
      })

      const clientSigningUrl = String(created?.signingUrl || '').trim()
      if (!clientSigningUrl) {
        return res.status(500).json({ error: 'Unable to create a secure signing link for this document.' })
      }

      let spouseSigningUrl = ''
      if (isMarriedJoint) {
        spouseSigningUrl = await getBoldsignEmbeddedSignLink({
          documentId: String(created?.documentId || '').trim(),
          signerEmail: spouseRecipientEmail,
          redirectUrl: spouseReturnUrl || clientReturnUrl,
        })
      }

      links = {
        ...links,
        form8821ClientLink: clientSigningUrl,
        form8821SpouseLink: spouseSigningUrl,
      }
      await sendGhlEmailMessage({
        contactId,
        emailTo: resolvedRecipientEmail,
        subject: 'TaxRefresh Signature Request',
        message: `Open and sign your TaxRefresh Form 8821: ${links.form8821ClientLink}`,
        html: build8821EmailHtml({ clientName, signingLink: links.form8821ClientLink }),
      })
      nextReceipts.push({ name: '8821 Document', documentCode, status: 'Sent' })
      logEntries.push({
        id: `doc_email_${Date.now().toString(36)}_client`,
        documentType: '8821 Document',
        documentCode,
        recipientEmail: resolvedRecipientEmail,
        link: links.form8821ClientLink,
        sentAt,
        sentBy: String(req.adminUser?.email || '').trim(),
      })
      deliveryEntries.push({
        id: `doc_delivery_${Date.now().toString(36)}_client`,
        name: '8821 Document',
        documentCode,
        status: 'Sent',
        method: 'Email',
        sentAt,
        recipientEmail: resolvedRecipientEmail,
        sentBy: String(req.adminUser?.email || '').trim(),
      })

      if (isMarriedJointFilingAnswers(answers) && spouseRecipientEmail) {
        if (!links.form8821SpouseLink) {
          return res.status(500).json({ error: 'Unable to create a secure spouse signing link for this document.' })
        }
        await sendGhlEmailMessage({
          contactId,
          emailTo: spouseRecipientEmail,
          subject: 'TaxRefresh Signature Request',
          message: `Open and sign the spouse portion of TaxRefresh Form 8821: ${links.form8821SpouseLink}`,
          html: build8821EmailHtml({ clientName: String(getPrimaryAnswer(answers, ['spouse_full_name', 'spouseFullName', 'spouse_name']) || 'Spouse'), signingLink: links.form8821SpouseLink }),
        })
        nextReceipts.push({ name: '8821 Spouse', documentCode, status: 'Sent' })
        logEntries.push({
          id: `doc_email_${Date.now().toString(36)}_spouse`,
          documentType: '8821 Spouse',
          documentCode,
          recipientEmail: spouseRecipientEmail,
          link: links.form8821SpouseLink,
          sentAt,
          sentBy: String(req.adminUser?.email || '').trim(),
        })
        deliveryEntries.push({
          id: `doc_delivery_${Date.now().toString(36)}_spouse`,
          name: '8821 Spouse',
          documentCode,
          status: 'Sent',
          method: 'Email',
          sentAt,
          recipientEmail: spouseRecipientEmail,
          sentBy: String(req.adminUser?.email || '').trim(),
        })
      }

      answers.onboarding_status = 'documents_ready_for_signature'
    } else {
      if (!links.clientPortalLink) {
        return res.status(400).json({ error: 'A public portal link is not available for this document yet.' })
      }
      await sendGhlEmailMessage({
        contactId,
        emailTo: resolvedRecipientEmail,
        subject: 'TaxRefresh documents ready for review',
        message: `Open your secure TaxRefresh portal to review your documents: ${links.clientPortalLink}`,
        html: buildResolutionEmailHtml({ clientName, portalLink: links.clientPortalLink }),
      })
      nextReceipts.push({ name: 'Resolution Documents', status: 'Sent' })
      logEntries.push({
        id: `doc_email_${Date.now().toString(36)}_resolution`,
        documentType: 'Resolution Documents',
        recipientEmail: resolvedRecipientEmail,
        link: links.clientPortalLink,
        sentAt,
        sentBy: String(req.adminUser?.email || '').trim(),
      })
      deliveryEntries.push({
        id: `doc_delivery_${Date.now().toString(36)}_resolution`,
        name: 'Resolution Documents',
        status: 'Sent',
        method: 'Email',
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
    return res.json({
      ok: true,
      item: refreshedItem,
      sentAt,
      link: documentType === '8821 Document' ? links.form8821ClientLink : links.clientPortalLink,
      spouseLink: documentType === '8821 Document' && spouseRecipientEmail ? links.form8821SpouseLink : '',
    })
  } catch (error) {
    if (error?.boldsign) {
      console.error('BoldSign send-document-email debug:', error.boldsign)
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send document email.' })
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
    const existingDocumentId = String(answers.boldsign_8821_document_id || '').trim()
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
    const logEntries = Array.isArray(answers.document_email_log) ? answers.document_email_log : parseStoredObject(answers.document_email_log, [])
    const targetLog = Array.isArray(logEntries)
      ? logEntries.find((entry) => String(entry?.documentType || '').trim() === (target === 'spouse' ? '8821 Spouse' : '8821 Document'))
      : null
    const signerName =
      target === 'spouse'
        ? String(
            req.query?.name ||
              getPrimaryAnswer(answers, ['spouse_full_name', 'spouseFullName', 'spouse_name']) ||
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

    const backendBase = getBackendBaseUrl()
    const returnUrl =
      String(req.query?.returnUrl || '').trim() ||
      (backendBase ? `${backendBase}/api/session/${encodeURIComponent(roomCode)}/document-complete?target=${target}` : '')

    const boldsignConfig = getBoldsignConfig()
    const isMarriedJoint = isMarriedJointFilingAnswers(answers)
    const selectedTemplateId = isMarriedJoint
      ? String(boldsignConfig.templateIdMfj || boldsignConfig.templateId || '').trim()
      : String(boldsignConfig.templateIdSingle || boldsignConfig.templateId || '').trim()
    const templateConfigured = Boolean(selectedTemplateId)

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
          signerEmail,
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
        const clientEmail = String(getPrimaryAnswer(answers, ['email', 'email_address']) || '').trim()
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
          signerEmail,
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

    const clientName = String(getPrimaryAnswer(answers, ['full_name', 'name']) || '').trim()
    return res.json({
      code: String(row.session_code),
      clientName,
      contactId: row.ghl_contact_id || '',
      opportunityId: row.ghl_opportunity_id || '',
    })
  })().catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to verify client portal account' }))
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
    const res = await pool.query(`
      select session_code, ghl_contact_id, ghl_opportunity_id, state, created_at, updated_at
      from ti_sessions
      order by updated_at desc
    `)
    return res.rows.map((row) =>
      buildConsultationDetail({
        sessionCode: row.session_code,
        contactId: row.ghl_contact_id,
        opportunityId: row.ghl_opportunity_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    )
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
  return Array.from(persistedByCode.values()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

function buildConsultationAnalytics(items = [], account = null) {
  const accessibleItems = String(account?.designatedPosition || '').trim() === 'Enrolled Agent'
    ? items.filter((item) => canEnrolledAgentAccessItem(item, account))
    : items

  const monthlyRevenue = new Map()
  const pipelineBuckets = new Map()
  const stageBuckets = new Map()
  let processedRevenueTotal = 0
  let pendingRevenueTotal = 0
  let failedRevenueTotal = 0
  let openTasks = 0
  let documentsUploaded = 0

  const topOpportunities = accessibleItems
    .map((item) => {
      const answers = item?.answers || {}
      const scheduleRows = getBillingScheduleRowsFromAnswers(answers)
      let processedRevenue = 0
      let pendingRevenue = 0
      let failedRevenue = 0
      scheduleRows.forEach((row) => {
        const amount = toNumberValue(row?.amount)
        const tone = getBillingStatusTone(row)
        const monthKey = normalizeBillingDateValue(row?.processedAt || row?.date || '').slice(0, 7)
        if (tone === 'processed') {
          processedRevenue += amount
          processedRevenueTotal += amount
          if (monthKey) {
            const existing = monthlyRevenue.get(monthKey) || { month: monthKey, label: formatMonthLabel(monthKey), revenue: 0, processedCount: 0 }
            existing.revenue += amount
            existing.processedCount += 1
            monthlyRevenue.set(monthKey, existing)
          }
        } else if (tone === 'failed') {
          failedRevenue += amount
          failedRevenueTotal += amount
        } else {
          pendingRevenue += amount
          pendingRevenueTotal += amount
        }
      })

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

  const activeClients = accessibleItems.filter((item) => getLifecycleLabel(item) === 'Active Client').length
  const activeProspects = accessibleItems.filter((item) => getLifecycleLabel(item) === 'Active Prospect').length
  const pendingEaReview = accessibleItems.filter((item) => String(item.eaCaseStatus || '').trim() === 'Pending EA Review').length
  const sentToEa = accessibleItems.filter((item) => isEnrolledAgentHandoffSent(item.readyForEnrolledAgent)).length
  const averageLiability = accessibleItems.length
    ? accessibleItems.reduce((sum, item) => sum + Number(item.liability || 0), 0) / accessibleItems.length
    : 0

  return {
    overview: {
      totalRecords: accessibleItems.length,
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
      maybeTrackExperienceDocumentRoute(roomCode, room, room.state.route, previousRoute)
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
      }
    }
  })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`)
})
