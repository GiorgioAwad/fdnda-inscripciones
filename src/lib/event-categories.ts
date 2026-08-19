import { birthYearForMaxAge, type AgeRuleModeValue } from "./event-pricing"

// Las categorías de un evento se escriben como texto libre (una por línea) y su
// formato depende de cómo mide las edades la disciplina:
//
//   RANGE         "Juvenil|2010|2012"  → ventana cerrada de años de nacimiento
//   MAX_AGE_ONLY  "Sub 13"             → solo tope de edad
//
// En MAX_AGE_ONLY el resultado tiene birthYearTo = null a propósito: "Sub 18"
// admite a los nacidos en ese año o después, así que un sub-13 puede jugar
// sub-18 pero un sub-18 nunca baja a sub-13.

export interface CategorySpec {
  label: string | null
  birthYearFrom: number | null
  birthYearTo: number | null
  /** Solo en MAX_AGE_ONLY: la N de "Sub-N", para poder re-renderizar la etiqueta. */
  maxAgeYears: number | null
  /**
   * Solo en natación artística: el 'desde' que aplica a varones cuando las
   * bases les dan un año más que a damas (Juvenil, Junior). null = mismo rango
   * para todos, que es el caso de todas las demás disciplinas.
   */
  maleBirthYearFrom: number | null
}

export type CategoryParseResult =
  | { ok: true; categories: CategorySpec[] }
  | { ok: false; error: string }

const MIN_YEAR = 1950
const MAX_YEAR = 2050
const MAX_AGE = 99

function parseYear(value: string | undefined): number | null | "invalid" {
  const text = (value ?? "").trim()
  if (!text) return null
  const year = Number(text)
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return "invalid"
  return year
}

function nonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

// "Sub 13", "Sub-13", "SUB18", "Sub 13|13" → 13
function parseMaxAge(line: string): number | null {
  const [label, explicit] = line.split("|").map((part) => part?.trim() ?? "")
  const fromExplicit = explicit ? Number(explicit) : NaN
  const age = Number.isInteger(fromExplicit)
    ? fromExplicit
    : Number(label.replace(/[^0-9]/g, ""))
  if (!Number.isInteger(age) || age < 1 || age > MAX_AGE) return null
  return age
}

function parseRangeCategories(lines: string[]): CategoryParseResult {
  const categories: CategorySpec[] = []
  for (const line of lines) {
    const [label, fromText, toText] = line.split("|").map((part) => part?.trim() ?? "")
    if (!label) {
      return { ok: false, error: `Línea de categoría inválida: "${line}"` }
    }
    const from = parseYear(fromText)
    const to = parseYear(toText)
    if (from === "invalid" || to === "invalid") {
      return {
        ok: false,
        error: `Años inválidos en la categoría "${label}" (formato: Nombre|2013|2014).`,
      }
    }
    if (from !== null && to !== null && from > to) {
      return { ok: false, error: `En "${label}" el año 'desde' es mayor que 'hasta'.` }
    }
    categories.push({
      label,
      birthYearFrom: from,
      birthYearTo: to,
      maxAgeYears: null,
      maleBirthYearFrom: null,
    })
  }
  return { ok: true, categories }
}

function parseMaxAgeCategories(
  lines: string[],
  seasonYear: number
): CategoryParseResult {
  const categories: CategorySpec[] = []
  for (const line of lines) {
    const [label = "", ageText = ""] = line
      .split("|")
      .map((part) => part.trim())
    if (!label) {
      return { ok: false, error: `Línea de categoría inválida: "${line}"` }
    }
    if (ageText.toUpperCase() === "OPEN") {
      categories.push({
        label,
        birthYearFrom: null,
        birthYearTo: null,
        maxAgeYears: null,
        maleBirthYearFrom: null,
      })
      continue
    }
    const maxAge = parseMaxAge(line)
    if (maxAge === null) {
      return {
        ok: false,
        error: `No pude leer la edad máxima de "${line}". Escribe por ejemplo «Sub 13».`,
      }
    }
    categories.push({
      label,
      birthYearFrom: birthYearForMaxAge(seasonYear, maxAge),
      // Sin tope superior: por eso un sub-13 entra a sub-18.
      birthYearTo: null,
      maxAgeYears: maxAge,
      maleBirthYearFrom: null,
    })
  }
  return { ok: true, categories }
}

/**
 * Interpreta el textarea de categorías según la regla de edad de la disciplina.
 * Texto vacío devuelve una categoría nula, que genera una sola versión de cada
 * prueba sin etiqueta — salvo en MAX_AGE_ONLY, donde una prueba sin tope
 * admitiría cualquier edad y por eso se exige al menos una categoría.
 */
export function parseCategorySpecs(
  text: string,
  options: { ageRuleMode: AgeRuleModeValue; seasonYear: number }
): CategoryParseResult {
  const lines = nonEmptyLines(text)

  if (options.ageRuleMode === "MAX_AGE_ONLY") {
    if (lines.length === 0) {
      return {
        ok: false,
        error:
          "Esta disciplina exige categorías «Sub-N»: sin tope de edad la prueba admitiría a cualquiera.",
      }
    }
    return parseMaxAgeCategories(lines, options.seasonYear)
  }

  if (lines.length === 0) {
    return {
      ok: true,
      categories: [
        { label: null, birthYearFrom: null, birthYearTo: null, maxAgeYears: null, maleBirthYearFrom: null },
      ],
    }
  }
  return parseRangeCategories(lines)
}
