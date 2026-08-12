import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { athleteDisciplines } from "./affiliations"
import { disciplineLabel, type DisciplineValue } from "./disciplines"
import { validateEntryComposition } from "./eligibility"
import {
  computePlanPricing,
  disciplineConfigFor,
  isAgeRuleConfigurationValid,
  type CoverageLookup,
  type DisciplinePricingSummary,
  type PlanPricing,
} from "./event-pricing"
import { birthYearOf, toAmount } from "./utils"

export type PlanIssueSeverity = "ERROR" | "WARNING"

export type PlanValidationIssueCode =
  | "PLAN_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "PLAN_ABANDONED"
  | "PLAN_NOT_EDITABLE"
  | "EVENT_REQUIRED"
  | "EVENT_CLOSED"
  | "DEADLINE_PASSED"
  | "EVENT_SEASON_REQUIRED"
  | "EMPTY_ROSTER"
  | "EMPTY_PLAN"
  | "ATHLETE_NOT_AVAILABLE"
  | "ATHLETE_NOT_IN_ROSTER"
  | "ATHLETE_WITHOUT_ENTRY"
  | "MODALITY_NOT_AVAILABLE"
  | "MODALITY_EVENT_MISMATCH"
  | "DISCIPLINE_MISMATCH"
  | "ENTRY_NOT_EDITABLE"
  | "CLUB_AFFILIATION_REQUIRED"
  | "ATHLETE_AFFILIATION_REQUIRED"
  | "COMPOSITION_INVALID"
  | "DUPLICATE_ENTRY"
  | "DUPLICATE_CONFIRMED_ENTRY"
  | "CAPACITY_EXCEEDED"
  | "UPGRADE_CONFIGURATION_INVALID"
  | "CATEGORY_UPGRADE_USED"
  | "DISCIPLINE_PRICING_INVALID"
  | "CHARGE_SELECTION_REQUIRED"
  | "AGE_RULE_INVALID"
  | "ATHLETE_FEE_ALREADY_PAID"

export type PlanCorrectiveAction =
  | "RELOAD"
  | "SELECT_EVENT"
  | "SELECT_ATHLETES"
  | "EDIT_ENTRY"
  | "REMOVE_ENTRY"
  | "AFFILIATE"
  | "SELECT_ANOTHER_MODALITY"
  | "CONTACT_FEDERATION"

export interface PlanValidationIssue {
  code: PlanValidationIssueCode
  severity: PlanIssueSeverity
  message: string
  action: PlanCorrectiveAction
  athleteId?: string
  modalityId?: string
  registrationId?: string
}

export interface PlanValidationSummary {
  rosterAthleteCount: number
  registeredAthleteCount: number
  athletesWithoutEntries: number
  entryCount: number
  totalAmount: number
  currency: "PEN"
  // Desglose del importe. `totalAmount` = entriesAmount + athleteFeesAmount.
  entriesAmount: number
  athleteFeesAmount: number
  chargedAthleteFees: number
  /** Cuotas que este club ya pagó en otra orden del mismo evento. */
  coveredAthleteFees: number
  byDiscipline: DisciplinePricingSummary[]
}

export interface PlanValidationResult {
  planId: string
  revision: number
  valid: boolean
  summary: PlanValidationSummary
  issues: PlanValidationIssue[]
}

/** Detalle del cobro para el checkout. No viaja al cliente. */
export interface PlanValidationWithPricing extends PlanValidationResult {
  pricing: PlanPricing
}

export interface ValidateRegistrationPlanInput {
  planId: string
  clubId: string
  expectedRevision?: number
  mode?: "REVIEW" | "CHECKOUT"
  now?: Date
}

const EMPTY_SUMMARY: PlanValidationSummary = {
  rosterAthleteCount: 0,
  registeredAthleteCount: 0,
  athletesWithoutEntries: 0,
  entryCount: 0,
  totalAmount: 0,
  currency: "PEN",
  entriesAmount: 0,
  athleteFeesAmount: 0,
  chargedAthleteFees: 0,
  coveredAthleteFees: 0,
  byDiscipline: [],
}

