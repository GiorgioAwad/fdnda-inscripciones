import { Prisma, type Discipline, type SexRule } from "@prisma/client"
import type { CategorySpec } from "./event-categories"
import { leagueEntryPrice, type LeagueCategoryPlan } from "./league"

// Vive en lib/ y no en la server action porque un archivo "use server" solo
// puede exportar funciones async, y esta matriz es el corazón de la
// elegibilidad de cada prueba: tiene que poder testearse sola.

export const SEX_SUFFIX: Record<string, string> = {
  MALE: "Varones",
  FEMALE: "Damas",
  MIXED: "Mixto",
  ANY: "",
}

export interface BuildModalityRowsInput {
  discipline: Discipline
  names: string[]
  categories: CategorySpec[]
  variantsFor: (name: string) => {
    sexRules: SexRule[]
    minAthletes: number
    maxAthletes: number
  }
  price: number
  leaguePlanFor?: (categoryIndex: number, sexRule: SexRule) => LeagueCategoryPlan
  allowsCategoryUpgrade: boolean
  startSortOrder: number
}

/**
 * Matriz pruebas × categorías × sexos. La comparten el generador masivo y la
 * creación de eventos, para que las pruebas nacidas en cualquiera de los dos
 * caminos queden idénticas.
 */
export function buildModalityRows(
  input: BuildModalityRowsInput
): Prisma.EventModalityCreateManyEventInput[] {
  const rows: Prisma.EventModalityCreateManyEventInput[] = []
  let sortOrder = input.startSortOrder

  for (const [categoryIndex, category] of input.categories.entries()) {
    for (const name of input.names) {
      const variant = input.variantsFor(name)
      for (const sexRule of variant.sexRules) {
        const leaguePlan = input.leaguePlanFor?.(categoryIndex, sexRule)
        const label = [category.label, SEX_SUFFIX[sexRule]].filter(Boolean).join(" — ")
        // Sin tope de año no hay categoría inferior que pueda subir: la más alta
        // del lote se genera sin el permiso.
        const upgrades = input.allowsCategoryUpgrade && category.birthYearTo !== null
        // Damas usan el rango de la categoría; el resto admite además al varón
        // del año extra que dan las bases. MIXED lleva un varón, y ANY admite a
        // cualquiera, así que ninguno puede ser más estrecho que MALE.
        //
        // LIMITACIÓN CONOCIDA, documentada porque acá se cobra: la prueba
        // guarda UN solo par de años, no uno por sexo, y athleteEligibilityError
        // (lib/eligibility.ts) compara el año de nacimiento sin mirar el sexo.
        // O sea que en un dueto MIXED la ventana ensanchada para el varón deja
        // entrar también a una DAMA del año extra, que según las bases no
        // debería competir ahí. Solo pasa en pruebas MIXED (y ANY) de artística
        // con maleBirthYearFrom, es decir Juvenil y Junior de un campeonato de
        // niveles; el resto de las disciplinas pasa null y no cambia en nada.
        //
        // Se dejó así a propósito: la alternativa —rangos por sexo— obliga a
        // desdoblar la columna (maleBirthYearFrom/maleBirthYearTo o una tabla
        // de rangos por sexo), a que athleteEligibilityError reciba el sexo y
        // elija el rango, y a rehacer las etiquetas de años en la planilla, el
        // resumen y los reportes. Eso es un cambio de modelo, no un ajuste, y
        // quedó fuera del alcance del campeonato de niveles. Mientras tanto lo
        // atrapa el club al armar el dueto y la federación al revisar.
        const birthYearFrom =
          sexRule === "FEMALE"
            ? category.birthYearFrom
            : (category.maleBirthYearFrom ?? category.birthYearFrom)
        rows.push({
          discipline: input.discipline,
          name,
          category: label || null,
          sexRule,
          birthYearFrom,
          birthYearTo: category.birthYearTo,
          allowsCategoryUpgrade: upgrades,
          categoryUpgradeBirthYear: upgrades ? category.birthYearTo! + 1 : null,
          minAthletes: variant.minAthletes,
          maxAthletes: variant.maxAthletes,
          price: new Prisma.Decimal(
            (leaguePlan ? leagueEntryPrice(leaguePlan) : input.price).toFixed(2)
          ),
          ...(leaguePlan
            ? {
                pricePerMatch: new Prisma.Decimal(
                  leaguePlan.pricePerMatch.toFixed(2)
                ),
                matchesPerTeam: leaguePlan.matchesPerTeam,
                expectedTeams: leaguePlan.expectedTeams,
              }
            : {}),
          sortOrder: sortOrder++,
        })
      }
    }
  }

  return rows
}
