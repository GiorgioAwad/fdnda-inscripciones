import assert from "node:assert/strict"
import test from "node:test"
import { runMaintenance } from "../src/index.js"

const env = {
  APP_ORIGIN: "https://inscripciones.example.org/",
  MAINTENANCE_SECRET: "s".repeat(32),
}
const logger = { log() {}, error() {} }

test("calls only the production maintenance endpoint with bearer authentication", async () => {
  let called = false
  await runMaintenance(env, async (url, options) => {
    called = true
    assert.equal(url.href, "https://inscripciones.example.org/api/internal/maintenance/expire-orders")
    assert.equal(options.method, "POST")
    assert.equal(options.headers.authorization, `Bearer ${env.MAINTENANCE_SECRET}`)
    assert.equal(options.redirect, "manual")
    return Response.json({ success: true, expiredOrders: 2, ordersRequiringPaymentReview: 0, prunedRateLimits: 1 })
  }, logger)
  assert.equal(called, true)
})

test("fails closed for an invalid origin before making a request", async () => {
  let called = false
  await assert.rejects(
    runMaintenance({ ...env, APP_ORIGIN: "http://localhost/" }, () => { called = true }, logger),
    /invalid_configuration/,
  )
  assert.equal(called, false)
})

test("reports authentication failures and redirects as failed cron runs", async () => {
  for (const status of [301, 401]) {
    await assert.rejects(
      runMaintenance(env, async () => new Response(null, { status }), logger),
      new RegExp(`http_status_${status}`),
    )
  }
})

test("reports malformed successful responses as failed cron runs", async () => {
  await assert.rejects(
    runMaintenance(env, async () => Response.json({ success: false }), logger),
    /invalid_response/,
  )
})
test("flags orders that require payment reconciliation", async () => {
  const errors = []
  await runMaintenance(env, async () => Response.json({
    success: true,
    expiredOrders: 0,
    ordersRequiringPaymentReview: 2,
    prunedRateLimits: 0,
  }), { log() {}, error(message) { errors.push(JSON.parse(message)) } })
  assert.deepEqual(errors, [{ event: "payment_reconciliation_required", count: 2 }])
})