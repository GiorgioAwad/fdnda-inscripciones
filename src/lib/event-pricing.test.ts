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

const soloCuota = {
  discipline: "DIVING",
  chargesEntry: false,
  chargesAthleteFee: true,
  athleteFee: "80.00",
  ageRuleMode: "RANGE",
}

const subN = {
  discipline: "WATER_POLO",
  chargesEntry: true,
  chargesAthleteFee: false,
  athleteFee: null,
  ageRuleMode: "MAX_AGE_ONLY",
}

const poloAmbos = {
  discipline: "WATER_POLO",
  chargesEntry: true,
  chargesAthleteFee: true,
  athleteFee: "60.00",
  ageRuleMode: "MAX_AGE_ONLY",
}

describe("disciplineConfigFor", () => {
  it("sin fila devuelve el default histórico: los eventos previos no cambian", () => {
    expect(disciplineConfigFor([], "DIVING")).toEqual({
      discipline: "DIVING",
      chargesEntry: true,
      chargesAthleteFee: false,
      athleteFee: null,
      ageRuleMode: "RANGE",
    })
  })

  it("no mezcla disciplinas: una config de clavados no aplica a polo", () => {
    const config = disciplineConfigFor([soloCuota], "WATER_POLO")
    expect(config.chargesEntry).toBe(true)
    expect(config.chargesAthleteFee).toBe(false)
  })

  it("lee la cuota fija de una disciplina que cobra por deportista", () => {
    const config = disciplineConfigFor([soloCuota], "DIVING")
    expect(config.chargesAthleteFee).toBe(true)
    expect(config.athleteFee).toBe("80.00")
  })

  it("polo puede cobrar los dos conceptos a la vez", () => {
    const config = disciplineConfigFor([poloAmbos], "WATER_POLO")
    expect(config.chargesEntry).toBe(true)
    expect(config.chargesAthleteFee).toBe(true)
    expect(config.athleteFee).toBe("60.00")
  })

  it("ignora una cuota residual cuando ya no se cobra por deportista", () => {
    const config = disciplineConfigFor(
      [{ ...soloCuota, chargesAthleteFee: false, chargesEntry: true }],
      "DIVING"
    )
    expect(config.athleteFee).toBeNull()
  })

  it("trata una regla de edad desconocida como el default en vez de romper", () => {
    const config = disciplineConfigFor(
      [{ ...subN, ageRuleMode: "OTRA_COSA" }],
      "WATER_POLO"
    )
    expect(config.ageRuleMode).toBe("RANGE")
  })
})

describe("isPricingConfigurationValid", () => {
  it("acepta una disciplina que solo cobra por formación", () => {
    expect(
      isPricingConfigurationValid(disciplineConfigFor([], "ARTISTIC_SWIMMING"))
    ).toBe(true)
  })

  it("rechaza cobrar por deportista sin cuota", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...soloCuota, athleteFee: null }], "DIVING")
      )
    ).toBe(false)
  })

  it("rechaza cobrar por deportista con cuota cero", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...soloCuota, athleteFee: "0" }], "DIVING")
      )
    ).toBe(false)
  })

  it("rechaza polo con los dos conceptos si la cuota falta", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...poloAmbos, athleteFee: null }], "WATER_POLO")
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
    chargesEntry: false,
    chargesAthleteFee: true,
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
    expect(diving).toMatchObject({
      chargesEntry: false,
      chargesAthleteFee: true,
      entriesAmount: 0,
      feesAmount: 80,
      subtotal: 80,
    })
    expect(artistic).toMatchObject({
      chargesEntry: true,
      chargesAthleteFee: false,
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

const POLO_AMBOS: EventDisciplineConfigLike[] = [
  {
    discipline: "WATER_POLO",
    chargesEntry: true,
    chargesAthleteFee: true,
    athleteFee: "60.00",
    ageRuleMode: "MAX_AGE_ONLY",
  },
]

function planCon(
  choice: { paysEntry?: boolean | null; paysAthleteFee?: boolean | null },
  registrations: PricingPlanLike["registrations"]
): PricingPlanLike {
  return { id: "plan-1", eventId: "event-1", ...choice, registrations }
}

describe("computePlanPricing · polo cobra los dos conceptos", () => {
  const plantel = () =>
    entry("r1", "WATER_POLO", "500.00", [
      ["a1", ANA],
      ["a2", LUZ],
    ])

  it("sin elección explícita cobra el plantel y las dos cuotas", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("620")
  })

  it("el club que solo paga por deportista no paga el plantel", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: false, paysAthleteFee: true }, [plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("120")
    // La formación se conserva como registro nominal, pero a 0.
    const entryLine = pricing.lines.find((l) => l.kind === "ENTRY")!
    expect(entryLine.amount.isZero()).toBe(true)
  })

  it("el club que solo paga el plantel no paga cuotas", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: true, paysAthleteFee: false }, [plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("500")
    expect(pricing.lines.filter((l) => l.kind === "ATHLETE_FEE")).toHaveLength(0)
  })

  it("no marcar ningún concepto deja el total en cero: la validación lo bloquea", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: false, paysAthleteFee: false }, [plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("0")
  })

  it("la elección del club no puede prender un concepto que el evento no cobra", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: true, paysAthleteFee: true }, [
        entry("r1", "ARTISTIC_SWIMMING", "150.00", [["a1", ANA]]),
      ]),
      []
    )
    expect(pricing.total.toString()).toBe("150")
    expect(pricing.lines.filter((l) => l.kind === "ATHLETE_FEE")).toHaveLength(0)
  })

  it("una cuota ya pagada no se vuelve a cobrar aunque el plantel sí", async () => {
    const pricing = await computePlanPricing(
      coverage([{ discipline: "WATER_POLO", athleteId: "a1", code: "INS-XYZ" }]),
      plan([plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("560")
    expect(pricing.coveredAthleteFees).toBe(1)
  })

  it("el desglose por disciplina reporta los dos conceptos", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([plantel()]),
      POLO_AMBOS
    )
    expect(pricing.byDiscipline[0]).toMatchObject({
      discipline: "WATER_POLO",
      chargesEntry: true,
      chargesAthleteFee: true,
      entriesAmount: 500,
      feesAmount: 120,
      subtotal: 620,
    })
  })

  it("señala el concepto habilitado sin cuota en vez de cobrar cero", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([plantel()]),
      [{ ...POLO_AMBOS[0], athleteFee: null }]
    )
    expect(pricing.misconfiguredDisciplines).toEqual(["WATER_POLO"])
  })

  it("no señala mala configuración si el club no eligió pagar esa cuota", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysAthleteFee: false }, [plantel()]),
      [{ ...POLO_AMBOS[0], athleteFee: null }]
    )
    expect(pricing.misconfiguredDisciplines).toEqual([])
  })
})

