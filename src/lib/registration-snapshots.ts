import { disciplineLabel } from "./disciplines"
import { toAmount } from "./utils"

export interface RegistrationItemSnapshot {
  version: 1
  capturedAt: string
  plan: { id: string; revision: number }
  club: { id: string; name: string; code: string }
  event: {
    id: string
    name: string
    slug: string
    venue: string | null
    city: string | null
    startDate: string
    endDate: string
    registrationDeadline: string
    season: { id: string; year: number; name: string } | null
  }
  modality: {
    id: string
    discipline: string
    name: string
    category: string | null
    sexRule: string
    birthYearFrom: number | null
    birthYearTo: number | null
    allowsCategoryUpgrade: boolean
    categoryUpgradeBirthYear: number | null
    minAthletes: number
    maxAthletes: number
    price: string
    capacity: number | null
  }
  registration: {
    id: string
    athletes: Array<{
      id: string
      firstNames: string
      lastNames: string
      docType: string
      docNumber: string
      birthDate: string
      sex: "M" | "F"
      disciplines: string[]
      isReserve: boolean
    }>
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null
    ? null
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined
}

/**
 * Order snapshots are historical data, so parse defensively instead of casting
 * Prisma Json. Unknown/newer versions simply use the legacy description fallback.
 */
export function parseRegistrationItemSnapshot(
  value: unknown
): RegistrationItemSnapshot | null {
  const root = record(value)
  if (!root || root.version !== 1) return null

  const plan = record(root.plan)
  const club = record(root.club)
  const event = record(root.event)
  const modality = record(root.modality)
  const registration = record(root.registration)
  if (!plan || !club || !event || !modality || !registration) return null

  const capturedAt = string(root.capturedAt)
  const planId = string(plan.id)
  const planRevision = number(plan.revision)
  const clubId = string(club.id)
  const clubName = string(club.name)
  const clubCode = string(club.code)
  const eventId = string(event.id)
  const eventName = string(event.name)
  const eventSlug = string(event.slug)
  const eventVenue = nullableString(event.venue)
  const eventCity = nullableString(event.city)
  const eventStartDate = string(event.startDate)
  const eventEndDate = string(event.endDate)
  const registrationDeadline = string(event.registrationDeadline)
  const modalityId = string(modality.id)
  const modalityDiscipline = string(modality.discipline)
  const modalityName = string(modality.name)
  const modalityCategory = nullableString(modality.category)
  const modalitySexRule = string(modality.sexRule)
  const birthYearFrom = nullableNumber(modality.birthYearFrom)
  const birthYearTo = nullableNumber(modality.birthYearTo)
  const categoryUpgradeBirthYear = nullableNumber(
    modality.categoryUpgradeBirthYear
  )
  const minAthletes = number(modality.minAthletes)
  const maxAthletes = number(modality.maxAthletes)
  const modalityPrice = string(modality.price)
  const modalityCapacity = nullableNumber(modality.capacity)
  const registrationId = string(registration.id)

  if (
    capturedAt === null ||
    planId === null ||
    planRevision === null ||
    clubId === null ||
    clubName === null ||
    clubCode === null ||
    eventId === null ||
    eventName === null ||
    eventSlug === null ||
    eventVenue === undefined ||
    eventCity === undefined ||
    eventStartDate === null ||
    eventEndDate === null ||
    registrationDeadline === null ||
    modalityId === null ||
    modalityDiscipline === null ||
    modalityName === null ||
    modalityCategory === undefined ||
    modalitySexRule === null ||
    birthYearFrom === undefined ||
    birthYearTo === undefined ||
    categoryUpgradeBirthYear === undefined ||
    minAthletes === null ||
    maxAthletes === null ||
    modalityPrice === null ||
    modalityCapacity === undefined ||
    registrationId === null ||
    typeof modality.allowsCategoryUpgrade !== "boolean"
  ) {
    return null
  }

  const dates = [
    capturedAt,
    eventStartDate,
    eventEndDate,
    registrationDeadline,
  ]
  if (dates.some((date) => Number.isNaN(Date.parse(date)))) return null
  if (
    [planId, clubId, clubName, eventId, eventName, eventSlug, modalityId,
      modalityDiscipline, modalityName, modalitySexRule, registrationId].some(
      (field) => field.trim().length === 0
    ) ||
    !Number.isInteger(planRevision) ||
    planRevision < 0 ||
    !Number.isInteger(minAthletes) ||
    !Number.isInteger(maxAthletes) ||
    minAthletes < 1 ||
    maxAthletes < minAthletes ||
    (birthYearFrom !== null && !Number.isInteger(birthYearFrom)) ||
    (birthYearTo !== null && !Number.isInteger(birthYearTo)) ||
    (categoryUpgradeBirthYear !== null &&
      !Number.isInteger(categoryUpgradeBirthYear)) ||
    (modalityCapacity !== null &&
      (!Number.isInteger(modalityCapacity) || modalityCapacity < 0)) ||
    Date.parse(eventEndDate) < Date.parse(eventStartDate)
  ) {
    return null
  }
  const parsedPrice = Number(modalityPrice)
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0) return null

