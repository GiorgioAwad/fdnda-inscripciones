// El campeonato de niveles de natación artística separa a los mismos
// deportistas en tres niveles técnicos, y cada nivel tiene su propia tabla de
// categorías por edad. Acá viven esas tablas, tal como las publican las «Bases
// Generales del Campeonato de Niveles», y la aritmética que las convierte en
// años de nacimiento.
//
// Es el gemelo de lib/league.ts: puro, sin Prisma, porque lo usan el formulario
// del admin y la server action, y porque así se puede verificar contra el PDF
// de las bases sin levantar una base de datos.

import type { CategorySpec } from "./event-categories"

export const ARTISTIC_LEVEL_VALUES = ["BASICO", "INTERMEDIO", "AVANZADO"] as const

export type ArtisticLevelValue = (typeof ARTISTIC_LEVEL_VALUES)[number]

export const ARTISTIC_LEVEL_LABELS: Record<ArtisticLevelValue, string> = {
  BASICO: "Básico",
  INTERMEDIO: "Intermedio",
  AVANZADO: "Avanzado",
}

export function isArtisticLevel(value: unknown): value is ArtisticLevelValue {
  return (
    typeof value === "string" &&
    (ARTISTIC_LEVEL_VALUES as readonly string[]).includes(value)
  )
}

/** Una categoría de un nivel, ya resuelta a años de nacimiento. */
export interface LevelCategoryDraft {
  level: ArtisticLevelValue
  label: string
  /** Año de nacimiento más viejo admitido. null = sin tope por arriba. */
  from: number | null
  /** Año de nacimiento más joven admitido. null = sin tope por abajo. */
  to: number | null
  /**
   * El 'desde' que aplica a varones cuando las bases les dan un año más que a
   * damas (Juvenil, Junior). null = mismo rango para todos.
   */
  maleFrom: number | null
}

const MIN_YEAR = 1950
const MAX_YEAR = 2050
const MAX_LABEL = 80

// Las bases describen las categorías por EDAD, no por año, porque la tabla se
// reescribe cada temporada. Guardamos la edad y calculamos el año: así el
// formulario sirve igual en 2027 sin que nadie edite este archivo.
interface AgeBand {
  label: string
  /** Edad del deportista más viejo admitido. null = sin tope. */
  oldestAge: number | null
  /** Edad del más joven admitido. null = sin piso. */
  youngestAge: number | null
  /** Edad del varón más viejo admitido, cuando las bases le dan un año más. */
  maleOldestAge: number | null
}

// Sección VI de las bases. Básico e intermedio comparten esta tabla.
const BASICO_E_INTERMEDIO: AgeBand[] = [
  { label: "Infantil D", oldestAge: 8, youngestAge: null, maleOldestAge: null },
  { label: "Infantil A", oldestAge: 10, youngestAge: 9, maleOldestAge: null },
  { label: "Infantil B", oldestAge: 12, youngestAge: 11, maleOldestAge: null },
  // F: 13-15, M: 13-16. El varón de 16 entra por maleOldestAge.
  { label: "Juvenil", oldestAge: 15, youngestAge: 13, maleOldestAge: 16 },
  { label: "Junior/Senior", oldestAge: null, youngestAge: 15, maleOldestAge: null },
]

const AVANZADO: AgeBand[] = [
  { label: "12 y menos", oldestAge: 12, youngestAge: null, maleOldestAge: null },
  { label: "Juvenil", oldestAge: 15, youngestAge: 13, maleOldestAge: 16 },
  // F: 15-19, M: 15-20.
  { label: "Junior", oldestAge: 19, youngestAge: 15, maleOldestAge: 20 },
  // Junior y Senior se superponen a propósito: así lo dicen las bases. No
  // estorba porque la categoría es una etiqueta y la elegibilidad la decide el
  // rango de años de cada prueba.
  { label: "Senior", oldestAge: null, youngestAge: 15, maleOldestAge: null },
]

const BANDS_BY_LEVEL: Record<ArtisticLevelValue, AgeBand[]> = {
  BASICO: BASICO_E_INTERMEDIO,
  INTERMEDIO: BASICO_E_INTERMEDIO,
  AVANZADO,
}

// Las bases miden la edad al 31 de diciembre del año del campeonato, así que
// el año de nacimiento es seasonYear - edad, sin el +1 de birthYearForMaxAge
// (que existe porque el "Sub-N" de polo mide con otro corte).
function birthYear(seasonYear: number, age: number | null): number | null {
  return age === null ? null : seasonYear - age
}

/** Las categorías de los tres niveles para una temporada. */
export function levelCategoryPreset(seasonYear: number): LevelCategoryDraft[] {
  return ARTISTIC_LEVEL_VALUES.flatMap((level) =>
    BANDS_BY_LEVEL[level].map((band) => ({
      level,
      label: band.label,
      from: birthYear(seasonYear, band.oldestAge),
      to: birthYear(seasonYear, band.youngestAge),
      maleFrom: birthYear(seasonYear, band.maleOldestAge),
    }))
  )
}

