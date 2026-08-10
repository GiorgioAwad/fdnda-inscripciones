"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireClubUser } from "@/lib/auth"
import { getPaymentsMode } from "@/lib/izipay"
import { failOrder, fulfillPaidOrder, type ActionResult } from "@/lib/orders"
import { assertOrderAccess } from "@/lib/club-access"

async function getOwnOrder(orderId: string) {
  const user = await requireClubUser()
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order || order.clubId !== user.clubId) {
    throw new Error("Orden no encontrada")
  }
  await assertOrderAccess(user, order.id)
  return order
}

export async function mockPayAction(orderId: string): Promise<ActionResult> {
  if (getPaymentsMode() !== "mock") {
    return { success: false, error: "Pagos simulados deshabilitados." }
  }

  try {
    const order = await getOwnOrder(orderId)
    if (order.status !== "PENDING") {
      return { success: false, error: "La orden ya no está pendiente." }
    }

    const result = await fulfillPaidOrder({
      orderId: order.id,
      provider: "MOCK",
      providerRef: `MOCK-${Date.now()}`,
      providerResponse: { simulated: true },
    })

    if (result.success) {
      revalidatePath(`/pago/${orderId}`)
      revalidatePath("/mis-inscripciones")
    }
    return result
  } catch {
    return { success: false, error: "No autorizado." }
  }
}

export async function mockFailAction(orderId: string): Promise<ActionResult> {
  if (getPaymentsMode() !== "mock") {
    return { success: false, error: "Pagos simulados deshabilitados." }
  }

  try {
    const order = await getOwnOrder(orderId)
    if (order.status !== "PENDING") {
      return { success: false, error: "La orden ya no está pendiente." }
    }

    const result = await failOrder({
      orderId: order.id,
      providerResponse: { simulated: true, failed: true },
    })

    if (result.success) {
      revalidatePath(`/pago/${orderId}`)
      revalidatePath("/carrito")
    }
    return result
  } catch {
    return { success: false, error: "No autorizado." }
  }
}
