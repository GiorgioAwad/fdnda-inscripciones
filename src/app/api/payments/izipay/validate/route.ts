import { NextRequest, NextResponse } from "next/server"
import {
  getPaymentsMode,
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

// Confirmación del checkout en pop-up. El SDK devuelve el resultado por
// callbackResponse en el navegador (no hay POST de retorno como en redirect),
// así que esta ruta es la vía primaria; el IPN sigue siendo el respaldo.
//
// La autorización es la firma HMAC: solo Izipay puede producirla con nuestra
// hash key, igual que en /webhook y /redirect-result. Reenviar un payload ya
// visto no hace daño porque fulfillPaidOrder es idempotente.
export async function POST(request: NextRequest) {
  try {
    if (getPaymentsMode() !== "izipay") {
      return NextResponse.json(
        { success: false, error: "Ruta no disponible" },
        { status: 404 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const rawResult =
      typeof body.paymentResult === "object" && body.paymentResult !== null
        ? (body.paymentResult as Record<string, unknown>)
        : body

    const parsed = parseIzipayPaymentResponse(rawResult)
    if (!parsed || !parsed.orderNumber) {
      return NextResponse.json(
        { success: false, error: "No se pudo interpretar la respuesta de Izipay" },
        { status: 400 }
      )
    }

    const isValid = verifyIzipayWebCoreSignature({
      code: parsed.code,
      payloadHttp: parsed.payloadHttp,
      signature: parsed.signature,
    })
    if (!isValid) {
      console.error("[izipay/validate] firma inválida", {
        orderNumber: parsed.orderNumber,
      })
      return NextResponse.json(
        { success: false, error: "La firma de Izipay no es válida" },
        { status: 401 }
      )
    }

    const context = await resolveIzipayPaymentContext(parsed)
    if (!context.ok) {
      console.error("[izipay/validate] correlación inválida", {
        orderNumber: parsed.orderNumber,
        reason: context.error,
      })
      return NextResponse.json(
        { success: false, error: "El pago no coincide con la orden esperada" },
        { status: 409 }
      )
    }
    const { orderId, attemptId } = context
    await recordIzipayPaymentEvent({
      source: "validate",
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
        return NextResponse.json(
          { success: false, error: result.error || "No se pudo confirmar la orden" },
          { status: 500 }
        )
      }
      return NextResponse.json({
        success: true,
        data: { orderId, status: "PAID" },
      })
    }

    // Rechazo o error de comunicación: la orden se deja PENDING a propósito.
    // En pop-up el club no salió del portal y lo natural es reintentar con otra
    // tarjeta; marcarla FAILED devolvería la planilla a borrador y liberaría sus
    // cupos por un simple «fondos insuficientes». Si abandona, expira sola a los
    // 30 minutos.
    console.warn("[izipay/validate] pago no aprobado", {
      orderId,
      code: parsed.code,
    })
    await updateIzipayAttempt({
      attemptId,
      status: isIzipayCommunicationError(parsed.code) ? "ERROR" : "REJECTED",
      parsed,
    })

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        status: isIzipayCommunicationError(parsed.code) ? "PENDING" : "REJECTED",
        message: parsed.messageUser || parsed.message || null,
      },
    })
  } catch (error) {
    console.error("[izipay/validate] error", error)
    return NextResponse.json(
      { success: false, error: "Error al validar el pago" },
      { status: 500 }
    )
  }
}
