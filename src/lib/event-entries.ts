import { randomUUID } from "node:crypto"
import { prisma } from "./prisma"
import {
  athleteDisciplines,
  getRegistrationEligibility,
  getSeasonCategories,
} from "./affiliations"
import { categoryNameForYear, upgradeBirthYearFor } from "./categories"
import { disciplineLabel, sortDisciplines, type DisciplineValue } from "./disciplines"
import { validateEntryComposition } from "./eligibility"
import {
  type PlanAthlete,
  type PlanEntry,
  type PlanModality,
  type SexRuleValue,
} from "./entry-plan"
import { expireStaleOrders, type ActionResult } from "./orders"
import { birthYearOf, toAmount } from "./utils"

// Inscripciones de un club en UN evento, vistas como una planilla completa: el
// club elige a sus deportistas y les asigna pruebas, y al guardar se reemplaza
// todo lo que tenía en el carrito de ese evento. Lo que ya salió del carrito
// (por pagar o pagado) se muestra pero no se toca.

// Techo defensivo: una planilla real de un club grande no pasa de unas decenas.
const MAX_ENTRIES = 400

export interface ClubEventPlan {
  eventId: string
  eventName: string
  modalities: PlanModality[]
  athletes: PlanAthlete[]
  entries: PlanEntry[]
  // Disciplinas del evento en las que el club está al día / bloqueado.
  affiliatedDisciplines: DisciplineValue[]
  blockedDisciplines: DisciplineValue[]
  seasonYear: number | null
}

