import type { Discipline, Prisma } from "@prisma/client"
import type { DisciplineValue } from "./disciplines"
import { prisma } from "./prisma"

export interface DisciplineScopedUser {
  disciplineAccess: readonly Discipline[]
}

/** Un array vacío representa al coordinador general del club. */
export function isClubCoordinator(user: DisciplineScopedUser): boolean {
  return user.disciplineAccess.length === 0
}

export function explicitDisciplineAccess(
  user: DisciplineScopedUser
): DisciplineValue[] | undefined {
  return isClubCoordinator(user)
    ? undefined
    : ([...user.disciplineAccess] as DisciplineValue[])
}

export function canAccessDiscipline(
  user: DisciplineScopedUser,
  discipline: string
): boolean {
  return (
    isClubCoordinator(user) ||
    user.disciplineAccess.some((allowed) => allowed === discipline)
  )
}

export function assertDisciplineAccess(
  user: DisciplineScopedUser,
  discipline: string
): void {
  if (!canAccessDiscipline(user, discipline)) {
    throw new Error("No autorizado para esta disciplina")
  }
}

export function visibleDisciplines(
  user: DisciplineScopedUser,
  disciplines: readonly DisciplineValue[]
): DisciplineValue[] {
  return isClubCoordinator(user)
    ? [...disciplines]
    : disciplines.filter((discipline) => canAccessDiscipline(user, discipline))
}

export function disciplineArrayWhere(user: DisciplineScopedUser) {
  return isClubCoordinator(user)
    ? {}
    : { disciplines: { hasSome: [...user.disciplineAccess] } }
}

export function disciplineInWhere(user: DisciplineScopedUser) {
  return isClubCoordinator(user)
    ? {}
    : { discipline: { in: [...user.disciplineAccess] } }
}

interface ClubActor extends DisciplineScopedUser {
  id: string
  clubId: string
}

export async function assertEventAccess(user: ClubActor, eventId: string) {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      ...(isClubCoordinator(user)
        ? {}
        : { disciplines: { hasSome: [...user.disciplineAccess] } }),
    },
    select: { id: true },
  })
  if (!event) throw new Error("No autorizado para esta competencia")
}

export async function assertPlanAccess(user: ClubActor, planId: string) {
  const plan = await prisma.registrationPlan.findFirst({
    where: {
      id: planId,
      clubId: user.clubId,
      ...(isClubCoordinator(user)
        ? {}
        : { disciplineScope: { in: [...user.disciplineAccess] } }),
    },
    select: { id: true },
  })
  if (!plan) throw new Error("No autorizado para esta planilla")
}

export async function assertModalityAccess(user: ClubActor, modalityId: string) {
  const modality = await prisma.eventModality.findFirst({
    where: {
      id: modalityId,
      ...(isClubCoordinator(user)
        ? {}
        : { discipline: { in: [...user.disciplineAccess] } }),
    },
    select: { id: true },
  })
  if (!modality) throw new Error("No autorizado para esta prueba")
}

export async function assertAthletesAccess(user: ClubActor, athleteIds: string[]) {
  if (isClubCoordinator(user) || athleteIds.length === 0) return
  const uniqueIds = [...new Set(athleteIds)]
  const count = await prisma.athlete.count({
    where: {
      id: { in: uniqueIds },
      clubId: user.clubId,
      isActive: true,
      disciplines: { hasSome: [...user.disciplineAccess] },
    },
  })
  if (count !== uniqueIds.length) {
    throw new Error("No autorizado para uno o más deportistas")
  }
}

export function orderAccessWhere(user: DisciplineScopedUser): Prisma.OrderWhereInput {
  if (isClubCoordinator(user)) return {}
  const allowed = [...user.disciplineAccess]
  return {
    OR: [
      {
        kind: "REGISTRATION",
        registrationPlan: { disciplineScope: { in: allowed } },
      },
      {
        kind: "AFFILIATION",
        items: {
          every: {
            OR: [
              { clubAffiliation: { discipline: { in: allowed } } },
              { athleteAffiliation: { discipline: { in: allowed } } },
            ],
          },
        },
      },
    ],
  }
}

export async function assertOrderAccess(user: ClubActor, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, clubId: user.clubId, ...orderAccessWhere(user) },
    select: { id: true },
  })
  if (!order) throw new Error("No autorizado para esta orden")
}