  const athletesValue = registration.athletes
  if (!Array.isArray(athletesValue) || athletesValue.length === 0) return null
  const athletes: RegistrationItemSnapshot["registration"]["athletes"] = []
  for (const value of athletesValue) {
    const athlete = record(value)
    if (
      !athlete ||
      !Array.isArray(athlete.disciplines) ||
      !athlete.disciplines.every((discipline) => typeof discipline === "string")
    ) {
      return null
    }
    const sex = athlete.sex
    if (sex !== "M" && sex !== "F") return null
    const id = string(athlete.id)
    const firstNames = string(athlete.firstNames)
    const lastNames = string(athlete.lastNames)
    const docType = string(athlete.docType)
    const docNumber = string(athlete.docNumber)
    const birthDate = string(athlete.birthDate)
    if (
      id === null ||
      firstNames === null ||
      lastNames === null ||
      docType === null ||
      docNumber === null ||
      birthDate === null ||
      Number.isNaN(Date.parse(birthDate)) ||
      typeof athlete.isReserve !== "boolean"
    ) {
      return null
    }
    if (
      [id, firstNames, lastNames, docType, docNumber].some(
        (field) => field.trim().length === 0
      )
    ) {
      return null
    }
    athletes.push({
      id,
      firstNames,
      lastNames,
      docType,
      docNumber,
      birthDate,
      sex,
      disciplines: athlete.disciplines as string[],
      isReserve: athlete.isReserve,
    })
  }

  const seasonValue = event.season
  let season: RegistrationItemSnapshot["event"]["season"] = null
  if (seasonValue !== null) {
    const seasonRecord = record(seasonValue)
    if (!seasonRecord) return null
    const id = string(seasonRecord.id)
    const year = number(seasonRecord.year)
    const name = string(seasonRecord.name)
    if (id === null || year === null || name === null) return null
    season = { id, year, name }
  }

  return {
    version: 1,
    capturedAt,
    plan: { id: planId, revision: planRevision },
    club: { id: clubId, name: clubName, code: clubCode },
    event: {
      id: eventId,
      name: eventName,
      slug: eventSlug,
      venue: eventVenue,
      city: eventCity,
      startDate: eventStartDate,
      endDate: eventEndDate,
      registrationDeadline,
      season,
    },
    modality: {
      id: modalityId,
      discipline: modalityDiscipline,
      name: modalityName,
      category: modalityCategory,
      sexRule: modalitySexRule,
      birthYearFrom,
      birthYearTo,
      allowsCategoryUpgrade: modality.allowsCategoryUpgrade,
      categoryUpgradeBirthYear,
      minAthletes,
      maxAthletes,
      price: modalityPrice,
      capacity: modalityCapacity,
    },
    registration: { id: registrationId, athletes },
  }
}

// ==================== CUOTA FIJA POR DEPORTISTA ====================
// Los ítems de cuota (pricingMode PER_ATHLETE) no tienen prueba ni formación, así
// que no caben en el snapshot v1. Llevan el suyo, con `kind` para distinguirlos.
// El parser v1 queda intacto a propósito: es el que sostiene todo el histórico.

export interface AthleteFeeSnapshot {
  version: 2
  kind: "ATHLETE_FEE"
  capturedAt: string
  plan: { id: string; revision: number }
  club: { id: string; name: string; code: string }
  event: RegistrationItemSnapshot["event"]
  discipline: string
  fee: string
  athlete: {
    id: string
    firstNames: string
    lastNames: string
    docType: string
    docNumber: string
    birthDate: string
    sex: "M" | "F"
  }
}

