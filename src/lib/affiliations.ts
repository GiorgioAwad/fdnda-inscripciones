import { prisma } from "./prisma"
import {
  DISCIPLINE_VALUES,
  disciplineLabel,
  isDiscipline,
  sortDisciplines,
  type DisciplineValue,
} from "./disciplines"
import {
  expireStaleOrders,
  ORDER_EXPIRATION_MINUTES,
  type ActionResult,
} from "./orders"
import { formatDateOnly, shortCode, toAmount } from "./utils"

// Afiliación anual POR DISCIPLINA: cada disciplina tiene su tarifa (SeasonFee) y
// su propia afiliación, así que un club puede estar al día en polo y no en
// clavados, y un deportista que hace dos deportes paga dos cuotas.
// El carrito de afiliaciones es independiente del de inscripciones; una
// afiliación PENDING sin activeOrderId está "en el carrito".

// Días antes del vencimiento en los que una afiliación se marca "por vencer".
export const EXPIRING_SOON_DAYS = 30

export type AffiliationState =
  | "ACTIVA"
  | "POR_VENCER"
  | "PENDIENTE"
  | "VENCIDA"
  | "SIN_AFILIAR"

export interface AffiliationLike {
  status: "PENDING" | "ACTIVE"
  validTo: Date
  activeOrderId: string | null
}

// Día calendario actual en Lima, como Date UTC a medianoche, para comparar
// contra los campos @db.Date sin que el huso corra el día.
export function todayInLima(now: Date = new Date()): Date {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.round((date.getTime() - todayInLima(now).getTime()) / 86_400_000)
}

// "Vencida" no se guarda en la base: se deriva de validTo. Así no hace falta un
// job que recorra la tabla cada noche.
export function affiliationState(
  affiliation: AffiliationLike | null | undefined,
  now: Date = new Date()
): AffiliationState {
  if (!affiliation) return "SIN_AFILIAR"

  const expired = todayInLima(now) > affiliation.validTo

  if (affiliation.status === "PENDING") {
    // El plazo se cerró sin pagarse: ya no sirve de nada.
    return expired ? "VENCIDA" : "PENDIENTE"
  }

  if (expired) return "VENCIDA"

  return daysUntil(affiliation.validTo, now) <= EXPIRING_SOON_DAYS
    ? "POR_VENCER"
    : "ACTIVA"
}

export function isAffiliationValid(
  affiliation: AffiliationLike | null | undefined,
  now: Date = new Date()
): boolean {
  const state = affiliationState(affiliation, now)
  return state === "ACTIVA" || state === "POR_VENCER"
}

// Para una inscripción no alcanza con estar al día hoy: la afiliación debe
// cubrir el evento completo. Se mantiene separada de affiliationState porque
// los paneles siguen mostrando el estado respecto del día actual.
export function isAffiliationValidForRange(
  affiliation:
    | (AffiliationLike & { validFrom: Date })
    | null
    | undefined,
  from: Date,
  to: Date
): boolean {
  return Boolean(
    affiliation?.status === "ACTIVE" &&
      affiliation.validFrom <= from &&
      affiliation.validTo >= to
  )
}

// Estados que habilitan a competir; el resto obliga a regularizar.
export function isSettledState(state: AffiliationState): boolean {
  return state === "ACTIVA" || state === "POR_VENCER"
}

// Normaliza el Discipline[] de Prisma al union tipado y en orden estable.
export function athleteDisciplines(disciplines: readonly string[]): DisciplineValue[] {
  return sortDisciplines(disciplines)
}

// ==================== TEMPORADA Y TARIFARIO ====================

export async function getCurrentSeason() {
  return prisma.season.findFirst({
    where: { isCurrent: true },
    orderBy: { year: "desc" },
  })
}

export async function getSeasonCategories(seasonId: string) {
  return prisma.category.findMany({
    where: { seasonId },
    orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
  })
}

export interface DisciplineFee {
  clubFee: number
  athleteFee: number
}

// Tarifario de la temporada. Una disciplina sin fila NO se afilia ese año: la
// federación todavía no le puso precio.
export async function getSeasonFees(
  seasonId: string
): Promise<Map<DisciplineValue, DisciplineFee>> {
  const rows = await prisma.seasonFee.findMany({ where: { seasonId } })
  const fees = new Map<DisciplineValue, DisciplineFee>()
  for (const row of rows) {
    if (!isDiscipline(row.discipline)) continue
    fees.set(row.discipline, {
      clubFee: toAmount(row.clubFee),
      athleteFee: toAmount(row.athleteFee),
    })
  }
  return fees
}

