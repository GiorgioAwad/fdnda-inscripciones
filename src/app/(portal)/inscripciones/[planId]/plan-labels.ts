import { stripLevelPrefix, type ArtisticLevelValue } from "@/lib/artistic-levels"
import type { AthleteView, ModalityView } from "../types"

// Textos que la planilla repite en varias piezas (tarjeta del deportista,
// formaciones, revisión). Viven juntos para que se digan igual en todas.

/** «Apellidos, Nombres», el formato del padrón. */
export function athleteName(athlete: { firstNames: string; lastNames: string }) {
  return `${athlete.lastNames}, ${athlete.firstNames}`
}

/**
 * Nombre de la prueba con su categoría. Bajo un encabezado que ya dice el
 * nivel (BÁSICO…) el prefijo del nivel sobra; sin nivel, la categoría se
 * muestra completa, que es lo único que distingue dos pruebas homónimas.
 */
export function modalityLabel(
  modality: Pick<ModalityView, "name" | "category">,
  level: ArtisticLevelValue | null = null
) {
  const category =
    level === null ? modality.category : stripLevelPrefix(modality.category)
  return [modality.name, category].filter(Boolean).join(" · ")
}

/**
 * Disciplinas de la competencia que el deportista practica pero en las que no
 * tiene una afiliación que cubra toda la competencia. Vacío si no se sabe.
 */
export function uncoveredDisciplines(
  athlete: AthleteView,
  eventDisciplines: readonly string[]
): string[] {
  const covered = athlete.coveredDisciplines
  if (covered === null) return []
  return eventDisciplines.filter(
    (discipline) =>
      athlete.disciplines.includes(discipline) && !covered.includes(discipline)
  )
}

/** Cómo se cobra una prueba en esta planilla, dicho en una frase corta. */
export type EntryPriceNote = (modality: ModalityView) => string

/** Una prueba de clavados sincronizados se inscribe como pareja. */
export function isDivingPair(
  modality: Pick<ModalityView, "discipline" | "minAthletes" | "maxAthletes">
) {
  return (
    modality.discipline === "DIVING" &&
    modality.minAthletes === 2 &&
    modality.maxAthletes === 2
  )
}
