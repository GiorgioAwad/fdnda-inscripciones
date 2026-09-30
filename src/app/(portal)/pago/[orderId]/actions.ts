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
    return { success: false, error: "El pago simulado está desactivado en este entorno." }
  }

  try {
    const order = await getOwnOrder(orderId)
    if (order.status !== "PENDING") {
      return {
        success: false,
        error: "Esta orden ya no está pendiente de pago. Recarga la página para ver su estado.",
      }
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
    return {
      success: false,
      error: "No pudimos abrir esta orden con tu sesión. Vuelve a iniciar sesión.",
    }
  }
}

export async function mockFailAction(orderId: string): Promise<ActionResult> {
  if (getPaymentsMode() !== "mock") {
    return { success: false, error: "El pago simulado está desactivado en este entorno." }
  }

  try {
    const order = await getOwnOrder(orderId)
    if (order.status !== "PENDING") {
      return {
        success: false,
        error: "Esta orden ya no está pendiente de pago. Recarga la página para ver su estado.",
      }
    }

    const result = await failOrder({
      orderId: order.id,
      providerResponse: { simulated: true, failed: true },
    })

    if (result.success) {
      revalidatePath(`/pago/${orderId}`)
      revalidatePath("/afiliacion/carrito")
    }
    return result
  } catch {
    return {
      success: false,
      error: "No pudimos abrir esta orden con tu sesión. Vuelve a iniciar sesión.",
    }
  }
}