// ==================== ELEGIBILIDAD PARA INSCRIBIR ====================

export interface RegistrationEligibility {
  clubIsAffiliated: boolean
  clubReason: string
  affiliatedAthleteIds: Set<string>
  seasonName: string | null
}

// Insumo del bloqueo duro: para inscribir en una prueba de X, el club debe tener
// la afiliación de X vigente y cada deportista la suya, también en X.
export async function getRegistrationEligibility(
  clubId: string,
  discipline: DisciplineValue,
  options?: {
    seasonId?: string | null
    validFrom?: Date
    validTo?: Date
  }
): Promise<RegistrationEligibility> {
  const season = options?.seasonId
    ? await prisma.season.findUnique({ where: { id: options.seasonId } })
    : await getCurrentSeason()

  if (!season) {
    return {
      clubIsAffiliated: false,
      clubReason:
        "La federación aún no habilitó la temporada de afiliaciones. Comunícate con la FDNDA.",
      affiliatedAthleteIds: new Set(),
      seasonName: null,
    }
  }

  const [clubAffiliation, athleteAffiliations] = await Promise.all([
    prisma.clubAffiliation.findUnique({
      where: {
        clubId_seasonId_discipline: { clubId, seasonId: season.id, discipline },
      },
    }),
    prisma.athleteAffiliation.findMany({
      where: { clubId, seasonId: season.id, discipline, status: "ACTIVE" },
      select: {
        athleteId: true,
        status: true,
        validFrom: true,
        validTo: true,
        activeOrderId: true,
      },
    }),
  ])

  const coversEvent =
    options?.validFrom !== undefined && options.validTo !== undefined
  const valid = (affiliation: (AffiliationLike & { validFrom?: Date }) | null) =>
    coversEvent
      ? isAffiliationValidForRange(
          affiliation?.validFrom
            ? { ...affiliation, validFrom: affiliation.validFrom }
            : null,
          options.validFrom!,
          options.validTo!
        )
      : isAffiliationValid(affiliation)

  const clubIsAffiliated = valid(clubAffiliation)
  const label = disciplineLabel(discipline)

  return {
    clubIsAffiliated,
    clubReason: clubIsAffiliated
      ? ""
      : `Tu club no tiene la afiliación ${season.year} de ${label} vigente. Afilia a tu club en ${label} para poder inscribir.`,
    affiliatedAthleteIds: new Set(
      athleteAffiliations
        .filter((affiliation) => valid(affiliation))
        .map((affiliation) => affiliation.athleteId)
    ),
    seasonName: season.name,
  }
}

export interface ClubEligibleDisciplines {
  season: { id: string; year: number; name: string } | null
  // Disciplinas cuyo calendario le interesa al club.
  disciplines: DisciplineValue[]
  // Distingue "todavía no se afilió a nada" de "no hay temporada abierta".
  hasAnyAffiliation: boolean
}

/**
 * Disciplinas en las que el club tiene afiliación de la temporada vigente, ya
 * sea ACTIVA o PENDIENTE de pago.
 *
 * PENDIENTE cuenta a propósito: el club ya inició el trámite y necesita ver el
 * calendario y armar su planilla mientras regulariza. El bloqueo duro sigue
 * viviendo en la validación de la planilla (CLUB_AFFILIATION_REQUIRED), que
 * además exige ACTIVA y que la vigencia cubra todas las fechas del evento. La
 * asimetría es deliberada: filtrar el listado es una comodidad, no un permiso.
 */
export async function getClubEligibleDisciplines(
  clubId: string,
  options?: {
    seasonId?: string | null
    disciplineAccess?: readonly DisciplineValue[]
  }
): Promise<ClubEligibleDisciplines> {
  const season = options?.seasonId
    ? await prisma.season.findUnique({ where: { id: options.seasonId } })
    : await getCurrentSeason()

  if (!season) {
    return { season: null, disciplines: [], hasAnyAffiliation: false }
  }

  const affiliations = await prisma.clubAffiliation.findMany({
    where: {
      clubId,
      seasonId: season.id,
      status: { in: ["ACTIVE", "PENDING"] },
      ...(options?.disciplineAccess
        ? { discipline: { in: [...options.disciplineAccess] } }
        : {}),
    },
    select: { discipline: true },
  })

  return {
    season: { id: season.id, year: season.year, name: season.name },
    disciplines: sortDisciplines(affiliations.map((row) => row.discipline)),
    hasAnyAffiliation: affiliations.length > 0,
  }
}

