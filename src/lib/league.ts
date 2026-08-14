import { formatMoney } from "./utils"

// Las cuentas de una liga viven aca, puras y sin Prisma, porque las usan el
// formulario del admin, la ficha del evento y la planilla del club.
// El motor de precios no cambia: la prueba se guarda con el precio final.
export interface LeagueCategoryPlan {
  pricePerMatch: number
  matchesPerTeam: number
  expectedTeams: number
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
