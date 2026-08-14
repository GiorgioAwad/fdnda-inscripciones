import { describe, expect, it } from "vitest"
import { formatMoney } from "./utils"
import {
  leagueEntryPrice,
  leaguePriceBreakdown,
  leagueTotalMatches,
  parseLeagueTeamCounts,
} from "./league"

describe("leagueEntryPrice", () => {
  it("cobra los partidos que juega el equipo", () => {
    expect(leagueEntryPrice({ pricePerMatch: 300, matchesPerTeam: 4 })).toBe(1200)
  })

  it("no pierde centavos con precios decimales", () => {
    expect(leagueEntryPrice({ pricePerMatch: 62.5, matchesPerTeam: 4 })).toBe(250)
  })

  it("sin partidos no cobra", () => {
    expect(leagueEntryPrice({ pricePerMatch: 300, matchesPerTeam: 0 })).toBe(0)
  })
})

describe("leagueTotalMatches", () => {
  it("cuatro equipos que juegan cuatro partidos dan ocho partidos", () => {
    expect(leagueTotalMatches({ expectedTeams: 4, matchesPerTeam: 4 })).toBe(8)
  })

  it("tres equipos que juegan cuatro partidos dan seis partidos", () => {
    expect(leagueTotalMatches({ expectedTeams: 3, matchesPerTeam: 4 })).toBe(6)
  })

  it("redondea hacia arriba un fixture impar", () => {
    expect(leagueTotalMatches({ expectedTeams: 3, matchesPerTeam: 3 })).toBe(5)
  })

  it("un solo equipo sin partidos no genera fixture", () => {
    expect(leagueTotalMatches({ expectedTeams: 1, matchesPerTeam: 0 })).toBe(0)
  })
})

describe("leaguePriceBreakdown", () => {
  it("explica de donde sale el precio del plantel", () => {
    const text = leaguePriceBreakdown({ pricePerMatch: 300, matchesPerTeam: 4 })
    expect(text.startsWith("4 partidos × ")).toBe(true)
    expect(text).toContain(formatMoney(300))
  })

  it("usa singular con un solo partido", () => {
    expect(leaguePriceBreakdown({ pricePerMatch: 300, matchesPerTeam: 1 })).toMatch(
      /^1 partido × /
    )
  })
})

describe("parseLeagueTeamCounts", () => {
  it("conserva los equipos por categoria y sexo de la Liga de Lima", () => {
    const counts = parseLeagueTeamCounts(
      JSON.stringify([
        { FEMALE: 3, MALE: 4 },
        { FEMALE: 3, MALE: 3 },
      ])
    )

    expect(counts).toEqual([
      { FEMALE: 3, MALE: 4 },
      { FEMALE: 3, MALE: 3 },
    ])
    expect(
      counts?.flatMap((row) => [
        leagueTotalMatches({ expectedTeams: row.FEMALE, matchesPerTeam: 4 }),
        leagueTotalMatches({ expectedTeams: row.MALE, matchesPerTeam: 4 }),
      ])
    ).toEqual([6, 8, 6, 6])
  })

  it("rechaza cantidades manipuladas fuera del rango permitido", () => {
    expect(parseLeagueTeamCounts('[{"FEMALE":3,"MALE":0}]')).toBeNull()
    expect(parseLeagueTeamCounts("no es json")).toBeNull()
  })
})
