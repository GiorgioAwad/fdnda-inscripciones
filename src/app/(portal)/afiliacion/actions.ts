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

// requireClubUser falla sin sesión, con un usuario que no es de club o con la
// contraseña temporal sin cambiar: en los tres casos la salida es volver a entrar.
const SESSION_ERROR =
  "Tu sesión expiró o no tiene acceso a este club. Vuelve a iniciar sesión."

// Todas las acciones toman el club de la sesión: el cliente nunca lo elige.
export async function addAffiliationsAction(input: {
  clubDisciplines?: DisciplineValue[]
  athletes?: AthleteAffiliationRequest[]
}): Promise<ActionResult & { added?: number }> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { success: false, error: SESSION_ERROR }
  }

  const requested = [
    ...(input.clubDisciplines ?? []),
    ...(input.athletes ?? []).map((row) => row.discipline),
  ]
  if (!requested.every((discipline) => canAccessDiscipline(user, discipline))) {
    return { success: false, error: "Tu usuario no tiene acceso a una de esas disciplinas." }
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
    return { success: false, error: SESSION_ERROR }
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
    return { success: false, error: "Tu usuario no tiene acceso a esa afiliación." }
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
    return { success: false, error: SESSION_ERROR }
  }

  const result = await checkoutAffiliationCart({ clubId, userId, disciplineAccess })

  if (!result.success || !result.orderId) {
    return { success: false, error: result.error }
  }

  revalidatePath("/afiliacion", "layout")
  redirect(`/pago/${result.orderId}`)
}
