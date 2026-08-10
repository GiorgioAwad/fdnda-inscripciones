import { prisma } from "./prisma"
import type { Discipline } from "@prisma/client"
import {
  expireStaleOrders,
  type ActionResult,
} from "./orders"
import { disciplineLabel } from "./disciplines"
import {
  checkoutRegistrationPlan,
  deleteRegistrationPlanEntry,
} from "./registration-plans"

export type { ActionResult } from "./orders"

// ==================== CARRITO ====================
//
// Las inscripciones NO se agregan de a una: el club arma la planilla completa de
// un evento (deportistas → pruebas) y la guarda de golpe con saveEventEntries
// (lib/event-entries), que reemplaza lo que tenía en el carrito de ese evento.
// Acá viven el carrito ya armado y el checkout.

export async function removeRegistrationFromCart(input: {
  clubId: string
  registrationId: string
}): Promise<ActionResult> {
  const registration = await prisma.registration.findFirst({
    where: { id: input.registrationId, clubId: input.clubId },
    select: { planId: true, plan: { select: { revision: true } } },
  })

  if (registration?.planId && registration.plan) {
    return deleteRegistrationPlanEntry({
      planId: registration.planId,
      clubId: input.clubId,
      expectedRevision: registration.plan.revision,
      registrationId: input.registrationId,
    })
  }

  const deleted = await prisma.registration.deleteMany({
    where: {
      id: input.registrationId,
      clubId: input.clubId,
      status: "IN_CART",
    },
  })

  if (deleted.count === 0) {
    return { success: false, error: "La inscripción ya no está en el carrito." }
  }
  return { success: true }
}

export async function getCart(clubId: string, disciplineAccess?: Discipline[]) {
  await expireStaleOrders()

  return prisma.registration.findMany({
    where: {
      clubId,
      status: "IN_CART",
      ...(disciplineAccess
        ? { modality: { discipline: { in: disciplineAccess } } }
        : {}),
    },
    include: {
      modality: { include: { event: true } },
      athletes: { include: { athlete: true } },
    },
    orderBy: { createdAt: "asc" },
  })
}

// ==================== CHECKOUT ====================

export async function checkoutCart(input: {
  clubId: string
  userId: string
  disciplineAccess?: Discipline[]
}): Promise<ActionResult & { orderId?: string }> {
  await expireStaleOrders()

  const [plans, legacyEntries] = await Promise.all([
    prisma.registrationPlan.findMany({
      where: {
        clubId: input.clubId,
        status: "DRAFT",
        registrations: { some: { status: "IN_CART" } },
        ...(input.disciplineAccess
          ? { event: { disciplines: { hasSome: input.disciplineAccess } } }
          : {}),
      },
      select: { id: true, revision: true },
      take: 2,
    }),
    prisma.registration.count({
      where: {
        clubId: input.clubId,
        status: "IN_CART",
        planId: null,
        ...(input.disciplineAccess
          ? { modality: { discipline: { in: input.disciplineAccess } } }
          : {}),
      },
    }),
  ])

  if (legacyEntries > 0) {
    return {
      success: false,
      error:
        "Hay inscripciones antiguas sin planilla. Ábrelas desde Inscripciones para migrarlas antes de pagar.",
    }
  }
  if (plans.length === 0) return { success: false, error: "No hay una planilla por pagar." }
  if (plans.length > 1) {
    return {
      success: false,
      error: "Selecciona una sola competencia y paga su planilla por separado.",
    }
  }

  return checkoutRegistrationPlan({
    planId: plans[0].id,
    clubId: input.clubId,
    userId: input.userId,
    expectedRevision: plans[0].revision,
  })
}

export function buildRegistrationDescription(registration: {
  modality: {
    name: string
    category: string | null
    discipline: string
    event: { name: string }
  }
  athletes: Array<{
    isReserve: boolean
    athlete: { firstNames: string; lastNames: string }
  }>
}): string {
  const m = registration.modality
  const label = [disciplineLabel(m.discipline), m.name, m.category]
    .filter(Boolean)
    .join(" — ")
  const names = registration.athletes
    .map(
      (ra) =>
        `${ra.athlete.firstNames} ${ra.athlete.lastNames}${ra.isReserve ? " (reserva)" : ""}`
    )
    .join(", ")
  return `${m.event.name} | ${label} | ${names}`
}
