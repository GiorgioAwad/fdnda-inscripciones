"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { Discipline } from "@prisma/client"
import { requireClubUser } from "@/lib/auth"
import { assertPlanAccess, canAccessDiscipline } from "@/lib/club-access"
import { DISCIPLINE_VALUES } from "@/lib/disciplines"
import { deleteEventOfficial, saveEventOfficial } from "@/lib/event-officials"
import { prisma } from "@/lib/prisma"
import type { OfficialView } from "./types"

// Delegados y entrenadores: no dependen de la revisión de la planilla (van por
// club + competencia + disciplina), así que no pasan por la cola de
// autoguardado. La planilla solo sirve para saber de qué competencia se trata
// y comprobar que el usuario puede tocarla.

type OfficialActionResult =
  | { success: true; official: OfficialView }
  | { success: false; error: string }

const id = z.string().trim().min(1).max(100)

const DENIED = {
  success: false as const,
  error: "Tu usuario de acceso no puede nombrar delegados ni entrenadores en esta disciplina.",
}

async function planEventFor(planId: string, discipline: Discipline) {
  const user = await requireClubUser()
  try {
    await assertPlanAccess(user, planId)
  } catch {
    return null
  }
  if (!canAccessDiscipline(user, discipline)) return null
  const plan = await prisma.registrationPlan.findFirst({
    where: { id: planId, clubId: user.clubId },
    select: { eventId: true, disciplineScope: true },
  })
  if (!plan?.eventId) return null
  if (plan.disciplineScope && plan.disciplineScope !== discipline) return null
  return { clubId: user.clubId, eventId: plan.eventId }
}

const saveSchema = z.object({
  planId: id,
  discipline: z.enum(DISCIPLINE_VALUES),
  role: z.enum(["DELEGATE", "COACH"]),
  officialId: id.optional(),
  firstNames: z.string().max(200),
  lastNames: z.string().max(200),
  docType: z.string().max(20),
  docNumber: z.string().max(40),
})

export async function saveOfficialAction(
  input: z.input<typeof saveSchema>
): Promise<OfficialActionResult> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "Revisa los datos e inténtalo de nuevo." }
  }
  const { planId, discipline, role, officialId, ...person } = parsed.data
  const scope = await planEventFor(planId, discipline as Discipline)
  if (!scope) return DENIED
  const result = await saveEventOfficial({
    ...scope,
    discipline: discipline as Discipline,
    role,
    officialId,
    person: person as Parameters<typeof saveEventOfficial>[0]["person"],
  })
  if (!result.success) return result
  revalidatePath(`/inscripciones/${planId}`)
  revalidatePath(`/inscripciones/${planId}/resumen`)
  const official = result.official
  return {
    success: true,
    official: {
      id: official.id,
      discipline: official.discipline,
      role: official.role,
      firstNames: official.firstNames,
      lastNames: official.lastNames,
      docType: official.docType,
      docNumber: official.docNumber,
    },
  }
}

const deleteSchema = z.object({
  planId: id,
  discipline: z.enum(DISCIPLINE_VALUES),
  officialId: id,
})

export async function deleteOfficialAction(
  input: z.input<typeof deleteSchema>
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = deleteSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "No pudimos procesar el cambio. Recarga la página." }
  }
  const scope = await planEventFor(parsed.data.planId, parsed.data.discipline as Discipline)
  if (!scope) return DENIED
  const result = await deleteEventOfficial({
    ...scope,
    discipline: parsed.data.discipline as Discipline,
    officialId: parsed.data.officialId,
  })
  if (result.success) {
    revalidatePath(`/inscripciones/${parsed.data.planId}`)
    revalidatePath(`/inscripciones/${parsed.data.planId}/resumen`)
  }
  return result
}
