import { Prisma } from "@prisma/client"
import { isDiscipline, type DisciplineValue } from "./disciplines"

// Fuente única de "cómo cobra y cómo mide las edades cada disciplina dentro de un
// evento". La configuración vive en EventDisciplineConfig, pero NO todos los
// eventos tienen fila: los creados antes de esa tabla no tienen ninguna.
//
// De ahí la regla que sostiene todo el rollout: AUSENCIA DE FILA = cobra por
// formación (chargesEntry) y RANGE, es decir el comportamiento histórico
// (precio por formación, ventana birthYearFrom..birthYearTo). Ningún evento
// anterior cambia de precio ni de elegibilidad por el hecho de existir esta
// tabla.

export type AgeRuleModeValue = "RANGE" | "MAX_AGE_ONLY"

export const DEFAULT_AGE_RULE_MODE: AgeRuleModeValue = "RANGE"

// Forma mínima que necesita este módulo. Se declara acá en vez de importar el
// tipo de Prisma para que las funciones puras sigan siendo testeables sin base.
export interface EventDisciplineConfigLike {
  discipline: string
  chargesEntry: boolean
  chargesAthleteFee: boolean
  athleteFee: unknown
  ageRuleMode: string
}

export interface EffectiveDisciplineConfig {
  discipline: DisciplineValue
  // Los dos son independientes: polo prende los dos y los cobros se suman.
  chargesEntry: boolean
  chargesAthleteFee: boolean
  // Monto de la cuota por deportista, como string decimal para no perder
  // precisión al cruzar el límite servidor/cliente. null si no se cobra.
  athleteFee: string | null
  ageRuleMode: AgeRuleModeValue
}

function ageRuleModeOf(value: string): AgeRuleModeValue {
  return value === "MAX_AGE_ONLY" ? "MAX_AGE_ONLY" : DEFAULT_AGE_RULE_MODE
}

/**
 * Configuración efectiva de una disciplina en un evento. Sin fila devuelve el
 * default histórico —cobra por formación—, así que es seguro llamarla para
 * cualquier evento, incluidos los anteriores a esta tabla.
 */
export function disciplineConfigFor(
  configs: readonly EventDisciplineConfigLike[],
  discipline: string
): EffectiveDisciplineConfig {
  // Disciplina desconocida (dato viejo): se trata como el default, igual que
  // hace disciplineStyle en lib/disciplines.
  const normalized: DisciplineValue = isDiscipline(discipline)
    ? discipline
    : "DIVING"
  const row = configs.find((config) => config.discipline === discipline)
  if (!row) {
    return {
      discipline: normalized,
      chargesEntry: true,
      chargesAthleteFee: false,
      athleteFee: null,
      ageRuleMode: DEFAULT_AGE_RULE_MODE,
    }
  }

  return {
    discipline: normalized,
    chargesEntry: row.chargesEntry,
    chargesAthleteFee: row.chargesAthleteFee,
    // La cuota solo tiene sentido si se cobra; si el concepto se apagó, un
    // valor residual de una configuración anterior se ignora.
    athleteFee:
      row.chargesAthleteFee && row.athleteFee != null
        ? String(row.athleteFee)
        : null,
    ageRuleMode: ageRuleModeOf(row.ageRuleMode),
  }
}

/**
 * Un concepto habilitado sin precio no puede vender. La cuota por deportista es
 * la única que se valida acá: el precio de la formación vive en la prueba.
 */
export function isPricingConfigurationValid(
  config: EffectiveDisciplineConfig
): boolean {
  if (!config.chargesAthleteFee) return true
  if (config.athleteFee === null) return false
  const fee = Number(config.athleteFee)
  return Number.isFinite(fee) && fee > 0
}

/**
 * En MAX_AGE_ONLY ("Sub-N") la prueba solo tiene tope de edad: admite a los
 * nacidos en birthYearFrom o después. Por eso birthYearFrom es obligatorio y
 * birthYearTo debe ser null — así un sub-13 entra a sub-18, pero un sub-18
 * nunca baja a sub-13.
 */
export function isAgeRuleConfigurationValid(
  modality: { birthYearFrom: number | null; birthYearTo: number | null },
  config: Pick<EffectiveDisciplineConfig, "ageRuleMode">
): boolean {
  if (config.ageRuleMode !== "MAX_AGE_ONLY") return true
  return modality.birthYearFrom !== null && modality.birthYearTo === null
}

/**
 * Año de nacimiento tope para una categoría "Sub-N" de una temporada dada.
 * Sub-18 en la temporada 2026 admite a los nacidos en 2009 o después.
 */
