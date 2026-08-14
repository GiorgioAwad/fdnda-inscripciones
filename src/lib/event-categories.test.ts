import { describe, expect, it } from "vitest"
import { parseCategorySpecs } from "./event-categories"

const RANGE = { ageRuleMode: "RANGE" as const, seasonYear: 2026 }
const SUB_N = { ageRuleMode: "MAX_AGE_ONLY" as const, seasonYear: 2026 }

describe("categorías por rango de años", () => {
  it("lee Nombre|desde|hasta", () => {
    const result = parseCategorySpecs("Juvenil|2010|2012", RANGE)
    expect(result).toEqual({
      ok: true,
      categories: [
        {
          label: "Juvenil",
          birthYearFrom: 2010,
          birthYearTo: 2012,
          maxAgeYears: null,
        },
      ],
    })
  })

  it("admite años opcionales", () => {
    const result = parseCategorySpecs("Absoluto", RANGE)
    expect(result.ok && result.categories[0]).toMatchObject({
      label: "Absoluto",
      birthYearFrom: null,
      birthYearTo: null,
    })
  })

  it("texto vacío genera una sola versión sin categoría", () => {
    const result = parseCategorySpecs("   \n  ", RANGE)
    expect(result.ok && result.categories).toEqual([
      { label: null, birthYearFrom: null, birthYearTo: null, maxAgeYears: null },
    ])
  })

  it("rechaza un rango invertido", () => {
    expect(parseCategorySpecs("Juvenil|2014|2012", RANGE)).toMatchObject({
      ok: false,
    })
  })

  it("rechaza años fuera de lo plausible", () => {
    expect(parseCategorySpecs("Juvenil|1800|2012", RANGE)).toMatchObject({
      ok: false,
    })
  })
})

describe("categorías Sub-N", () => {
  it("convierte «Sub 18» en un piso de año sin tope superior", () => {
    const result = parseCategorySpecs("Sub 18", SUB_N)
    expect(result).toEqual({
      ok: true,
      categories: [
        {
          label: "Sub 18",
          birthYearFrom: 2009,
          birthYearTo: null,
          maxAgeYears: 18,
        },
      ],
    })
  })

  it("un sub-13 entra en sub-18: el piso de sub-18 es más antiguo", () => {
    const result = parseCategorySpecs("Sub 13\nSub 18", SUB_N)
    if (!result.ok) throw new Error(result.error)
    const [sub13, sub18] = result.categories
    expect(sub13.birthYearFrom).toBe(2014)
    expect(sub18.birthYearFrom).toBe(2009)
    // Un nacido en 2014 cumple 2014 >= 2009, así que es elegible en sub-18.
    expect(2014).toBeGreaterThanOrEqual(sub18.birthYearFrom!)
    // Un nacido en 2009 no llega al piso de sub-13.
    expect(2009).toBeLessThan(sub13.birthYearFrom!)
  })

  it.each(["Sub-16", "SUB16", "Sub 16", "Sub dieciséis|16"])(
    "tolera la escritura «%s»",
    (line) => {
      const result = parseCategorySpecs(line, SUB_N)
      expect(result.ok && result.categories[0].maxAgeYears).toBe(16)
    }
  )

  it("exige al menos una categoría: sin tope admitiría cualquier edad", () => {
    expect(parseCategorySpecs("", SUB_N)).toMatchObject({ ok: false })
  })

  it("admite una categoría Open explícita sin límite de edad", () => {
    expect(parseCategorySpecs("Open|OPEN", SUB_N)).toEqual({
      ok: true,
      categories: [
        {
          label: "Open",
          birthYearFrom: null,
          birthYearTo: null,
          maxAgeYears: null,
        },
      ],
    })
  })

  it("rechaza una línea sin edad ni marca Open", () => {
    expect(parseCategorySpecs("Categoría abierta", SUB_N)).toMatchObject({
      ok: false,
    })
  })
})
