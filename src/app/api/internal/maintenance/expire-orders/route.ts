import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  countOrdersRequiringPaymentReview,
  expireStaleOrders,
} from "@/lib/orders"
import { pruneSecurityRateLimits } from "@/lib/security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function hasValidMaintenanceSecret(request: NextRequest): boolean {
  const configured = process.env.MAINTENANCE_SECRET
  if (!configured) return false

  const authorization = request.headers.get("authorization")
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : request.headers.get("x-maintenance-secret") || ""

  const expectedBuffer = Buffer.from(configured)
  const providedBuffer = Buffer.from(provided)

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  )
}

// Endpoint protegido para ejecutar cada minuto desde el programador de la
// infraestructura. La expiracion perezosa se conserva como respaldo.
export async function POST(request: NextRequest) {
  if (!hasValidMaintenanceSecret(request)) {
    return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
  }

  const [expiredOrders, ordersRequiringPaymentReview, prunedRateLimits] =
    await Promise.all([
      expireStaleOrders(),
      countOrdersRequiringPaymentReview(),
      pruneSecurityRateLimits(),
    ])

  if (ordersRequiringPaymentReview > 0) {
    console.error(
      JSON.stringify({
        level: "error",
        type: "payment_reconciliation_required",
        count: ordersRequiringPaymentReview,
        occurredAt: new Date().toISOString(),
      })
    )
  }

  return NextResponse.json({
    success: true,
    expiredOrders,
    ordersRequiringPaymentReview,
    prunedRateLimits,
    processedAt: new Date().toISOString(),
  })
}

// Algunos programadores administrados (por ejemplo, cron HTTP) solo invocan
// GET. Se protege con el mismo secreto y comparte la operacion idempotente.
export const GET = POST