function readYear(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value)) return "invalid"
  const year = value as number
  return year < MIN_YEAR || year > MAX_YEAR ? "invalid" : year
}

/**
 * Lee las categorías por nivel que manda el formulario. Se valida en el
 * servidor porque los campos ocultos también se manipulan desde el navegador,
 * igual que parseLeagueTeamCounts.
 */
export function parseLevelCategories(value: string): LevelCategoryDraft[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null

  const parsed: LevelCategoryDraft[] = []
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null
    const candidate = row as Record<string, unknown>

    if (!isArtisticLevel(candidate.level)) return null
    if (typeof candidate.label !== "string") return null
    const label = candidate.label.trim()
    if (!label || label.length > MAX_LABEL) return null

    const from = readYear(candidate.from)
    const to = readYear(candidate.to)
    const maleFrom = readYear(candidate.maleFrom)
    if (from === "invalid" || to === "invalid" || maleFrom === "invalid") {
      return null
    }
    if (from !== null && to !== null && from > to) return null
    if (maleFrom !== null && to !== null && maleFrom > to) return null

    parsed.push({ level: candidate.level, label, from, to, maleFrom })
  }
  return parsed
}

/**
 * El separador entre el nombre del nivel y la etiqueta de la categoría. Vive
 * acá y en ningún otro lado: el prefijo se compone y se descompone siempre con
 * las dos funciones de abajo.
 */
const LEVEL_PREFIX_SEPARATOR = " — "

/**
 * Quita el «Nivel — » inicial si lo hay. Devuelve el texto tal cual si no.
 *
 * Exige el separador completo, así que una categoría llamada «Básicos del
 * club» no se toca. Un texto que es exactamente el nombre de un nivel se
 * reduce a null, porque de ahí salió: es la prueba sin categoría a la que el
 * generador masivo le puso el nivel de etiqueta.
 */
export function stripLevelPrefix(text: string | null): string | null {
  if (text === null) return null
  const trimmed = text.trim()
  for (const level of ARTISTIC_LEVEL_VALUES) {
    const label = ARTISTIC_LEVEL_LABELS[level]
    if (trimmed === label) return null
    const prefix = `${label}${LEVEL_PREFIX_SEPARATOR}`
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim() || null
    }
  }
  return text
}

/**
 * Antepone el nombre del nivel a una etiqueta, sin duplicarlo si ya está.
 *
 * Quita primero cualquier prefijo de nivel y recién después antepone el que
 * toca. Por eso aplicarla dos veces da lo mismo que aplicarla una, que es lo
 * que hace seguro editar una prueba: el formulario reenvía la categoría que ya
 * trae el prefijo, y cambiar el nivel lo reemplaza en vez de encadenarlo.
 *
 * Con `text` en null devuelve solo el nombre del nivel.
 */
export function withLevelPrefix(
  level: ArtisticLevelValue,
  text: string | null
): string {
  return [ARTISTIC_LEVEL_LABELS[level], stripLevelPrefix(text)]
    .filter(Boolean)
    .join(LEVEL_PREFIX_SEPARATOR)
}

export interface LevelCategoryGroup {
  level: ArtisticLevelValue
  specs: CategorySpec[]
}

/**
 * Convierte las categorías del formulario en los grupos que consume
 * buildModalityRows, uno por nivel y en el orden en que compiten.
 *
 * El nombre del nivel se antepone a la etiqueta porque la descripción de la
 * orden se arma con `category` (ver lib/registration-snapshots.ts): sin él, dos
 * pruebas homónimas de niveles distintos aparecerían idénticas en el
 * comprobante que paga el club.
 */
export function levelCategoriesToSpecs(
  categories: LevelCategoryDraft[]
): LevelCategoryGroup[] {
  const groups: LevelCategoryGroup[] = []
  for (const level of ARTISTIC_LEVEL_VALUES) {
    const specs = categories
      .filter((category) => category.level === level)
      .map<CategorySpec>((category) => ({
        label: withLevelPrefix(level, category.label),
        birthYearFrom: category.from,
        birthYearTo: category.to,
        maxAgeYears: null,
        maleBirthYearFrom: category.maleFrom,
      }))
    if (specs.length > 0) groups.push({ level, specs })
  }
  return groups
}

/**
 * Agrupa por nivel en el orden en que compiten y deja al final lo que no
 * pertenece a un campeonato de niveles. Una lista sin niveles devuelve un solo
 * grupo sin etiqueta: por eso una competencia normal se ve igual que siempre.
 */
export function groupByLevel<T extends { level: string | null }>(
  rows: T[]
): Array<{ level: ArtisticLevelValue | null; rows: T[] }> {
  const groups: Array<{ level: ArtisticLevelValue | null; rows: T[] }> = []
  for (const level of ARTISTIC_LEVEL_VALUES) {
    const matching = rows.filter((row) => row.level === level)
    if (matching.length > 0) groups.push({ level, rows: matching })
  }
  const sinNivel = rows.filter((row) => row.level === null)
  if (sinNivel.length > 0) groups.push({ level: null, rows: sinNivel })
  return groups
}