// ==================== PANEL DEL CLUB ====================

export interface AthleteDisciplineState {
  affiliationId: string | null
  state: AffiliationState
  validTo: Date | null
  fee: number | null
  inCart: boolean
  awaitingPayment: boolean
  // Última temporada en la que estuvo afiliado con este club en esta disciplina.
  previousSeasonYear: number | null
}

export interface AthleteAffiliationRow {
  athleteId: string
  firstNames: string
  lastNames: string
  docType: string
  docNumber: string
  birthDate: Date
  sex: "M" | "F"
  // Disciplinas que practica: definen qué cuotas le corresponden.
  disciplines: DisciplineValue[]
  byDiscipline: Partial<Record<DisciplineValue, AthleteDisciplineState>>
}

export interface AffiliationCounts {
  total: number
  active: number
  pending: number
  expired: number
  unaffiliated: number
}

export interface DisciplinePanel {
  discipline: DisciplineValue
  // null = la federación no le puso tarifa a esta disciplina esta temporada.
  fee: DisciplineFee | null
  clubState: AffiliationState
  clubValidFrom: Date | null
  clubValidTo: Date | null
  clubFee: number | null
  clubPaidAt: Date | null
  clubInCart: boolean
  clubAwaitingPayment: boolean
  // Orden viva que cubre la cuota del club: el portal enlaza directo a pagarla.
  clubActiveOrderId: string | null
  // Deportistas del club que practican esta disciplina.
  counts: AffiliationCounts
}

function emptyCounts(): AffiliationCounts {
  return { total: 0, active: 0, pending: 0, expired: 0, unaffiliated: 0 }
}

function tallyInto(counts: AffiliationCounts, state: AffiliationState) {
  counts.total += 1
  if (isSettledState(state)) counts.active += 1
  else if (state === "PENDIENTE") counts.pending += 1
  else if (state === "VENCIDA") counts.expired += 1
  else counts.unaffiliated += 1
}

