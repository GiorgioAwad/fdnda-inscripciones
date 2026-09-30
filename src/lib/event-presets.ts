import { DISCIPLINE_VALUES, type DisciplineValue } from "./disciplines"
import type { AgeRuleModeValue } from "./event-pricing"

// Cómo se ve un evento de cada disciplina: cómo cobra, cómo mide las edades y
// qué pruebas suele tener. Es lo que hace que el formulario de creación cambie
// por completo según la disciplina elegida, en vez de pedir siempre los mismos
// campos genéricos.
//
// Agregar natación = una entrada acá + lib/disciplines.ts + la migración propia
// del enum Discipline (ver «Agregar una disciplina» en el README).

export type SexRuleValue = "MALE" | "FEMALE" | "MIXED" | "ANY"

export interface ModalityPreset {
  name: string
  /** Sexos que se generan por defecto para esta prueba. */
  sexRules: SexRuleValue[]
  minAthletes: number
  maxAthletes: number
}

export interface DisciplinePreset {
  defaultChargesEntry: boolean
  defaultChargesAthleteFee: boolean
  defaultAgeRuleMode: AgeRuleModeValue
  /** Explica al admin qué significa el modo de cobro en esta disciplina. */
  pricingHint: string
  /** Explica cómo se escriben las categorías de esta disciplina. */
  categoryHint: string
  /**
   * Ejemplo para el campo «Nombre de la categoría». Antes era el texto
   * «Nombre|desde|hasta» del generador en lote; las categorías ahora se cargan
   * en filas con un campo por dato.
   */
  categoryPlaceholder: string
  modalities: ModalityPreset[]
}

const INDIVIDUAL: Pick<ModalityPreset, "minAthletes" | "maxAthletes"> = {
  minAthletes: 1,
  maxAthletes: 1,
}

export const DISCIPLINE_PRESETS: Record<DisciplineValue, DisciplinePreset> = {
  DIVING: {
    // Un clavadista paga una sola vez por el evento, haga una prueba o seis.
    defaultChargesEntry: false,
    defaultChargesAthleteFee: true,
    defaultAgeRuleMode: "RANGE",
    pricingHint:
      "Cada clavadista paga una cuota de competencia fija por toda la competencia, sin importar cuántas pruebas haga.",
    categoryHint: "Categorías por rango de años de nacimiento (Grupo A, B, C…).",
    categoryPlaceholder: "Grupo D",
    modalities: [
      { name: "Trampolín 1m", sexRules: ["FEMALE", "MALE"], ...INDIVIDUAL },
      { name: "Trampolín 3m", sexRules: ["FEMALE", "MALE"], ...INDIVIDUAL },
      { name: "Plataforma", sexRules: ["FEMALE", "MALE"], ...INDIVIDUAL },
      {
        name: "Sincronizados 3m",
        sexRules: ["FEMALE", "MALE", "MIXED"],
        minAthletes: 2,
        maxAthletes: 2,
      },
    ],
  },
  ARTISTIC_SWIMMING: {
    defaultChargesEntry: true,
    defaultChargesAthleteFee: false,
    defaultAgeRuleMode: "RANGE",
    pricingHint:
      "Cada prueba tiene su precio por formación: lo paga una vez cada solo, dueto o equipo.",
    categoryHint:
      "Categorías por rango de años de nacimiento. Solo en esta disciplina existe «Sube de categoría».",
    categoryPlaceholder: "Infantil A",
    modalities: [
      { name: "Solo Libre", sexRules: ["FEMALE"], ...INDIVIDUAL },
      { name: "Figuras", sexRules: ["FEMALE"], ...INDIVIDUAL },
      { name: "Estrellas", sexRules: ["FEMALE"], ...INDIVIDUAL },
      {
        name: "Dueto Libre",
        sexRules: ["FEMALE", "MIXED"],
        minAthletes: 2,
        maxAthletes: 2,
      },
      {
        name: "Equipo Libre",
        sexRules: ["FEMALE"],
        minAthletes: 4,
        maxAthletes: 8,
      },
    ],
  },
  WATER_POLO: {
    defaultChargesEntry: true,
    defaultChargesAthleteFee: true,
    defaultAgeRuleMode: "RANGE",
    pricingHint:
      "Se cobra el precio por formación de cada plantel y además una cuota de competencia por cada jugador. Cada club elige en su planilla cuál paga, o ambos.",
    categoryHint:
      "Categorías por rango de años de nacimiento, igual que en las demás disciplinas.",
    categoryPlaceholder: "Sub-16",
    modalities: [
      {
        name: "Plantel",
        sexRules: ["FEMALE", "MALE"],
        minAthletes: 7,
        maxAthletes: 13,
      },
    ],
  },
}

export function disciplinePreset(discipline: DisciplineValue): DisciplinePreset {
  return DISCIPLINE_PRESETS[discipline]
}

/** Comprobación de exhaustividad: una disciplina nueva sin preset falla acá. */
export function assertPresetsCoverAllDisciplines(): void {
  const missing = DISCIPLINE_VALUES.filter(
    (discipline) => DISCIPLINE_PRESETS[discipline] === undefined
  )
  if (missing.length > 0) {
    throw new Error(`Faltan presets de evento para: ${missing.join(", ")}`)
  }
}
