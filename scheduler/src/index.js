const MAINTENANCE_PATH = "/api/internal/maintenance/expire-orders"

function maintenanceUrl(origin) {
  if (typeof origin !== "string") throw new Error("invalid_configuration")

  let url
  try {
    url = new URL(origin)
  } catch {
    throw new Error("invalid_configuration")
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin + "/" !== origin
  ) {
    throw new Error("invalid_configuration")
  }

  return new URL(MAINTENANCE_PATH, url)
}

export async function runMaintenance(env, fetcher = fetch, logger = console) {
  const url = maintenanceUrl(env.APP_ORIGIN)
  if (typeof env.MAINTENANCE_SECRET !== "string" || env.MAINTENANCE_SECRET.length < 32) {
    throw new Error("invalid_configuration")
  }

  let response
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.MAINTENANCE_SECRET}` },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new Error("request_failed")
  }

  if (response.status !== 200) {
    throw new Error(`http_status_${response.status}`)
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error("invalid_response")
  }

  if (
    result?.success !== true ||
    !Number.isSafeInteger(result.expiredOrders) || result.expiredOrders < 0 ||
    !Number.isSafeInteger(result.ordersRequiringPaymentReview) || result.ordersRequiringPaymentReview < 0 ||
    !Number.isSafeInteger(result.prunedRateLimits) || result.prunedRateLimits < 0
  ) {
    throw new Error("invalid_response")
  }

  logger.log(JSON.stringify({
    event: "maintenance_complete",
    expiredOrders: result.expiredOrders,
    ordersRequiringPaymentReview: result.ordersRequiringPaymentReview,
    prunedRateLimits: result.prunedRateLimits,
  }))

  if (result.ordersRequiringPaymentReview > 0) {
    logger.error(JSON.stringify({
      event: "payment_reconciliation_required",
      count: result.ordersRequiringPaymentReview,
    }))
  }
}

export default {
  async scheduled(_controller, env) {
    try {
      await runMaintenance(env)
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown_error"
      console.error(JSON.stringify({ event: "maintenance_failed", code }))
      throw new Error("maintenance_failed")
    }
  },
}