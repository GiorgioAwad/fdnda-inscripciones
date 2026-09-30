import { disciplineLabel } from "./disciplines"
import {
  disciplineConfigFor,
  isAgeRuleConfigurationValid,
  isPricingConfigurationValid,
  type EventDisciplineConfigLike,
} from "./event-pricing"
import { leagueEntryPrice } from "./league"
import { formatDateTimeLima } from "./utils"

// Qué le falta a una competencia para abrir inscripciones. Antes estas reglas
// vivían solo dentro de setEventStatus y el admin las descubría de a una:
// pulsaba «Abrir inscripciones», leía un toast, corregía y volvía a pulsar. Ahora
// la misma lista alimenta la guarda del servidor y la tarjeta de requisitos del
// detalle, así que lo que la pantalla marca como listo es exactamente lo que el
// servidor acepta.
//
// Puro y sin Prisma para poder probarlo sin base.

export interface ReadinessModality {
  name: string
  category: string | null
  discipline: string
  isActive: boolean
  price: number
  pricePerMatch: number | null
  matchesPerTeam: number | null
  expectedTeams: number | null
  birthYearFrom: number | null
  birthYearTo: number | null
  allowsCategoryUpgrade: boolean
  categoryUpgradeBirthYear: number | null
}

export interface ReadinessInput {
  registrationDeadline: Date
  isLeague: boolean
  disciplines: readonly string[]
  disciplineConfigs: readonly EventDisciplineConfigLike[]
  /** null = la competencia no tiene temporada. */
  season: { name: string; feeDisciplines: readonly string[] } | null
  /** Todas las pruebas, activas o no: las inactivas no cuentan para abrir. */
  modalities: readonly ReadinessModality[]
}

export type ReadinessKey =
  | "SEASON"
  | "DEADLINE"
  | "ACTIVE_MODALITY"
  | "LEAGUE"
  | "ATHLETE_FEE"
  | "AGE_RULE"
  | "MODALITY_DISCIPLINE"
  | "AFFILIATION_FEE"
  | "CATEGORY_UPGRADE"

export interface ReadinessCheck {
  key: ReadinessKey
  /** El requisito dicho en positivo, tal como se lee en la lista. */
  label: string
  ok: boolean
  /** Qué falta y cómo resolverlo. Solo cuando `ok` es false. */
  problem: string | null
}

export interface EventReadiness {
  /** Los requisitos que aplican a esta competencia, en el orden en que se revisan. */
  checks: ReadinessCheck[]
  missing: ReadinessCheck[]
  ready: boolean
}

const EDIT_EVENT = "«Editar datos de la competencia»"

/**
 * Adapta una prueba tal como la devuelve Prisma (montos en Decimal) a la forma
 * que revisa este módulo. La usan la server action y la página de detalle, para
 * que las dos lean los mismos campos.
 */
export function readinessModalityFrom(modality: {
  name: string
  category: string | null
  discipline: string
  isActive: boolean
  price: unknown
  pricePerMatch: unknown
  matchesPerTeam: number | null
  expectedTeams: number | null
  birthYearFrom: number | null
  birthYearTo: number | null
  allowsCategoryUpgrade: boolean
  categoryUpgradeBirthYear: number | null
}): ReadinessModality {
  return {
    name: modality.name,
    category: modality.category,
    discipline: modality.discipline,
    isActive: modality.isActive,
    price: Number(modality.price),
    pricePerMatch:
      modality.pricePerMatch === null || modality.pricePerMatch === undefined
        ? null
        : Number(modality.pricePerMatch),
    matchesPerTeam: modality.matchesPerTeam,
    expectedTeams: modality.expectedTeams,
    birthYearFrom: modality.birthYearFrom,
    birthYearTo: modality.birthYearTo,
    allowsCategoryUpgrade: modality.allowsCategoryUpgrade,
    categoryUpgradeBirthYear: modality.categoryUpgradeBirthYear,
  }
}

/** «Trampolín 3m · Grupo C — Damas»: el nombre solo se repite en cada categoría. */
export function modalityDisplayName(modality: {
  name: string
  category: string | null
}): string {
  return [modality.name, modality.category].filter(Boolean).join(" · ")
}

function check(
  key: ReadinessKey,
  label: string,
  problem: string | null
): ReadinessCheck {
  return { key, label, ok: problem === null, problem }
}

function isLeagueModalityComplete(modality: ReadinessModality): boolean {
  return (
    modality.pricePerMatch !== null &&
    modality.matchesPerTeam !== null &&
    modality.matchesPerTeam >= 1 &&
    modality.matchesPerTeam <= 40 &&
    modality.expectedTeams !== null &&
    modality.expectedTeams >= 1 &&
    modality.expectedTeams <= 40 &&
    modality.price ===
      leagueEntryPrice({
        pricePerMatch: modality.pricePerMatch,
        matchesPerTeam: modality.matchesPerTeam,
      })
  )
}

