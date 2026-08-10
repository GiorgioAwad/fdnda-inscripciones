"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireClubUser } from "@/lib/auth"
import {
  checkoutCart,
  removeRegistrationFromCart,
  type ActionResult,
} from "@/lib/registrations"
import {
  assertPlanAccess,
  canAccessDiscipline,
  explicitDisciplineAccess,
} from "@/lib/club-access"
import { prisma } from "@/lib/prisma"

export async function removeFromCartAction(
  registrationId: string
): Promise<ActionResult> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
    const registration = await prisma.registration.findFirst({
      where: { id: registrationId, clubId: user.clubId },
      select: { planId: true, modality: { select: { discipline: true } } },
    })
    if (
      !registration ||
      !canAccessDiscipline(user, registration.modality.discipline)
    ) {
      throw new Error("No autorizado")
    }
    if (registration.planId) await assertPlanAccess(user, registration.planId)
  } catch {
    return { success: false, error: "No autorizado." }
  }

  const result = await removeRegistrationFromCart({
    clubId: user.clubId,
    registrationId,
  })
  if (result.success) {
    revalidatePath("/carrito")
    revalidatePath("/eventos", "layout")
  }
  return result
}

export async function checkoutAction(): Promise<ActionResult> {
  let clubId: string
  let userId: string
  let disciplineAccess
  try {
    const user = await requireClubUser()
    clubId = user.clubId
    userId = user.id
    disciplineAccess = explicitDisciplineAccess(user)
  } catch {
    return { success: false, error: "No autorizado." }
  }

  const result = await checkoutCart({ clubId, userId, disciplineAccess })

  if (!result.success || !result.orderId) {
    return { success: false, error: result.error }
  }

  revalidatePath("/carrito")
  redirect(`/pago/${result.orderId}`)
}
