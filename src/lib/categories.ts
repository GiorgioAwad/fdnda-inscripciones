import { birthYearOf } from "./utils"

// La categoría es una ETIQUETA informativa (Infantil A, Juvenil, …). No
// restringe nada: la elegibilidad real de cada prueba la decide el rango
// birthYearFrom/birthYearTo de la modalidad, así que un mismo deportista puede
// inscribirse en pruebas de varias categorías si los rangos lo admiten.

export interface CategoryRange {
  id: string
  discipline: string
  name: string
  birthYearFrom: number | null
  birthYearTo: number | null
  sortOrder: number
}

function matchesYear(category: CategoryRange, year: number): boolean {
  if (category.birthYearFrom !== null && year < category.birthYearFrom) return false
  if (category.birthYearTo !== null && year > category.birthYearTo) return false
  return true
}

// Categorías que le corresponden a un año de nacimiento, por disciplina.
// Puede devolver más de una: un deportista compite en clavados y en artística.
export function categoriesForYear(
  categories: CategoryRange[],
  year: number,
  discipline?: string
): CategoryRange[] {
  return categories
    .filter((category) => !discipline || category.discipline === discipline)
    .filter((category) => matchesYear(category, year))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// ==================== SUBE DE CATEGORÍA ====================
// En natación artística los deportistas del ÚLTIMO año de la categoría inferior
// inmediata pueden subir. Las escrituras nuevas persisten y validan ese año
// contra las categorías de la temporada. `birthYearTo + 1` se conserva aquí
// únicamente como lectura compatible mientras existan filas históricas sin el
// snapshot explícito.

export function upgradeBirthYearFor(modality: {
  allowsCategoryUpgrade: boolean
  birthYearTo: number | null
  discipline?: string
  categoryUpgradeBirthYear?: number | null
}): number | null {
  // La regla pertenece exclusivamente a natación artística. El año
  // persistido es la fuente de verdad para pruebas nuevas; el cálculo anterior
  // queda como compatibilidad mientras se completa el backfill.
  if (
    modality.discipline !== undefined &&
    modality.discipline !== "ARTISTIC_SWIMMING"
  ) {
    return null
  }
  if (!modality.allowsCategoryUpgrade) return null
  if (modality.categoryUpgradeBirthYear != null) {
    return modality.categoryUpgradeBirthYear
  }
  if (modality.birthYearTo === null) return null
  return modality.birthYearTo + 1
}

// Nombre de la categoría a la que pertenece un año de nacimiento, o null si la
// temporada no la tiene definida. Sirve para rotular "sube desde Infantil B".
export function categoryNameForYear(
  categories: CategoryRange[],
  year: number,
  discipline?: string
): string | null {
  return categoriesForYear(categories, year, discipline)[0]?.name ?? null
}

// Etiqueta corta para tablas y fichas: "Juvenil", "Infantil A · Juvenil" o "—".
export function categoryLabelFor(
  categories: CategoryRange[],
  birthDate: Date | string,
  discipline?: string
): string {
  const matches = categoriesForYear(categories, birthYearOf(birthDate), discipline)
  if (matches.length === 0) return "—"

  // Nombres únicos: la misma categoría puede existir en las dos disciplinas.
  return [...new Set(matches.map((category) => category.name))].join(" · ")
}