export function eventReadiness(
  input: ReadinessInput,
  now: Date = new Date()
): EventReadiness {
  const checks: ReadinessCheck[] = []
  const active = input.modalities.filter((modality) => modality.isActive)
  const configFor = (discipline: string) =>
    disciplineConfigFor(input.disciplineConfigs, discipline)

  checks.push(
    check(
      "SEASON",
      "Temporada asignada",
      input.season
        ? null
        : `Asigna una temporada a la competencia en ${EDIT_EVENT}.`
    )
  )

  const deadline = formatDateTimeLima(input.registrationDeadline)
  checks.push(
    check(
      "DEADLINE",
      `Cierre de inscripciones en el futuro (${deadline})`,
      input.registrationDeadline > now
        ? null
        : `El cierre de inscripciones (${deadline}) ya pasó. Pon una fecha futura en ${EDIT_EVENT}.`
    )
  )

  checks.push(
    check(
      "ACTIVE_MODALITY",
      input.modalities.length > 0
        ? `Al menos una prueba activa (${active.length} de ${input.modalities.length} activas)`
        : "Al menos una prueba activa",
      active.length > 0
        ? null
        : input.modalities.length === 0
          ? "Agrega al menos una prueba: créala o genérala en lote."
          : "Todas las pruebas están desactivadas: activa al menos una."
    )
  )

  if (input.isLeague) {
    const incomplete = active.find((modality) => !isLeagueModalityComplete(modality))
    checks.push(
      check(
        "LEAGUE",
        "Pruebas de liga con precio por partido, partidos por plantel y planteles esperados",
        incomplete
          ? `Completa el precio por partido, los partidos por plantel y los planteles esperados de «${modalityDisplayName(incomplete)}».`
          : null
      )
    )
  }

  // Una disciplina que cobra cuota fija sin monto no puede vender nada.
  if (input.disciplines.some((discipline) => configFor(discipline).chargesAthleteFee)) {
    const misconfigured = input.disciplines.find(
      (discipline) => !isPricingConfigurationValid(configFor(discipline))
    )
    checks.push(
      check(
        "ATHLETE_FEE",
        "Cuota de competencia por deportista mayor que S/ 0",
        misconfigured
          ? `La cuota de competencia por deportista de ${disciplineLabel(misconfigured)} debe ser mayor que S/ 0. Corrígela en ${EDIT_EVENT}.`
          : null
      )
    )
  }

  // En «Sub-N» la prueba solo puede tener piso de año, o quedar sin ambos
  // límites cuando es Open. Un tope superior excluiría a los más jóvenes.
  const usesMaxAge = [...input.disciplines, ...active.map((m) => m.discipline)].some(
    (discipline) => configFor(discipline).ageRuleMode === "MAX_AGE_ONLY"
  )
  if (usesMaxAge) {
    const badAgeRule = active.find(
      (modality) => !isAgeRuleConfigurationValid(modality, configFor(modality.discipline))
    )
    checks.push(
      check(
        "AGE_RULE",
        "Pruebas Sub-N u Open sin año de nacimiento «hasta»",
        badAgeRule
          ? `«${modalityDisplayName(badAgeRule)}» tiene un año «hasta», pero su disciplina usa categorías Sub-N u Open. Edita la prueba y guárdala para quitarlo.`
          : null
      )
    )
  }

  // Solo aparece si falla: pasa únicamente con competencias antiguas de varias
  // disciplinas.
  const foreign = active.find((modality) => !input.disciplines.includes(modality.discipline))
  if (foreign) {
    checks.push(
      check(
        "MODALITY_DISCIPLINE",
        "Pruebas de las disciplinas de la competencia",
        `«${modalityDisplayName(foreign)}» es de ${disciplineLabel(foreign.discipline)}, que no es una disciplina de esta competencia. Desactívala o elimínala.`
      )
    )
  }

  if (input.season) {
    // Se revisan las disciplinas de las pruebas activas, que es lo que se va a
    // vender. Sin pruebas activas se muestran las de la competencia para avisar
    // antes de crearlas; ese caso ya lo bloquea ACTIVE_MODALITY.
    const disciplines = [
      ...new Set(
        active.length > 0 ? active.map((m) => m.discipline) : input.disciplines
      ),
    ]
    const withoutFee = disciplines.find(
      (discipline) => !input.season!.feeDisciplines.includes(discipline)
    )
    checks.push(
      check(
        "AFFILIATION_FEE",
        `Cuota de afiliación de ${disciplines.map(disciplineLabel).join(" y ")} en «${input.season.name}»`,
        withoutFee
          ? `«${input.season.name}» no tiene cuota de afiliación de ${disciplineLabel(withoutFee)}. Configúrala en Temporadas.`
          : null
      )
    )
  }

  const badUpgrade = active.find(
    (modality) =>
      modality.allowsCategoryUpgrade &&
      (modality.discipline !== "ARTISTIC_SWIMMING" ||
        modality.categoryUpgradeBirthYear === null)
  )
  if (badUpgrade) {
    checks.push(
      check(
        "CATEGORY_UPGRADE",
        "Pruebas con «Sube de categoría» bien configuradas",
        // Guardar la prueba de nuevo lo resuelve en los dos casos: fuera de
        // artística el diálogo no muestra la casilla y la envía desmarcada, y en
        // artística saveModality recalcula el año de ascenso.
        badUpgrade.discipline !== "ARTISTIC_SWIMMING"
          ? `«${modalityDisplayName(badUpgrade)}» tiene «Sube de categoría», que solo aplica a ${disciplineLabel("ARTISTIC_SWIMMING")}. Edita la prueba y guárdala para quitar la opción.`
          : `«${modalityDisplayName(badUpgrade)}» tiene «Sube de categoría» sin año de ascenso. Edita la prueba y guárdala de nuevo, o desmarca la opción.`
      )
    )
  }

  const missing = checks.filter((item) => !item.ok)
  return { checks, missing, ready: missing.length === 0 }
}
