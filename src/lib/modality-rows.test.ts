import { describe, expect, it } from "vitest"
import type { CategorySpec } from "./event-categories"
import { buildModalityRows } from "./modality-rows"

function category(overrides: Partial<CategorySpec> = {}): CategorySpec {
  return {
    label: "Juvenil",
    birthYearFrom: 2011,
    birthYearTo: 2013,
    maxAgeYears: null,
    maleBirthYearFrom: null,
    ...overrides,
  }
}

const individual = {
  sexRules: ["FEMALE", "MALE"] as const,
  minAthletes: 1,
  maxAthletes: 1,
}

describe("buildModalityRows", () => {
  it("multiplica pruebas × categorías × sexos", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre", "Figuras"],
      categories: [category(), category({ label: "Infantil A" })],
      variantsFor: () => ({ ...individual, sexRules: [...individual.sexRules] }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows).toHaveLength(8)
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it("arma la etiqueta como «categoría — sexo»", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category()],
      variantsFor: () => ({ ...individual, sexRules: [...individual.sexRules] }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows.map((row) => row.category)).toEqual([
      "Juvenil — Damas",
      "Juvenil — Varones",
    ])
  })

  it("una categoría sin etiqueta deja category en null", () => {
    const rows = buildModalityRows({
      discipline: "DIVING",
      names: ["Plataforma"],
      categories: [
        { label: null, birthYearFrom: null, birthYearTo: null, maxAgeYears: null, maleBirthYearFrom: null },
      ],
      variantsFor: () => ({ sexRules: ["ANY"], minAthletes: 1, maxAthletes: 1 }),
      price: 40,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows[0].category).toBeNull()
  })

  it("sin tope de año no concede «sube de categoría»", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category({ birthYearTo: null })],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: true,
      startSortOrder: 0,
    })
    expect(rows[0].allowsCategoryUpgrade).toBe(false)
    expect(rows[0].categoryUpgradeBirthYear).toBeNull()
  })

  it("con tope de año el año que sube es birthYearTo + 1", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category()],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: true,
      startSortOrder: 0,
    })
    expect(rows[0].allowsCategoryUpgrade).toBe(true)
    expect(rows[0].categoryUpgradeBirthYear).toBe(2014)
  })

  it("en una liga el precio sale de los partidos del equipo", () => {
    const rows = buildModalityRows({
      discipline: "WATER_POLO",
      names: ["Plantel"],
      categories: [category()],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 7, maxAthletes: 13 }),
      price: 0,
      leaguePlanFor: () => ({
        pricePerMatch: 50,
        matchesPerTeam: 4,
        expectedTeams: 6,
      }),
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows[0].price.toString()).toBe("200")
    expect(rows[0].matchesPerTeam).toBe(4)
    expect(rows[0].expectedTeams).toBe(6)
  })

  it("respeta el sortOrder inicial que le pasan", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category()],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 12,
    })
    expect(rows[0].sortOrder).toBe(12)
  })
})

// Las bases dan a los varones un año más en Juvenil (F 13-15, M 13-16) y en
// Junior (F 15-19, M 15-20). Sin esto, un nadador de 2010 no entra a juvenil.
describe("el rango masculino extendido", () => {
  const juvenil: CategorySpec = {
    label: "Juvenil",
    birthYearFrom: 2011,
    birthYearTo: 2013,
    maxAgeYears: null,
    maleBirthYearFrom: 2010,
  }

  function rowsFor(sexRules: readonly string[]) {
    return buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [juvenil],
      variantsFor: () => ({
        sexRules: sexRules as never,
        minAthletes: 1,
        maxAthletes: 1,
      }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
  }

  it("damas conservan el rango de la categoría", () => {
    expect(rowsFor(["FEMALE"])[0].birthYearFrom).toBe(2011)
  })

  it.each(["MALE", "MIXED", "ANY"])(
    "%s admite además al varón del año extra",
    (sexRule) => {
      expect(rowsFor([sexRule])[0].birthYearFrom).toBe(2010)
    }
  )

  it("el tope joven no se desdobla: es el mismo para todos", () => {
    for (const sexRule of ["FEMALE", "MALE", "MIXED", "ANY"]) {
      expect(rowsFor([sexRule])[0].birthYearTo).toBe(2013)
    }
  })

  it("sin rango masculino todos los sexos usan el de la categoría", () => {
    const sinExtra = { ...juvenil, maleBirthYearFrom: null }
    for (const sexRule of ["FEMALE", "MALE", "MIXED", "ANY"]) {
      const rows = buildModalityRows({
        discipline: "ARTISTIC_SWIMMING",
        names: ["Solo Libre"],
        categories: [sinExtra],
        variantsFor: () => ({
          sexRules: [sexRule] as never,
          minAthletes: 1,
          maxAthletes: 1,
        }),
        price: 60,
        allowsCategoryUpgrade: false,
        startSortOrder: 0,
      })
      expect(rows[0].birthYearFrom).toBe(2011)
    }
  })

  it("«sube de categoría» sigue saliendo del tope joven, no del masculino", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [juvenil],
      variantsFor: () => ({ sexRules: ["MALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: true,
      startSortOrder: 0,
    })
    expect(rows[0].categoryUpgradeBirthYear).toBe(2014)
  })
})