export function birthYearForMaxAge(seasonYear: number, maxAgeYears: number): number {
  return seasonYear - maxAgeYears + 1
}

/** Inversa de birthYearForMaxAge, para re-renderizar "Sub-N" desde el año guardado. */
export function maxAgeForBirthYear(seasonYear: number, birthYearFrom: number): number {
  return seasonYear - birthYearFrom + 1
}

// ==================== CÁLCULO DEL IMPORTE DE UNA PLANILLA ====================

export type PricingLineKind = "ENTRY" | "ATHLETE_FEE"

export interface PlanPricingLine {
  kind: PricingLineKind
  discipline: DisciplineValue
  amount: Prisma.Decimal
  /** Solo en ENTRY. */
  registrationId?: string
  /** Solo en ATHLETE_FEE. */
  athleteId?: string
  athleteName?: string
  /** Solo en ATHLETE_FEE: la cuota ya se pagó (o está en otra orden viva). */
  alreadyCovered: boolean
  /** Orden que ya cubre la cuota, para poder explicarlo en la UI. */
  coveredByOrderCode?: string
}

export interface DisciplinePricingSummary {
  discipline: DisciplineValue
  // Qué cobra el evento en esta disciplina. Los dos pueden ser ciertos.
  chargesEntry: boolean
  chargesAthleteFee: boolean
  entryCount: number
  /** Deportistas distintos con al menos una formación en la disciplina. */
  athleteCount: number
  entriesAmount: number
  feesAmount: number
  subtotal: number
}

export interface PlanPricing {
  lines: PlanPricingLine[]
  /** Las que efectivamente se cobran: excluye las cuotas ya cubiertas. */
  chargeableLines: PlanPricingLine[]
  total: Prisma.Decimal
  byDiscipline: DisciplinePricingSummary[]
  coveredAthleteFees: number
  /** Disciplinas con un concepto habilitado pero sin cuota positiva: el evento no puede cobrar. */
  misconfiguredDisciplines: DisciplineValue[]
}

// Forma mínima de una planilla para calcular su precio. Se declara acá para que
// el motor no dependa del tipo generado por Prisma y siga siendo testeable.
export interface PricingPlanLike {
  id: string
  eventId: string | null
  /** Qué conceptos eligió pagar el club. null = lo que diga el evento. */
  paysEntry?: boolean | null
  paysAthleteFee?: boolean | null
  registrations: Array<{
    id: string
    modality: { discipline: string; price: unknown }
    athletes: Array<{
      athleteId: string
      athlete: { firstNames: string; lastNames: string }
    }>
  }>
}

/** Cuota ya emitida para un par (disciplina, deportista) del evento. */
export interface CoveredAthleteFee {
  discipline: string
  athleteId: string
  /** Orden que la cubre, si se conoce. Sirve para explicarlo en la UI. */
  orderCode?: string
}

/**
 * Consulta de cobertura. Es un callback en vez de un cliente de base para que el
 * motor no dependa de Prisma y la consulta viva donde está la transacción.
 */
export type CoverageLookup = (input: {
  eventId: string
  disciplines: DisciplineValue[]
  athleteIds: string[]
}) => Promise<CoveredAthleteFee[]>

/**
 * Importe de una planilla, con el desglose que consumen la validación, el
 * checkout y el resumen. Es la única fuente del total: nadie más suma precios.
 *
 * Cada disciplina puede cobrar por formación, por deportista, o los dos a la
 * vez (polo). Si el evento no cobra un concepto, la formación (o la cuota) vale
 * 0. La elección del club (paysEntry/paysAthleteFee) puede apagar un concepto
 * que el evento sí cobra, pero nunca prender uno que el evento no cobra. La
 * cuota por deportista además se omite si ese deportista ya la pagó en otra
 * orden del mismo evento (planilla suplementaria).
 */
