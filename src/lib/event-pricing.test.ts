import { describe, expect, it } from "vitest"
import {
  birthYearForMaxAge,
  computePlanPricing,
  disciplineConfigFor,
  isAgeRuleConfigurationValid,
  isPricingConfigurationValid,
  maxAgeForBirthYear,
  type CoverageLookup,
  type EventDisciplineConfigLike,
  type PricingPlanLike,
} from "./event-pricing"

const perAthlete = {
  discipline: "DIVING",
  pricingMode: "PER_ATHLETE",
  athleteFee: "80.00",
  ageRuleMode: "RANGE",
}

const subN = {
  discipline: "WATER_POLO",
  pricingMode: "PER_ENTRY",
  athleteFee: null,
  ageRuleMode: "MAX_AGE_ONLY",
}

describe("disciplineConfigFor", () => {
  it("sin fila devuelve el default histórico: los eventos previos no cambian", () => {
    expect(disciplineConfigFor([], "DIVING")).toEqual({
      discipline: "DIVING",
      pricingMode: "PER_ENTRY",
      athleteFee: null,
      ageRuleMode: "RANGE",
    })
  })

  it("no mezcla disciplinas: una config de clavados no aplica a polo", () => {
    expect(disciplineConfigFor([perAthlete], "WATER_POLO").pricingMode).toBe(
      "PER_ENTRY"
    )
  })

  it("lee la cuota fija de una disciplina PER_ATHLETE", () => {
    const config = disciplineConfigFor([perAthlete], "DIVING")
    expect(config.pricingMode).toBe("PER_ATHLETE")
    expect(config.athleteFee).toBe("80.00")
  })

  it("ignora una cuota residual cuando la disciplina volvió a PER_ENTRY", () => {
    const config = disciplineConfigFor(
      [{ ...perAthlete, pricingMode: "PER_ENTRY" }],
      "DIVING"
    )
    expect(config.athleteFee).toBeNull()
  })

  it("trata un modo desconocido como el default en vez de romper", () => {
    const config = disciplineConfigFor(
      [{ ...subN, pricingMode: "LO_QUE_SEA", ageRuleMode: "OTRA_COSA" }],
      "WATER_POLO"
    )
    expect(config.pricingMode).toBe("PER_ENTRY")
    expect(config.ageRuleMode).toBe("RANGE")
  })
})

describe("isPricingConfigurationValid", () => {
  it("acepta PER_ENTRY sin cuota", () => {
    expect(
      isPricingConfigurationValid(disciplineConfigFor([], "ARTISTIC_SWIMMING"))
    ).toBe(true)
  })

  it("rechaza PER_ATHLETE sin cuota", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...perAthlete, athleteFee: null }], "DIVING")
      )
    ).toBe(false)
  })

  it("rechaza PER_ATHLETE con cuota cero", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...perAthlete, athleteFee: "0" }], "DIVING")
      )
    ).toBe(false)
  })
})

describe("regla de edad Sub-N", () => {
  const maxAgeOnly = disciplineConfigFor([subN], "WATER_POLO")
  const range = disciplineConfigFor([], "ARTISTIC_SWIMMING")

  it("MAX_AGE_ONLY exige solo tope: birthYearFrom presente y birthYearTo nulo", () => {
    expect(
      isAgeRuleConfigurationValid(
        { birthYearFrom: 2009, birthYearTo: null },
        maxAgeOnly
      )
    ).toBe(true)
  })

  it("MAX_AGE_ONLY rechaza un rango cerrado: dejaría fuera a los más jóvenes", () => {
    expect(
      isAgeRuleConfigurationValid(
        { birthYearFrom: 2009, birthYearTo: 2011 },
        maxAgeOnly
      )
    ).toBe(false)
  })

  it("MAX_AGE_ONLY rechaza una prueba sin piso: dejaría entrar a cualquier edad", () => {
    expect(
      isAgeRuleConfigurationValid(
        { birthYearFrom: null, birthYearTo: null },
        maxAgeOnly
      )
    ).toBe(false)
  })

  it("RANGE no impone nada", () => {
    expect(
      isAgeRuleConfigurationValid(
        { birthYearFrom: 2009, birthYearTo: 2011 },
        range
      )
    ).toBe(true)
  })
})

describe("conversión Sub-N ↔ año de nacimiento", () => {
  it("Sub-18 en la temporada 2026 admite a los nacidos en 2009 o después", () => {
    expect(birthYearForMaxAge(2026, 18)).toBe(2009)
  })

  it("Sub-13 en la temporada 2026 admite a los nacidos en 2014 o después", () => {
    expect(birthYearForMaxAge(2026, 13)).toBe(2014)
  })

  it("es reversible para poder re-renderizar la etiqueta", () => {
    expect(maxAgeForBirthYear(2026, birthYearForMaxAge(2026, 18))).toBe(18)
  })
})

// ==================== computePlanPricing ====================

const ANA = { firstNames: "Ana", lastNames: "Pérez" }
const LUZ = { firstNames: "Luz", lastNames: "Silva" }

function entry(
  id: string,
  discipline: string,
  price: string,
  athletes: Array<[string, { firstNames: string; lastNames: string }]>
) {
  return {
    id,
    modality: { discipline, price },
    athletes: athletes.map(([athleteId, athlete]) => ({ athleteId, athlete })),
  }
}