export async function getClubAffiliationPanel(
  clubId: string,
  disciplineAccess?: readonly DisciplineValue[]
) {
  const season = await getCurrentSeason()

  if (!season) {
    return {
      season: null,
      fees: new Map<DisciplineValue, DisciplineFee>(),
      disciplines: [] as DisciplinePanel[],
      athletes: [] as AthleteAffiliationRow[],
      totals: emptyCounts(),
    }
  }

  const disciplineFilter = disciplineAccess
    ? { discipline: { in: [...disciplineAccess] } }
    : {}
  const athleteFilter = disciplineAccess
    ? { disciplines: { hasSome: [...disciplineAccess] } }
    : {}
  const [allFees, clubAffiliations, athletes, previous] = await Promise.all([
    getSeasonFees(season.id),
    prisma.clubAffiliation.findMany({
      where: { clubId, seasonId: season.id, ...disciplineFilter },
    }),
    prisma.athlete.findMany({
      where: { clubId, isActive: true, ...athleteFilter },
      orderBy: [{ lastNames: "asc" }, { firstNames: "asc" }],
      include: { affiliations: { where: { seasonId: season.id } } },
    }),
    // Temporadas anteriores con este club: distingue "reafiliar" de "nuevo".
    prisma.athleteAffiliation.findMany({
      where: { clubId, seasonId: { not: season.id }, ...disciplineFilter },
      select: {
        athleteId: true,
        discipline: true,
        season: { select: { year: true } },
      },
      orderBy: { season: { year: "desc" } },
    }),
  ])

  const fees = new Map(
    [...allFees].filter(([discipline]) =>
      disciplineAccess ? disciplineAccess.includes(discipline) : true
    )
  )
  const lastSeasonByAthlete = new Map<string, number>()
  for (const row of previous) {
    const key = `${row.athleteId}:${row.discipline}`
    if (!lastSeasonByAthlete.has(key)) {
      lastSeasonByAthlete.set(key, row.season.year)
    }
  }

  const clubByDiscipline = new Map(
    clubAffiliations.map((row) => [row.discipline as DisciplineValue, row])
  )

  const countsByDiscipline = new Map<DisciplineValue, AffiliationCounts>(
    DISCIPLINE_VALUES.map((value) => [value, emptyCounts()])
  )

  const rows: AthleteAffiliationRow[] = athletes.map((athlete) => {
    const practises = athleteDisciplines(athlete.disciplines).filter((discipline) =>
      disciplineAccess ? disciplineAccess.includes(discipline) : true
    )
    const byDiscipline: Partial<Record<DisciplineValue, AthleteDisciplineState>> = {}

    for (const discipline of practises) {
      const affiliation =
        athlete.affiliations.find((row) => row.discipline === discipline) ?? null
      const state = affiliationState(affiliation)

      byDiscipline[discipline] = {
        affiliationId: affiliation?.id ?? null,
        state,
        validTo: affiliation?.validTo ?? null,
        fee: affiliation ? toAmount(affiliation.fee) : null,
        inCart:
          affiliation?.status === "PENDING" && affiliation.activeOrderId === null,
        awaitingPayment:
          affiliation?.status === "PENDING" && affiliation.activeOrderId !== null,
        previousSeasonYear:
          lastSeasonByAthlete.get(`${athlete.id}:${discipline}`) ?? null,
      }

      tallyInto(countsByDiscipline.get(discipline)!, state)
    }

    return {
      athleteId: athlete.id,
      firstNames: athlete.firstNames,
      lastNames: athlete.lastNames,
      docType: athlete.docType,
      docNumber: athlete.docNumber,
      birthDate: athlete.birthDate,
      sex: athlete.sex,
      disciplines: practises,
      byDiscipline,
    }
  })

  // Solo se listan las disciplinas con tarifa o con algo ya registrado: una
  // disciplina que la federación no habilitó no debe aparecer como "sin afiliar".
  const disciplines: DisciplinePanel[] = DISCIPLINE_VALUES.filter(
    (discipline) =>
      fees.has(discipline) ||
      clubByDiscipline.has(discipline) ||
      (countsByDiscipline.get(discipline)?.total ?? 0) > 0
  ).map((discipline) => {
    const affiliation = clubByDiscipline.get(discipline) ?? null

    return {
      discipline,
      fee: fees.get(discipline) ?? null,
      clubState: affiliationState(affiliation),
      clubValidFrom: affiliation?.validFrom ?? null,
      clubValidTo: affiliation?.validTo ?? null,
      clubFee: affiliation ? toAmount(affiliation.fee) : null,
      clubPaidAt: affiliation?.paidAt ?? null,
      clubInCart:
        affiliation?.status === "PENDING" && affiliation.activeOrderId === null,
      clubAwaitingPayment:
        affiliation?.status === "PENDING" && affiliation.activeOrderId !== null,
      clubActiveOrderId:
        affiliation?.status === "PENDING" ? affiliation.activeOrderId : null,
      counts: countsByDiscipline.get(discipline) ?? emptyCounts(),
    }
  })

  // Totales sumando todas las cuotas pendientes (una por disciplina practicada).
  const totals = emptyCounts()
  for (const panel of disciplines) {
    totals.total += panel.counts.total
    totals.active += panel.counts.active
    totals.pending += panel.counts.pending
    totals.expired += panel.counts.expired
    totals.unaffiliated += panel.counts.unaffiliated
  }

  return { season, fees, disciplines, athletes: rows, totals }
}

// Pares (deportista, disciplina) que faltan regularizar: es lo que alimenta la
// pestaña "Deportistas" de /afiliacion.
export interface PendingAffiliationRow {
  athleteId: string
  discipline: DisciplineValue
  firstNames: string
  lastNames: string
  docType: string
  docNumber: string
  birthDate: Date
  state: AffiliationState
  inCart: boolean
  awaitingPayment: boolean
  previousSeasonYear: number | null
}

export function pendingAffiliationRows(
  athletes: AthleteAffiliationRow[]
): PendingAffiliationRow[] {
  const rows: PendingAffiliationRow[] = []

  for (const athlete of athletes) {
    for (const discipline of athlete.disciplines) {
      const entry = athlete.byDiscipline[discipline]
      if (!entry || isSettledState(entry.state)) continue

      rows.push({
        athleteId: athlete.athleteId,
        discipline,
        firstNames: athlete.firstNames,
        lastNames: athlete.lastNames,
        docType: athlete.docType,
        docNumber: athlete.docNumber,
        birthDate: athlete.birthDate,
        state: entry.state,
        inCart: entry.inCart,
        awaitingPayment: entry.awaitingPayment,
        previousSeasonYear: entry.previousSeasonYear,
      })
    }
  }

  return rows
}

