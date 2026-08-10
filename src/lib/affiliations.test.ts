import { describe, expect, it, vi } from "vitest"

vi.mock("./prisma", () => ({ prisma: {} }))

import { isAffiliationValidForRange } from "./affiliations"

const eventStart = new Date("2026-08-21T00:00:00.000Z")
const eventEnd = new Date("2026-08-23T00:00:00.000Z")

function affiliation(overrides: {
  status?: "PENDING" | "ACTIVE"
  validFrom?: Date
  validTo?: Date
} = {}) {
  return {
    status: overrides.status ?? ("ACTIVE" as const),
    validFrom: overrides.validFrom ?? eventStart,
    validTo: overrides.validTo ?? eventEnd,
    activeOrderId: null,
  }
}

describe("afiliación para todas las fechas de una competencia", () => {
  it("acepta los límites exactos del evento", () => {
    expect(
      isAffiliationValidForRange(affiliation(), eventStart, eventEnd)
    ).toBe(true)
  })

  it("rechaza una afiliación que comienza después del primer día", () => {
    expect(
      isAffiliationValidForRange(
        affiliation({ validFrom: new Date("2026-08-22T00:00:00.000Z") }),
        eventStart,
        eventEnd
      )
    ).toBe(false)
  })

  it("rechaza una afiliación que vence antes del último día", () => {
    expect(
      isAffiliationValidForRange(
        affiliation({ validTo: new Date("2026-08-22T00:00:00.000Z") }),
        eventStart,
        eventEnd
      )
    ).toBe(false)
  })

  it("rechaza estados pendientes aunque el rango cubra el evento", () => {
    expect(
      isAffiliationValidForRange(
        affiliation({ status: "PENDING" }),
        eventStart,
        eventEnd
      )
    ).toBe(false)
  })

  it("rechaza afiliaciones ausentes", () => {
    expect(isAffiliationValidForRange(null, eventStart, eventEnd)).toBe(false)
    expect(isAffiliationValidForRange(undefined, eventStart, eventEnd)).toBe(
      false
    )
  })
})