function plan(registrations: PricingPlanLike["registrations"]): PricingPlanLike {
  return { id: "plan-1", eventId: "event-1", registrations }
}

// Doble de lectura: devuelve las cuotas que ya están pagadas o reservadas.
function coverage(
  rows: Array<{ discipline: string; athleteId: string; code?: string }>
): CoverageLookup {
  return async () =>
    rows.map((row) => ({
      discipline: row.discipline,
      athleteId: row.athleteId,
      orderCode: row.code,
    }))
}

const NO_COVERAGE = coverage([])

const DIVING_FLAT: EventDisciplineConfigLike[] = [
  {
    discipline: "DIVING",
    pricingMode: "PER_ATHLETE",
    athleteFee: "80.00",
    ageRuleMode: "RANGE",
  },
]

describe("computePlanPricing · precio por formación (histórico)", () => {
  it("sin configuración suma el precio de cada prueba", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([
        entry("r1", "ARTISTIC_SWIMMING", "150.00", [["a1", ANA]]),
        entry("r2", "ARTISTIC_SWIMMING", "90.00", [["a1", ANA]]),
      ]),
      []
    )

    expect(pricing.total.toString()).toBe("240")
    expect(pricing.lines).toHaveLength(2)
    expect(pricing.lines.every((line) => line.kind === "ENTRY")).toBe(true)
  })

  it("no consulta cuotas si ninguna disciplina cobra por deportista", async () => {
    let called = false
    const spy: CoverageLookup = async () => {
      called = true
      return []
    }
    await computePlanPricing(
      spy,
      plan([entry("r1", "ARTISTIC_SWIMMING", "150.00", [["a1", ANA]])]),
      []
    )
    expect(called).toBe(false)
  })
})

describe("computePlanPricing · cuota fija por deportista", () => {
  it("un clavadista con tres pruebas paga una sola cuota", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([
        entry("r1", "DIVING", "60.00", [["a1", ANA]]),
        entry("r2", "DIVING", "60.00", [["a1", ANA]]),
        entry("r3", "DIVING", "60.00", [["a1", ANA]]),
      ]),
      DIVING_FLAT
    )

    expect(pricing.total.toString()).toBe("80")
    // Las formaciones se conservan como registro nominal, pero a 0.
    expect(pricing.lines.filter((l) => l.kind === "ENTRY")).toHaveLength(3)
    expect(
      pricing.lines
        .filter((l) => l.kind === "ENTRY")
        .every((l) => l.amount.isZero())
    ).toBe(true)
    expect(pricing.lines.filter((l) => l.kind === "ATHLETE_FEE")).toHaveLength(1)
  })

  it("cobra una cuota por cada deportista distinto", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([
        entry("r1", "DIVING", "60.00", [["a1", ANA]]),
        entry("r2", "DIVING", "60.00", [["a2", LUZ]]),
      ]),
      DIVING_FLAT
    )
    expect(pricing.total.toString()).toBe("160")
  })

  it("no vuelve a cobrar al deportista que ya pagó la cuota del evento", async () => {
    const pricing = await computePlanPricing(
      coverage([{ discipline: "DIVING", athleteId: "a1", code: "INS-ABC123" }]),
      plan([entry("r1", "DIVING", "60.00", [["a1", ANA]])]),
      DIVING_FLAT
    )

    expect(pricing.total.toString()).toBe("0")
    expect(pricing.coveredAthleteFees).toBe(1)
    expect(pricing.chargeableLines.filter((l) => l.kind === "ATHLETE_FEE")).toHaveLength(0)
    const fee = pricing.lines.find((l) => l.kind === "ATHLETE_FEE")
    expect(fee?.coveredByOrderCode).toBe("INS-ABC123")
  })

  it("en un evento mixto cobra formaciones y cuotas por separado", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([
        entry("r1", "DIVING", "60.00", [["a1", ANA]]),
        entry("r2", "ARTISTIC_SWIMMING", "150.00", [["a2", LUZ]]),
      ]),
      DIVING_FLAT
    )

    expect(pricing.total.toString()).toBe("230")
    const diving = pricing.byDiscipline.find((d) => d.discipline === "DIVING")!
    const artistic = pricing.byDiscipline.find(
      (d) => d.discipline === "ARTISTIC_SWIMMING"
    )!
    expect(diving).toMatchObject({ entriesAmount: 0, feesAmount: 80, subtotal: 80 })
    expect(artistic).toMatchObject({
      entriesAmount: 150,
      feesAmount: 0,
      subtotal: 150,
    })
  })

  it("señala la disciplina PER_ATHLETE sin cuota en vez de cobrar cero", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([entry("r1", "DIVING", "60.00", [["a1", ANA]])]),
      [{ ...DIVING_FLAT[0], athleteFee: null }]
    )
    expect(pricing.misconfiguredDisciplines).toEqual(["DIVING"])
  })

  it("cuenta deportistas distintos también donde se cobra por formación", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([
        entry("r1", "ARTISTIC_SWIMMING", "150.00", [["a1", ANA], ["a2", LUZ]]),
        entry("r2", "ARTISTIC_SWIMMING", "90.00", [["a1", ANA]]),
      ]),
      []
    )
    const artistic = pricing.byDiscipline[0]
    expect(artistic.entryCount).toBe(2)
    expect(artistic.athleteCount).toBe(2)
  })
})