// Hallazgo 1 (CRITICAL): paysEntry/paysAthleteFee son un par por PLANILLA,
// pero solo tienen que aplicarse en la disciplina que ofrece elegir -la que
// cobra los DOS conceptos a la vez-. Antes se multiplicaban contra la config
// de CADA disciplina de la planilla, así que en un evento multidisciplina
// apagar el plantel pensando en polo también apagaba (a $0) formaciones de
// disciplinas que cobran un solo concepto y nunca ofrecieron elegir.
describe("computePlanPricing · la elección del club solo apaga la disciplina que ofrece elegir", () => {
  const ARTISTIC_SOLO_ENTRY: EventDisciplineConfigLike = {
    discipline: "ARTISTIC_SWIMMING",
    chargesEntry: true,
    chargesAthleteFee: false,
    athleteFee: null,
    ageRuleMode: "RANGE",
  }

  it("multidisciplina: apagar el plantel pensando en polo no apaga la formación de artística", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: false }, [
        entry("r1", "WATER_POLO", "500.00", [["a1", ANA], ["a2", LUZ]]),
        entry("r2", "ARTISTIC_SWIMMING", "150.00", [["a3", ANA]]),
      ]),
      [...POLO_AMBOS, ARTISTIC_SOLO_ENTRY]
    )

    const polo = pricing.byDiscipline.find((d) => d.discipline === "WATER_POLO")!
    const artistic = pricing.byDiscipline.find(
      (d) => d.discipline === "ARTISTIC_SWIMMING"
    )!

    // Polo sí ofrecía elegir (cobra los dos): el club apagó el plantel y su
    // formación va a 0, la cuota por deportista sigue en pie.
    expect(polo.chargedEntry).toBe(false)
    expect(polo.chargedAthleteFee).toBe(true)
    const poloEntry = pricing.lines.find(
      (l) => l.kind === "ENTRY" && l.discipline === "WATER_POLO"
    )!
    expect(poloEntry.amount.isZero()).toBe(true)

    // Artística cobra un solo concepto: nunca ofreció elegir, así que
    // paysEntry=false (pensado para polo) no la toca.
    expect(artistic.chargedEntry).toBe(true)
    const artisticEntry = pricing.lines.find(
      (l) => l.kind === "ENTRY" && l.discipline === "ARTISTIC_SWIMMING"
    )!
    expect(artisticEntry.amount.toString()).toBe("150")

    // 2 cuotas de polo (60 c/u) + la formación de artística.
    expect(pricing.total.toString()).toBe("270")
  })

  it("evento de un solo concepto: apagar esa única bandera no lo apaga, porque nunca ofreció elegir", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysAthleteFee: false }, [
        entry("r1", "DIVING", "60.00", [["a1", ANA]]),
      ]),
      DIVING_FLAT
    )

    expect(pricing.total.toString()).toBe("80")
    expect(pricing.byDiscipline[0].chargedAthleteFee).toBe(true)
  })
})
