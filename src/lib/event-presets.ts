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
  /** Placeholder del textarea de categorías del generador masivo. */
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
      "Cada clavadista paga una cuota fija por todo el evento, sin importar cuántas pruebas haga.",
    categoryHint: "Grupos por rango de año de nacimiento (Grupo A, B, C…).",
    categoryPlaceholder: "Grupo D|2015|2017\nGrupo C|2013|2014\nGrupo B|2011|2012",
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
      "Cada prueba tiene su propio precio y se cobra una vez por formación (un solo, un dueto, un equipo).",
    categoryHint:
      "Categorías por rango de año de nacimiento. Solo acá aplica «sube de categoría».",
    categoryPlaceholder:
      "Juvenil|2010|2012\nInfantil A|2013|2014\nInfantil B|2015|2016",
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
      "Se cobra la inscripción del plantel y además una cuota por cada jugador. El club elige cuáles paga.",
    categoryHint:
      "Categorías por rango de año de nacimiento, igual que en las demás disciplinas.",
    categoryPlaceholder: "Sub 14|2013|2016\nSub 16|2011|2012\nSub 18|2009|2010",
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
