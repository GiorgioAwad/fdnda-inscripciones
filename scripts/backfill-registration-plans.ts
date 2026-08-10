import "dotenv/config"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

// Backfill aditivo para desplegar las planillas persistentes sobre una base que
// ya tiene eventos, inscripciones y órdenes.
//
//   npx tsx scripts/backfill-registration-plans.ts [--dry-run]
//
// Es idempotente: completa únicamente vínculos/snapshots faltantes, reutiliza
// los planes ya asociados y usa createMany(..., skipDuplicates) para la nómina.
// Las órdenes históricas que abarcan más de un evento se reportan y permanecen
// deliberadamente sin eventId/registrationPlanId.

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const dryRun = process.argv.includes("--dry-run")

type RegistrationFact = {
  id: string
  clubId: string
  modality: { eventId: string }
  athletes: Array<{ athleteId: string }>
}

type OrderFact = {
  id: string
  code: string
  clubId: string
  userId: string
  status: "PENDING" | "PAID"
  registrationPlanId: string | null
  eventId: string | null
  createdAt: Date
  registrations: RegistrationFact[]
  derivedEventId: string
}

const reviewNotes: string[] = []

function uniqueRegistrations(
  items: Array<{ registration: RegistrationFact | null }>
): RegistrationFact[] {
  const byId = new Map<string, RegistrationFact>()
  for (const item of items) {
    if (item.registration) byId.set(item.registration.id, item.registration)
  }
  return [...byId.values()]
}

function dateContains(
  startDate: Date,
  endDate: Date,
  eventStart: Date,
  eventEnd: Date
): boolean {
  return (
    startDate.getTime() <= eventStart.getTime() &&
    endDate.getTime() >= eventEnd.getTime()
  )
}