export function parseAthleteFeeSnapshot(value: unknown): AthleteFeeSnapshot | null {
  const root = record(value)
  if (!root || root.version !== 2 || root.kind !== "ATHLETE_FEE") return null

  const plan = record(root.plan)
  const club = record(root.club)
  const event = record(root.event)
  const athlete = record(root.athlete)
  if (!plan || !club || !event || !athlete) return null

  const capturedAt = string(root.capturedAt)
  const discipline = string(root.discipline)
  const fee = string(root.fee)
  const planId = string(plan.id)
  const planRevision = number(plan.revision)
  const clubId = string(club.id)
  const clubName = string(club.name)
  const clubCode = string(club.code)
  const eventId = string(event.id)
  const eventName = string(event.name)
  const eventSlug = string(event.slug)
  const eventVenue = nullableString(event.venue)
  const eventCity = nullableString(event.city)
  const eventStartDate = string(event.startDate)
  const eventEndDate = string(event.endDate)
  const registrationDeadline = string(event.registrationDeadline)
  const athleteId = string(athlete.id)
  const firstNames = string(athlete.firstNames)
  const lastNames = string(athlete.lastNames)
  const docType = string(athlete.docType)
  const docNumber = string(athlete.docNumber)
  const birthDate = string(athlete.birthDate)
  const sex = athlete.sex

  const required = [
    capturedAt,
    discipline,
    fee,
    planId,
    clubId,
    clubName,
    clubCode,
    eventId,
    eventName,
    eventSlug,
    eventStartDate,
    eventEndDate,
    registrationDeadline,
    athleteId,
    firstNames,
    lastNames,
    docType,
    docNumber,
    birthDate,
  ]
  if (
    required.some((field) => field === null || field.trim().length === 0) ||
    planRevision === null ||
    !Number.isInteger(planRevision) ||
    planRevision < 0 ||
    eventVenue === undefined ||
    eventCity === undefined ||
    (sex !== "M" && sex !== "F")
  ) {
    return null
  }

  const dates = [capturedAt!, eventStartDate!, eventEndDate!, registrationDeadline!, birthDate!]
  if (dates.some((date) => Number.isNaN(Date.parse(date)))) return null
  if (Date.parse(eventEndDate!) < Date.parse(eventStartDate!)) return null
  const parsedFee = Number(fee)
  if (!Number.isFinite(parsedFee) || parsedFee < 0) return null

  const seasonValue = event.season
  let season: RegistrationItemSnapshot["event"]["season"] = null
  if (seasonValue !== null) {
    const seasonRecord = record(seasonValue)
    if (!seasonRecord) return null
    const id = string(seasonRecord.id)
    const year = number(seasonRecord.year)
    const name = string(seasonRecord.name)
    if (id === null || year === null || name === null) return null
    season = { id, year, name }
  }

  return {
    version: 2,
    kind: "ATHLETE_FEE",
    capturedAt: capturedAt!,
    plan: { id: planId!, revision: planRevision },
    club: { id: clubId!, name: clubName!, code: clubCode! },
    event: {
      id: eventId!,
      name: eventName!,
      slug: eventSlug!,
      venue: eventVenue,
      city: eventCity,
      startDate: eventStartDate!,
      endDate: eventEndDate!,
      registrationDeadline: registrationDeadline!,
      season,
    },
    discipline: discipline!,
    fee: fee!,
    athlete: {
      id: athleteId!,
      firstNames: firstNames!,
      lastNames: lastNames!,
      docType: docType!,
      docNumber: docNumber!,
      birthDate: birthDate!,
      sex,
    },
  }
}

export interface RegistrationOrderItemView {
  description: string
  unitPrice: number
  snapshot: RegistrationItemSnapshot | null
}

export function registrationOrderItemView(item: {
  description: string
  unitPrice: unknown
  registrationSnapshot?: unknown
}): RegistrationOrderItemView {
  const snapshot = parseRegistrationItemSnapshot(item.registrationSnapshot)
  if (!snapshot) {
    return {
      description: item.description,
      unitPrice: toAmount(item.unitPrice),
      snapshot: null,
    }
  }

  const modality = snapshot.modality
  const label = [
    disciplineLabel(modality.discipline),
    modality.name,
    modality.category,
  ]
    .filter(Boolean)
    .join(" — ")
  const athleteNames = snapshot.registration.athletes
    .map(
      (athlete) =>
        `${athlete.firstNames} ${athlete.lastNames}${athlete.isReserve ? " (reserva)" : ""}`
    )
    .join(", ")

  return {
    description: `${snapshot.event.name} | ${label} | ${athleteNames}`,
    // El importe cobrado sale del OrderItem, no del precio de la prueba. Con el
    // precio por formación ambos coinciden, pero cuando la disciplina cobra una
    // cuota fija por deportista la formación va a 0 y la prueba conserva su
    // precio de lista: leer modality.price duplicaría la recaudación en los
    // reportes y en la constancia de pago.
    unitPrice: toAmount(item.unitPrice),
    snapshot,
  }
}
