import pg from 'pg'

const { Pool } = pg

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

function toStr(value) {
  return String(value ?? '').trim()
}

function deepClone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj
}

function parseSchedule(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function getProcessedAt(row = {}) {
  return (
    toStr(row.processedAt) ||
    toStr(row.processed_at) ||
    toStr(row.processed_at_iso) ||
    ''
  )
}

function getPaymentIntentId(row = {}) {
  return (
    toStr(row.stripePaymentIntentId) ||
    toStr(row.stripe_payment_intent_id) ||
    toStr(row.stripe_payment_intent) ||
    ''
  )
}

function getProcessedPaymentMethodId(row = {}) {
  return (
    toStr(row.processedStripePaymentMethodId) ||
    toStr(row.processed_stripe_payment_method_id) ||
    ''
  )
}

function getProcessedLast4(row = {}) {
  return toStr(row.processedPaymentMethodLast4) || toStr(row.processed_payment_method_last4) || ''
}

function getProcessedBrand(row = {}) {
  return toStr(row.processedPaymentMethodBrand) || toStr(row.processed_payment_method_brand) || ''
}

function hasStripeEvidenceInRows(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return list.some((row) => {
    if (!row || typeof row !== 'object') return false
    return Boolean(
      getProcessedAt(row) ||
        getPaymentIntentId(row) ||
        getProcessedPaymentMethodId(row) ||
        getProcessedLast4(row) ||
        getProcessedBrand(row),
    )
  })
}

function extractBilling(answers = {}) {
  const obj = answers && typeof answers === 'object' ? answers : {}
  return {
    stripe_customer_id: toStr(obj.stripe_customer_id),
    billing_invoice_amount: obj.billing_invoice_amount ?? '',
    billing_invoice_created_at: obj.billing_invoice_created_at ?? '',
    billing_schedule: obj.billing_schedule ?? [],
    investigation_billing_invoice_amount: obj.investigation_billing_invoice_amount ?? '',
    investigation_billing_invoice_created_at: obj.investigation_billing_invoice_created_at ?? '',
    investigation_billing_schedule: obj.investigation_billing_schedule ?? [],
    resolution_billing_invoice_amount: obj.resolution_billing_invoice_amount ?? '',
    resolution_billing_invoice_created_at: obj.resolution_billing_invoice_created_at ?? '',
    resolution_billing_schedule: obj.resolution_billing_schedule ?? [],
  }
}

function billingHasAnyEvidence(billing = {}) {
  return (
    hasStripeEvidenceInRows(parseSchedule(billing.billing_schedule)) ||
    hasStripeEvidenceInRows(parseSchedule(billing.investigation_billing_schedule)) ||
    hasStripeEvidenceInRows(parseSchedule(billing.resolution_billing_schedule))
  )
}

function normalizeNumber(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function shouldCopyScalar({ prodValue, recValue }) {
  const prodStr = toStr(prodValue)
  const recStr = toStr(recValue)
  if (!recStr) return false
  if (!prodStr) return true
  // If prod is "0" and rec is meaningful, prefer rec
  if (normalizeNumber(prodStr) <= 0 && normalizeNumber(recStr) > 0) return true
  return false
}

function mergeBillingIntoProd({ prodState, recoveryState }) {
  const prod = deepClone(prodState) || {}
  const rec = recoveryState || {}
  const prodAnswers = (prod.answers && typeof prod.answers === 'object') ? prod.answers : {}
  const recAnswers = (rec.answers && typeof rec.answers === 'object') ? rec.answers : {}

  const prodBilling = extractBilling(prodAnswers)
  const recBilling = extractBilling(recAnswers)

  const prodHasEvidence = billingHasAnyEvidence(prodBilling)
  const recHasEvidence = billingHasAnyEvidence(recBilling)

  // Only merge if recovery has evidence and prod doesn't.
  if (!recHasEvidence || prodHasEvidence) {
    // Still allow restoration of stripe_customer_id / invoice fields when missing in prod.
    let changed = false
    const nextAnswers = { ...prodAnswers }
    if (shouldCopyScalar({ prodValue: prodBilling.stripe_customer_id, recValue: recBilling.stripe_customer_id })) {
      nextAnswers.stripe_customer_id = recBilling.stripe_customer_id
      changed = true
    }
    ;[
      'billing_invoice_amount',
      'billing_invoice_created_at',
      'investigation_billing_invoice_amount',
      'investigation_billing_invoice_created_at',
      'resolution_billing_invoice_amount',
      'resolution_billing_invoice_created_at',
    ].forEach((key) => {
      if (shouldCopyScalar({ prodValue: prodBilling[key], recValue: recBilling[key] })) {
        nextAnswers[key] = recBilling[key]
        changed = true
      }
    })
    if (!changed) return { changed: false, nextState: prodState }
    return { changed: true, nextState: { ...prod, answers: nextAnswers } }
  }

  const nextAnswers = { ...prodAnswers }

  // Copy schedules (including evidence fields).
  nextAnswers.billing_schedule = recBilling.billing_schedule
  nextAnswers.investigation_billing_schedule = recBilling.investigation_billing_schedule
  nextAnswers.resolution_billing_schedule = recBilling.resolution_billing_schedule

  // Copy invoice amounts if they exist in recovery.
  ;[
    'billing_invoice_amount',
    'billing_invoice_created_at',
    'investigation_billing_invoice_amount',
    'investigation_billing_invoice_created_at',
    'resolution_billing_invoice_amount',
    'resolution_billing_invoice_created_at',
  ].forEach((key) => {
    if (toStr(recBilling[key]) || normalizeNumber(recBilling[key]) > 0) {
      nextAnswers[key] = recBilling[key]
    }
  })

  // Copy stripe customer id if recovery has it and prod doesn't.
  if (shouldCopyScalar({ prodValue: prodBilling.stripe_customer_id, recValue: recBilling.stripe_customer_id })) {
    nextAnswers.stripe_customer_id = recBilling.stripe_customer_id
  }

  return { changed: true, nextState: { ...prod, answers: nextAnswers } }
}

async function main() {
  const PROD_DATABASE_URL = requiredEnv('PROD_DATABASE_URL')
  const RECOVERY_DATABASE_URL = requiredEnv('RECOVERY_DATABASE_URL')
  const DRY_RUN = toStr(process.env.DRY_RUN || 'true').toLowerCase() !== 'false'
  const LIMIT = Math.max(1, Number(process.env.LIMIT || 5000) || 5000)

  const prodPool = new Pool({ connectionString: PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  const recPool = new Pool({ connectionString: RECOVERY_DATABASE_URL, ssl: { rejectUnauthorized: false } })

  try {
    const [prodRes, recRes] = await Promise.all([
      prodPool.query('select session_code, state from ti_sessions order by updated_at desc limit $1', [LIMIT]),
      recPool.query('select session_code, state from ti_sessions order by updated_at desc limit $1', [LIMIT]),
    ])

    const prodByCode = new Map(prodRes.rows.map((row) => [String(row.session_code), row]))
    let scanned = 0
    let updated = 0
    let skipped = 0
    const updatedExamples = []

    for (const recRow of recRes.rows) {
      const code = String(recRow.session_code || '').trim()
      if (!code) continue
      const prodRow = prodByCode.get(code)
      if (!prodRow) continue
      scanned += 1

      const { changed, nextState } = mergeBillingIntoProd({
        prodState: prodRow.state,
        recoveryState: recRow.state,
      })

      if (!changed) {
        skipped += 1
        continue
      }

      if (!DRY_RUN) {
        await prodPool.query('update ti_sessions set state=$2, updated_at=now() where session_code=$1', [code, nextState])
      }

      updated += 1
      if (updatedExamples.length < 20) updatedExamples.push(code)
    }

    console.log(
      JSON.stringify(
        {
          dryRun: DRY_RUN,
          scanned,
          updated,
          skipped,
          updatedExamples,
        },
        null,
        2,
      ),
    )
  } finally {
    await Promise.allSettled([prodPool.end(), recPool.end()])
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

