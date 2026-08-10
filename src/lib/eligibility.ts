import { birthYearOf, SEX_RULE_LABELS } from "./utils"

export interface EligibilityModality {
  sexRule: "MALE" | "FEMALE" | "MIXED" | "ANY"
  birthYearFrom: number | null
  birthYearTo: number | null
  // Año extra admitido por "sube de categoría" (los del último año de la
  // categoría inmediata inferior). Lo calcula upgradeBirthYearFor en
  // lib/categories a partir de allowsCategoryUpgrade; null = la prueba no lo
  // admite. Se evalúa antes que el rango: un año que entra por acá es elegible
  // aunque quede fuera de birthYearFrom/To.
  upgradeYear?: number | null
  minAthletes: number
  maxAthletes: number
  name: string
  category?: string | null
}

export interface EligibilityAthlete {
  id: string
  firstNames: string
  lastNames: string
  birthDate: Date | string
  sex: "M" | "F"
}

// true si el deportista entra a la prueba por la regla de "sube de categoría"
// (es del último año de la categoría inferior), no por el rango propio.
export function competesUpACategory(
  modality: EligibilityModality,
  athlete: EligibilityAthlete
): boolean {
  return (
    modality.upgradeYear != null &&
    birthYearOf(athlete.birthDate) === modality.upgradeYear
  )
}

export function athleteEligibilityError(
  modality: EligibilityModality,
  athlete: EligibilityAthlete
): string | null {
  const year = birthYearOf(athlete.birthDate)
  const upgraded = competesUpACategory(modality, athlete)

  if (!upgraded && modality.birthYearFrom !== null && year < modality.birthYearFrom) {
    return `Nacido en ${year}: fuera del rango ${modality.birthYearFrom}-${modality.birthYearTo ?? "…"}`
  }
  if (!upgraded && modality.birthYearTo !== null && year > modality.birthYearTo) {
    return `Nacido en ${year}: fuera del rango ${modality.birthYearFrom ?? "…"}-${modality.birthYearTo}`
  }
  if (modality.sexRule === "MALE" && athlete.sex !== "M") {
    return "La prueba es solo para varones"
  }
  if (modality.sexRule === "FEMALE" && athlete.sex !== "F") {
    return "La prueba es solo para damas"
  }
  return null
}

export function isAthleteEligible(
  modality: EligibilityModality,
  athlete: EligibilityAthlete
): boolean {
  return athleteEligibilityError(modality, athlete) === null
}

// Valida la composición completa de una inscripción (individual o dueto/equipo).
export function validateEntryComposition(
  modality: EligibilityModality,
  athletes: EligibilityAthlete[]
): string[] {
  const errors: string[] = []

  if (athletes.length < modality.minAthletes || athletes.length > modality.maxAthletes) {
    const range =
      modality.minAthletes === modality.maxAthletes
        ? `${modality.minAthletes}`
        : `${modality.minAthletes} a ${modality.maxAthletes}`
    errors.push(
      `Esta prueba requiere ${range} deportista(s); seleccionaste ${athletes.length}.`
    )
  }

  const seen = new Set<string>()
  for (const athlete of athletes) {
    if (seen.has(athlete.id)) {
      errors.push(`${athlete.firstNames} ${athlete.lastNames} está repetido.`)
      continue
    }
    seen.add(athlete.id)

    const error = athleteEligibilityError(modality, athlete)
    if (error) {
      errors.push(`${athlete.firstNames} ${athlete.lastNames}: ${error}`)
    }
  }

  // MIXED en pruebas de 2+ integrantes exige al menos un varón y una dama.
  if (modality.sexRule === "MIXED" && modality.maxAthletes >= 2) {
    const hasMale = athletes.some((a) => a.sex === "M")
    const hasFemale = athletes.some((a) => a.sex === "F")
    if (!hasMale || !hasFemale) {
      errors.push(
        `Una prueba ${SEX_RULE_LABELS.MIXED.toLowerCase()} requiere al menos un varón y una dama.`
      )
    }
  }

  return errors
}
