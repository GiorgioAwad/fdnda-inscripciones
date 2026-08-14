import { formatMoney } from "./utils"

// Las cuentas de una liga viven aca, puras y sin Prisma, porque las usan el
// formulario del admin, la ficha del evento y la planilla del club.
// El motor de precios no cambia: la prueba se guarda con el precio final.
export interface LeagueCategoryPlan {
  pricePerMatch: number
  matchesPerTeam: number
  expectedTeams: number
}

export interface LeagueTeamCountsBySex {
  FEMALE: number
  MALE: number
}

/**
 * Lee la configuracion enviada por el formulario para cada categoria. Se
 * valida otra vez en el servidor porque los campos ocultos tambien se pueden
 * manipular desde el navegador.
 */
export function parseLeagueTeamCounts(value: string): LeagueTeamCountsBySex[] | null {
  try {
    const rows: unknown = JSON.parse(value)
    if (!Array.isArray(rows)) return null
    const valid = rows.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        Number.isInteger((row as LeagueTeamCountsBySex).FEMALE) &&
        (row as LeagueTeamCountsBySex).FEMALE >= 1 &&
        (row as LeagueTeamCountsBySex).FEMALE <= 40 &&
        Number.isInteger((row as LeagueTeamCountsBySex).MALE) &&
        (row as LeagueTeamCountsBySex).MALE >= 1 &&
        (row as LeagueTeamCountsBySex).MALE <= 40
    )
    return valid ? (rows as LeagueTeamCountsBySex[]) : null
  } catch {
    return null
  }
}

/** Lo que paga un equipo por la fase preliminar. */
export function leagueEntryPrice(
  input: Pick<LeagueCategoryPlan, "pricePerMatch" | "matchesPerTeam">
): number {
  return Math.round(input.pricePerMatch * input.matchesPerTeam * 100) / 100
}

/** Total de partidos de la categoria; cada partido involucra dos equipos. */
export function leagueTotalMatches(
  input: Pick<LeagueCategoryPlan, "expectedTeams" | "matchesPerTeam">
): number {
  return Math.ceil((input.expectedTeams * input.matchesPerTeam) / 2)
}

/** Desglose legible del precio final de una formacion. */
export function leaguePriceBreakdown(
  input: Pick<LeagueCategoryPlan, "pricePerMatch" | "matchesPerTeam">
): string {
  const unit = input.matchesPerTeam === 1 ? "partido" : "partidos"
  return `${input.matchesPerTeam} ${unit} × ${formatMoney(input.pricePerMatch)}`
}
