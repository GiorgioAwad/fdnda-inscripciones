import { Prisma } from "@prisma/client"
import { isDiscipline, type DisciplineValue } from "./disciplines"

// Fuente única de "cómo cobra y cómo mide las edades cada disciplina dentro de un
// evento". La configuración vive en EventDisciplineConfig, pero NO todos los
// eventos tienen fila: los creados antes de esa tabla no tienen ninguna.
//
// De ahí la regla que sostiene todo el rollout: AUSENCIA DE FILA = PER_ENTRY +
// RANGE, es decir el comportamiento histórico (precio por formación, ventana
// birthYearFrom..birthYearTo). Ningún evento anterior cambia de precio ni de
// elegibilidad por el hecho de existir esta tabla.

export type PricingModeValue = "PER_ENTRY" | "PER_ATHLETE"
export type AgeRuleModeValue = "RANGE" | "MAX_AGE_ONLY"

export const DEFAULT_PRICING_MODE: PricingModeValue = "PER_ENTRY"
export const DEFAULT_AGE_RULE_MODE: AgeRuleModeValue = "RANGE"

// Forma mínima que necesita este módulo. Se declara acá en vez de importar el
// tipo de Prisma para que las funciones puras sigan siendo testeables sin base.
export interface EventDisciplineConfigLike {
  discipline: string
  pricingMode: string
  athleteFee: unknown
  ageRuleMode: string
}

export interface EffectiveDisciplineConfig {
  discipline: DisciplineValue
  pricingMode: PricingModeValue
  // Monto de la cuota fija por deportista, como string decimal para no perder
  // precisión al cruzar el límite servidor/cliente. null en PER_ENTRY.
  athleteFee: string | null
  ageRuleMode: AgeRuleModeValue
}

function pricingModeOf(value: string): PricingModeValue {
  return value === "PER_ATHLETE" ? "PER_ATHLETE" : DEFAULT_PRICING_MODE
}

function ageRuleModeOf(value: string): AgeRuleModeValue {
  return value === "MAX_AGE_ONLY" ? "MAX_AGE_ONLY" : DEFAULT_AGE_RULE_MODE
}

/**
 * Configuración efectiva de una disciplina en un evento. Sin fila devuelve el
 * default histórico, así que es seguro llamarla para cualquier evento.
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
      pricingMode: DEFAULT_PRICING_MODE,
      athleteFee: null,
      ageRuleMode: DEFAULT_AGE_RULE_MODE,
    }
  }

  const pricingMode = pricingModeOf(row.pricingMode)
  return {
    discipline: normalized,
    pricingMode,
    // La cuota solo tiene sentido en PER_ATHLETE; en PER_ENTRY se ignora aunque
    // haya quedado un valor de una configuración anterior.
    athleteFee:
      pricingMode === "PER_ATHLETE" && row.athleteFee != null
        ? String(row.athleteFee)
        : null,
    ageRuleMode: ageRuleModeOf(row.ageRuleMode),
  }
}

/**
 * Una disciplina PER_ATHLETE sin cuota positiva está mal configurada: el evento
 * no puede cobrar. Se detecta al abrir el evento (admin) y otra vez al validar
 * la planilla, por si la configuración cambió después.
 */
export function isPricingConfigurationValid(
  config: EffectiveDisciplineConfig
): boolean {
  if (config.pricingMode !== "PER_ATHLETE") return true
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
  pricingMode: PricingModeValue
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
  /** Disciplinas PER_ATHLETE sin cuota positiva: el evento no puede cobrar. */
  misconfiguredDisciplines: DisciplineValue[]
}

// Forma mínima de una planilla para calcular su precio. Se declara acá para que
// el motor no dependa del tipo generado por Prisma y siga siendo testeable.
export interface PricingPlanLike {
  id: string
  eventId: string | null
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
 * En disciplinas PER_ATHLETE las formaciones valen 0 y el cobro se concentra en
 * una cuota por deportista, que además se omite si ese deportista ya la pagó en
 * otra orden del mismo evento (planilla suplementaria).
 */
export async function computePlanPricing(
  lookupCoverage: CoverageLookup,
  plan: PricingPlanLike,
  configs: readonly EventDisciplineConfigLike[]
): Promise<PlanPricing> {
  const lines: PlanPricingLine[] = []
  const misconfigured = new Set<DisciplineValue>()

  // Deportistas distintos por disciplina, en orden estable de aparición.
  const athletesByDiscipline = new Map<
    DisciplineValue,
    Map<string, { firstNames: string; lastNames: string }>
  >()

  for (const registration of plan.registrations) {
    const config = disciplineConfigFor(configs, registration.modality.discipline)
    const perAthlete = config.pricingMode === "PER_ATHLETE"
    if (perAthlete && !isPricingConfigurationValid(config)) {
      misconfigured.add(config.discipline)
    }

    lines.push({
      kind: "ENTRY",
      discipline: config.discipline,
      registrationId: registration.id,
      // En PER_ATHLETE la formación no cuesta: el cobro va en la cuota.
      amount: perAthlete
        ? new Prisma.Decimal(0)
        : new Prisma.Decimal(String(registration.modality.price)),
      alreadyCovered: false,
    })

    if (!perAthlete) continue
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
    const summary =
      byDiscipline.get(line.discipline) ??
      ({
        discipline: line.discipline,
        pricingMode: disciplineConfigFor(configs, line.discipline).pricingMode,
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

  // Deportistas distintos también en las disciplinas que cobran por formación.
  for (const registration of plan.registrations) {
    const config = disciplineConfigFor(configs, registration.modality.discipline)
    if (config.pricingMode === "PER_ATHLETE") continue
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
