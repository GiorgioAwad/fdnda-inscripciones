import type { Discipline, Prisma } from "@prisma/client"
import {
  getClubEligibleDisciplines,
  type ClubEligibleDisciplines,
} from "./affiliations"
import type { DisciplineValue } from "./disciplines"

// Un club solo debería ver el calendario de las disciplinas en las que compite.
// Antes veía todas las convocatorias abiertas y recién al pagar se enteraba de
// que no estaba afiliado a esa disciplina; ahora el filtro se aplica en el
// listado y también como guard de servidor al fijar la competencia de un plan.
//
// Se expone un constructor de `where` en vez de un findMany envuelto para que
// cada pantalla componga su propio include/select y conserve la inferencia de
// tipos de Prisma.

export type ClubEventScope = ClubEligibleDisciplines

export interface ClubEventFilters {
  /** Solo eventos con inscripción abierta. */
  requireOpen?: boolean
  /** Solo eventos cuyo plazo de inscripción sigue vigente. */
  requireFutureDeadline?: boolean
  /** Solo eventos con temporada asignada (las planillas la necesitan). */
  requireSeason?: boolean
  now?: Date
}

/**
 * Disciplinas del club y por qué su calendario podría venir vacío. Reexporta
 * getClubEligibleDisciplines para que las páginas no dependan del módulo de
 * afiliaciones solo por esto.
 */
export function getClubEventScope(
  clubId: string,
  disciplineAccess?: readonly DisciplineValue[]
): Promise<ClubEventScope> {
  return getClubEligibleDisciplines(clubId, { disciplineAccess })
}

/**
 * Filtro de eventos visibles para un club.
 *
 * Ojo: con `disciplines` vacío devuelve `hasSome: []`, que en Postgres no
 * coincide con ninguna fila. Es el comportamiento correcto —un club sin
 * afiliaciones no ve convocatorias— pero conviene cortar antes en la página
 * para ahorrarse la consulta y poder mostrar el mensaje que lleva a afiliarse.
 */
export function clubEventWhere(
  disciplines: readonly DisciplineValue[],
  filters: ClubEventFilters = {}
): Prisma.EventWhereInput {
  const now = filters.now ?? new Date()
  return {
    disciplines: { hasSome: [...disciplines] },
    ...(filters.requireOpen ? { status: "OPEN" } : {}),
    ...(filters.requireFutureDeadline
      ? { registrationDeadline: { gte: now } }
      : {}),
    ...(filters.requireSeason ? { seasonId: { not: null } } : {}),
  }
}

/**
 * ¿El club puede inscribirse en este evento? Guard de servidor para las rutas
 * que reciben un evento por id/slug en vez de elegirlo de la lista ya filtrada.
 */
export async function clubMayEnterEvent(
  clubId: string,
  eventDisciplines: readonly string[],
  disciplineAccess?: readonly DisciplineValue[]
): Promise<boolean> {
  const { disciplines } = await getClubEligibleDisciplines(clubId, {
    disciplineAccess,
  })
  return disciplines.some((discipline) => eventDisciplines.includes(discipline))
}

/**
 * Igual que clubMayEnterEvent pero dentro de una transacción en curso, para que
 * el guard lea el mismo snapshot que el resto de la mutación.
 *
 * Usa la temporada vigente, no la del evento, para coincidir exactamente con lo
 * que el club vio en el listado. La comprobación estricta por temporada del
 * evento sigue estando en plan-validation (CLUB_AFFILIATION_REQUIRED).
 */
export async function clubMayEnterEventInTransaction(
  tx: Prisma.TransactionClient,
  clubId: string,
  eventDisciplines: readonly Discipline[]
): Promise<boolean> {
  const season = await tx.season.findFirst({
    where: { isCurrent: true },
    orderBy: { year: "desc" },
    select: { id: true },
  })
  if (!season) return false

  const matches = await tx.clubAffiliation.count({
    where: {
      clubId,
      seasonId: season.id,
      status: { in: ["ACTIVE", "PENDING"] },
      discipline: { in: [...eventDisciplines] },
    },
  })
  return matches > 0
}
