import { prisma } from "./prisma"
import { disciplineLabel } from "./disciplines"
import {
  disciplineConfigFor,
  type EventDisciplineConfigLike,
} from "./event-pricing"
import {
  parseAthleteFeeSnapshot,
  registrationOrderItemView,
} from "./registration-snapshots"
import { SEX_RULE_LABELS, birthYearOf, toAmount } from "./utils"

export interface EventReport {
  event: {
    id: string
    name: string
    status: string
    // Solo para presentación: la franja de andarivel del encabezado.
    disciplines: string[]
  }
  totals: {
    paidRegistrations: number
    pendingRegistrations: number
    distinctAthletes: number
    /** Formaciones + cuotas fijas por deportista, solo lo pagado. */
    revenue: number
    /** Parte de `revenue` que viene de cuotas fijas por deportista. */
    athleteFeeRevenue: number
    paidAthleteFees: number
  }
  athleteFeeRows: Array<{
    athleteName: string
    docNumber: string
    birthYear: number
    sex: string
    clubName: string
    discipline: string
    fee: number
    status: string
  }>
  modalityRows: Array<{
    modalityId: string
    discipline: string
    name: string
    category: string
    sexLabel: string
    price: number
    paidCount: number
    pendingCount: number
    athleteCount: number
    revenue: number
  }>
  clubRows: Array<{
    clubName: string
    paidCount: number
    athleteCount: number
    amount: number
  }>
  nominalRows: Array<{
    athleteName: string
    docNumber: string
    birthYear: number
    sex: string
    clubName: string
    discipline: string
    modalityName: string
    category: string
    isReserve: boolean
    status: string
  }>
  orderRows: Array<{
    code: string
    isLegacy: boolean
    clubName: string
    createdAt: Date
    status: string
    provider: string
    eventAmount: number
    itemCount: number
  }>
}

interface NormalizedAthlete {
  id: string
  firstNames: string
  lastNames: string
  docNumber: string
  birthYear: number
  sex: string
  isReserve: boolean
}

interface NormalizedRegistration {
  registrationId: string
  modalityId: string
  discipline: string
  modalityName: string
  category: string
  sexRule: string
  price: number
  clubName: string
  status: "PAID" | "PENDING_PAYMENT"
  athletes: NormalizedAthlete[]
}

type LiveRegistration = Awaited<
  ReturnType<typeof loadLiveRegistrations>
>[number]

function loadLiveRegistrations(eventId: string, clubId?: string) {
  return prisma.registration.findMany({
    where: {
      modality: { eventId },
      status: { in: ["PAID", "PENDING_PAYMENT"] },
      ...(clubId ? { clubId } : {}),
    },
    include: {
      modality: true,
      club: { select: { name: true } },
      athletes: { include: { athlete: true } },
    },
  })
}