// Cuántas afiliaciones le faltan al club, contando pares (deportista, disciplina)
// y (club, disciplina). Excluye lo que ya está en el carrito o en una orden en
// curso: eso lo señala el badge del carrito, y duplicarlo confundiría.
// Versión liviana del panel: corre en el layout de cada página del portal.
export async function countPendingAffiliations(
  clubId: string,
  disciplineAccess?: readonly DisciplineValue[]
): Promise<number> {
  const season = await getCurrentSeason()
  if (!season) return 0

  const disciplineFilter = disciplineAccess
    ? { discipline: { in: [...disciplineAccess] } }
    : {}
  const athleteFilter = disciplineAccess
    ? { disciplines: { hasSome: [...disciplineAccess] } }
    : {}
  const [allFees, clubAffiliations, athletes] = await Promise.all([
    getSeasonFees(season.id),
    prisma.clubAffiliation.findMany({
      where: { clubId, seasonId: season.id, ...disciplineFilter },
      select: { discipline: true, status: true, validTo: true, activeOrderId: true },
    }),
    prisma.athlete.findMany({
      where: { clubId, isActive: true, ...athleteFilter },
      select: {
        disciplines: true,
        affiliations: {
          where: { seasonId: season.id },
          select: {
            discipline: true,
            status: true,
            validTo: true,
            activeOrderId: true,
          },
        },
      },
    }),
  ])

  const fees = new Map(
    [...allFees].filter(([discipline]) =>
      disciplineAccess ? disciplineAccess.includes(discipline) : true
    )
  )
  const needsAction = (
    affiliation:
      | { status: "PENDING" | "ACTIVE"; validTo: Date; activeOrderId: string | null }
      | undefined
  ) => {
    if (!affiliation) return true
    // Ya está en el carrito o esperando el pago de una orden viva.
    if (affiliation.status === "PENDING") return false
    return !isAffiliationValid(affiliation)
  }

  const clubByDiscipline = new Map(
    clubAffiliations.map((row) => [row.discipline as DisciplineValue, row])
  )

  let pending = 0

  for (const discipline of fees.keys()) {
    if (needsAction(clubByDiscipline.get(discipline))) pending += 1
  }

  for (const athlete of athletes) {
    for (const discipline of athleteDisciplines(athlete.disciplines)) {
      if (!fees.has(discipline)) continue
      const affiliation = athlete.affiliations.find(
        (row) => row.discipline === discipline
      )
      if (needsAction(affiliation)) pending += 1
    }
  }

  return pending
}

// ==================== PANEL DE LA FEDERACIÓN ====================

export interface ClubDisciplineRow {
  discipline: DisciplineValue
  affiliationId: string | null
  clubState: AffiliationState
  fee: number | null
  validTo: Date | null
  paidAt: Date | null
  athletesTotal: number
  athletesActive: number
  athletesPending: number
  athletesExpiredOrMissing: number
}

export interface FederationClubRow {
  clubId: string
  clubName: string
  clubCode: string
  isActive: boolean
  athletesTotal: number
  disciplines: ClubDisciplineRow[]
}