export async function getClubEventPlan(
  event: {
    id: string
    name: string
    seasonId: string | null
    startDate: Date
    endDate: Date
    modalities: Array<{
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
      price: unknown
      capacity: number | null
      _count: { registrations: number }
    }>
  },
  clubId: string | null
): Promise<ClubEventPlan> {
  const eventDisciplines = sortDisciplines(
    event.modalities.map((modality) => modality.discipline)
  )

  const season = event.seasonId
    ? await prisma.season.findUnique({ where: { id: event.seasonId } })
    : null
  const categories = season ? await getSeasonCategories(season.id) : []

  const modalities: PlanModality[] = event.modalities.map((modality) => {
    const upgradeYear = upgradeBirthYearFor(modality)
    return {
      id: modality.id,
      discipline: modality.discipline as DisciplineValue,
      name: modality.name,
      category: modality.category ?? "",
      sexRule: modality.sexRule as SexRuleValue,
      birthYearFrom: modality.birthYearFrom,
      birthYearTo: modality.birthYearTo,
      upgradeYear,
      upgradeFromCategory:
        upgradeYear === null
          ? null
          : categoryNameForYear(categories, upgradeYear, modality.discipline),
      minAthletes: modality.minAthletes,
      maxAthletes: modality.maxAthletes,
      price: toAmount(modality.price),
      capacity: modality.capacity,
      registrationCount: modality._count.registrations,
    }
  })

  if (!clubId) {
    return {
      eventId: event.id,
      eventName: event.name,
      modalities,
      athletes: [],
      entries: [],
      affiliatedDisciplines: [],
      blockedDisciplines: eventDisciplines,
      seasonYear: season?.year ?? null,
    }
  }

  const [athleteRows, eligibilityPairs, registrations] = await Promise.all([
    prisma.athlete.findMany({
      where: { clubId, isActive: true },
      orderBy: [{ lastNames: "asc" }, { firstNames: "asc" }],
    }),
    Promise.all(
      eventDisciplines.map(
        async (discipline) =>
          [
            discipline,
            await getRegistrationEligibility(clubId, discipline, {
              seasonId: event.seasonId,
              validFrom: event.startDate,
              validTo: event.endDate,
            }),
          ] as const
      )
    ),
    prisma.registration.findMany({
      where: { clubId, modality: { eventId: event.id } },
      include: { athletes: true },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const eligibility = new Map(eligibilityPairs)

  const athletes: PlanAthlete[] = athleteRows.map((athlete) => {
    const practises = athleteDisciplines(athlete.disciplines)
    const birthYear = birthYearOf(athlete.birthDate)
    const categoryByDiscipline: Partial<Record<DisciplineValue, string>> = {}

    for (const discipline of practises) {
      const name = categoryNameForYear(categories, birthYear, discipline)
      if (name) categoryByDiscipline[discipline] = name
    }

    return {
      id: athlete.id,
      firstNames: athlete.firstNames,
      lastNames: athlete.lastNames,
      docType: athlete.docType,
      docNumber: athlete.docNumber,
      birthDate: athlete.birthDate.toISOString(),
      birthYear,
      sex: athlete.sex,
      disciplines: practises,
      affiliatedIn: eventDisciplines.filter((discipline) =>
        eligibility.get(discipline)?.affiliatedAthleteIds.has(athlete.id)
      ),
      categoryByDiscipline,
    }
  })

  const entries: PlanEntry[] = registrations.map((registration) => ({
    key: registration.id,
    modalityId: registration.modalityId,
    athleteIds: registration.athletes.map((row) => row.athleteId),
    reserveIds: registration.athletes
      .filter((row) => row.isReserve)
      .map((row) => row.athleteId),
    status: registration.status,
    // Guardar la planilla borra y rehace lo que el club tiene en el carrito, así
    // que frente al cupo esas inscripciones cuentan como nuevas y no como
    // ocupadas. registrationCount, abajo, las descuenta para no contarlas dos veces.
    isNew: registration.status === "IN_CART",
  }))

  for (const modality of modalities) {
    const ownInCart = registrations.filter(
      (registration) =>
        registration.modalityId === modality.id && registration.status === "IN_CART"
    ).length
    modality.registrationCount -= ownInCart
  }

  return {
    eventId: event.id,
    eventName: event.name,
    modalities,
    athletes,
    entries,
    affiliatedDisciplines: eventDisciplines.filter(
      (discipline) => eligibility.get(discipline)?.clubIsAffiliated
    ),
    blockedDisciplines: eventDisciplines.filter(
      (discipline) => !eligibility.get(discipline)?.clubIsAffiliated
    ),
    seasonYear: season?.year ?? null,
  }
}

// La consulta que alimenta tanto la página del evento como la hoja de resumen.
export function findEventBySlug(slug: string) {
  return prisma.event.findUnique({
    where: { slug },
    include: {
      modalities: {
        where: { isActive: true },
        orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
        include: { _count: { select: { registrations: true } } },
      },
    },
  })
}

// ==================== GUARDAR LA PLANILLA ====================

export interface EntryInput {
  modalityId: string
  athleteIds: string[]
  reserveIds?: string[]
}

export async function saveEventEntries(input: {
  clubId: string
  eventId: string
  entries: EntryInput[]
}): Promise<ActionResult & { saved?: number }> {
  await expireStaleOrders()

  const event = await prisma.event.findUnique({
    where: { id: input.eventId },
    include: { modalities: { where: { isActive: true } } },
  })

  if (!event) return { success: false, error: "El evento no está disponible." }
  if (event.status !== "OPEN") {
    return { success: false, error: "El evento no tiene inscripciones abiertas." }
  }
  if (event.registrationDeadline < new Date()) {
    return { success: false, error: "El plazo de inscripción ya cerró." }
  }
  if (!event.seasonId) {
    return {
      success: false,
      error: "El evento todavía no tiene una temporada configurada.",
    }
  }

  const modalityById = new Map(event.modalities.map((modality) => [modality.id, modality]))

  // Normaliza antes de validar: sin deportistas repetidos dentro de una entry y
  // sin entries vacías (quitar a todos equivale a borrar la inscripción).
  const entries = input.entries
    .map((entry) => {
      const athleteIds = [...new Set(entry.athleteIds)]
      const chosen = new Set(athleteIds)
      return {
        modalityId: entry.modalityId,
        athleteIds,
        reserveIds: [...new Set(entry.reserveIds ?? [])].filter((id) => chosen.has(id)),
      }
    })
    .filter((entry) => entry.athleteIds.length > 0)

  if (entries.length > MAX_ENTRIES) {
    return {
      success: false,
      error: `La planilla tiene ${entries.length} inscripciones (máximo ${MAX_ENTRIES}).`,
    }
  }
  if (entries.some((entry) => !modalityById.has(entry.modalityId))) {
    return {
      success: false,
      error: "Una de las pruebas ya no está disponible. Recarga la página.",
    }
  }

  const athleteIds = [...new Set(entries.flatMap((entry) => entry.athleteIds))]
  const athleteRows = await prisma.athlete.findMany({
    where: { id: { in: athleteIds }, clubId: input.clubId, isActive: true },
  })

  if (athleteRows.length !== athleteIds.length) {
    return {
      success: false,
      error: "Uno o más deportistas no pertenecen a tu club o están inactivos.",
    }
  }
  const athleteById = new Map(athleteRows.map((athlete) => [athlete.id, athlete]))

  // Afiliación por disciplina: una prueba de polo exige la de polo del club y la
  // de cada deportista, aunque estén al día en clavados.
  const disciplines = [
    ...new Set(
      entries.map(
        (entry) => modalityById.get(entry.modalityId)!.discipline as DisciplineValue
      )
    ),
  ]
  const eligibility = new Map(
    await Promise.all(
      disciplines.map(
        async (discipline) =>
          [
            discipline,
            await getRegistrationEligibility(input.clubId, discipline, {
              seasonId: event.seasonId,
              validFrom: event.startDate,
              validTo: event.endDate,
            }),
          ] as const
      )
    )
  )

  for (const discipline of disciplines) {
    const state = eligibility.get(discipline)!
    if (!state.clubIsAffiliated) return { success: false, error: state.clubReason }
  }

  for (const entry of entries) {
    const modality = modalityById.get(entry.modalityId)!
    const discipline = modality.discipline as DisciplineValue
    const label = [modality.name, modality.category].filter(Boolean).join(" — ")
    const chosen = entry.athleteIds.map((id) => athleteById.get(id)!)

    const notPractising = chosen.filter(
      (athlete) => !athleteDisciplines(athlete.disciplines).includes(discipline)
    )
    if (notPractising.length > 0) {
      const names = notPractising
        .map((athlete) => `${athlete.firstNames} ${athlete.lastNames}`)
        .join(", ")
      return {
        success: false,
        error: `${label}: ${names} no tiene(n) ${disciplineLabel(discipline)} registrada en el padrón.`,
      }
    }

    const notAffiliated = chosen.filter(
      (athlete) => !eligibility.get(discipline)!.affiliatedAthleteIds.has(athlete.id)
    )
    if (notAffiliated.length > 0) {
      const names = notAffiliated
        .map((athlete) => `${athlete.firstNames} ${athlete.lastNames}`)
        .join(", ")
      return {
        success: false,
        error: `Sin afiliación vigente de ${disciplineLabel(discipline)}: ${names}. Afílialos antes de inscribirlos.`,
      }
    }

    const errors = validateEntryComposition(
      { ...modality, upgradeYear: upgradeBirthYearFor(modality) },
      chosen
    )
    if (errors.length > 0) {
      return { success: false, error: `${label}: ${errors.join(" ")}` }
    }
  }

  // Un deportista no puede repetirse en la misma prueba, ni entre dos entries de
  // la planilla (el unique (modalityId, athleteId) lo rechazaría al guardar).
  const pairs = new Set<string>()
  for (const entry of entries) {
    for (const athleteId of entry.athleteIds) {
      const key = `${entry.modalityId}:${athleteId}`
      if (pairs.has(key)) {
        const athlete = athleteById.get(athleteId)!
        return {
          success: false,
          error: `${athlete.firstNames} ${athlete.lastNames} aparece dos veces en la misma prueba.`,
        }
      }
      pairs.add(key)
    }
  }

  const usedModalityIds = [...new Set(entries.map((entry) => entry.modalityId))]

  // Choques con inscripciones que ya no están en el carrito de este club: esas
  // no se reemplazan, así que el deportista ya está dentro de la prueba.
  const locked = await prisma.registrationAthlete.findMany({
    where: {
      modalityId: { in: usedModalityIds },
      athleteId: { in: athleteIds },
      NOT: { registration: { clubId: input.clubId, status: "IN_CART" } },
    },
    include: { athlete: { select: { firstNames: true, lastNames: true } } },
  })

  const conflict = locked.find((row) => pairs.has(`${row.modalityId}:${row.athleteId}`))
  if (conflict) {
    const modality = modalityById.get(conflict.modalityId)!
    return {
      success: false,
      error: `${conflict.athlete.firstNames} ${conflict.athlete.lastNames} ya está inscrito en ${modality.name}${
        modality.category ? ` — ${modality.category}` : ""
      } en una orden en curso o pagada.`,
    }
  }

  // Cupo: cuenta lo de los demás clubes y lo propio que no se reemplaza.
  const withCapacity = usedModalityIds
    .map((id) => modalityById.get(id)!)
    .filter((modality) => modality.capacity !== null)

  for (const modality of withCapacity) {
    const kept = await prisma.registration.count({
      where: {
        modalityId: modality.id,
        status: { in: ["PENDING_PAYMENT", "PAID"] },
      },
    })
    const planned = entries.filter((entry) => entry.modalityId === modality.id).length
    if (kept + planned > modality.capacity!) {
      return {
        success: false,
        error: `${modality.name}${modality.category ? ` — ${modality.category}` : ""} solo tiene ${
          modality.capacity! - kept
        } cupo(s) disponible(s).`,
      }
    }
  }

  const eventModalityIds = event.modalities.map((modality) => modality.id)
  const rows = entries.map((entry) => ({ id: randomUUID(), ...entry }))

  try {
    await prisma.$transaction(
      async (tx) => {
        // La planilla reemplaza al carrito del evento: lo que el club quitó de la
        // pantalla deja de estar inscrito.
        await tx.registration.deleteMany({
          where: {
            clubId: input.clubId,
            status: "IN_CART",
            modalityId: { in: eventModalityIds },
          },
        })

        if (rows.length === 0) return

        await tx.registration.createMany({
          data: rows.map((row) => ({
            id: row.id,
            modalityId: row.modalityId,
            clubId: input.clubId,
            status: "IN_CART" as const,
          })),
        })

        await tx.registrationAthlete.createMany({
          data: rows.flatMap((row) => {
            const reserves = new Set(row.reserveIds)
            return row.athleteIds.map((athleteId) => ({
              registrationId: row.id,
              athleteId,
              modalityId: row.modalityId,
              isReserve: reserves.has(athleteId),
            }))
          }),
        })
      },
      { timeout: 20_000 }
    )
  } catch (error) {
    console.error("saveEventEntries error:", error)
    return {
      success: false,
      error:
        "No se pudo guardar la planilla: alguna inscripción cambió mientras la editabas. Recarga la página.",
    }
  }

  return { success: true, saved: rows.length }
}
