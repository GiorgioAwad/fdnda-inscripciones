import { describe, expect, it } from "vitest"
import { DISCIPLINE_VALUES } from "./disciplines"
import { DISCIPLINE_PRESETS } from "./event-presets"

describe("categorías iniciales por disciplina", () => {
  it.each(DISCIPLINE_VALUES)(
    "%s usa grupos con rango de años de nacimiento por defecto",
    (discipline) => {
      expect(DISCIPLINE_PRESETS[discipline].defaultAgeRuleMode).toBe("RANGE")
    }
  )
})

// Estos booleanos deciden cuánto cobra por defecto TODO evento nuevo de cada
// deporte. Nada más los pincha: transponer el par de una disciplina (por
// ejemplo, el de DIVING) haría que todo evento nuevo de ese deporte naciera
// cobrando formaciones de precio 0 en vez de la cuota fija por deportista.
describe("cobro por defecto de cada disciplina", () => {
  it.each([
    ["DIVING", false, true],
    ["ARTISTIC_SWIMMING", true, false],
    ["WATER_POLO", true, true],
  ] as const)(
    "%s: defaultChargesEntry=%s, defaultChargesAthleteFee=%s",
    (discipline, defaultChargesEntry, defaultChargesAthleteFee) => {
      expect(DISCIPLINE_PRESETS[discipline].defaultChargesEntry).toBe(
        defaultChargesEntry
      )
      expect(DISCIPLINE_PRESETS[discipline].defaultChargesAthleteFee).toBe(
        defaultChargesAthleteFee
      )
    }
  )
})
