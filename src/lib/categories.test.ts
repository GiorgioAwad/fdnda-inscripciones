import { describe, expect, it } from "vitest"
import { upgradeBirthYearFor } from "./categories"

describe("sube de categoría", () => {
  it("usa el año persistido para natación artística", () => {
    expect(
      upgradeBirthYearFor({
        discipline: "ARTISTIC_SWIMMING",
        allowsCategoryUpgrade: true,
        birthYearTo: 2012,
        categoryUpgradeBirthYear: 2013,
      })
    ).toBe(2013)
  })

  it("rechaza la regla en otras disciplinas aunque el payload la active", () => {
    expect(
      upgradeBirthYearFor({
        discipline: "DIVING",
        allowsCategoryUpgrade: true,
        birthYearTo: 2012,
        categoryUpgradeBirthYear: 2013,
      })
    ).toBeNull()
  })

  it("mantiene compatibilidad con modalidades artísticas previas al backfill", () => {
    expect(
      upgradeBirthYearFor({
        discipline: "ARTISTIC_SWIMMING",
        allowsCategoryUpgrade: true,
        birthYearTo: 2012,
      })
    ).toBe(2013)
  })
})