const EMPTY_PRICING: PlanPricing = {
  lines: [],
  chargeableLines: [],
  total: new Prisma.Decimal(0),
  byDiscipline: [],
  coveredAthleteFees: 0,
  misconfiguredDisciplines: [],
}

const VALIDATION_PLAN_INCLUDE = {
  club: { select: { id: true, name: true, code: true } },
  event: {
    include: {
      season: { include: { categories: true } },
      // Cómo cobra y cómo mide edades cada disciplina del evento. Viaja acá para
      // que el cálculo del importe no cueste una consulta extra.
      disciplineConfigs: true,
    },
  },
  athletes: { include: { athlete: true } },
  registrations: {
    include: {
      modality: true,
      athletes: { include: { athlete: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.RegistrationPlanInclude

export type RegistrationPlanForValidation =
  Prisma.RegistrationPlanGetPayload<{ include: typeof VALIDATION_PLAN_INCLUDE }>

export type PlanTransactionClient = Prisma.TransactionClient

function issue(
  code: PlanValidationIssueCode,
  message: string,
  action: PlanCorrectiveAction,
  context: Pick<
    PlanValidationIssue,
    "athleteId" | "modalityId" | "registrationId"
  > = {},
  severity: PlanIssueSeverity = "ERROR"
): PlanValidationIssue {
  return { code, severity, message, action, ...context }
}

function athleteName(athlete: { firstNames: string; lastNames: string }): string {
  return `${athlete.firstNames} ${athlete.lastNames}`
}

function modalityName(modality: { name: string; category: string | null }): string {
  return [modality.name, modality.category].filter(Boolean).join(" — ")
}

function otherPlanFilter(planId: string) {
  return {
    OR: [{ planId: null }, { planId: { not: planId } }],
  }
}

/**
 * Verifies the explicit artistic-swimming upgrade year against the event season.
 * The athlete allowed to move up is the oldest year of the immediately lower
 * category: the year directly after the modality's own upper birth-year bound.
 */
export function isValidCategoryUpgradeConfiguration(
  modality: {
    discipline: string
    allowsCategoryUpgrade: boolean
    categoryUpgradeBirthYear: number | null
    birthYearTo: number | null
  },
  categories: Array<{
    discipline: string
    birthYearFrom: number | null
    birthYearTo: number | null
  }>
): boolean {
  if (!modality.allowsCategoryUpgrade) {
    return modality.categoryUpgradeBirthYear === null
  }

  if (
    modality.discipline !== "ARTISTIC_SWIMMING" ||
    modality.birthYearTo === null ||
    modality.categoryUpgradeBirthYear === null
  ) {
    return false
  }

  const expectedYear = modality.birthYearTo + 1
  if (modality.categoryUpgradeBirthYear !== expectedYear) return false

  return categories.some(
    (category) =>
      category.discipline === "ARTISTIC_SWIMMING" &&
      category.birthYearFrom === expectedYear &&
      (category.birthYearTo === null || category.birthYearTo >= expectedYear)
  )
}

/**
 * Cuotas por deportista ya emitidas en el evento: pagadas, o reservadas por una
 * orden viva. Una cuota liberada (orden expirada o fallida) se borra, así que no
 * aparece y el club vuelve a pagarla si reintenta.
 */
export function coverageLookupFor(tx: PlanTransactionClient): CoverageLookup {
  return async ({ eventId, disciplines, athleteIds }) => {
    const rows = await tx.eventAthleteFee.findMany({
      where: {
        eventId,
        discipline: { in: disciplines as DisciplineValue[] },
        athleteId: { in: athleteIds },
        OR: [
          { status: "PAID" },
          { status: "PENDING_PAYMENT", activeOrderId: { not: null } },
        ],
      },
      select: {
        discipline: true,
        athleteId: true,
        orderItems: {
          // Solo órdenes vivas: una cuota reutilizada conserva el ítem de un
          // intento cancelado, y mostrar ese código confundiría al club.
          where: { order: { status: { in: ["PENDING", "PAID"] } } },
          select: { order: { select: { code: true } } },
          take: 1,
        },
      },
    })
    return rows.map((row) => ({
      discipline: row.discipline,
      athleteId: row.athleteId,
      orderCode: row.orderItems[0]?.order.code,
    }))
  }
}

export async function loadRegistrationPlanForValidation(
  tx: PlanTransactionClient,
  input: Pick<ValidateRegistrationPlanInput, "planId" | "clubId">
): Promise<RegistrationPlanForValidation | null> {
  return tx.registrationPlan.findFirst({
    where: { id: input.planId, clubId: input.clubId },
    include: VALIDATION_PLAN_INCLUDE,
  })
}

function buildSummary(
  plan: RegistrationPlanForValidation,
  pricing: PlanPricing
): PlanValidationSummary {
  const registeredAthletes = new Set(
    plan.registrations.flatMap((registration) =>
      registration.athletes.map((row) => row.athleteId)
    )
  )
  const roster = new Set(plan.athletes.map((row) => row.athleteId))

  const feeLines = pricing.chargeableLines.filter(
    (line) => line.kind === "ATHLETE_FEE"
  )
  const entriesAmount = pricing.chargeableLines
    .filter((line) => line.kind === "ENTRY")
    .reduce((sum, line) => sum + toAmount(line.amount), 0)
  const athleteFeesAmount = feeLines.reduce(
    (sum, line) => sum + toAmount(line.amount),
    0
  )

  return {
    rosterAthleteCount: roster.size,
    registeredAthleteCount: registeredAthletes.size,
    athletesWithoutEntries: [...roster].filter((id) => !registeredAthletes.has(id))
      .length,
    entryCount: plan.registrations.length,
    totalAmount: toAmount(pricing.total),
    currency: "PEN",
    entriesAmount,
    athleteFeesAmount,
    chargedAthleteFees: feeLines.length,
    coveredAthleteFees: pricing.coveredAthleteFees,
    byDiscipline: pricing.byDiscipline,
  }
}

/**
 * Single authoritative validation used by review and checkout. It intentionally
 * reads prices, rules, ownership and affiliations from the database; callers
 * provide identifiers and an optional optimistic revision only.
 */
export async function validateRegistrationPlanInTransaction(
  tx: PlanTransactionClient,
  input: ValidateRegistrationPlanInput,
  preloadedPlan?: RegistrationPlanForValidation | null
): Promise<PlanValidationWithPricing> {
  const now = input.now ?? new Date()
  const plan =
    preloadedPlan === undefined
      ? await loadRegistrationPlanForValidation(tx, input)
      : preloadedPlan

  if (!plan) {
    const missing = issue(
      "PLAN_NOT_FOUND",
      "La planilla no existe o no pertenece a tu club.",
      "RELOAD"
    )
    return {
      planId: input.planId,
      revision: -1,
      valid: false,
      summary: EMPTY_SUMMARY,
      issues: [missing],
      pricing: EMPTY_PRICING,
    }
  }

  const disciplineConfigs = plan.event?.disciplineConfigs ?? []
  const pricing = await computePlanPricing(
    coverageLookupFor(tx),
    plan,
    disciplineConfigs
  )
  const summary = buildSummary(plan, pricing)
  const issues: PlanValidationIssue[] = []

  if (
    input.expectedRevision !== undefined &&
    plan.revision !== input.expectedRevision
  ) {
    issues.push(
      issue(
        "REVISION_CONFLICT",
        "La planilla cambió en otra pestaña. Recarga antes de continuar.",
        "RELOAD"
      )
    )
    return {
      planId: plan.id,
      revision: plan.revision,
      valid: false,
      summary,
      issues,
      pricing,
    }
  }

  if (plan.status === "ABANDONED") {
    issues.push(
      issue(
        "PLAN_ABANDONED",
        "Esta planilla fue reemplazada por otra y ya no puede utilizarse.",
        "RELOAD"
      )
    )
  }
  if (input.mode === "CHECKOUT" && plan.status !== "DRAFT") {
    issues.push(
      issue(
        "PLAN_NOT_EDITABLE",
        "La planilla ya está asociada a una orden o fue pagada.",
        "RELOAD"
      )
    )
  }

  if (!plan.event) {
    issues.push(
      issue(
        "EVENT_REQUIRED",
        "Selecciona la competencia antes de validar la planilla.",
        "SELECT_EVENT"
      )
    )
  } else {
    if (plan.event.status !== "OPEN") {
      issues.push(
        issue(
          "EVENT_CLOSED",
          "La competencia no tiene inscripciones abiertas.",
          "SELECT_EVENT"
        )
      )
    }
    if (plan.event.registrationDeadline < now) {
      issues.push(
        issue(
          "DEADLINE_PASSED",
          "El plazo de inscripción de la competencia ya cerró.",
          "CONTACT_FEDERATION"
        )
      )
    }
    if (!plan.event.season) {
      issues.push(
        issue(
          "EVENT_SEASON_REQUIRED",
          "La competencia no tiene una temporada configurada.",
          "CONTACT_FEDERATION"
        )
      )
    }
  }

  if (plan.athletes.length === 0) {
    issues.push(
      issue(
        "EMPTY_ROSTER",
        "Selecciona al menos un deportista para la planilla.",
        "SELECT_ATHLETES"
      )
    )
  }
  if (plan.registrations.length === 0) {
    issues.push(
      issue(
        "EMPTY_PLAN",
        "Asigna al menos una prueba o formación antes de pagar.",
        "EDIT_ENTRY"
      )
    )
  }

  const rosterIds = new Set(plan.athletes.map((row) => row.athleteId))
  const validRosterIds = new Set<string>()
  for (const row of plan.athletes) {
    if (!row.athlete.isActive || row.athlete.clubId !== plan.clubId) {
      issues.push(
        issue(
          "ATHLETE_NOT_AVAILABLE",
          `${athleteName(row.athlete)} ya no está activo en tu club.`,
          "SELECT_ATHLETES",
          { athleteId: row.athleteId }
        )
      )
    } else {
      validRosterIds.add(row.athleteId)
    }
  }

  const usedAthleteIds = new Set<string>()
  const usedModalityIds = new Set<string>()
  const entriesByModality = new Map<string, number>()
  const pairOwner = new Map<string, string>()
  const validUpgradeByModality = new Map<string, boolean>()
  const seasonCategories = plan.event?.season?.categories ?? []

  for (const registration of plan.registrations) {
    const modality = registration.modality
    usedModalityIds.add(modality.id)
    entriesByModality.set(
      modality.id,
      (entriesByModality.get(modality.id) ?? 0) + 1
    )

    if (registration.status !== "IN_CART" && plan.status === "DRAFT") {
      issues.push(
        issue(
          "ENTRY_NOT_EDITABLE",
          `${modalityName(modality)} ya pertenece a una orden en curso o pagada.`,
          "RELOAD",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }

    if (!modality.isActive) {
      issues.push(
        issue(
          "MODALITY_NOT_AVAILABLE",
          `${modalityName(modality)} ya no está disponible.`,
          "REMOVE_ENTRY",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }
    if (!plan.event || modality.eventId !== plan.event.id) {
      issues.push(
        issue(
          "MODALITY_EVENT_MISMATCH",
          `${modalityName(modality)} no pertenece a la competencia seleccionada.`,
          "REMOVE_ENTRY",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }
    if (plan.event && !plan.event.disciplines.includes(modality.discipline)) {
      issues.push(
        issue(
          "DISCIPLINE_MISMATCH",
          `${modalityName(modality)} no corresponde a una disciplina habilitada en la competencia.`,
          "REMOVE_ENTRY",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }

    // «Sub-N» exige piso de año y ningún tope. Si el admin cambió la regla de la
    // disciplina después de crear la prueba, el rango quedó incoherente y la
    // elegibilidad dejaría fuera a quienes sí pueden subir de categoría.
    if (
      !isAgeRuleConfigurationValid(
        modality,
        disciplineConfigFor(disciplineConfigs, modality.discipline)
      )
    ) {
      issues.push(
        issue(
          "AGE_RULE_INVALID",
          `${modalityName(modality)} usa categorías Sub-N pero su rango de años no lo refleja. Avisa a la federación.`,
          "CONTACT_FEDERATION",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }

    const upgradeIsValid = isValidCategoryUpgradeConfiguration(
      modality,
      seasonCategories
    )
    validUpgradeByModality.set(modality.id, upgradeIsValid)
    if (!upgradeIsValid) {
      issues.push(
        issue(
          "UPGRADE_CONFIGURATION_INVALID",
          `${modalityName(modality)} tiene una regla de subida de categoría que no coincide con la temporada.`,
          "CONTACT_FEDERATION",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }

    const athletes = registration.athletes.map((row) => row.athlete)
    for (const row of registration.athletes) {
      usedAthleteIds.add(row.athleteId)
      if (!rosterIds.has(row.athleteId)) {
        issues.push(
          issue(
            "ATHLETE_NOT_IN_ROSTER",
            `${athleteName(row.athlete)} no está en la nómina de esta planilla.`,
            "SELECT_ATHLETES",
            {
              athleteId: row.athleteId,
              modalityId: modality.id,
              registrationId: registration.id,
            }
          )
        )
      }

      const pair = `${modality.id}:${row.athleteId}`
      const previous = pairOwner.get(pair)
      if (previous && previous !== registration.id) {
        issues.push(
          issue(
            "DUPLICATE_ENTRY",
            `${athleteName(row.athlete)} aparece más de una vez en ${modalityName(modality)}.`,
            "EDIT_ENTRY",
            {
              athleteId: row.athleteId,
              modalityId: modality.id,
              registrationId: registration.id,
            }
          )
        )
      } else {
        pairOwner.set(pair, registration.id)
      }

      if (
        upgradeIsValid &&
        modality.categoryUpgradeBirthYear !== null &&
        birthYearOf(row.athlete.birthDate) === modality.categoryUpgradeBirthYear
      ) {
        issues.push(
          issue(
            "CATEGORY_UPGRADE_USED",
            `${athleteName(row.athlete)} compite en la categoría inmediata superior en ${modalityName(modality)}.`,
            "EDIT_ENTRY",
            {
              athleteId: row.athleteId,
              modalityId: modality.id,
              registrationId: registration.id,
            },
            "WARNING"
          )
        )
      }
    }

    const compositionErrors = validateEntryComposition(
      {
        ...modality,
        upgradeYear: upgradeIsValid ? modality.categoryUpgradeBirthYear : null,
      },
      athletes
    )
    for (const message of compositionErrors) {
      issues.push(
        issue(
          "COMPOSITION_INVALID",
          `${modalityName(modality)}: ${message}`,
          "EDIT_ENTRY",
          { modalityId: modality.id, registrationId: registration.id }
        )
      )
    }
  }

  for (const row of plan.athletes) {
    if (!usedAthleteIds.has(row.athleteId)) {
      issues.push(
        issue(
          "ATHLETE_WITHOUT_ENTRY",
          `${athleteName(row.athlete)} todavía no tiene una prueba asignada.`,
          "EDIT_ENTRY",
          { athleteId: row.athleteId },
          "WARNING"
        )
      )
    }
  }

  if (plan.event?.season && usedModalityIds.size > 0) {
    const disciplines = [
      ...new Set(
        plan.registrations.map(
          (registration) => registration.modality.discipline as DisciplineValue
        )
      ),
    ]
    const athleteIds = [...usedAthleteIds]
    const [clubAffiliations, athleteAffiliations] = await Promise.all([
      tx.clubAffiliation.findMany({
        where: {
          clubId: plan.clubId,
          seasonId: plan.event.season.id,
          discipline: { in: disciplines },
          status: "ACTIVE",
          validFrom: { lte: plan.event.startDate },
          validTo: { gte: plan.event.endDate },
        },
        select: { discipline: true },
      }),
      athleteIds.length === 0
        ? Promise.resolve([])
        : tx.athleteAffiliation.findMany({
            where: {
              clubId: plan.clubId,
              seasonId: plan.event.season.id,
              athleteId: { in: athleteIds },
              discipline: { in: disciplines },
              status: "ACTIVE",
              validFrom: { lte: plan.event.startDate },
              validTo: { gte: plan.event.endDate },
            },
            select: { athleteId: true, discipline: true },
          }),
    ])

    const affiliatedClubDisciplines = new Set(
      clubAffiliations.map((row) => row.discipline)
    )
    const affiliatedAthletes = new Set(
      athleteAffiliations.map((row) => `${row.athleteId}:${row.discipline}`)
    )

    for (const discipline of disciplines) {
      if (!affiliatedClubDisciplines.has(discipline)) {
        issues.push(
          issue(
            "CLUB_AFFILIATION_REQUIRED",
            `Tu club no tiene una afiliación de ${disciplineLabel(discipline)} que cubra todas las fechas de la competencia.`,
            "AFFILIATE"
          )
        )
      }
    }

    for (const registration of plan.registrations) {
      const discipline = registration.modality.discipline as DisciplineValue
      for (const row of registration.athletes) {
        const practises = athleteDisciplines(row.athlete.disciplines)
        if (
          !row.athlete.isActive ||
          row.athlete.clubId !== plan.clubId ||
          !validRosterIds.has(row.athleteId)
        ) {
          continue
        }
        if (!practises.includes(discipline)) {
          issues.push(
            issue(
              "DISCIPLINE_MISMATCH",
              `${athleteName(row.athlete)} no tiene ${disciplineLabel(discipline)} registrada en el padrón.`,
              "SELECT_ATHLETES",
              {
                athleteId: row.athleteId,
                modalityId: registration.modalityId,
                registrationId: registration.id,
              }
            )
          )
        }
        if (!affiliatedAthletes.has(`${row.athleteId}:${discipline}`)) {
          issues.push(
            issue(
              "ATHLETE_AFFILIATION_REQUIRED",
              `${athleteName(row.athlete)} no tiene una afiliación de ${disciplineLabel(discipline)} que cubra toda la competencia.`,
              "AFFILIATE",
              {
                athleteId: row.athleteId,
                modalityId: registration.modalityId,
                registrationId: registration.id,
              }
            )
          )
        }
      }
    }
  }

  if (usedModalityIds.size > 0) {
    const modalityIds = [...usedModalityIds]
    const occupied = await tx.registration.groupBy({
      by: ["modalityId"],
      where: {
        modalityId: { in: modalityIds },
        status: { in: ["PENDING_PAYMENT", "PAID"] },
        ...otherPlanFilter(plan.id),
      },
      _count: { modalityId: true },
    })
    const occupiedByModality = new Map(
      occupied.map((row) => [row.modalityId, row._count.modalityId])
    )

    for (const registration of plan.registrations) {
      const modality = registration.modality
      if (modality.capacity === null) continue
      const taken = occupiedByModality.get(modality.id) ?? 0
      const requested = entriesByModality.get(modality.id) ?? 0
      if (taken + requested > modality.capacity) {
        issues.push(
          issue(
            "CAPACITY_EXCEEDED",
            `${modalityName(modality)} solo tiene ${Math.max(0, modality.capacity - taken)} cupo(s) disponible(s).`,
            "SELECT_ANOTHER_MODALITY",
            { modalityId: modality.id, registrationId: registration.id }
          )
        )
      }
    }

    if (usedAthleteIds.size > 0) {
      const duplicates = await tx.registrationAthlete.findMany({
        where: {
          modalityId: { in: modalityIds },
          athleteId: { in: [...usedAthleteIds] },
          registration: {
            status: { in: ["PENDING_PAYMENT", "PAID"] },
            ...otherPlanFilter(plan.id),
          },
        },
        include: {
          athlete: { select: { firstNames: true, lastNames: true } },
          registration: { select: { id: true } },
        },
      })
      for (const duplicate of duplicates) {
        if (!pairOwner.has(`${duplicate.modalityId}:${duplicate.athleteId}`)) continue
        issues.push(
          issue(
            "DUPLICATE_CONFIRMED_ENTRY",
            `${athleteName(duplicate.athlete)} ya está inscrito en esa prueba mediante otra orden.`,
            "EDIT_ENTRY",
            {
              athleteId: duplicate.athleteId,
              modalityId: duplicate.modalityId,
            }
          )
        )
      }
    }
  }

  // Un concepto sigue en pie si el evento lo cobra y el club no lo apago.
  // `null` no es `false`: una planilla que nunca toco la eleccion paga todo.
  //
  // La pregunta NO es "el evento ofrecia elegir" sino "queda algo cobrandose":
  // en un evento multidisciplina los dos conceptos pueden vivir en disciplinas
  // distintas, y en uno de un solo concepto apagar esa unica bandera tambien
  // dejaria la planilla en cero. La server action recibe booleanos del cliente,
  // asi que esta es la unica guarda real.
  const cobraAlgo = pricing.byDiscipline.some(
    (row) =>
      (row.chargesEntry && plan.paysEntry !== false) ||
      (row.chargesAthleteFee && plan.paysAthleteFee !== false)
  )
  if (!cobraAlgo && plan.registrations.length > 0) {
    issues.push(
      issue(
        "CHARGE_SELECTION_REQUIRED",
        "Elige al menos una forma de pago: la inscripción del equipo o la cuota por deportista.",
        "EDIT_ENTRY"
      )
    )
  }

  // Una disciplina que cobra por deportista sin cuota positiva no puede vender.
  for (const discipline of pricing.misconfiguredDisciplines) {
    issues.push(
      issue(
        "DISCIPLINE_PRICING_INVALID",
        `La cuota por deportista de ${disciplineLabel(discipline)} no está configurada. Avisa a la federación.`,
        "CONTACT_FEDERATION"
      )
    )
  }

  // Aviso, no error: al club le sirve saber por qué su total es menor de lo que
  // esperaba cuando inscribe pruebas extra de un deportista que ya pagó.
  for (const line of pricing.lines) {
    if (line.kind !== "ATHLETE_FEE" || !line.alreadyCovered) continue
    issues.push(
      issue(
        "ATHLETE_FEE_ALREADY_PAID",
        `${line.athleteName} ya tiene pagada la cuota de ${disciplineLabel(line.discipline)} de esta competencia${line.coveredByOrderCode ? ` (orden ${line.coveredByOrderCode})` : ""}: no se vuelve a cobrar.`,
        "EDIT_ENTRY",
        { athleteId: line.athleteId },
        "WARNING"
      )
    )
  }

  return {
    planId: plan.id,
    revision: plan.revision,
    valid: !issues.some((row) => row.severity === "ERROR"),
    summary,
    issues,
    pricing,
  }
}

export async function validateRegistrationPlan(
  input: ValidateRegistrationPlanInput
): Promise<PlanValidationResult> {
  const detailed = await prisma.$transaction((tx) =>
    validateRegistrationPlanInTransaction(tx, input)
  )
  // La versión pública deja fuera `pricing`: lleva Prisma.Decimal, que no
  // sobrevive el paso a un componente cliente.
  return {
    planId: detailed.planId,
    revision: detailed.revision,
    valid: detailed.valid,
    summary: detailed.summary,
    issues: detailed.issues,
  }
}
