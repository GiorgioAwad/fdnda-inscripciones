import { describe, expect, it } from "vitest"
import {
  DEFAULT_OFFICIAL_LIMITS,
  officialLimitsFor,
  officialLimitsSummary,
  officialPersonSchema,
} from "./event-officials"

describe("topes de delegados y entrenadores", () => {
  it("usa los defaults para una disciplina sin configuración", () => {
    expect(officialLimitsFor([], "DIVING")).toEqual(DEFAULT_OFFICIAL_LIMITS)
  })

  it("lee la configuración de la disciplina pedida", () => {
    expect(
      officialLimitsFor(
        [
          { discipline: "WATER_POLO", maxDelegates: 2, maxCoaches: 4, requiresDelegate: true },
          { discipline: "DIVING", maxDelegates: 0, maxCoaches: 1 },
        ],
        "WATER_POLO"
      )
    ).toEqual({ maxDelegates: 2, maxCoaches: 4, requiresDelegate: true })
  })

  it("no exige delegado si la disciplina no admite ninguno", () => {
    expect(
      officialLimitsFor(
        [{ discipline: "DIVING", maxDelegates: 0, maxCoaches: 2, requiresDelegate: true }],
        "DIVING"
      ).requiresDelegate
    ).toBe(false)
  })

  it("resume los topes para el admin", () => {
    expect(
      officialLimitsSummary({ maxDelegates: 1, maxCoaches: 3, requiresDelegate: true })
    ).toBe("Hasta 1 delegado (obligatorio) y 3 entrenadores por club")
    expect(
      officialLimitsSummary({ maxDelegates: 0, maxCoaches: 1, requiresDelegate: false })
    ).toBe("Hasta 1 entrenador por club")
    expect(
      officialLimitsSummary({ maxDelegates: 0, maxCoaches: 0, requiresDelegate: false })
    ).toBe("No se piden")
  })
})

describe("datos de un delegado o entrenador", () => {
  it("normaliza el documento y recorta espacios", () => {
    expect(
      officialPersonSchema.parse({
        firstNames: " Ana ",
        lastNames: " Pérez ",
        docType: "PASAPORTE",
        docNumber: " ab-12345 ",
      })
    ).toEqual({ firstNames: "Ana", lastNames: "Pérez", docType: "PASAPORTE", docNumber: "AB-12345" })
  })

  it("rechaza nombres vacíos y documentos inválidos", () => {
    expect(
      officialPersonSchema.safeParse({
        firstNames: "",
        lastNames: "Pérez",
        docType: "DNI",
        docNumber: "12345678",
      }).success
    ).toBe(false)
    expect(
      officialPersonSchema.safeParse({
        firstNames: "Ana",
        lastNames: "Pérez",
        docType: "DNI",
        docNumber: "12 34",
      }).success
    ).toBe(false)
  })
})