// Una sola pasada por club para el panel y para el export a Excel.
export async function getFederationOverview() {
  const season = await getCurrentSeason()

  if (!season) {
    return { season: null, clubs: [] as FederationClubRow[], totals: null }
  }

  const [fees, clubs] = await Promise.all([
    getSeasonFees(season.id),
    prisma.club.findMany({
      orderBy: { name: "asc" },
      include: {
        affiliations: { where: { seasonId: season.id } },
        athletes: {
          where: { isActive: true },
          select: {
            id: true,
            disciplines: true,
            affiliations: {
              where: { seasonId: season.id },
              select: {
                discipline: true,
                status: true,
                validTo: true,
                activeOrderId: true,
              },
            },
          },
        },
      },
    }),
  ])

  const rows: FederationClubRow[] = clubs.map((club) => {
    const clubByDiscipline = new Map(
      club.affiliations.map((row) => [row.discipline as DisciplineValue, row])
    )

    const counts = new Map<DisciplineValue, AffiliationCounts>(
      DISCIPLINE_VALUES.map((value) => [value, emptyCounts()])
    )

    for (const athlete of club.athletes) {
      for (const discipline of athleteDisciplines(athlete.disciplines)) {
        const affiliation =
          athlete.affiliations.find((row) => row.discipline === discipline) ?? null
        tallyInto(counts.get(discipline)!, affiliationState(affiliation))
      }
    }

    const disciplines: ClubDisciplineRow[] = DISCIPLINE_VALUES.filter(
      (discipline) =>
        fees.has(discipline) ||
        clubByDiscipline.has(discipline) ||
        (counts.get(discipline)?.total ?? 0) > 0
    ).map((discipline) => {
      const affiliation = clubByDiscipline.get(discipline) ?? null
      const tally = counts.get(discipline) ?? emptyCounts()

      return {
        discipline,
        affiliationId: affiliation?.id ?? null,
        clubState: affiliationState(affiliation),
        fee: affiliation ? toAmount(affiliation.fee) : null,
        validTo: affiliation?.validTo ?? null,
        paidAt: affiliation?.paidAt ?? null,
        athletesTotal: tally.total,
        athletesActive: tally.active,
        athletesPending: tally.pending,
        athletesExpiredOrMissing: tally.expired + tally.unaffiliated,
      }
    })

    return {
      clubId: club.id,
      clubName: club.name,
      clubCode: club.code,
      isActive: club.isActive,
      athletesTotal: club.athletes.length,
      disciplines,
    }
  })

  // Los totales cuentan pares (club, disciplina) y (deportista, disciplina):
  // con cuota por disciplina, "un club afiliado" ya no es una unidad útil.
  const allDisciplineRows = rows.flatMap((row) => row.disciplines)

  const totals = {
    // Denominador en la MISMA unidad que los contadores de abajo. Sin él, quien
    // consuma `clubsAffiliated` acaba dividiéndolo entre el número de clubes y
    // sale un «30/11»: pares partidos por clubes.
    clubDisciplinesTotal: allDisciplineRows.length,
    clubsAffiliated: allDisciplineRows.filter((row) => isSettledState(row.clubState))
      .length,
    clubsPending: allDisciplineRows.filter((row) => row.clubState === "PENDIENTE")
      .length,
    clubsUnaffiliated: allDisciplineRows.filter(
      (row) => row.clubState === "SIN_AFILIAR" || row.clubState === "VENCIDA"
    ).length,
    athletesAffiliated: allDisciplineRows.reduce(
      (sum, row) => sum + row.athletesActive,
      0
    ),
    athletesPending: allDisciplineRows.reduce(
      (sum, row) => sum + row.athletesPending,
      0
    ),
    athletesUnaffiliated: allDisciplineRows.reduce(
      (sum, row) => sum + row.athletesExpiredOrMissing,
      0
    ),
    expiringSoon:
      allDisciplineRows.filter((row) => row.clubState === "POR_VENCER").length +
      (await countAthletesExpiringSoon(season.id)),
  }

  return { season, clubs: rows, totals }
}

// Afiliaciones de deportistas activas que vencen dentro de la ventana de aviso.
async function countAthletesExpiringSoon(seasonId: string): Promise<number> {
  const limit = new Date(todayInLima())
  limit.setUTCDate(limit.getUTCDate() + EXPIRING_SOON_DAYS)

  return prisma.athleteAffiliation.count({
    where: {
      seasonId,
      status: "ACTIVE",
      validTo: { gte: todayInLima(), lte: limit },
    },
  })
}

// ==================== CARRITO DE AFILIACIONES ====================

export interface AthleteAffiliationRequest {
  athleteId: string
  discipline: DisciplineValue
}

