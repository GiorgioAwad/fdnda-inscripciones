import { describe, expect, it } from "vitest"
import {
  ARTISTIC_LEVEL_VALUES,
  levelCategoriesToSpecs,
  levelCategoryPreset,
  parseLevelCategories,
  type LevelCategoryDraft,
} from "./artistic-levels"

function categoriesOf(
  preset: LevelCategoryDraft[],
  level: string
): Array<[string, number | null, number | null, number | null]> {
  return preset
    .filter((row) => row.level === level)
    .map((row) => [row.label, row.from, row.to, row.maleFrom])
}

// Este es EL test del plan. Los años de abajo están copiados de la sección VI
// de las «Bases Generales II Campeonato de Niveles» (edades al 31/12/2026).
// Si alguien mete un ±1 en la aritmética, se rompe acá y no en una inscripción
// real donde una nadadora aparece en la categoría equivocada.
describe("las categorías de las bases con temporada 2026", () => {
  const preset = levelCategoryPreset(2026)

  it("básico e intermedio comparten la tabla impresa en las bases", () => {
    const esperado = [
      ["Infantil D", 2018, null, null],
      ["Infantil A", 2016, 2017, null],
      ["Infantil B", 2014, 2015, null],
      ["Juvenil", 2011, 2013, 2010],
      ["Junior/Senior", null, 2011, null],
    ]
    expect(categoriesOf(preset, "BASICO")).toEqual(esperado)
    expect(categoriesOf(preset, "INTERMEDIO")).toEqual(esperado)
  })

  it("avanzado tiene su propia tabla", () => {
    expect(categoriesOf(preset, "AVANZADO")).toEqual([
      ["12 y menos", 2014, null, null],
      ["Juvenil", 2011, 2013, 2010],
      ["Junior", 2007, 2011, 2006],
      ["Senior", null, 2011, null],
    ])
  })

  it("cubre los tres niveles y ninguno más", () => {
    expect([...new Set(preset.map((row) => row.level))]).toEqual([
      ...ARTISTIC_LEVEL_VALUES,
    ])
  })
})

// La trampa que este test vigila: birthYearForMaxAge hace seasonYear - edad + 1
// porque el Sub-N de polo mide la edad con otro corte. Artística mide al 31 de
// diciembre, o sea seasonYear - edad. Un año de temporada distinto corre toda
// la tabla en bloque; si alguien reintroduce el +1, acá se ve.
describe("los años se corren con el año de la temporada", () => {
  it("2027 corre todas las categorías exactamente un año", () => {
    const dosMilVeintiseis = levelCategoryPreset(2026)
    const dosMilVeintisiete = levelCategoryPreset(2027)
    expect(dosMilVeintisiete).toHaveLength(dosMilVeintiseis.length)
    for (const [index, row] of dosMilVeintisiete.entries()) {
      const previo = dosMilVeintiseis[index]
      expect(row.label).toBe(previo.label)
      expect(row.from).toBe(previo.from === null ? null : previo.from + 1)
      expect(row.to).toBe(previo.to === null ? null : previo.to + 1)
      expect(row.maleFrom).toBe(
        previo.maleFrom === null ? null : previo.maleFrom + 1
      )
    }
  })
})

describe("parseLevelCategories", () => {
  const valida: LevelCategoryDraft[] = [
    { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: 2010 },
    { level: "AVANZADO", label: "Senior", from: null, to: 2011, maleFrom: null },
  ]

  it("acepta lo que manda el formulario", () => {
    expect(parseLevelCategories(JSON.stringify(valida))).toEqual(valida)
  })

  it("acepta un arreglo vacío: es un evento sin categorías todavía", () => {
    expect(parseLevelCategories("[]")).toEqual([])
  })

  it.each([
    ["no es JSON", "{"],
    ["no es un arreglo", '{"level":"BASICO"}'],
    ["nivel desconocido", '[{"level":"MASTER","label":"A","from":null,"to":null,"maleFrom":null}]'],
    ["etiqueta vacía", '[{"level":"BASICO","label":"  ","from":null,"to":null,"maleFrom":null}]'],
    ["año fuera de rango", '[{"level":"BASICO","label":"A","from":1800,"to":null,"maleFrom":null}]'],
    ["año no entero", '[{"level":"BASICO","label":"A","from":2011.5,"to":null,"maleFrom":null}]'],
    ["desde mayor que hasta", '[{"level":"BASICO","label":"A","from":2013,"to":2011,"maleFrom":null}]'],
    ["varones desde mayor que hasta", '[{"level":"BASICO","label":"A","from":2011,"to":2013,"maleFrom":2014}]'],
  ])("rechaza cuando %s", (_caso, json) => {
    expect(parseLevelCategories(json)).toBeNull()
  })

  it("recorta los espacios de la etiqueta", () => {
    const json = '[{"level":"BASICO","label":"  Juvenil  ","from":null,"to":null,"maleFrom":null}]'
    expect(parseLevelCategories(json)?.[0].label).toBe("Juvenil")
  })
})

describe("levelCategoriesToSpecs", () => {
  it("agrupa por nivel en el orden básico → intermedio → avanzado", () => {
    const grupos = levelCategoriesToSpecs([
      { level: "AVANZADO", label: "Senior", from: null, to: 2011, maleFrom: null },
      { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: 2010 },
    ])
    expect(grupos.map((grupo) => grupo.level)).toEqual(["BASICO", "AVANZADO"])
  })

  it("antepone el nombre del nivel a la etiqueta de la categoría", () => {
    const [grupo] = levelCategoriesToSpecs([
      { level: "BASICO", label: "Infantil A", from: 2016, to: 2017, maleFrom: null },
    ])
    expect(grupo.specs[0].label).toBe("Básico — Infantil A")
  })

  it("traslada los años y el rango masculino al CategorySpec", () => {
    const [grupo] = levelCategoriesToSpecs([
      { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: 2010 },
    ])
    expect(grupo.specs[0]).toMatchObject({
      birthYearFrom: 2011,
      birthYearTo: 2013,
      maleBirthYearFrom: 2010,
      maxAgeYears: null,
    })
  })

  it("omite los niveles sin categorías", () => {
    const grupos = levelCategoriesToSpecs([
      { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: null },
    ])
    expect(grupos).toHaveLength(1)
  })

  it("una lista vacía no produce ningún grupo", () => {
    expect(levelCategoriesToSpecs([])).toEqual([])
  })
})
