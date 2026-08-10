"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireClubUser } from "@/lib/auth"
import {
  addAffiliationsToCart,
  checkoutAffiliationCart,
  removeAffiliationFromCart,
  type AthleteAffiliationRequest,
} from "@/lib/affiliations"
import type { DisciplineValue } from "@/lib/disciplines"
import type { ActionResult } from "@/lib/orders"
import { canAccessDiscipline, explicitDisciplineAccess } from "@/lib/club-access"
import { prisma } from "@/lib/prisma"

export type { ActionResult } from "@/lib/orders"

// Todas las acciones toman el club de la sesión: el cliente nunca lo elige.
export async function addAffiliationsAction(input: {
  clubDisciplines?: DisciplineValue[]
  athletes?: AthleteAffiliationRequest[]
}): Promise<ActionResult & { added?: number }> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { success: false, error: "No autorizado." }
  }

  const requested = [
    ...(input.clubDisciplines ?? []),
    ...(input.athletes ?? []).map((row) => row.discipline),
  ]
  if (!requested.every((discipline) => canAccessDiscipline(user, discipline))) {
    return { success: false, error: "No autorizado para una de las disciplinas." }
  }
  const result = await addAffiliationsToCart({ ...input, clubId: user.clubId })

  if (result.success) {
    revalidatePath("/afiliacion", "layout")
    revalidatePath("/deportistas")
    revalidatePath("/inicio")
  }
  return result
}

export async function removeAffiliationAction(input: {
  kind: "CLUB" | "ATHLETE"
  affiliationId: string
}): Promise<ActionResult> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { success: false, error: "No autorizado." }
  }

  const affiliation =
    input.kind === "CLUB"
      ? await prisma.clubAffiliation.findFirst({
          where: { id: input.affiliationId, clubId: user.clubId },
          select: { discipline: true },
        })
      : await prisma.athleteAffiliation.findFirst({
          where: { id: input.affiliationId, clubId: user.clubId },
          select: { discipline: true },
        })
  if (!affiliation || !canAccessDiscipline(user, affiliation.discipline)) {
    return { success: false, error: "No autorizado para esta afiliación." }
  }
  const result = await removeAffiliationFromCart({ ...input, clubId: user.clubId })

  if (result.success) {
    revalidatePath("/afiliacion", "layout")
    revalidatePath("/deportistas")
    revalidatePath("/inicio")
  }
  return result
}

export async function checkoutAffiliationAction(): Promise<ActionResult> {
  let clubId: string
  let userId: string
  let disciplineAccess: DisciplineValue[] | undefined
  try {
    const user = await requireClubUser()
    clubId = user.clubId
    userId = user.id
    disciplineAccess = explicitDisciplineAccess(user)
  } catch {
    return { success: false, error: "No autorizado." }
  }

  const result = await checkoutAffiliationCart({ clubId, userId, disciplineAccess })

  if (!result.success || !result.orderId) {
    return { success: false, error: result.error }
  }

  revalidatePath("/afiliacion", "layout")
  redirect(`/pago/${result.orderId}`)
}
