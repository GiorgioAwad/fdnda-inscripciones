import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  isIzipayCommunicationError,
  isIzipayPaymentApproved,
  parseIzipayPaymentResponse,
  sanitizeIzipayPaymentResult,
  verifyIzipayWebCoreSignature,
} from "@/lib/izipay"
import {
  recordIzipayPaymentEvent,
  resolveIzipayOrderId,
  resolveIzipayPaymentContext,
  updateIzipayAttempt,
} from "@/lib/izipay-orders"
import { failOrder, fulfillPaidOrder } from "@/lib/orders"
import { getCanonicalAppUrl } from "@/lib/env"

export const runtime = "nodejs"

function paymentPageUrl(request: NextRequest, orderId: string, message?: string) {
  const base = getCanonicalAppUrl()
  const url = new URL(`/pago/${orderId}`, base)
  if (message) url.searchParams.set("message", message)
  return url
}

function fallbackUrl(request: NextRequest, message: string) {
  const base = getCanonicalAppUrl()
  const url = new URL("/mis-inscripciones", base)
  url.searchParams.set("message", message)
  return url
}

// GET: Izipay redirige al comercio desde su página de resumen. El resultado del
// pago llega por POST/IPN; aquí solo llevamos al usuario a su página de orden.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const orderRef =
    params.get("orderId") ||
    params.get("orderNumber") ||
    params.get("merchantOrderNumber") ||
    ""

  const resolvedOrderId = orderRef ? await resolveIzipayOrderId(orderRef) : null

  if (resolvedOrderId) {
    const order = await prisma.order.findUnique({
      where: { id: resolvedOrderId },
      select: { status: true },
    })

    const message =
      order?.status === "PENDING"
        ? "Tu pago aún se está procesando. Si ya pagaste, no vuelvas a pagar: esta página se actualizará al confirmarse."
        : undefined

    return NextResponse.redirect(paymentPageUrl(request, resolvedOrderId, message), {
      status: 303,
    })
  }

  return NextResponse.redirect(
    fallbackUrl(request, "Volviste sin completar el pago. Puedes reintentar desde tu carrito."),
    { status: 303 }
  )
}

// POST: respuesta del pago (payloadHttp + signature). Fuente primaria de
// confirmación en el flujo Web Core (el IPN es el respaldo).
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const body = Object.fromEntries(formData.entries())

  const payloadHttp =
    typeof body.payloadHttp === "string"
      ? body.payloadHttp
      : typeof body.payloadhttp === "string"
        ? body.payloadhttp
        : ""
  const signature =
    typeof body.signature === "string"
      ? body.signature
      : request.headers.get("signature") || ""
  const transactionId =
    typeof body.transactionId === "string"
      ? body.transactionId
      : request.headers.get("transactionId") || ""

  const parsed = parseIzipayPaymentResponse({
    ...body,
    payloadHttp,
    signature,
    transactionId,
  })

  if (!parsed || !parsed.orderNumber) {
    return NextResponse.redirect(
      fallbackUrl(request, "No se pudo interpretar la respuesta de Izipay."),
      { status: 303 }
    )
  }

  const isValid = verifyIzipayWebCoreSignature({
    code: parsed.code,
    payloadHttp: parsed.payloadHttp,
    signature,
  })
  if (!isValid) {
    console.error("[izipay/redirect-result] firma inválida o ausente", {
      orderNumber: parsed.orderNumber,
    })
    return NextResponse.redirect(
      fallbackUrl(request, "La firma de Izipay no es válida."),
      { status: 303 }
    )
  }

  const context = await resolveIzipayPaymentContext(parsed)
  if (!context.ok) {
    return NextResponse.redirect(
      fallbackUrl(request, "El pago no coincide con la orden esperada."),
      { status: 303 }
    )
  }
  const resolvedOrderId = context.orderId
  await recordIzipayPaymentEvent({
    source: "redirect",
    parsed,
    orderId: context.orderId,
    attemptId: context.attemptId,
    validSignature: true,
  })

  if (isIzipayPaymentApproved(parsed)) {
    await updateIzipayAttempt({
      attemptId: context.attemptId,
      status: "APPROVED",
      parsed,
    })
    const result = await fulfillPaidOrder({
      orderId: resolvedOrderId,
      provider: "IZIPAY",
      providerRef: parsed.transactionId,
      providerTransactionId: parsed.transactionId,
      providerResponse: sanitizeIzipayPaymentResult(parsed),
    })
    if (!result.success) {
      return NextResponse.redirect(
        paymentPageUrl(request, resolvedOrderId, result.error),
        { status: 303 }
      )
    }
    return NextResponse.redirect(paymentPageUrl(request, resolvedOrderId), {
      status: 303,
    })
  }

  if (context.attemptStatus === "APPROVED") {
    return NextResponse.redirect(
      paymentPageUrl(
        request,
        resolvedOrderId,
        "El pago aprobado requiere conciliación. No vuelvas a pagar."
      ),
      { status: 303 }
    )
  }

  // El código 021 es un error de comunicación transitorio, no un rechazo: la
  // orden puede terminar cobrada. Cancelarla liberaría los cupos de un pago que
  // sigue vivo, así que se deja PENDING y decide el IPN (o la expiración).
  if (!isIzipayCommunicationError(parsed.code)) {
    await failOrder({
      orderId: resolvedOrderId,
      providerResponse: sanitizeIzipayPaymentResult(parsed),
    })
    await updateIzipayAttempt({
      attemptId: context.attemptId,
      status: "REJECTED",
      parsed,
    })
  } else {
    await updateIzipayAttempt({
      attemptId: context.attemptId,
      status: "ERROR",
      parsed,
    })
  }

  return NextResponse.redirect(
    paymentPageUrl(
      request,
      resolvedOrderId,
      parsed.messageUser || parsed.message || "El pago no se completó."
    ),
    { status: 303 }
  )
}