export async function computePlanPricing(
  lookupCoverage: CoverageLookup,
  plan: PricingPlanLike,
  configs: readonly EventDisciplineConfigLike[]
): Promise<PlanPricing> {
  const lines: PlanPricingLine[] = []
  const misconfigured = new Set<DisciplineValue>()

  // La elección del club NUNCA prende un concepto que el evento no cobra: solo
  // puede apagar uno. Por eso es un AND, no un OR.
  const paysEntry = plan.paysEntry ?? true
  const paysAthleteFee = plan.paysAthleteFee ?? true

  // Deportistas distintos por disciplina, en orden estable de aparición.
  const athletesByDiscipline = new Map<
    DisciplineValue,
    Map<string, { firstNames: string; lastNames: string }>
  >()

  for (const registration of plan.registrations) {
    const config = disciplineConfigFor(configs, registration.modality.discipline)
    const chargeEntry = config.chargesEntry && paysEntry
    const chargeFee = config.chargesAthleteFee && paysAthleteFee
    if (chargeFee && !isPricingConfigurationValid(config)) {
      misconfigured.add(config.discipline)
    }

    lines.push({
      kind: "ENTRY",
      discipline: config.discipline,
      registrationId: registration.id,
      // La línea existe siempre —es el registro nominal— pero vale 0 cuando
      // este plan no paga por formación.
      amount: chargeEntry
        ? new Prisma.Decimal(String(registration.modality.price))
        : new Prisma.Decimal(0),
      alreadyCovered: false,
    })

    if (!chargeFee) continue
    const bucket =
      athletesByDiscipline.get(config.discipline) ??
      new Map<string, { firstNames: string; lastNames: string }>()
    for (const row of registration.athletes) {
      if (!bucket.has(row.athleteId)) bucket.set(row.athleteId, row.athlete)
    }
    athletesByDiscipline.set(config.discipline, bucket)
  }

  // Una sola consulta, y solo si hay alguna disciplina que cobre por deportista.
  const covered = new Map<string, string | undefined>()
  if (athletesByDiscipline.size > 0 && plan.eventId) {
    const rows = await lookupCoverage({
      eventId: plan.eventId,
      disciplines: [...athletesByDiscipline.keys()],
      athleteIds: [
        ...new Set(
          [...athletesByDiscipline.values()].flatMap((bucket) => [...bucket.keys()])
        ),
      ],
    })
    for (const row of rows) {
      covered.set(`${row.discipline}:${row.athleteId}`, row.orderCode)
    }
  }

  for (const [discipline, bucket] of athletesByDiscipline) {
    const config = disciplineConfigFor(configs, discipline)
    const fee = new Prisma.Decimal(config.athleteFee ?? 0)
    for (const [athleteId, athlete] of bucket) {
      const key = `${discipline}:${athleteId}`
      const isCovered = covered.has(key)
      lines.push({
        kind: "ATHLETE_FEE",
        discipline,
        athleteId,
        athleteName: `${athlete.lastNames}, ${athlete.firstNames}`,
        amount: fee,
        alreadyCovered: isCovered,
        coveredByOrderCode: covered.get(key),
      })
    }
  }

  const chargeableLines = lines.filter((line) => !line.alreadyCovered)
  const total = chargeableLines.reduce(
    (sum, line) => sum.add(line.amount),
    new Prisma.Decimal(0)
  )

  const byDiscipline = new Map<DisciplineValue, DisciplinePricingSummary>()
  for (const line of lines) {
    const config = disciplineConfigFor(configs, line.discipline)
    const summary =
      byDiscipline.get(line.discipline) ??
      ({
        discipline: line.discipline,
        chargesEntry: config.chargesEntry,
        chargesAthleteFee: config.chargesAthleteFee,
        entryCount: 0,
        athleteCount: 0,
        entriesAmount: 0,
        feesAmount: 0,
        subtotal: 0,
      } satisfies DisciplinePricingSummary)

    if (line.kind === "ENTRY") {
      summary.entryCount += 1
      summary.entriesAmount += Number(line.amount)
    } else {
      summary.athleteCount += 1
      if (!line.alreadyCovered) summary.feesAmount += Number(line.amount)
    }
    if (!line.alreadyCovered) summary.subtotal += Number(line.amount)
    byDiscipline.set(line.discipline, summary)
  }

  // Deportistas distintos también en las disciplinas que no emiten línea de cuota.
  for (const registration of plan.registrations) {
    const config = disciplineConfigFor(configs, registration.modality.discipline)
    if (config.chargesAthleteFee && paysAthleteFee) continue
    const summary = byDiscipline.get(config.discipline)
    if (!summary) continue
    summary.athleteCount = countDistinctAthletes(plan, config.discipline, configs)
  }

  return {
    lines,
    chargeableLines,
    total,
    byDiscipline: [...byDiscipline.values()],
    coveredAthleteFees: lines.filter(
      (line) => line.kind === "ATHLETE_FEE" && line.alreadyCovered
    ).length,
    misconfiguredDisciplines: [...misconfigured],
  }
}

function countDistinctAthletes(
  plan: PricingPlanLike,
  discipline: DisciplineValue,
  configs: readonly EventDisciplineConfigLike[]
): number {
  const ids = new Set<string>()
  for (const registration of plan.registrations) {
    if (
      disciplineConfigFor(configs, registration.modality.discipline).discipline !==
      discipline
    ) {
      continue
    }
    for (const row of registration.athletes) ids.add(row.athleteId)
  }
  return ids.size
}