export async function addAffiliationsToCart(input: {
  clubId: string
  // Disciplinas en las que se quiere afiliar al club.
  clubDisciplines?: DisciplineValue[]
  athletes?: AthleteAffiliationRequest[]
}): Promise<ActionResult & { added?: number }> {
  const season = await getCurrentSeason()
  if (!season) {
    return {
      success: false,
      error: "La federación aún no habilitó la temporada de afiliaciones.",
    }
  }

  const fees = await getSeasonFees(season.id)

  const clubDisciplines = [...new Set(input.clubDisciplines ?? [])]
  // Deduplica pares (deportista, disciplina).
  const athleteRequests = [
    ...new Map(
      (input.athletes ?? []).map((row) => [
        `${row.athleteId}:${row.discipline}`,
        row,
      ])
    ).values(),
  ]

  if (clubDisciplines.length === 0 && athleteRequests.length === 0) {
    return { success: false, error: "Selecciona al menos una afiliación." }
  }

  const withoutFee = [...clubDisciplines, ...athleteRequests.map((r) => r.discipline)]
    .filter((discipline) => !fees.has(discipline))
    .map(disciplineLabel)

  if (withoutFee.length > 0) {
    return {
      success: false,
      error: `La federación aún no fijó la cuota ${season.year} de ${[...new Set(withoutFee)].join(", ")}.`,
    }
  }

  let added = 0

  for (const discipline of clubDisciplines) {
    const existing = await prisma.clubAffiliation.findUnique({
      where: {
        clubId_seasonId_discipline: {
          clubId: input.clubId,
          seasonId: season.id,
          discipline,
        },
      },
    })

    const label = disciplineLabel(discipline)

    if (existing?.status === "ACTIVE") {
      return {
        success: false,
        error: `Tu club ya tiene la afiliación ${season.year} de ${label} pagada.`,
      }
    }
    if (existing?.activeOrderId) {
      return {
        success: false,
        error: `La afiliación del club en ${label} ya está en una orden por pagar. Págala o espera a que venza para volver a agregarla.`,
      }
    }
    if (!existing) {
      await prisma.clubAffiliation.create({
        data: {
          clubId: input.clubId,
          seasonId: season.id,
          discipline,
          fee: fees.get(discipline)!.clubFee,
          validFrom: season.startDate,
          validTo: season.endDate,
        },
      })
      added += 1
    }
  }

  if (athleteRequests.length > 0) {
    const athleteIds = [...new Set(athleteRequests.map((row) => row.athleteId))]

    const athletes = await prisma.athlete.findMany({
      where: { id: { in: athleteIds }, clubId: input.clubId, isActive: true },
      select: { id: true, disciplines: true },
    })

    if (athletes.length !== athleteIds.length) {
      return {
        success: false,
        error:
          "Uno o más deportistas ya no están en el padrón de tu club. Recarga la página para ver la lista actual.",
      }
    }

    // No se puede afiliar a alguien en un deporte que no practica: primero hay
    // que agregarle la disciplina en el padrón.
    const practisedBy = new Map(
      athletes.map((athlete) => [
        athlete.id,
        new Set(athleteDisciplines(athlete.disciplines)),
      ])
    )
    const notPractised = athleteRequests.filter(
      (row) => !practisedBy.get(row.athleteId)?.has(row.discipline)
    )
    if (notPractised.length > 0) {
      return {
        success: false,
        error:
          notPractised.length === 1
            ? "1 deportista no tiene esa disciplina en el padrón. Solo la FDNDA puede agregársela."
            : `${notPractised.length} deportistas no tienen esa disciplina en el padrón. Solo la FDNDA puede agregársela.`,
      }
    }

    const existing = await prisma.athleteAffiliation.findMany({
      where: { athleteId: { in: athleteIds }, seasonId: season.id },
      select: {
        athleteId: true,
        discipline: true,
        status: true,
        activeOrderId: true,
      },
    })
    const existingByKey = new Map(
      existing.map((row) => [`${row.athleteId}:${row.discipline}`, row])
    )

    const blocked = athleteRequests.filter((row) => {
      const found = existingByKey.get(`${row.athleteId}:${row.discipline}`)
      return found && (found.status === "ACTIVE" || found.activeOrderId !== null)
    })
    if (blocked.length > 0) {
      return {
        success: false,
        error:
          blocked.length === 1
            ? "1 afiliación ya está pagada o en una orden por pagar. Recarga la página para ver su estado."
            : `${blocked.length} afiliaciones ya están pagadas o en una orden por pagar. Recarga la página para ver su estado.`,
      }
    }

    const toCreate = athleteRequests.filter(
      (row) => !existingByKey.has(`${row.athleteId}:${row.discipline}`)
    )

    if (toCreate.length > 0) {
      const result = await prisma.athleteAffiliation.createMany({
        data: toCreate.map((row) => ({
          athleteId: row.athleteId,
          clubId: input.clubId,
          seasonId: season.id,
          discipline: row.discipline,
          fee: fees.get(row.discipline)!.athleteFee,
          validFrom: season.startDate,
          validTo: season.endDate,
        })),
        skipDuplicates: true,
      })
      added += result.count
    }
  }

  return { success: true, added }
}

export async function removeAffiliationFromCart(input: {
  clubId: string
  kind: "CLUB" | "ATHLETE"
  affiliationId: string
}): Promise<ActionResult> {
  // Solo se puede quitar lo que sigue en el carrito (PENDING sin orden viva).
  const where = {
    id: input.affiliationId,
    clubId: input.clubId,
    status: "PENDING" as const,
    activeOrderId: null,
  }

  const deleted =
    input.kind === "CLUB"
      ? await prisma.clubAffiliation.deleteMany({ where })
      : await prisma.athleteAffiliation.deleteMany({ where })

  if (deleted.count === 0) {
    return {
      success: false,
      error: "Esa afiliación ya no está en el carrito. Recarga la página para ver su estado.",
    }
  }
  return { success: true }
}