function loadEventOrders(eventId: string, clubId?: string) {
  return prisma.order.findMany({
    where: {
      kind: "REGISTRATION",
      ...(clubId ? { clubId } : {}),
      OR: [
        { eventId },
        { items: { some: { registration: { modality: { eventId } } } } },
      ],
    },
    include: {
      club: { select: { name: true } },
      items: {
        include: {
          registration: {
            include: {
              modality: true,
              club: { select: { name: true } },
              athletes: { include: { athlete: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

export type EventOrderWithItems = Awaited<
  ReturnType<typeof loadEventOrders>
>[number]

export interface NormalizedAthleteFee {
  athleteId: string
  athleteName: string
  docNumber: string
  birthYear: number
  sex: string
  clubName: string
  discipline: string
  fee: number
  status: "PAID" | "PENDING_PAYMENT"
}

export interface EventRegistrationCollection {
  registrations: NormalizedRegistration[]
  athleteFees: NormalizedAthleteFee[]
  orders: EventOrderWithItems[]
  // Nombre/fechas del evento tal como quedaron congelados en la primera orden
  // pagada. Si el admin renombra el evento, el reporte histórico no cambia.
  frozenEvent: NonNullable<
    ReturnType<typeof registrationOrderItemView>["snapshot"]
  >["event"] | undefined
}

/**
 * Reúne las inscripciones de un evento priorizando el snapshot congelado de cada
 * OrderItem y cayendo a las relaciones vivas solo para filas legadas sin
 * snapshot. Con `clubId` devuelve exactamente lo mismo acotado a ese club, que
 * es lo que consume el reporte descargable del portal.
 */
export async function collectEventRegistrations(
  eventId: string,
  options: { clubId?: string } = {}
): Promise<EventRegistrationCollection> {
  const { clubId } = options
  const [liveRegistrations, orders, disciplineConfigs] = await Promise.all([
    loadLiveRegistrations(eventId, clubId),
    loadEventOrders(eventId, clubId),
    prisma.eventDisciplineConfig.findMany({ where: { eventId } }),
  ])

  const registrations: NormalizedRegistration[] = []
  const athleteFees: NormalizedAthleteFee[] = []
  const representedRegistrationIds = new Set<string>()
  const frozenEvent = orders
    .filter((order) => order.status === "PAID")
    .flatMap((order) => order.items)
    .map((item) => registrationOrderItemView(item).snapshot?.event)
    .find((snapshotEvent) => snapshotEvent?.id === eventId)

  for (const order of orders) {
    if (order.status !== "PENDING" && order.status !== "PAID") continue

    for (const item of order.items) {
      // Cuota fija por deportista: no es una formación, va en su propia tabla.
      const feeSnapshot = parseAthleteFeeSnapshot(item.registrationSnapshot)
      if (feeSnapshot) {
        if (feeSnapshot.event.id !== eventId) continue
        athleteFees.push({
          athleteId: feeSnapshot.athlete.id,
          athleteName: `${feeSnapshot.athlete.lastNames}, ${feeSnapshot.athlete.firstNames}`,
          docNumber: feeSnapshot.athlete.docNumber,
          birthYear: birthYearOf(feeSnapshot.athlete.birthDate),
          sex: feeSnapshot.athlete.sex,
          clubName: feeSnapshot.club.name,
          discipline: feeSnapshot.discipline,
          fee: toAmount(item.unitPrice),
          status: order.status === "PAID" ? "PAID" : "PENDING_PAYMENT",
        })
        continue
      }

      const view = registrationOrderItemView(item)
      const snapshot = view.snapshot
      if (snapshot) {
        if (snapshot.event.id !== eventId) continue
        representedRegistrationIds.add(snapshot.registration.id)
        registrations.push({
          registrationId: snapshot.registration.id,
          modalityId: snapshot.modality.id,
          discipline: snapshot.modality.discipline,
          modalityName: snapshot.modality.name,
          category: snapshot.modality.category ?? "",
          sexRule: snapshot.modality.sexRule,
          price: view.unitPrice,
          clubName: snapshot.club.name,
          status: order.status === "PAID" ? "PAID" : "PENDING_PAYMENT",
          athletes: snapshot.registration.athletes.map((athlete) => ({
            id: athlete.id,
            firstNames: athlete.firstNames,
            lastNames: athlete.lastNames,
            docNumber: athlete.docNumber,
            birthYear: birthYearOf(athlete.birthDate),
            sex: athlete.sex,
            isReserve: athlete.isReserve,
          })),
        })
        continue
      }

      const live = item.registration
      if (!live || live.modality.eventId !== eventId) continue
      representedRegistrationIds.add(live.id)
      registrations.push(
        normalizeLiveRegistration(
          {
            ...live,
            status: order.status === "PAID" ? "PAID" : "PENDING_PAYMENT",
          },
          disciplineConfigs
        )
      )
    }
  }

  // Rollout/legacy fallback: registrations without an order snapshot remain
  // visible and use their live relations exactly as before.
  for (const registration of liveRegistrations) {
    if (representedRegistrationIds.has(registration.id)) continue
    registrations.push(normalizeLiveRegistration(registration, disciplineConfigs))
  }

  return { registrations, athleteFees, orders, frozenEvent }
}

function normalizeLiveRegistration(
  registration: LiveRegistration,
  disciplineConfigs: readonly EventDisciplineConfigLike[]
): NormalizedRegistration {
  // Sin snapshot hay que reconstruir el importe. Si la disciplina cobra cuota
  // fija, la formación no cuesta: usar el precio de lista duplicaría el ingreso.
  const perAthlete =
    disciplineConfigFor(disciplineConfigs, registration.modality.discipline)
      .pricingMode === "PER_ATHLETE"
  return {
    registrationId: registration.id,
    modalityId: registration.modality.id,
    discipline: registration.modality.discipline,
    modalityName: registration.modality.name,
    category: registration.modality.category ?? "",
    sexRule: registration.modality.sexRule,
    price: perAthlete ? 0 : toAmount(registration.modality.price),
    clubName: registration.club.name,
    status: registration.status as "PAID" | "PENDING_PAYMENT",
    athletes: registration.athletes.map((row) => ({
      id: row.athlete.id,
      firstNames: row.athlete.firstNames,
      lastNames: row.athlete.lastNames,
      docNumber: row.athlete.docNumber,
      birthYear: birthYearOf(row.athlete.birthDate),
      sex: row.athlete.sex,
      isReserve: row.isReserve,
    })),
  }
}

// ==================== REPORTE DEL CLUB ====================

export interface ClubEventReport {
  event: {
    name: string
    venue: string | null
    city: string | null
    startDate: Date
    endDate: Date
    seasonName: string | null
  }
  clubName: string
  totals: {
    paidRegistrations: number
    pendingRegistrations: number
    distinctAthletes: number
    athleteFees: number
    amount: number
  }
  modalityRows: Array<{
    discipline: string
    modalityName: string
    category: string
    sexLabel: string
    entryCount: number
    athleteCount: number
    amount: number
  }>
  nominalRows: EventReport["nominalRows"]
  athleteFeeRows: EventReport["athleteFeeRows"]
  orderRows: Array<{
    code: string
    createdAt: Date
    status: string
    amount: number
    itemCount: number
  }>
}

/**
 * Mismo reporte que ve la federación, acotado al club. Lo consume la descarga
 * del portal: el clubId sale de la sesión, nunca de la URL.
 */
export async function getClubEventReport(
  eventId: string,
  clubId: string,
  disciplineAccess?: readonly string[]
): Promise<ClubEventReport | null> {
  const [event, club] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        name: true,
        venue: true,
        city: true,
        startDate: true,
        endDate: true,
        season: { select: { name: true } },
      },
    }),
    prisma.club.findUnique({ where: { id: clubId }, select: { name: true } }),
  ])
  if (!event || !club) return null

  const {
    registrations: allRegistrations,
    athleteFees: allAthleteFees,
    orders,
    frozenEvent,
  } =
    await collectEventRegistrations(eventId, { clubId })
  const allowed = disciplineAccess ? new Set(disciplineAccess) : null
  const registrations = allowed
    ? allRegistrations.filter((row) => allowed.has(row.discipline))
    : allRegistrations
  const athleteFees = allowed
    ? allAthleteFees.filter((row) => allowed.has(row.discipline))
    : allAthleteFees

  const buckets = new Map<
    string,
    {
      discipline: string
      modalityName: string
      category: string
      sexRule: string
      entryCount: number
      athletes: Set<string>
      amount: number
    }
  >()
  for (const registration of registrations) {
    const key = `${registration.modalityId}`
    const bucket = buckets.get(key) ?? {
      discipline: registration.discipline,
      modalityName: registration.modalityName,
      category: registration.category,
      sexRule: registration.sexRule,
      entryCount: 0,
      athletes: new Set<string>(),
      amount: 0,
    }
    bucket.entryCount += 1
    bucket.amount += registration.price
    for (const athlete of registration.athletes) bucket.athletes.add(athlete.id)
    buckets.set(key, bucket)
  }

  const modalityRows = [...buckets.values()]
    .map((bucket) => ({
      discipline: disciplineLabel(bucket.discipline),
      modalityName: bucket.modalityName,
      category: bucket.category,
      sexLabel: SEX_RULE_LABELS[bucket.sexRule] ?? bucket.sexRule,
      entryCount: bucket.entryCount,
      athleteCount: bucket.athletes.size,
      amount: bucket.amount,
    }))
    .sort(
      (a, b) =>
        a.discipline.localeCompare(b.discipline) ||
        a.modalityName.localeCompare(b.modalityName)
    )

  const nominalRows = registrations
    .flatMap((registration) =>
      registration.athletes.map((athlete) => ({
        athleteName: `${athlete.lastNames}, ${athlete.firstNames}`,
        docNumber: athlete.docNumber,
        birthYear: athlete.birthYear,
        sex: athlete.sex,
        clubName: registration.clubName,
        discipline: disciplineLabel(registration.discipline),
        modalityName: registration.modalityName,
        category: registration.category,
        isReserve: athlete.isReserve,
        status: registration.status === "PAID" ? "Pagada" : "Por pagar",
      }))
    )
    .sort(
      (a, b) =>
        a.discipline.localeCompare(b.discipline) ||
        a.modalityName.localeCompare(b.modalityName) ||
        a.athleteName.localeCompare(b.athleteName)
    )

  const paidRegistrations = registrations.filter((row) => row.status === "PAID")
  const distinctAthletes = new Set(
    registrations.flatMap((row) => row.athletes.map((athlete) => athlete.id))
  ).size

  const orderRows = orders
    .filter((order) => order.status === "PENDING" || order.status === "PAID")
    .map((order) => {
      const items = allowed
        ? order.items.filter((item) => {
            const fee = parseAthleteFeeSnapshot(item.registrationSnapshot)
            if (fee) return allowed.has(fee.discipline)
            const view = registrationOrderItemView(item)
            const discipline =
              view.snapshot?.modality.discipline ??
              item.registration?.modality.discipline
            return discipline ? allowed.has(discipline) : false
          })
        : order.items
      return {
        code: order.code,
        createdAt: order.createdAt,
        status: order.status === "PAID" ? "Pagada" : "Pendiente",
        amount: items.reduce((sum, item) => sum + toAmount(item.unitPrice), 0),
        itemCount: items.length,
      }
    })
    .filter((order) => order.itemCount > 0)

  return {
    event: {
      name: frozenEvent?.name ?? event.name,
      venue: event.venue,
      city: event.city,
      startDate: event.startDate,
      endDate: event.endDate,
      seasonName: event.season?.name ?? null,
    },
    clubName: club.name,
    totals: {
      paidRegistrations: paidRegistrations.length,
      pendingRegistrations: registrations.length - paidRegistrations.length,
      distinctAthletes,
      athleteFees: athleteFees.length,
      amount:
        registrations.reduce((sum, row) => sum + row.price, 0) +
        athleteFees.reduce((sum, row) => sum + row.fee, 0),
    },
    modalityRows,
    nominalRows,
    athleteFeeRows: athleteFees
      .map((fee) => ({
        athleteName: fee.athleteName,
        docNumber: fee.docNumber,
        birthYear: fee.birthYear,
        sex: fee.sex,
        clubName: fee.clubName,
        discipline: disciplineLabel(fee.discipline),
        fee: fee.fee,
        status: fee.status === "PAID" ? "Pagada" : "Por pagar",
      }))
      .sort((a, b) => a.athleteName.localeCompare(b.athleteName)),
    orderRows,
  }
}

export async function getEventReport(eventId: string): Promise<EventReport | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, status: true, disciplines: true },
  })
  if (!event) return null

  const [{ registrations, athleteFees, orders, frozenEvent }, liveModalities] =
    await Promise.all([
      collectEventRegistrations(eventId),
      prisma.eventModality.findMany({
        where: { eventId },
        orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
      }),
    ])

  const modalityBuckets = new Map<
    string,
    {
      discipline: string
      name: string
      category: string
      sexRule: string
      price: number
      paid: number
      pending: number
      athletes: number
      revenue: number
    }
  >()

  // Orders are newest first, so the first historical snapshot supplies the row
  // label/price while every paid item contributes its own frozen amount.
  for (const registration of registrations) {
    const bucket = modalityBuckets.get(registration.modalityId) ?? {
      discipline: registration.discipline,
      name: registration.modalityName,
      category: registration.category,
      sexRule: registration.sexRule,
      price: registration.price,
      paid: 0,
      pending: 0,
      athletes: 0,
      revenue: 0,
    }
    if (registration.status === "PAID") {
      bucket.paid += 1
      bucket.athletes += registration.athletes.length
      bucket.revenue += registration.price
    } else {
      bucket.pending += 1
    }
    modalityBuckets.set(registration.modalityId, bucket)
  }

  for (const modality of liveModalities) {
    if (modalityBuckets.has(modality.id)) continue
    modalityBuckets.set(modality.id, {
      discipline: modality.discipline,
      name: modality.name,
      category: modality.category ?? "",
      sexRule: modality.sexRule,
      price: toAmount(modality.price),
      paid: 0,
      pending: 0,
      athletes: 0,
      revenue: 0,
    })
  }

  const modalityRows = [...modalityBuckets.entries()]
    .map(([modalityId, bucket]) => ({
      modalityId,
      discipline: disciplineLabel(bucket.discipline),
      name: bucket.name,
      category: bucket.category,
      sexLabel: SEX_RULE_LABELS[bucket.sexRule] ?? bucket.sexRule,
      price: bucket.price,
      paidCount: bucket.paid,
      pendingCount: bucket.pending,
      athleteCount: bucket.athletes,
      revenue: bucket.revenue,
    }))
    .sort(
      (a, b) =>
        a.discipline.localeCompare(b.discipline) || a.name.localeCompare(b.name)
    )

  const byClub = new Map<string, { paid: number; athletes: number; amount: number }>()
  for (const registration of registrations) {
    if (registration.status !== "PAID") continue
    const bucket = byClub.get(registration.clubName) ?? {
      paid: 0,
      athletes: 0,
      amount: 0,
    }
    bucket.paid += 1
    bucket.athletes += registration.athletes.length
    bucket.amount += registration.price
    byClub.set(registration.clubName, bucket)
  }
  // Las cuotas fijas también son recaudación del club, aunque no sean una
  // formación: sin esto la columna MONTO no cuadraría con lo que pagó.
  for (const fee of athleteFees) {
    if (fee.status !== "PAID") continue
    const bucket = byClub.get(fee.clubName) ?? { paid: 0, athletes: 0, amount: 0 }
    bucket.amount += fee.fee
    byClub.set(fee.clubName, bucket)
  }
  const clubRows = [...byClub.entries()]
    .map(([clubName, bucket]) => ({
      clubName,
      paidCount: bucket.paid,
      athleteCount: bucket.athletes,
      amount: bucket.amount,
    }))
    .sort((a, b) => b.amount - a.amount)

  const nominalRows = registrations
    .flatMap((registration) =>
      registration.athletes.map((athlete) => ({
        athleteName: `${athlete.lastNames}, ${athlete.firstNames}`,
        docNumber: athlete.docNumber,
        birthYear: athlete.birthYear,
        sex: athlete.sex,
        clubName: registration.clubName,
        discipline: disciplineLabel(registration.discipline),
        modalityName: registration.modalityName,
        category: registration.category,
        isReserve: athlete.isReserve,
        status: registration.status === "PAID" ? "Pagada" : "Por pagar",
      }))
    )
    .sort(
      (a, b) =>
        a.discipline.localeCompare(b.discipline) ||
        a.modalityName.localeCompare(b.modalityName) ||
        a.athleteName.localeCompare(b.athleteName)
    )

  const orderRows = orders
    .map((order) => {
      const eventItems = order.items
        .map((item) => ({ item, view: registrationOrderItemView(item) }))
        .filter(
          ({ item, view }) =>
            view.snapshot?.event.id === eventId ||
            (!view.snapshot && item.registration?.modality.eventId === eventId)
        )
      return {
        code: order.code,
        isLegacy: order.isLegacy,
        clubName:
          eventItems.find(({ view }) => view.snapshot)?.view.snapshot?.club.name ??
          order.club.name,
        createdAt: order.createdAt,
        status: order.status,
        provider: order.provider ?? "",
        eventAmount: eventItems.reduce(
          (sum, { view }) => sum + view.unitPrice,
          0
        ),
        itemCount: eventItems.length,
      }
    })
    .filter((order) => order.itemCount > 0)

  const paidRegistrations = registrations.filter(
    (registration) => registration.status === "PAID"
  )
  const distinctAthletes = new Set(
    paidRegistrations.flatMap((registration) =>
      registration.athletes.map((athlete) => athlete.id)
    )
  ).size

  const paidFees = athleteFees.filter((fee) => fee.status === "PAID")
  const athleteFeeRevenue = paidFees.reduce((sum, fee) => sum + fee.fee, 0)

  const athleteFeeRows = athleteFees
    .map((fee) => ({
      athleteName: fee.athleteName,
      docNumber: fee.docNumber,
      birthYear: fee.birthYear,
      sex: fee.sex,
      clubName: fee.clubName,
      discipline: disciplineLabel(fee.discipline),
      fee: fee.fee,
      status: fee.status === "PAID" ? "Pagada" : "Por pagar",
    }))
    .sort(
      (a, b) =>
        a.discipline.localeCompare(b.discipline) ||
        a.clubName.localeCompare(b.clubName) ||
        a.athleteName.localeCompare(b.athleteName)
    )

  return {
    event: frozenEvent
      ? {
          id: event.id,
          name: frozenEvent.name,
          status: event.status,
          disciplines: event.disciplines,
        }
      : event,
    totals: {
      paidRegistrations: paidRegistrations.length,
      pendingRegistrations: registrations.length - paidRegistrations.length,
      distinctAthletes,
      revenue:
        paidRegistrations.reduce(
          (sum, registration) => sum + registration.price,
          0
        ) + athleteFeeRevenue,
      athleteFeeRevenue,
      paidAthleteFees: paidFees.length,
    },
    modalityRows,
    clubRows,
    nominalRows,
    athleteFeeRows,
    orderRows,
  }
}