async function backfillEventSeasons() {
  const [events, seasons] = await Promise.all([
    prisma.event.findMany({
      where: { seasonId: null },
      select: { id: true, name: true, startDate: true, endDate: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.season.findMany({ orderBy: [{ isCurrent: "desc" }, { year: "desc" }] }),
  ])

  const currentSeason = seasons.find((season) => season.isCurrent)
  let assigned = 0

  for (const event of events) {
    const matching = seasons.filter((season) =>
      dateContains(
        season.startDate,
        season.endDate,
        event.startDate,
        event.endDate
      )
    )
    const selected = matching.length === 1 ? matching[0] : currentSeason

    if (!selected) {
      reviewNotes.push(
        `Evento ${event.id} (${event.name}): sin temporada por fechas ni temporada vigente; queda seasonId=null.`
      )
      continue
    }

    if (matching.length !== 1) {
      reviewNotes.push(
        `Evento ${event.id} (${event.name}): ${matching.length} temporadas cubren todas sus fechas; se usó la vigente ${selected.year}.`
      )
    }

    if (!dryRun) {
      await prisma.event.updateMany({
        where: { id: event.id, seasonId: null },
        data: { seasonId: selected.id },
      })
    }
    assigned++
  }

  console.log(
    `Eventos sin temporada: ${events.length}; ${dryRun ? "asignaría" : "asignados"}: ${assigned}.`
  )
}

async function backfillCategoryUpgradeYears() {
  const modalities = await prisma.eventModality.findMany({
    select: {
      id: true,
      discipline: true,
      allowsCategoryUpgrade: true,
      categoryUpgradeBirthYear: true,
      birthYearTo: true,
      event: {
        select: {
          season: {
            select: {
              categories: {
                select: {
                  discipline: true,
                  birthYearFrom: true,
                  birthYearTo: true,
                },
              },
            },
          },
        },
      },
    },
  })

  let changed = 0
  for (const modality of modalities) {
    const isArtistic = modality.discipline === "ARTISTIC_SWIMMING"
    const expectedYear =
      modality.birthYearTo === null ? null : modality.birthYearTo + 1
    const hasImmediateLowerCategory =
      expectedYear !== null &&
      Boolean(
        modality.event.season?.categories.some(
          (category) =>
            category.discipline === "ARTISTIC_SWIMMING" &&
            category.birthYearFrom === expectedYear &&
            (category.birthYearTo === null || expectedYear <= category.birthYearTo)
        )
      )
    const allowsCategoryUpgrade =
      isArtistic &&
      modality.allowsCategoryUpgrade &&
      expectedYear !== null &&
      hasImmediateLowerCategory
    const categoryUpgradeBirthYear = allowsCategoryUpgrade ? expectedYear : null

    if (modality.allowsCategoryUpgrade && !isArtistic) {
      reviewNotes.push(
        `Modalidad ${modality.id}: ascenso desactivado porque no pertenece a natación artística.`
      )
    } else if (isArtistic && modality.allowsCategoryUpgrade && expectedYear === null) {
      reviewNotes.push(
        `Modalidad ${modality.id}: ascenso desactivado porque no tiene birthYearTo.`
      )
    } else if (
      isArtistic &&
      modality.allowsCategoryUpgrade &&
      !hasImmediateLowerCategory
    ) {
      reviewNotes.push(
        `Modalidad ${modality.id}: ascenso desactivado; la temporada no define la categoría inferior inmediata para ${expectedYear}.`
      )
    }

    if (
      modality.allowsCategoryUpgrade === allowsCategoryUpgrade &&
      modality.categoryUpgradeBirthYear === categoryUpgradeBirthYear
    ) {
      continue
    }

    if (!dryRun) {
      await prisma.eventModality.update({
        where: { id: modality.id },
        data: { allowsCategoryUpgrade, categoryUpgradeBirthYear },
      })
    }
    changed++
  }

  console.log(
    `Modalidades revisadas: ${modalities.length}; ${dryRun ? "cambiaría" : "actualizadas"}: ${changed}.`
  )
}

async function attachRegistrations(
  tx: Prisma.TransactionClient,
  planId: string,
  registrations: RegistrationFact[]
): Promise<{
  conflicts: string[]
  linkedRegistrations: number
  linkedAthletes: number
}> {
  const ids = [...new Set(registrations.map((registration) => registration.id))]
  if (ids.length === 0) {
    return { conflicts: [], linkedRegistrations: 0, linkedAthletes: 0 }
  }

  const current = await tx.registration.findMany({
    where: { id: { in: ids } },
    select: { id: true, planId: true },
  })
  const conflicting = current.filter(
    (registration) => registration.planId && registration.planId !== planId
  )
  const eligibleIds = new Set(
    current
      .filter(
        (registration) =>
          registration.planId === null || registration.planId === planId
      )
      .map((registration) => registration.id)
  )

  const registrationLinks = await tx.registration.updateMany({
    where: { id: { in: [...eligibleIds] }, planId: null },
    data: { planId },
  })

  const athleteIds = [
    ...new Set(
      registrations
        .filter((registration) => eligibleIds.has(registration.id))
        .flatMap((registration) =>
          registration.athletes.map((athlete) => athlete.athleteId)
        )
    ),
  ]

  const athleteLinks =
    athleteIds.length > 0
      ? await tx.registrationPlanAthlete.createMany({
          data: athleteIds.map((athleteId) => ({ planId, athleteId })),
          skipDuplicates: true,
        })
      : { count: 0 }

  return {
    conflicts: conflicting.map((registration) => registration.id),
    linkedRegistrations: registrationLinks.count,
    linkedAthletes: athleteLinks.count,
  }
}

async function loadOrderFacts(): Promise<OrderFact[]> {
  const orders = await prisma.order.findMany({
    where: {
      kind: "REGISTRATION",
      status: { in: ["PENDING", "PAID"] },
    },
    select: {
      id: true,
      code: true,
      clubId: true,
      userId: true,
      status: true,
      registrationPlanId: true,
      eventId: true,
      createdAt: true,
      items: {
        where: { registrationId: { not: null } },
        select: {
          registration: {
            select: {
              id: true,
              clubId: true,
              modality: { select: { eventId: true } },
              athletes: { select: { athleteId: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })

  const facts: OrderFact[] = []
  for (const order of orders) {
    const registrations = uniqueRegistrations(order.items)
    const eventIds = [
      ...new Set(
        registrations.map((registration) => registration.modality.eventId)
      ),
    ]

    if (eventIds.length === 0) {
      reviewNotes.push(
        `Orden ${order.code}: no conserva inscripciones enlazadas; queda sin plan/evento.`
      )
      continue
    }

    if (eventIds.length > 1) {
      if (!dryRun) {
        await prisma.order.updateMany({
          where: { id: order.id, isLegacy: false },
          data: { isLegacy: true },
        })
      }
      reviewNotes.push(
        `Orden ${order.code}: orden histórica mixta (${eventIds.length} eventos); queda sin plan/evento.`
      )
      continue
    }

    if (registrations.some((registration) => registration.clubId !== order.clubId)) {
      reviewNotes.push(
        `Orden ${order.code}: contiene inscripciones de otro club; queda sin plan/evento.`
      )
      continue
    }

    facts.push({
      ...order,
      status: order.status as "PENDING" | "PAID",
      registrations,
      derivedEventId: eventIds[0],
    })
  }

  return facts
}

async function backfillPaidOrderPlans(facts: OrderFact[]) {
  const paid = facts.filter((fact) => fact.status === "PAID")
  let created = 0
  let changed = 0

  for (const fact of paid) {
    if (dryRun) {
      if (!fact.registrationPlanId) created++
      if (!fact.registrationPlanId || !fact.eventId) changed++
      continue
    }

    const result = await prisma.$transaction(async (tx) => {
      const freshOrder = await tx.order.findUniqueOrThrow({
        where: { id: fact.id },
        select: { registrationPlanId: true, eventId: true },
      })

      if (freshOrder.eventId && freshOrder.eventId !== fact.derivedEventId) {
        return { created: false, conflicts: [], changed: false, incompatible: true }
      }

      let plan = freshOrder.registrationPlanId
        ? await tx.registrationPlan.findUnique({
            where: { id: freshOrder.registrationPlanId },
          })
        : null

      if (
        plan &&
        (plan.clubId !== fact.clubId ||
          (plan.eventId !== null && plan.eventId !== fact.derivedEventId))
      ) {
        return { created: false, conflicts: [], changed: false, incompatible: true }
      }

      let wasCreated = false
      let wasChanged = false
      if (!plan) {
        plan = await tx.registrationPlan.create({
          data: {
            clubId: fact.clubId,
            eventId: fact.derivedEventId,
            createdById: fact.userId,
            status: "PAID",
            currentStep: 4,
            createdAt: fact.createdAt,
          },
        })
        wasCreated = true
        wasChanged = true
      } else if (
        plan.status !== "PAID" ||
        plan.currentStep !== 4 ||
        plan.eventId === null
      ) {
        plan = await tx.registrationPlan.update({
          where: { id: plan.id },
          data: {
            status: "PAID",
            currentStep: 4,
            eventId: fact.derivedEventId,
          },
        })
        wasChanged = true
      }

      if (
        freshOrder.registrationPlanId !== plan.id ||
        freshOrder.eventId !== fact.derivedEventId
      ) {
        await tx.order.update({
          where: { id: fact.id },
          data: {
            registrationPlanId: plan.id,
            eventId: fact.derivedEventId,
          },
        })
        wasChanged = true
      }

      const attached = await attachRegistrations(
        tx,
        plan.id,
        fact.registrations
      )
      wasChanged ||=
        attached.linkedRegistrations > 0 || attached.linkedAthletes > 0
      return {
        created: wasCreated,
        conflicts: attached.conflicts,
        changed: wasChanged,
        incompatible: false,
      }
    })

    if (result.incompatible) {
      reviewNotes.push(
        `Orden ${fact.code}: su plan/eventId existente contradice el evento derivado; no se modificó.`
      )
      continue
    }
    if (result.conflicts.length > 0) {
      reviewNotes.push(
        `Orden ${fact.code}: ${result.conflicts.length} inscripciones ya pertenecían a otro plan y no se reasignaron.`
      )
    }
    if (result.created) created++
    if (result.changed) changed++
  }

  console.log(
    `Órdenes pagadas de un evento: ${paid.length}; planes ${dryRun ? "a crear" : "creados"}: ${created}; órdenes ${dryRun ? "a actualizar" : "actualizadas"}: ${changed}.`
  )
}

async function backfillPendingOrderPlans(facts: OrderFact[]) {
  const pending = facts.filter((item) => item.status === "PENDING")
  const groups = new Map<string, OrderFact[]>()
  for (const fact of pending) {
    const key = `${fact.clubId}:${fact.derivedEventId}`
    const group = groups.get(key) ?? []
    group.push(fact)
    groups.set(key, group)
  }

  let created = 0
  let changed = 0
  let skipped = 0

  if (dryRun) {
    const activePlans = await prisma.registrationPlan.findMany({
      where: {
        eventId: { not: null },
        status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
      },
      select: { clubId: true, eventId: true },
    })
    const claimedKeys = new Set(
      activePlans.map((plan) => `${plan.clubId}:${plan.eventId}`)
    )

    for (const fact of pending) {
      if (fact.registrationPlanId) {
        if (!fact.eventId) changed++
        continue
      }
      const key = `${fact.clubId}:${fact.derivedEventId}`
      if (claimedKeys.has(key)) {
        skipped++
        continue
      }
      claimedKeys.add(key)
      created++
      changed++
    }
  } else {
    for (const fact of pending) {
      const result = await prisma.$transaction(async (tx) => {
        const freshOrder = await tx.order.findUniqueOrThrow({
          where: { id: fact.id },
          select: {
            status: true,
            registrationPlanId: true,
            eventId: true,
          },
        })

        if (freshOrder.status !== "PENDING") {
          return { outcome: "stale" as const, conflicts: [] as string[] }
        }
        if (freshOrder.eventId && freshOrder.eventId !== fact.derivedEventId) {
          return { outcome: "incompatible" as const, conflicts: [] as string[] }
        }

        let plan = freshOrder.registrationPlanId
          ? await tx.registrationPlan.findUnique({
              where: { id: freshOrder.registrationPlanId },
            })
          : null

        if (freshOrder.registrationPlanId && !plan) {
          return { outcome: "incompatible" as const, conflicts: [] as string[] }
        }
        if (
          plan &&
          (plan.clubId !== fact.clubId ||
            (plan.eventId !== null && plan.eventId !== fact.derivedEventId) ||
            !["DRAFT", "AWAITING_PAYMENT"].includes(plan.status))
        ) {
          return { outcome: "incompatible" as const, conflicts: [] as string[] }
        }

        if (plan) {
          const siblingOrders = await tx.order.count({
            where: {
              id: { not: fact.id },
              registrationPlanId: plan.id,
              kind: "REGISTRATION",
              status: "PENDING",
            },
          })
          if (siblingOrders > 0) {
            return { outcome: "shared" as const, conflicts: [] as string[] }
          }
        } else {
          const occupied = await tx.registrationPlan.findFirst({
            where: {
              clubId: fact.clubId,
              eventId: fact.derivedEventId,
              status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
            },
            select: { id: true },
          })
          if (occupied) {
            return { outcome: "occupied" as const, conflicts: [] as string[] }
          }

          plan = await tx.registrationPlan.create({
            data: {
              clubId: fact.clubId,
              eventId: fact.derivedEventId,
              createdById: fact.userId,
              status: "AWAITING_PAYMENT",
              currentStep: 4,
              createdAt: fact.createdAt,
            },
          })
        }

        const wasCreated = freshOrder.registrationPlanId === null
        let wasChanged = wasCreated
        if (
          plan.status !== "AWAITING_PAYMENT" ||
          plan.currentStep !== 4 ||
          plan.eventId === null
        ) {
          plan = await tx.registrationPlan.update({
            where: { id: plan.id },
            data: {
              status: "AWAITING_PAYMENT",
              currentStep: 4,
              eventId: fact.derivedEventId,
            },
          })
          wasChanged = true
        }

        if (
          freshOrder.registrationPlanId !== plan.id ||
          freshOrder.eventId !== fact.derivedEventId
        ) {
          await tx.order.update({
            where: { id: fact.id },
            data: {
              registrationPlanId: plan.id,
              eventId: fact.derivedEventId,
            },
          })
          wasChanged = true
        }

        const attached = await attachRegistrations(tx, plan.id, fact.registrations)
        wasChanged ||=
          attached.linkedRegistrations > 0 || attached.linkedAthletes > 0
        return {
          outcome: wasChanged ? (wasCreated ? "created" : "changed") : "unchanged",
          conflicts: attached.conflicts,
        } as const
      })

      if (result.outcome === "incompatible") {
        reviewNotes.push(
          `Orden pendiente ${fact.code}: su plan/eventId existente es incompatible; no se modificó.`
        )
        skipped++
        continue
      }
      if (result.outcome === "shared") {
        reviewNotes.push(
          `Orden pendiente ${fact.code}: ya comparte plan con otra orden pendiente; requiere revisión manual y no se modificó.`
        )
        skipped++
        continue
      }
      if (result.outcome === "occupied") {
        reviewNotes.push(
          `Orden pendiente ${fact.code}: ya existe otra planilla activa para el club/evento; queda como legado sin vincular.`
        )
        skipped++
        continue
      }
      if (result.outcome === "stale") continue
      if (result.conflicts.length > 0) {
        reviewNotes.push(
          `Orden pendiente ${fact.code}: ${result.conflicts.length} inscripciones ya pertenecían a otro plan.`
        )
      }
      if (result.outcome === "created") created++
      if (result.outcome === "created" || result.outcome === "changed") changed++
    }
  }

  console.log(
    `Grupos con pago pendiente: ${groups.size}; planes ${dryRun ? "a crear" : "creados"}: ${created}; órdenes ${dryRun ? "a actualizar" : "actualizadas"}: ${changed}; omitidas: ${skipped}.`
  )
}

async function backfillCartPlans() {
  const registrations = await prisma.registration.findMany({
    where: { status: "IN_CART", planId: null },
    select: {
      id: true,
      clubId: true,
      modality: { select: { eventId: true } },
      athletes: { select: { athleteId: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })

  const groups = new Map<string, RegistrationFact[]>()
  for (const registration of registrations) {
    const key = `${registration.clubId}:${registration.modality.eventId}`
    const group = groups.get(key) ?? []
    group.push(registration)
    groups.set(key, group)
  }

  const clubIds = [...new Set(registrations.map((item) => item.clubId))]
  const [users, fallbackAdmin] = await Promise.all([
    prisma.user.findMany({
      where: { clubId: { in: clubIds } },
      select: {
        id: true,
        clubId: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.user.findFirst({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ])

  const creatorByClub = new Map<string, string>()
  for (const clubId of clubIds) {
    const candidates = users.filter((user) => user.clubId === clubId)
    const selected =
      candidates.find((user) => user.role === "CLUB" && user.isActive) ??
      candidates.find((user) => user.isActive) ??
      candidates[0]
    if (selected) creatorByClub.set(clubId, selected.id)
  }

  let created = 0
  let attached = 0

  for (const group of groups.values()) {
    const [first] = group
    const eventId = first.modality.eventId
    const creatorId = creatorByClub.get(first.clubId) ?? fallbackAdmin?.id

    if (!creatorId) {
      reviewNotes.push(
        `Club ${first.clubId}, evento ${eventId}: no existe usuario para atribuir el borrador; ${group.length} inscripciones quedan sin plan.`
      )
      continue
    }
    if (!creatorByClub.has(first.clubId)) {
      reviewNotes.push(
        `Club ${first.clubId}, evento ${eventId}: no tiene usuario propio; el borrador migrado se atribuyó al administrador ${creatorId}.`
      )
    }

    if (dryRun) {
      const activePlan = await prisma.registrationPlan.findFirst({
        where: {
          clubId: first.clubId,
          eventId,
          status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
        },
        select: { status: true },
      })
      if (activePlan?.status === "AWAITING_PAYMENT") {
        reviewNotes.push(
          `Club ${first.clubId}, evento ${eventId}: existe una planilla AWAITING_PAYMENT; ${group.length} inscripciones IN_CART permanecerían sin plan.`
        )
        continue
      }
      if (!activePlan) created++
      attached += group.length
      continue
    }

    const result = await prisma.$transaction(async (tx) => {
      let plan = await tx.registrationPlan.findFirst({
        where: {
          clubId: first.clubId,
          eventId,
          status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
        },
        orderBy: { createdAt: "asc" },
      })
      if (plan?.status === "AWAITING_PAYMENT") {
        return {
          created: false,
          blockedByCheckout: true,
          conflicts: [] as string[],
          linked: 0,
        }
      }

      let wasCreated = false

      if (!plan) {
        plan = await tx.registrationPlan.create({
          data: {
            clubId: first.clubId,
            eventId,
            createdById: creatorId,
            status: "DRAFT",
            currentStep: 3,
          },
        })
        wasCreated = true
      } else if (plan.status === "DRAFT" && plan.currentStep < 3) {
        plan = await tx.registrationPlan.update({
          where: { id: plan.id },
          data: { currentStep: 3 },
        })
      }

      const attached = await attachRegistrations(tx, plan.id, group)
      return {
        created: wasCreated,
        blockedByCheckout: false,
        conflicts: attached.conflicts,
        linked: attached.linkedRegistrations,
      }
    })

    if (result.blockedByCheckout) {
      reviewNotes.push(
        `Club ${first.clubId}, evento ${eventId}: existe una planilla AWAITING_PAYMENT; ${group.length} inscripciones IN_CART permanecen sin plan y no se anexaron.`
      )
      continue
    }
    if (result.conflicts.length > 0) {
      reviewNotes.push(
        `Club ${first.clubId}, evento ${eventId}: ${result.conflicts.length} inscripciones ya pertenecían a otro plan.`
      )
    }
    if (result.created) created++
    attached += result.linked
  }

  console.log(
    `Grupos IN_CART: ${groups.size}; planes ${dryRun ? "a crear/reutilizar" : "creados"}: ${created}; inscripciones ${dryRun ? "a enlazar" : "enlazadas"}: ${attached}.`
  )
}

async function validateCategoryUpgradeConstraint() {
  if (dryRun) return
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "event_modalities" VALIDATE CONSTRAINT "event_modalities_category_upgrade_artistic_check"'
  )
  console.log("CHECK de ascenso de categoría validado.")
}

async function main() {
  console.log(
    dryRun
      ? "Simulación del backfill de planillas (sin escrituras)."
      : "Backfill de planillas iniciado."
  )

  await backfillEventSeasons()
  await backfillCategoryUpgradeYears()

  const orderFacts = await loadOrderFacts()
  await backfillPaidOrderPlans(orderFacts)
  await backfillPendingOrderPlans(orderFacts)
  await backfillCartPlans()
  await validateCategoryUpgradeConstraint()

  if (reviewNotes.length > 0) {
    console.log("\nRevisión manual recomendada:")
    for (const note of reviewNotes) console.log(`  - ${note}`)
  }

  // registrationSnapshot queda null en órdenes históricas: reconstruirlo con
  // datos actuales fingiría un snapshot que nunca se capturó. description y
  // unitPrice siguen siendo la fuente histórica compatible para esas órdenes.
  console.log(
    dryRun
      ? "Simulación terminada."
      : "Backfill completado; las órdenes mixtas/históricas no fueron recalculadas."
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