export async function getAffiliationCart(
  clubId: string,
  disciplineAccess?: readonly DisciplineValue[]
) {
  await expireStaleOrders()

  const season = await getCurrentSeason()
  if (!season) {
    return { season: null, clubs: [], athletes: [], total: 0 }
  }

  const disciplineFilter = disciplineAccess
    ? { discipline: { in: [...disciplineAccess] } }
    : {}
  const [clubs, athletes] = await Promise.all([
    prisma.clubAffiliation.findMany({
      where: {
        clubId,
        seasonId: season.id,
        status: "PENDING",
        activeOrderId: null,
        ...disciplineFilter,
      },
      include: { club: { select: { name: true } } },
      orderBy: { discipline: "asc" },
    }),
    prisma.athleteAffiliation.findMany({
      where: {
        clubId,
        seasonId: season.id,
        status: "PENDING",
        activeOrderId: null,
        ...disciplineFilter,
      },
      include: { athlete: true },
      orderBy: [{ discipline: "asc" }, { athlete: { lastNames: "asc" } }],
    }),
  ])

  const total =
    clubs.reduce((sum, row) => sum + toAmount(row.fee), 0) +
    athletes.reduce((sum, row) => sum + toAmount(row.fee), 0)

  return { season, clubs, athletes, total }
}

// Distingue la carrera real (otra pestaña tomó parte del carrito) de cualquier
// otro fallo, para no culpar al carrito de un error que no tiene que ver.
class CartChangedError extends Error {
  constructor() {
    super("El carrito cambió mientras se creaba la orden.")
  }
}

export async function checkoutAffiliationCart(input: {
  clubId: string
  userId: string
  disciplineAccess?: readonly DisciplineValue[]
}): Promise<ActionResult & { orderId?: string }> {
  const cart = await getAffiliationCart(input.clubId, input.disciplineAccess)

  if (!cart.season) {
    return {
      success: false,
      error: "La federación aún no habilitó la temporada de afiliaciones.",
    }
  }
  if (cart.clubs.length === 0 && cart.athletes.length === 0) {
    return {
      success: false,
      error: "Tu carrito está vacío: agrega una afiliación antes de pagar.",
    }
  }

  const season = cart.season
  const vigencia = `vigencia ${formatDateOnly(season.startDate)} – ${formatDateOnly(season.endDate)}`

  const clubAffiliationIds = cart.clubs.map((row) => row.id)
  const athleteAffiliationIds = cart.athletes.map((row) => row.id)

  try {
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          code: shortCode("AFI"),
          kind: "AFFILIATION",
          clubId: input.clubId,
          userId: input.userId,
          totalAmount: cart.total,
          status: "PENDING",
          expiresAt: new Date(Date.now() + ORDER_EXPIRATION_MINUTES * 60 * 1000),
          items: {
            create: [
              ...cart.clubs.map((row) => ({
                clubAffiliationId: row.id,
                unitPrice: row.fee,
                description: `Afiliación ${season.year} ${disciplineLabel(row.discipline)} — Club ${row.club.name} (${vigencia})`,
              })),
              ...cart.athletes.map((row) => ({
                athleteAffiliationId: row.id,
                unitPrice: row.fee,
                description: `Afiliación ${season.year} ${disciplineLabel(row.discipline)} — ${row.athlete.lastNames}, ${row.athlete.firstNames} · ${row.athlete.docType} ${row.athlete.docNumber} (${vigencia})`,
              })),
            ],
          },
        },
      })

      // Guard contra carreras: solo toma lo que seguía suelto en el carrito.
      const clubTaken = clubAffiliationIds.length
        ? (
            await tx.clubAffiliation.updateMany({
              where: {
                id: { in: clubAffiliationIds },
                status: "PENDING",
                activeOrderId: null,
              },
              data: { activeOrderId: created.id },
            })
          ).count
        : 0

      const athletesTaken = athleteAffiliationIds.length
        ? (
            await tx.athleteAffiliation.updateMany({
              where: {
                id: { in: athleteAffiliationIds },
                status: "PENDING",
                activeOrderId: null,
              },
              data: { activeOrderId: created.id },
            })
          ).count
        : 0

      if (
        clubTaken !== clubAffiliationIds.length ||
        athletesTaken !== athleteAffiliationIds.length
      ) {
        throw new CartChangedError()
      }

      return created
    })

    return { success: true, orderId: order.id }
  } catch (error) {
    console.error("checkoutAffiliationCart error:", error)
    return {
      success: false,
      error:
        error instanceof CartChangedError
          ? "El carrito cambió mientras se creaba la orden. Revisa lo que quedó y vuelve a pagar."
          : "No pudimos crear la orden. Vuelve a intentarlo; tu carrito no cambió.",
    }
  }
}
