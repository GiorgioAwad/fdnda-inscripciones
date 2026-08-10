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
