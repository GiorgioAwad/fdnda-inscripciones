import type { AgeRuleModeValue } from "@/lib/event-pricing"
import type { PlanValidationResult } from "@/lib/plan-validation"

export type PlanStatus = "DRAFT" | "AWAITING_PAYMENT" | "PAID" | "ABANDONED"

export interface AthleteView {
  id: string
  firstNames: string
  lastNames: string
  docType: string
  docNumber: string
  birthDate: string
  sex: "M" | "F"
  disciplines: string[]
  /**
   * Disciplinas con una afiliación que cubre toda la competencia de la
   * planilla. null = no se consultó (planilla sin competencia o sin temporada).
   */
  coveredDisciplines: string[] | null
}

export interface EventView {
  id: string
  name: string
  slug: string
  venue: string | null
  city: string | null
  startDate: string
  endDate: string
  registrationDeadline: string
  /**
   * Cierre de inscripciones con fecha y hora de Lima, ya formateado en el
   * servidor: formatear horas en el cliente puede diferir del HTML del servidor.
   */
  registrationDeadlineLabel: string
  disciplines: string[]
  seasonName: string | null
}

export interface ModalityView {
  id: string
  discipline: string
  name: string
  category: string | null
  /** Nivel del campeonato de niveles de artística. null fuera de ese formato. */
  level: string | null
  sexRule: "MALE" | "FEMALE" | "MIXED" | "ANY"
  birthYearFrom: number | null
  birthYearTo: number | null
  upgradeYear: number | null
  minAthletes: number
  maxAthletes: number
  price: number
  /** Desglose de liga; nulos en una prueba con precio directo. */
  pricePerMatch: number | null
  matchesPerTeam: number | null
  capacity: number | null
  // Cambia cómo se lee la ventana de años: en MAX_AGE_ONLY birthYearFrom es un
  // tope de edad ("Sub-18 = nacidos en 2009 o después"), no un piso de rango.
  ageRuleMode: AgeRuleModeValue
  /** Qué cobra el evento en la disciplina de esta prueba. Pueden ser los dos. */
  chargesEntry: boolean
  chargesAthleteFee: boolean
  /** Cuota de competencia por deportista de su disciplina; null si no se cobra. */
  athleteFee: number | null
}

export interface EntryView {
  id: string
  modalityId: string
  status: string
  athleteIds: string[]
  reserveIds: string[]
}

export interface LockedEntryView extends EntryView {
  modalityName: string
  category: string | null
  discipline: string
}

/**
 * Par (prueba, deportista) que ya está en una orden pendiente o pagada. El único
 * de base impide repetirlo, así que la casilla se pinta marcada y bloqueada en
 * vez de dejar que el club choque con un error al guardar.
 */
export interface LockedPairView {
  modalityId: string
  athleteId: string
  status: string
}

export interface PlanView {
  id: string
  status: PlanStatus
  revision: number
  currentStep: number
  clubName: string
  event: EventView | null
  roster: AthleteView[]
  entries: EntryView[]
  activeOrder: {
    id: string
    code: string
    status: string
    totalAmount: number
  } | null
  /**
   * Por qué la planilla ya no se puede pagar aunque siga en borrador. Se calcula
   * en el servidor para no leer el reloj durante el render del cliente.
   */
  closedReason: "DEADLINE" | "CLOSED" | null
  /** Conceptos que el club eligió pagar. null = lo que diga el evento. */
  paysEntry: boolean | null
  paysAthleteFee: boolean | null
}

export interface AthletePageView {
  rows: AthleteView[]
  page: number
  pageSize: number
  total: number
  pageCount: number
}

export type SerializableValidation = PlanValidationResult
