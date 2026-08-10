import { NextRequest, NextResponse } from "next/server"
import {
  isIzipayCommunicationError,
  isIzipayPaymentApproved,
  parseIzipayPaymentResponse,
  sanitizeIzipayPaymentResult,
  verifyIzipayWebCoreSignature,
} from "@/lib/izipay"
import {
  recordIzipayPaymentEvent,
  resolveIzipayPaymentContext,
  updateIzipayAttempt,
} from "@/lib/izipay-orders"
import { fulfillPaidOrder } from "@/lib/orders"

export const runtime = "nodejs"

// Izipay no siempre manda un content-type fiable en el IPN. Si asumimos uno y
// el parseo lanza, la ruta responde 4xx/5xx, Izipay marca la notificación como
// «Fallido» y el pago cobrado nunca se confirma. Por eso se decide por
// content-type y, si falta, se intenta JSON y luego form-urlencoded.
function parseWebhookBody(raw: string, contentType: string): Record<string, unknown> {
  if (!raw.trim()) return {}

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries())
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return Object.fromEntries(new URLSearchParams(raw).entries())
  }
}

function readField(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value) return value
  }
  return ""
}

// Health check: Izipay hace un GET a la URL del IPN al registrarla.
export async function GET() {
  return NextResponse.json({
    endpoint: "izipay-webhook",
    accepts: ["application/json", "application/x-www-form-urlencoded"],
  })
}

// IPN de Izipay (Web Core). Respaldo del redirect-result: solo confirma pagos
// aprobados con firma válida. Un IPN no aprobado NO cancela la orden (podría
// cruzarse con un reintento del comprador); la expiración se encarga del resto.
export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>

  try {
    const rawBody = await request.text()
    const contentType = (request.headers.get("content-type") || "").toLowerCase()
    payload = parseWebhookBody(rawBody, contentType)
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }

  // Izipay alterna la capitalización de payloadHttp según el canal.
  const payloadHttp = readField(payload, "payloadHttp", "payloadhttp")
  const signature =
    readField(payload, "signature") || request.headers.get("signature") || ""
  const transactionId =
    readField(payload, "transactionId", "transactionid") ||
    request.headers.get("transactionId") ||
    ""

  const parsed = parseIzipayPaymentResponse({
    ...payload,
    ...(payloadHttp ? { payloadHttp } : {}),
    signature,
    ...(transactionId ? { transactionId } : {}),
  })

  if (!parsed || !parsed.orderNumber) {
    console.error("[izipay/webhook] payload no interpretable")
    return NextResponse.json({ error: "Payload no interpretable" }, { status: 400 })
  }

  const isValid = verifyIzipayWebCoreSignature({
    code: parsed.code,
    payloadHttp: parsed.payloadHttp,
    signature,
  })

  if (!isValid) {
    console.error("[izipay/webhook] firma inválida", {
      orderNumber: parsed.orderNumber,
    })
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 })
  }

  const context = await resolveIzipayPaymentContext(parsed)
  if (!context.ok) {
    console.error("[izipay/webhook] correlación inválida", {
      orderNumber: parsed.orderNumber,
      reason: context.error,
    })
    return NextResponse.json({ error: "Pago no correlacionado" }, { status: 409 })
  }
  const { orderId, attemptId } = context
  await recordIzipayPaymentEvent({
    source: "webhook",
    parsed,
    orderId,
    attemptId,
    validSignature: true,
  })

  if (isIzipayPaymentApproved(parsed)) {
    await updateIzipayAttempt({ attemptId, status: "APPROVED", parsed })
    const result = await fulfillPaidOrder({
      orderId,
      provider: "IZIPAY",
      providerRef: parsed.transactionId,
      providerTransactionId: parsed.transactionId,
      providerResponse: sanitizeIzipayPaymentResult(parsed),
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
  } else {
    await updateIzipayAttempt({
      attemptId,
      status: isIzipayCommunicationError(parsed.code) ? "ERROR" : "REJECTED",
      parsed,
    })
  }

  return NextResponse.json({ received: true })
}
