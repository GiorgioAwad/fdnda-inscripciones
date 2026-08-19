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
          maleBirthYearFrom: null,
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
      { label: null, birthYearFrom: null, birthYearTo: null, maxAgeYears: null, maleBirthYearFrom: null },
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

// Las bases de artística dan a los varones un año más en Juvenil y Junior. El
// generador masivo es EL camino para nivelar un evento que ya existe, así que
// tiene que poder expresarlo: sin el cuarto campo, un varón de 16 quedaba
// fuera de Juvenil aunque las bases lo admitan.
describe("el cuarto campo: «varones desde»", () => {
  it("lee Nombre|desde|hasta|varonesDesde", () => {
    const result = parseCategorySpecs("Juvenil|2011|2013|2010", RANGE)
    expect(result).toEqual({
      ok: true,
      categories: [
        {
          label: "Juvenil",
          birthYearFrom: 2011,
          birthYearTo: 2013,
          maxAgeYears: null,
          maleBirthYearFrom: 2010,
        },
      ],
    })
  })

  // Esta es la garantía de que nada de lo que existe hoy cambia: una línea de
  // tres campos sigue produciendo exactamente el mismo CategorySpec.
  it.each([
    ["Juvenil|2011|2013", "con los dos años"],
    ["Juvenil|2011|", "sin el año 'hasta'"],
    ["Juvenil", "sin años"],
    ["Juvenil|2011|2013|", "con el cuarto campo vacío"],
  ])("«%s» (%s) deja maleBirthYearFrom en null", (line) => {
    const result = parseCategorySpecs(line, RANGE)
    expect(result.ok && result.categories[0].maleBirthYearFrom).toBeNull()
  })

  it("una línea de tres campos produce lo mismo que antes del cuarto campo", () => {
    expect(parseCategorySpecs("Categoría B|2011|2012", RANGE)).toEqual({
      ok: true,
      categories: [
        {
          label: "Categoría B",
          birthYearFrom: 2011,
          birthYearTo: 2012,
          maxAgeYears: null,
          maleBirthYearFrom: null,
        },
      ],
    })
  })

  it.each([
    ["fuera del rango plausible", "Juvenil|2011|2013|1800"],
    ["no es un número", "Juvenil|2011|2013|dos mil diez"],
  ])("rechaza un «varones desde» %s", (_caso, line) => {
    expect(parseCategorySpecs(line, RANGE)).toMatchObject({ ok: false })
  })

  // El año extra de los varones siempre está del lado viejo del rango: si es
  // más nuevo que el 'hasta', la línea está mal escrita.
  it("rechaza un «varones desde» posterior al año 'hasta'", () => {
    expect(parseCategorySpecs("Juvenil|2011|2013|2014", RANGE)).toMatchObject({
      ok: false,
    })
  })

  // En MAX_AGE_ONLY el formato es otro y el cuarto campo no existe: el «|»
  // ahí solo lleva la edad explícita.
  it("no se cuela en las categorías Sub-N", () => {
    const result = parseCategorySpecs("Sub 16", SUB_N)
    expect(result.ok && result.categories[0].maleBirthYearFrom).toBeNull()
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
          maleBirthYearFrom: null,
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
          maleBirthYearFrom: null,
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
