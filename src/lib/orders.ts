import { prisma } from "./prisma"

// Ciclo de vida de las órdenes, común a los dos carritos (inscripciones y
// afiliaciones). Vive aparte de registrations.ts/affiliations.ts para que ambos
// puedan usarlo sin importarse entre sí.

export const ORDER_EXPIRATION_MINUTES = 30

export interface ActionResult {
  success: boolean
  error?: string
}

class PaymentRequiresReviewError extends Error {}

// Confirma una orden pagada y lo que cubre. Idempotente: si la orden ya está
// PAID no hace nada (webhook + redirect-result pueden llegar ambos).
export async function fulfillPaidOrder(input: {
  orderId: string
  provider: string
  providerRef?: string
  providerTransactionId?: string
  providerResponse?: unknown
}): Promise<ActionResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const paidAt = new Date()
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { registrationPlanId: true, status: true },
      })
      if (!order) throw new Error("Orden no encontrada")
      if (order.status === "PAID") return
      if (order.status !== "PENDING") {
        throw new PaymentRequiresReviewError(
          `Pago confirmado para orden ${input.orderId} en estado ${order.status}`
        )
      }

      const updated = await tx.order.updateMany({
        where: { id: input.orderId, status: "PENDING" },
        data: {
          status: "PAID",
          paidAt,
          provider: input.provider,
          providerRef: input.providerRef,
          providerTransactionId: input.providerTransactionId,
          providerResponse: input.providerResponse
            ? JSON.parse(JSON.stringify(input.providerResponse))
            : undefined,
        },
      })

      if (updated.count === 0) {
        const current = await tx.order.findUnique({
          where: { id: input.orderId },
          select: { status: true },
        })
        if (current?.status === "PAID") return
        throw new PaymentRequiresReviewError(
          `La orden ${input.orderId} cambió mientras se confirmaba el pago`
        )
      }

      await tx.registration.updateMany({
        where: { activeOrderId: input.orderId, status: "PENDING_PAYMENT" },
        data: { status: "PAID" },
      })

      // Cuotas fijas por deportista: quedan pagadas para TODO el evento, así
      // que una planilla suplementaria del mismo deportista ya no las cobra.
      await tx.eventAthleteFee.updateMany({
        where: { activeOrderId: input.orderId, status: "PENDING_PAYMENT" },
        data: { status: "PAID" },
      })

      if (order?.registrationPlanId) {
        await tx.registrationPlan.updateMany({
          where: {
            id: order.registrationPlanId,
            status: "AWAITING_PAYMENT",
          },
          data: {
            status: "PAID",
            revision: { increment: 1 },
            currentStep: 4,
          },
        })
      }

      await tx.clubAffiliation.updateMany({
        where: { activeOrderId: input.orderId, status: "PENDING" },
        data: { status: "ACTIVE", paidAt },
      })

      await tx.athleteAffiliation.updateMany({
        where: { activeOrderId: input.orderId, status: "PENDING" },
        data: { status: "ACTIVE", paidAt },
      })
    })

    return { success: true }
  } catch (error) {
    console.error("fulfillPaidOrder error:", error)
    if (error instanceof PaymentRequiresReviewError) {
      return {
        success: false,
        error:
          "El pago fue recibido pero la orden requiere conciliación manual. No vuelvas a pagar.",
      }
    }
    return { success: false, error: "No se pudo confirmar la orden." }
  }
}

export async function failOrder(input: {
  orderId: string
  providerResponse?: unknown
}): Promise<ActionResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { registrationPlanId: true },
      })
      const updated = await tx.order.updateMany({
        where: { id: input.orderId, status: "PENDING" },
        data: {
          status: "FAILED",
          providerResponse: input.providerResponse
            ? JSON.parse(JSON.stringify(input.providerResponse))
            : undefined,
        },
      })

      if (updated.count > 0) {
        await releaseOrderContents(
          tx,
          input.orderId,
          order?.registrationPlanId ?? null
        )
      }
    })
    return { success: true }
  } catch (error) {
    console.error("failOrder error:", error)
    return { success: false, error: "No se pudo actualizar la orden." }
  }
}

// Expiración perezosa: se invoca desde las páginas de carrito/pago/admin.
// Órdenes PENDING vencidas pasan a CANCELLED y lo que cubrían vuelve al carrito.
export async function expireStaleOrders(): Promise<number> {
  const stale = await prisma.order.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
      // Si ya se abrió una sesión, un callback/IPN podría estar retrasado.
      // Esas órdenes quedan reservadas para conciliación en vez de liberar algo
      // que Izipay pudo haber cobrado.
      paymentAttempts: {
        none: { status: { in: ["CREATED", "SESSION_READY", "APPROVED", "ERROR"] } },
      },
    },
    select: { id: true, registrationPlanId: true },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 100,
  })

  let expired = 0
  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      })
      if (updated.count > 0) {
        await releaseOrderContents(tx, order.id, order.registrationPlanId)
        expired += 1
      }
    })
  }

  return expired
}

export async function countOrdersRequiringPaymentReview(): Promise<number> {
  return prisma.order.count({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
      paymentAttempts: {
        some: { status: { in: ["CREATED", "SESSION_READY", "APPROVED", "ERROR"] } },
      },
    },
  })
}

// Devuelve al carrito todo lo que cubría una orden que no prosperó. Las
// afiliaciones siguen PENDING (nunca llegaron a pagarse): basta con soltarlas.
type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

async function releaseOrderContents(
  tx: TransactionClient,
  orderId: string,
  registrationPlanId: string | null
) {
  await tx.registration.updateMany({
    where: { activeOrderId: orderId, status: "PENDING_PAYMENT" },
    data: { status: "IN_CART", activeOrderId: null },
  })

  // Las cuotas se liberan igual que las formaciones: vuelven a IN_CART y sueltan
  // la orden. No se borran porque el OrderItem de la orden fallida las apunta y
  // quedaría sin destino, rompiendo la invariante de "exactamente uno". El
  // checkout reutiliza la fila liberada mediante upsert sobre su único.
  await tx.eventAthleteFee.updateMany({
    where: { activeOrderId: orderId, status: "PENDING_PAYMENT" },
    data: { status: "IN_CART", activeOrderId: null },
  })

  await tx.clubAffiliation.updateMany({
    where: { activeOrderId: orderId, status: "PENDING" },
    data: { activeOrderId: null },
  })

  await tx.athleteAffiliation.updateMany({
    where: { activeOrderId: orderId, status: "PENDING" },
    data: { activeOrderId: null },
  })

  if (registrationPlanId) {
    await tx.registrationPlan.updateMany({
      where: { id: registrationPlanId, status: "AWAITING_PAYMENT" },
      data: { status: "DRAFT", revision: { increment: 1 } },
    })
  }
}
