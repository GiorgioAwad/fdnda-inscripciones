import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import {
  buildIzipayOrderNumber,
  sanitizeIzipayPaymentResult,
  type ParsedIzipayPaymentResult,
} from "./izipay"

export async function storeIzipayOrderCorrelation(input: {
  orderId: string
  providerOrderNumber: string
  providerTransactionId: string
  amount: unknown
  currency: string
}): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.create({
      data: {
        orderId: input.orderId,
        provider: "IZIPAY",
        providerOrderNumber: input.providerOrderNumber,
        providerTransactionId: input.providerTransactionId,
        amount: new Prisma.Decimal(String(input.amount)),
        currency: input.currency,
      },
      select: { id: true },
    })
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        provider: "IZIPAY",
        providerOrderNumber: input.providerOrderNumber,
        providerTransactionId: input.providerTransactionId,
      },
    })
    return attempt.id
  })
}

export async function markIzipayAttemptSessionResult(input: {
  attemptId: string
  ready: boolean
  providerResponse?: unknown
}) {
  await prisma.paymentAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: input.ready ? "SESSION_READY" : "ERROR",
      providerResponse: input.providerResponse
        ? JSON.parse(JSON.stringify(input.providerResponse))
        : undefined,
    },
  })
}

// Uso exclusivo de navegación/consulta visual. Las confirmaciones de pago deben
// usar resolveIzipayPaymentContext, que exige transactionId y monto coincidente.
export async function resolveIzipayOrderId(orderRef: string): Promise<string | null> {
  if (!orderRef) return null
  const direct = await prisma.order.findUnique({
    where: { id: orderRef },
    select: { id: true },
  })
  if (direct) return direct.id

  const attempt = await prisma.paymentAttempt.findFirst({
    where: { provider: "IZIPAY", providerOrderNumber: orderRef },
    select: { orderId: true },
    orderBy: { createdAt: "desc" },
  })
  if (attempt) return attempt.orderId

  // Compatibilidad de lectura para órdenes anteriores a PaymentAttempt.
  const candidates = await prisma.order.findMany({
    where: { status: "PENDING", provider: "IZIPAY" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  return candidates.find((candidate) => buildIzipayOrderNumber(candidate.id) === orderRef)
    ?.id ?? null
}

function cents(value: unknown): number | null {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number * 100)
}

export async function resolveIzipayPaymentContext(
  parsed: ParsedIzipayPaymentResult
): Promise<
  | {
      ok: true
      orderId: string
      attemptId: string
      attemptStatus: "CREATED" | "SESSION_READY" | "APPROVED" | "REJECTED" | "ERROR"
      orderStatus: "PENDING" | "PAID" | "FAILED" | "CANCELLED"
    }
  | { ok: false; error: string }
> {
  if (!parsed.transactionId || !parsed.orderNumber) {
    return { ok: false, error: "Faltan identificadores de la transacción" }
  }

  const attempt = await prisma.paymentAttempt.findUnique({
    where: {
      provider_providerTransactionId: {
        provider: "IZIPAY",
        providerTransactionId: parsed.transactionId,
      },
    },
    include: {
      order: { select: { id: true, status: true, totalAmount: true, currency: true } },
    },
  })
  if (!attempt) return { ok: false, error: "Intento de pago no reconocido" }
  if (attempt.providerOrderNumber !== parsed.orderNumber) {
    return { ok: false, error: "La referencia no corresponde al intento de pago" }
  }

  const receivedCents = cents(parsed.amount)
  const attemptCents = cents(attempt.amount)
  const orderCents = cents(attempt.order.totalAmount)
  if (
    receivedCents === null ||
    attemptCents === null ||
    orderCents === null ||
    receivedCents !== attemptCents ||
    receivedCents !== orderCents
  ) {
    return { ok: false, error: "El monto recibido no coincide con la orden" }
  }

  if (
    !parsed.currency ||
    parsed.currency !== attempt.currency ||
    parsed.currency !== attempt.order.currency
  ) {
    return { ok: false, error: "La moneda recibida no coincide con la orden" }
  }

  return {
    ok: true,
    orderId: attempt.order.id,
    attemptId: attempt.id,
    attemptStatus: attempt.status,
    orderStatus: attempt.order.status,
  }
}

export async function recordIzipayPaymentEvent(input: {
  source: "validate" | "webhook" | "redirect"
  parsed: ParsedIzipayPaymentResult
  orderId: string
  attemptId: string
  validSignature: boolean
}): Promise<{ duplicate: boolean }> {
  const eventKey = crypto
    .createHash("sha256")
    .update(
      [
        input.source,
        input.parsed.transactionId || "",
        input.parsed.code,
        input.parsed.signature || "",
      ].join(":"),
      "utf8"
    )
    .digest("hex")

  try {
    await prisma.paymentEvent.create({
      data: {
        orderId: input.orderId,
        attemptId: input.attemptId,
        provider: "IZIPAY",
        eventKey,
        eventType: `${input.source}:${input.parsed.code || "UNKNOWN"}`,
        providerTransactionId: input.parsed.transactionId,
        validSignature: input.validSignature,
        amount:
          input.parsed.amount === undefined
            ? undefined
            : new Prisma.Decimal(String(input.parsed.amount)),
        currency: input.parsed.currency,
        payload: sanitizeIzipayPaymentResult(input.parsed),
      },
    })
    return { duplicate: false }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { duplicate: true }
    }
    throw error
  }
}

export async function updateIzipayAttempt(input: {
  attemptId: string
  status: "APPROVED" | "REJECTED" | "ERROR"
  parsed: ParsedIzipayPaymentResult
}) {
  await prisma.paymentAttempt.updateMany({
    where: {
      id: input.attemptId,
      ...(input.status === "APPROVED" ? {} : { status: { not: "APPROVED" } }),
    },
    data: {
      status: input.status,
      providerResponse: sanitizeIzipayPaymentResult(input.parsed),
    },
  })
}
