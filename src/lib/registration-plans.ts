import { randomUUID } from "node:crypto"
import { Prisma, type Discipline } from "@prisma/client"
import { prisma } from "./prisma"
import {
  loadRegistrationPlanForValidation,
  validateRegistrationPlanInTransaction,
  type PlanTransactionClient,
  type PlanValidationResult,
  type PlanValidationWithPricing,
  type RegistrationPlanForValidation,
} from "./plan-validation"
import {
  expireStaleOrders,
  ORDER_EXPIRATION_MINUTES,
} from "./orders"
import { clubMayEnterEventInTransaction } from "./club-events"
import { disciplineLabel } from "./disciplines"
import { shortCode } from "./utils"

const MAX_ROSTER_ATHLETES = 2_000
const MAX_PLAN_ENTRIES = 400
const TRANSACTION_ATTEMPTS = 8
const TRANSACTION_BASE_DELAY_MS = 20
const TRANSACTION_MAX_DELAY_MS = 400

export type RegistrationPlanActionCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "REVISION_CONFLICT"
  | "PLAN_NOT_EDITABLE"
  | "INVALID_ATHLETES"
  | "INVALID_EVENT"
  | "INVALID_MODALITY"
  | "DUPLICATE_ENTRY"
  | "ACTIVE_PLAN_EXISTS"
  | "VALIDATION_FAILED"
  | "CONCURRENT_CHANGE"
  | "UNEXPECTED_ERROR"

export interface RegistrationPlanActionError {
  [key: string]: unknown
  success: false
  error: string
  code: RegistrationPlanActionCode
  currentRevision?: number
  existingPlanId?: string
  validation?: PlanValidationResult
}

export type RegistrationPlanActionResult<T extends object> =
  | ({ success: true } & T)
  | RegistrationPlanActionError

export interface RegistrationPlanRef {
  planId: string
  status: "DRAFT" | "AWAITING_PAYMENT" | "PAID" | "ABANDONED"
  revision: number
  currentStep: number
  eventId: string | null
}

export interface RegistrationPlanEntryInput {
  registrationId?: string
  modalityId: string
  athleteIds: string[]
  reserveIds?: string[]
}

function planRef(plan: {
  id: string
  status: "DRAFT" | "AWAITING_PAYMENT" | "PAID" | "ABANDONED"
  revision: number
  currentStep: number
  eventId: string | null
}): RegistrationPlanRef {
  return {
    planId: plan.id,
    status: plan.status,
    revision: plan.revision,
    currentStep: plan.currentStep,
    eventId: plan.eventId,
  }
}

function normalizeIds(ids: readonly string[], limit: number): string[] | null {
  const normalized = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  return normalized.length <= limit ? normalized : null
}

function clampStep(step: number): number {
  return Math.max(1, Math.min(4, Math.trunc(step)))
}

function errorCodeFrom(
  error: unknown,
  seen: Set<object> = new Set(),
  depth = 0
): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code
  if (typeof error !== "object" || error === null) return undefined
  if (depth > 6 || seen.has(error)) return undefined
  seen.add(error)

  const record = error as Record<string, unknown>
  for (const key of ["code", "originalCode"] as const) {
    if (typeof record[key] === "string") return record[key]
  }
  // Prisma 7 + adapter-pg puede exponer 40001 como
  // meta.driverAdapterError.cause.originalCode o directamente en cause. Se
  // recorren solo envoltorios conocidos, con limite y deteccion de ciclos.
  for (const key of ["meta", "driverAdapterError", "cause"] as const) {
    const nestedCode = errorCodeFrom(record[key], seen, depth + 1)
    if (nestedCode) return nestedCode
  }
  return undefined
}

function knownErrorCode(error: unknown): string | undefined {
  return errorCodeFrom(error)
}

export function isRetryableRegistrationPlanTransactionError(
  error: unknown
): boolean {
  const code = errorCodeFrom(error)
  return code === "P2034" || code === "40001" || code === "40P01"
}

function retryDelayMs(attempt: number): number {
  const ceiling = Math.min(
    TRANSACTION_MAX_DELAY_MS,
    TRANSACTION_BASE_DELAY_MS * 2 ** (attempt - 1)
  )
  return ceiling + Math.floor(Math.random() * ceiling)
}

async function transactionWithRetry<T>(
  work: (tx: PlanTransactionClient) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel,
        maxWait: 5_000,
        timeout: 20_000,
      })
    } catch (error) {
      lastError = error
      if (
        !isRetryableRegistrationPlanTransactionError(error) ||
        attempt === TRANSACTION_ATTEMPTS
      ) {
        throw error
      }
      // El jitter evita que decenas de operaciones abortadas vuelvan a abrir su
      // transaccion al mismo tiempo y formen otra ola de conflictos/deadlocks.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
    }
  }
  throw lastError
}

/**
 * Las mutaciones pequenas ya serializan por plan/slot con advisory locks,
 * comprueban expectedRevision bajo ese lock y descansan en indices unicos. READ
 * COMMITTED evita conflictos SSI entre inserciones de planillas independientes.
 */
async function planMutationTransaction<T>(
  work: (tx: PlanTransactionClient) => Promise<T>
): Promise<T> {
  return transactionWithRetry(
    work,
    Prisma.TransactionIsolationLevel.ReadCommitted
  )
}

/**
 * Checkout usa READ COMMITTED porque la garantia de capacidad proviene de
 * bloquear con FOR UPDATE todas las modalidades en orden estable y, despues,
 * contar ocupacion y reservar dentro de esta misma transaccion. Cada sentencia
 * posterior al lock ve la reserva ya confirmada por el checkout anterior. El
 * advisory lock de plan mantiene idempotencia y expectedRevision.
 */
async function checkoutReservationTransaction<T>(
  work: (tx: PlanTransactionClient) => Promise<T>
): Promise<T> {
  return transactionWithRetry(
    work,
    Prisma.TransactionIsolationLevel.ReadCommitted
  )
}

async function advisoryLock(tx: PlanTransactionClient, key: string): Promise<void> {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked
  `
}

async function lockPlan(tx: PlanTransactionClient, planId: string): Promise<void> {
  await advisoryLock(tx, `registration-plan:${planId}`)
}

async function lockClubPlanSlot(
  tx: PlanTransactionClient,
  clubId: string,
  eventId: string | null,
  disciplineScope: Discipline | null
): Promise<void> {
  const scope = disciplineScope ?? "coordinator"
  await advisoryLock(
    tx,
    eventId
      ? `registration-plan-slot:${clubId}:${eventId}:${scope}`
      : `registration-plan-slot:${clubId}:without-event:${scope}`
  )
}

async function lockModalities(
  tx: PlanTransactionClient,
  modalityIds: readonly string[]
): Promise<void> {
  const sorted = [...new Set(modalityIds)].sort()
  if (sorted.length === 0) return

  // Every checkout locks the same modality rows in the same order. Capacity is
  // counted only after this lock, so two clubs cannot both take the last slot.
  await tx.$queryRaw(
    Prisma.sql`
      SELECT id
      FROM "event_modalities"
      WHERE id IN (${Prisma.join(sorted)})
      ORDER BY id
      FOR UPDATE
    `
  )
}

async function userMayActForClub(
  tx: PlanTransactionClient,
  userId: string,
  clubId: string,
  disciplineScope?: Discipline | null
): Promise<boolean> {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      isActive: true,
      OR: [{ clubId }, { role: "ADMIN" }],
    },
    select: { role: true, disciplineAccess: true },
  })
  if (!user) return false
  if (user.role === "ADMIN" || !user.disciplineAccess?.length) return true
  return Boolean(
    disciplineScope && user.disciplineAccess.includes(disciplineScope)
  )
}

async function editablePlan(
  tx: PlanTransactionClient,
  input: { planId: string; clubId: string; expectedRevision: number }
): Promise<
  | {
      ok: true
      plan: {
        id: string
        clubId: string
        eventId: string | null
        disciplineScope: Discipline | null
        status: "DRAFT"
        revision: number
        currentStep: number
      }
    }
  | { ok: false; result: RegistrationPlanActionError }
> {
  const plan = await tx.registrationPlan.findFirst({
    where: { id: input.planId, clubId: input.clubId },
    select: {
      id: true,
      clubId: true,
      eventId: true,
      disciplineScope: true,
      status: true,
      revision: true,
      currentStep: true,
    },
  })

  if (!plan) {
    return {
      ok: false,
      result: {
        success: false,
        code: "NOT_FOUND",
        error: "La planilla no existe o no pertenece a tu club.",
      },
    }
  }
  if (plan.status !== "DRAFT") {
    return {
      ok: false,
      result: {
        success: false,
        code: "PLAN_NOT_EDITABLE",
        currentRevision: plan.revision,
        error: "La planilla ya está asociada a una orden o fue pagada.",
      },
    }
  }
  if (plan.revision !== input.expectedRevision) {
    return {
      ok: false,
      result: {
        success: false,
        code: "REVISION_CONFLICT",
        currentRevision: plan.revision,
        error: "La planilla cambió en otra pestaña. Recarga antes de continuar.",
      },
    }
  }

  return { ok: true, plan: { ...plan, status: "DRAFT" } }
}

async function validateOwnedAthletes(
  tx: PlanTransactionClient,
  clubId: string,
  athleteIds: readonly string[]
): Promise<boolean> {
  if (athleteIds.length === 0) return true
  const count = await tx.athlete.count({
    where: { id: { in: [...athleteIds] }, clubId, isActive: true },
  })
  return count === athleteIds.length
}

export async function createOrResumeRegistrationPlan(input: {
  clubId: string
  createdById: string
  athleteIds?: string[]
  currentStep?: number
  scopeByCreator?: boolean
  disciplineScope?: Discipline
}): Promise<
  RegistrationPlanActionResult<RegistrationPlanRef & { resumed: boolean }>
> {
  const athleteIds = normalizeIds(input.athleteIds ?? [], MAX_ROSTER_ATHLETES)
  if (!athleteIds) {
    return {
      success: false,
      code: "INVALID_ATHLETES",
      error: `Una planilla admite como máximo ${MAX_ROSTER_ATHLETES} deportistas.`,
    }
  }

  try {
    return await planMutationTransaction(async (tx) => {
      await lockClubPlanSlot(
        tx,
        input.clubId,
        null,
        input.disciplineScope ?? null
      )

      if (
        !(await userMayActForClub(
          tx,
          input.createdById,
          input.clubId,
          input.disciplineScope ?? null
        ))
      ) {
        return {
          success: false,
          code: "FORBIDDEN",
          error: "No tienes permiso para crear planillas de este club.",
        }
      }

      const existing = await tx.registrationPlan.findFirst({
        where: {
          clubId: input.clubId,
          eventId: null,
          status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
          ...(input.scopeByCreator ? { createdById: input.createdById } : {}),
          disciplineScope: input.disciplineScope ?? null,
        },
        orderBy: { updatedAt: "desc" },
      })
      if (existing) {
        return { success: true, ...planRef(existing), resumed: true }
      }

      if (!(await validateOwnedAthletes(tx, input.clubId, athleteIds))) {
        return {
          success: false,
          code: "INVALID_ATHLETES",
          error: "Uno o más deportistas no pertenecen a tu club o están inactivos.",
        }
      }

      const created = await tx.registrationPlan.create({
        data: {
          clubId: input.clubId,
          createdById: input.createdById,
          status: "DRAFT",
          currentStep: clampStep(input.currentStep ?? 1),
          disciplineScope: input.disciplineScope,
        },
      })
      if (athleteIds.length > 0) {
        await tx.registrationPlanAthlete.createMany({
          data: athleteIds.map((athleteId) => ({
            planId: created.id,
            athleteId,
          })),
        })
      }

      return { success: true, ...planRef(created), resumed: false }
    })
  } catch (error) {
    console.error("createOrResumeRegistrationPlan error:", error)
    return {
      success: false,
      code: "UNEXPECTED_ERROR",
      error: "No se pudo crear la planilla. Vuelve a intentarlo.",
    }
  }
}

export async function replaceRegistrationPlanRoster(input: {
  planId: string
  clubId: string
  expectedRevision: number
  athleteIds: string[]
  currentStep?: number
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  const athleteIds = normalizeIds(input.athleteIds, MAX_ROSTER_ATHLETES)
  if (!athleteIds) {
    return {
      success: false,
      code: "INVALID_ATHLETES",
      error: `Una planilla admite como máximo ${MAX_ROSTER_ATHLETES} deportistas.`,
    }
  }

  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan

      if (!(await validateOwnedAthletes(tx, input.clubId, athleteIds))) {
        return {
          success: false,
          code: "INVALID_ATHLETES",
          error: "Uno o más deportistas no pertenecen a tu club o están inactivos.",
        }
      }

      const current = await tx.registrationPlanAthlete.findMany({
        where: { planId: plan.id },
        select: { athleteId: true },
      })
      const requested = new Set(athleteIds)
      const currentIds = new Set(current.map((row) => row.athleteId))
      const removed = [...currentIds].filter((id) => !requested.has(id))
      const added = athleteIds.filter((id) => !currentIds.has(id))

      if (removed.length > 0) {
        await tx.registrationAthlete.deleteMany({
          where: {
            athleteId: { in: removed },
            registration: { planId: plan.id, status: "IN_CART" },
          },
        })
        await tx.registrationPlanAthlete.deleteMany({
          where: { planId: plan.id, athleteId: { in: removed } },
        })
      }
      if (added.length > 0) {
        await tx.registrationPlanAthlete.createMany({
          data: added.map((athleteId) => ({ planId: plan.id, athleteId })),
          skipDuplicates: true,
        })
      }

      const nextStep = input.currentStep
        ? clampStep(input.currentStep)
        : Math.max(1, plan.currentStep)
      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: { revision: { increment: 1 }, currentStep: nextStep },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("replaceRegistrationPlanRoster error:", error)
    return {
      success: false,
      code: isRetryableRegistrationPlanTransactionError(error)
        ? "CONCURRENT_CHANGE"
        : "UNEXPECTED_ERROR",
      error: "No se pudo guardar la nómina. Vuelve a intentarlo.",
    }
  }
}

/**
 * Persiste una sola selección de la nómina. Es la mutación usada por la UI
 * paginada para no reenviar hasta 2.000 IDs en cada checkbox.
 */
export async function setRegistrationPlanAthleteSelection(input: {
  planId: string
  clubId: string
  expectedRevision: number
  athleteId: string
  selected: boolean
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan

      const current = await tx.registrationPlanAthlete.findUnique({
        where: {
          planId_athleteId: {
            planId: plan.id,
            athleteId: input.athleteId,
          },
        },
        select: { id: true },
      })

      if (input.selected) {
        if (current) return { success: true, ...planRef(plan) }
        if (!(await validateOwnedAthletes(tx, input.clubId, [input.athleteId]))) {
          return {
            success: false,
            code: "INVALID_ATHLETES",
            error: "El deportista no pertenece a tu club o está inactivo.",
          }
        }
        const rosterCount = await tx.registrationPlanAthlete.count({
          where: { planId: plan.id },
        })
        if (rosterCount >= MAX_ROSTER_ATHLETES) {
          return {
            success: false,
            code: "INVALID_ATHLETES",
            error: `Una planilla admite como máximo ${MAX_ROSTER_ATHLETES} deportistas.`,
          }
        }
        await tx.registrationPlanAthlete.create({
          data: { planId: plan.id, athleteId: input.athleteId },
        })
      } else {
        if (!current) return { success: true, ...planRef(plan) }
        // Quitar a alguien de la nómina también lo retira de formaciones aún
        // editables. Las de equipo se conservan incompletas como borrador.
        const affected = await tx.registrationAthlete.findMany({
          where: {
            athleteId: input.athleteId,
            registration: { planId: plan.id, status: "IN_CART" },
          },
          select: { registrationId: true },
        })
        await tx.registrationAthlete.deleteMany({
          where: {
            athleteId: input.athleteId,
            registration: { planId: plan.id, status: "IN_CART" },
          },
        })
        // Las que quedaron vacías POR ESTA remoción se borran: eran pruebas
        // individuales de ese deportista y sin él no significan nada. Las
        // formaciones creadas deliberadamente vacías no se tocan, porque nunca
        // tuvieron a este deportista.
        if (affected.length > 0) {
          await tx.registration.deleteMany({
            where: {
              id: { in: affected.map((row) => row.registrationId) },
              planId: plan.id,
              status: "IN_CART",
              athletes: { none: {} },
            },
          })
        }
        await tx.registrationPlanAthlete.delete({ where: { id: current.id } })
      }

      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: { revision: { increment: 1 } },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("setRegistrationPlanAthleteSelection error:", error)
    return {
      success: false,
      code: isRetryableRegistrationPlanTransactionError(error)
        ? "CONCURRENT_CHANGE"
        : "UNEXPECTED_ERROR",
      error: "No se pudo guardar la selección. Vuelve a intentarlo.",
    }
  }
}

export async function selectRegistrationPlanEvent(input: {
  planId: string
  clubId: string
  eventId: string
  expectedRevision: number
}): Promise<
  RegistrationPlanActionResult<RegistrationPlanRef & { merged: boolean }>
> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const source = editable.plan

      if (source.eventId === input.eventId) {
        return { success: true, ...planRef(source), merged: false }
      }

      const sourceEntryCount = await tx.registration.count({
        where: { planId: source.id },
      })
      if (source.eventId !== null && sourceEntryCount > 0) {
        return {
          success: false,
          code: "INVALID_EVENT",
          currentRevision: source.revision,
          error:
            "Quita las pruebas guardadas antes de cambiar la competencia de esta planilla.",
        }
      }

      const event = await tx.event.findFirst({
        where: {
          id: input.eventId,
          status: "OPEN",
          registrationDeadline: { gte: new Date() },
        },
        select: { id: true, seasonId: true, disciplines: true },
      })
      if (!event) {
        return {
          success: false,
          code: "INVALID_EVENT",
          error: "La competencia no está disponible o su inscripción ya cerró.",
        }
      }
      if (!event.seasonId) {
        return {
          success: false,
          code: "INVALID_EVENT",
          error: "La competencia todavía no tiene una temporada configurada.",
        }
      }
      // El listado ya viene filtrado, pero la competencia también puede llegar
      // por ?evento=slug o por un enlace viejo: el club solo puede plantarse en
      // eventos de las disciplinas en las que se afilió.
      const eligibleDisciplines = source.disciplineScope
        ? event.disciplines.includes(source.disciplineScope)
          ? [source.disciplineScope]
          : []
        : event.disciplines
      if (
        eligibleDisciplines.length === 0 ||
        !(await clubMayEnterEventInTransaction(
          tx,
          input.clubId,
          eligibleDisciplines
        ))
      ) {
        return {
          success: false,
          code: "INVALID_EVENT",
          error:
            "Tu club no está afiliado a ninguna disciplina de esta competencia. Regulariza la afiliación para inscribirte.",
        }
      }

      await lockClubPlanSlot(
        tx,
        input.clubId,
        input.eventId,
        source.disciplineScope
      )
      const target = await tx.registrationPlan.findFirst({
        where: {
          id: { not: source.id },
          clubId: input.clubId,
          eventId: input.eventId,
          disciplineScope: source.disciplineScope,
          status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
        },
        orderBy: { updatedAt: "desc" },
      })

      if (target) {
        await lockPlan(tx, target.id)
        const freshTarget = await tx.registrationPlan.findUnique({
          where: { id: target.id },
        })
        if (!freshTarget || freshTarget.status !== "DRAFT") {
          return {
            success: false,
            code: "ACTIVE_PLAN_EXISTS",
            existingPlanId: target.id,
            error:
              "Ya existe una planilla de esta competencia con una orden en curso.",
          }
        }

        const sourceRoster = await tx.registrationPlanAthlete.findMany({
          where: { planId: source.id },
          select: { athleteId: true },
        })
        if (sourceRoster.length > 0) {
          await tx.registrationPlanAthlete.createMany({
            data: sourceRoster.map((row) => ({
              planId: freshTarget.id,
              athleteId: row.athleteId,
            })),
            skipDuplicates: true,
          })
        }
        const updatedTarget = await tx.registrationPlan.update({
          where: { id: freshTarget.id },
          data: {
            revision: { increment: 1 },
            currentStep: Math.max(2, freshTarget.currentStep),
          },
        })
        await tx.registrationPlan.update({
          where: { id: source.id },
          data: { status: "ABANDONED", revision: { increment: 1 } },
        })
        return { success: true, ...planRef(updatedTarget), merged: true }
      }

      const updated = await tx.registrationPlan.update({
        where: { id: source.id },
        data: {
          eventId: event.id,
          revision: { increment: 1 },
          currentStep: Math.max(2, source.currentStep),
        },
      })
      return { success: true, ...planRef(updated), merged: false }
    })
  } catch (error) {
    console.error("selectRegistrationPlanEvent error:", error)
    return {
      success: false,
      code:
        knownErrorCode(error) === "P2002"
          ? "ACTIVE_PLAN_EXISTS"
          : isRetryableRegistrationPlanTransactionError(error)
            ? "CONCURRENT_CHANGE"
            : "UNEXPECTED_ERROR",
      error:
        knownErrorCode(error) === "P2002"
          ? "Ya existe una planilla activa para esa competencia. Recarga la página."
          : "No se pudo seleccionar la competencia. Vuelve a intentarlo.",
    }
  }
}

export async function saveRegistrationPlanEntry(input: {
  planId: string
  clubId: string
  expectedRevision: number
  entry: RegistrationPlanEntryInput
}): Promise<
  RegistrationPlanActionResult<RegistrationPlanRef & { registrationId: string }>
> {
  const athleteIds = normalizeIds(input.entry.athleteIds, 100)
  if (!athleteIds) {
    return {
      success: false,
      code: "INVALID_ATHLETES",
      error: "La formación contiene demasiados deportistas.",
    }
  }
  const chosen = new Set(athleteIds)
  const reserveIds = normalizeIds(input.entry.reserveIds ?? [], 100)?.filter((id) =>
    chosen.has(id)
  )
  if (!reserveIds) {
    return {
      success: false,
      code: "INVALID_ATHLETES",
      error: "La lista de reservas no es válida.",
    }
  }

  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan
      if (!plan.eventId) {
        return {
          success: false,
          code: "INVALID_EVENT",
          error: "Selecciona una competencia antes de guardar pruebas.",
        }
      }

      const modality = await tx.eventModality.findFirst({
        where: {
          id: input.entry.modalityId,
          eventId: plan.eventId,
          isActive: true,
        },
        select: { id: true },
      })
      if (!modality) {
        return {
          success: false,
          code: "INVALID_MODALITY",
          error: "La prueba ya no está disponible para esta competencia.",
        }
      }

      if (athleteIds.length > 0) {
        const rosterCount = await tx.registrationPlanAthlete.count({
          where: { planId: plan.id, athleteId: { in: athleteIds } },
        })
        if (
          rosterCount !== athleteIds.length ||
          !(await validateOwnedAthletes(tx, plan.clubId, athleteIds))
        ) {
          return {
            success: false,
            code: "INVALID_ATHLETES",
            error:
              "Uno o más deportistas no están disponibles en la nómina de esta planilla.",
          }
        }
      }

      let registrationId = input.entry.registrationId
      if (registrationId) {
        const existing = await tx.registration.findFirst({
          where: {
            id: registrationId,
            planId: plan.id,
            clubId: plan.clubId,
          },
          select: { id: true, status: true },
        })
        if (!existing) {
          return {
            success: false,
            code: "NOT_FOUND",
            error: "La formación ya no existe en esta planilla.",
          }
        }
        if (existing.status !== "IN_CART") {
          return {
            success: false,
            code: "PLAN_NOT_EDITABLE",
            error: "La formación ya pertenece a una orden y no puede editarse.",
          }
        }
      } else {
        const count = await tx.registration.count({ where: { planId: plan.id } })
        if (count >= MAX_PLAN_ENTRIES) {
          return {
            success: false,
            code: "INVALID_MODALITY",
            error: `Una planilla admite como máximo ${MAX_PLAN_ENTRIES} formaciones.`,
          }
        }
        registrationId = randomUUID()
      }

      if (athleteIds.length > 0) {
        const duplicate = await tx.registrationAthlete.findFirst({
          where: {
            modalityId: modality.id,
            athleteId: { in: athleteIds },
            registrationId: { not: registrationId },
          },
          include: {
            athlete: { select: { firstNames: true, lastNames: true } },
          },
        })
        if (duplicate) {
          return {
            success: false,
            code: "DUPLICATE_ENTRY",
            error: `${duplicate.athlete.firstNames} ${duplicate.athlete.lastNames} ya aparece en esta prueba.`,
          }
        }
      }

      if (input.entry.registrationId) {
        await tx.registrationAthlete.deleteMany({
          where: { registrationId },
        })
        await tx.registration.update({
          where: { id: registrationId },
          data: { modalityId: modality.id },
        })
      } else {
        await tx.registration.create({
          data: {
            id: registrationId,
            planId: plan.id,
            clubId: plan.clubId,
            modalityId: modality.id,
            status: "IN_CART",
          },
        })
      }

      if (athleteIds.length > 0) {
        const reserves = new Set(reserveIds)
        await tx.registrationAthlete.createMany({
          data: athleteIds.map((athleteId) => ({
            registrationId: registrationId!,
            modalityId: modality.id,
            athleteId,
            isReserve: reserves.has(athleteId),
          })),
        })
      }

      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: {
          revision: { increment: 1 },
          currentStep: Math.max(3, plan.currentStep),
        },
      })
      return {
        success: true,
        ...planRef(updated),
        registrationId: registrationId!,
      }
    })
  } catch (error) {
    console.error("saveRegistrationPlanEntry error:", error)
    return {
      success: false,
      code:
        knownErrorCode(error) === "P2002"
          ? "DUPLICATE_ENTRY"
          : isRetryableRegistrationPlanTransactionError(error)
            ? "CONCURRENT_CHANGE"
            : "UNEXPECTED_ERROR",
      error:
        knownErrorCode(error) === "P2002"
          ? "Un deportista ya aparece en esa prueba. Recarga la planilla."
          : "No se pudo guardar la formación. Vuelve a intentarlo.",
    }
  }
}

/**
 * Marca o desmarca una prueba INDIVIDUAL de un deportista.
 *
 * Existe porque la pantalla única inscribe con una casilla por prueba: hacerlo
 * con setRegistrationPlanAthleteSelection + saveRegistrationPlanEntry costaría
 * dos viajes, dos incrementos de revisión y una ventana de carrera entre ambos.
 * Acá todo ocurre bajo el mismo lock y suma una sola revisión.
 *
 * Las pruebas de equipo (dueto, plantel de polo) siguen yendo por el editor de
 * formaciones: elegir quién es titular y quién reserva no cabe en una casilla.
 */
export async function toggleRegistrationPlanIndividualEntry(input: {
  planId: string
  clubId: string
  expectedRevision: number
  athleteId: string
  modalityId: string
  selected: boolean
}): Promise<
  RegistrationPlanActionResult<
    RegistrationPlanRef & { registrationId: string | null }
  >
> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan
      if (!plan.eventId) {
        return {
          success: false,
          code: "INVALID_EVENT",
          error: "Selecciona una competencia antes de asignar pruebas.",
        }
      }

      const modality = await tx.eventModality.findFirst({
        where: { id: input.modalityId, eventId: plan.eventId, isActive: true },
        select: { id: true, maxAthletes: true },
      })
      if (!modality) {
        return {
          success: false,
          code: "INVALID_MODALITY",
          error: "La prueba ya no está disponible para esta competencia.",
        }
      }
      if (modality.maxAthletes !== 1) {
        return {
          success: false,
          code: "INVALID_MODALITY",
          error: "Esta prueba es de equipo: usa el editor de formaciones.",
        }
      }

      if (!input.selected) {
        // Quitar la prueba no saca al deportista de la nómina: puede seguir
        // teniendo otras pruebas, o estar a punto de recibir una.
        const target = await tx.registration.findFirst({
          where: {
            planId: plan.id,
            clubId: plan.clubId,
            modalityId: modality.id,
            status: "IN_CART",
            athletes: { some: { athleteId: input.athleteId } },
          },
          select: { id: true },
        })
        if (target) {
          await tx.registration.delete({ where: { id: target.id } })
        }
        const updated = await tx.registrationPlan.update({
          where: { id: plan.id },
          data: { revision: { increment: 1 } },
        })
        return { success: true, ...planRef(updated), registrationId: null }
      }

      if (!(await validateOwnedAthletes(tx, plan.clubId, [input.athleteId]))) {
        return {
          success: false,
          code: "INVALID_ATHLETES",
          error: "El deportista no pertenece a tu club o está inactivo.",
        }
      }

      // La nómina se completa sola: en la pantalla única marcar una prueba ES
      // la forma de agregar al deportista.
      const inRoster = await tx.registrationPlanAthlete.findUnique({
        where: {
          planId_athleteId: { planId: plan.id, athleteId: input.athleteId },
        },
        select: { id: true },
      })
      if (!inRoster) {
        const rosterCount = await tx.registrationPlanAthlete.count({
          where: { planId: plan.id },
        })
        if (rosterCount >= MAX_ROSTER_ATHLETES) {
          return {
            success: false,
            code: "INVALID_ATHLETES",
            error: `Una planilla admite como máximo ${MAX_ROSTER_ATHLETES} deportistas.`,
          }
        }
        await tx.registrationPlanAthlete.create({
          data: { planId: plan.id, athleteId: input.athleteId },
        })
      }

      const existing = await tx.registration.findFirst({
        where: {
          planId: plan.id,
          modalityId: modality.id,
          athletes: { some: { athleteId: input.athleteId } },
        },
        select: { id: true },
      })
      if (existing) {
        // Ya estaba marcada: idempotente, para que un doble clic no falle.
        const updated = await tx.registrationPlan.update({
          where: { id: plan.id },
          data: { revision: { increment: 1 } },
        })
        return { success: true, ...planRef(updated), registrationId: existing.id }
      }

      const entryCount = await tx.registration.count({
        where: { planId: plan.id },
      })
      if (entryCount >= MAX_PLAN_ENTRIES) {
        return {
          success: false,
          code: "INVALID_MODALITY",
          error: `Una planilla admite como máximo ${MAX_PLAN_ENTRIES} formaciones.`,
        }
      }

      const registrationId = randomUUID()
      await tx.registration.create({
        data: {
          id: registrationId,
          planId: plan.id,
          clubId: plan.clubId,
          modalityId: modality.id,
          status: "IN_CART",
          athletes: {
            create: {
              modalityId: modality.id,
              athleteId: input.athleteId,
              isReserve: false,
            },
          },
        },
      })

      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: {
          revision: { increment: 1 },
          currentStep: Math.max(3, plan.currentStep),
        },
      })
      return { success: true, ...planRef(updated), registrationId }
    })
  } catch (error) {
    console.error("toggleRegistrationPlanIndividualEntry error:", error)
    return {
      success: false,
      code:
        knownErrorCode(error) === "P2002"
          ? "DUPLICATE_ENTRY"
          : isRetryableRegistrationPlanTransactionError(error)
            ? "CONCURRENT_CHANGE"
            : "UNEXPECTED_ERROR",
      error:
        knownErrorCode(error) === "P2002"
          ? "Ese deportista ya está inscrito en esa prueba. Recarga la planilla."
          : "No se pudo guardar la prueba. Vuelve a intentarlo.",
    }
  }
}

export async function deleteRegistrationPlanEntry(input: {
  planId: string
  clubId: string
  expectedRevision: number
  registrationId: string
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan

      const deleted = await tx.registration.deleteMany({
        where: {
          id: input.registrationId,
          planId: plan.id,
          clubId: plan.clubId,
          status: "IN_CART",
        },
      })
      if (deleted.count === 0) {
        return {
          success: false,
          code: "NOT_FOUND",
          error: "La formación ya no está disponible para eliminarla.",
        }
      }

      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: { revision: { increment: 1 } },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("deleteRegistrationPlanEntry error:", error)
    return {
      success: false,
      code: "UNEXPECTED_ERROR",
      error: "No se pudo eliminar la formación. Vuelve a intentarlo.",
    }
  }
}

export async function updateRegistrationPlanStep(input: {
  planId: string
  clubId: string
  expectedRevision: number
  currentStep: number
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan
      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: {
          revision: { increment: 1 },
          currentStep: clampStep(input.currentStep),
        },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("updateRegistrationPlanStep error:", error)
    return {
      success: false,
      code: "UNEXPECTED_ERROR",
      error: "No se pudo guardar el avance. Vuelve a intentarlo.",
    }
  }
}

/**
 * Guarda qué conceptos eligió pagar el club. Solo tiene efecto cuando el evento
 * cobra los dos; la validación es la que bloquea apagarlos ambos, porque acá no
 * se conoce la configuración del evento sin una consulta extra.
 */
export async function setRegistrationPlanCharges(input: {
  planId: string
  clubId: string
  expectedRevision: number
  paysEntry: boolean
  paysAthleteFee: boolean
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result

      const updated = await tx.registrationPlan.update({
        where: { id: editable.plan.id },
        data: {
          paysEntry: input.paysEntry,
          paysAthleteFee: input.paysAthleteFee,
          revision: { increment: 1 },
        },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("setRegistrationPlanCharges error:", error)
    return {
      success: false,
      code: isRetryableRegistrationPlanTransactionError(error)
        ? "CONCURRENT_CHANGE"
        : "UNEXPECTED_ERROR",
      error: "No se pudo guardar la forma de pago. Vuelve a intentarlo.",
    }
  }
}

export async function abandonRegistrationPlan(input: {
  planId: string
  clubId: string
  expectedRevision: number
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result
      const plan = editable.plan

      await tx.registration.deleteMany({
        where: { planId: plan.id, status: "IN_CART" },
      })
      const updated = await tx.registrationPlan.update({
        where: { id: plan.id },
        data: { status: "ABANDONED", revision: { increment: 1 } },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("abandonRegistrationPlan error:", error)
    return {
      success: false,
      code: "UNEXPECTED_ERROR",
      error: "No se pudo abandonar la planilla. Vuelve a intentarlo.",
    }
  }
}

export async function getRegistrationPlan(input: {
  planId: string
  clubId: string
}) {
  await expireStaleOrders()
  return prisma.registrationPlan.findFirst({
    where: { id: input.planId, clubId: input.clubId },
    include: {
      club: { select: { id: true, name: true, code: true } },
      event: { include: { season: true } },
      athletes: {
        include: { athlete: true },
        orderBy: { createdAt: "asc" },
      },
      registrations: {
        include: {
          modality: true,
          athletes: { include: { athlete: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      orders: {
        where: { status: { in: ["PENDING", "PAID"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  })
}

export async function listRegistrationPlans(
  clubId: string,
  options?: {
    statuses?: Array<"DRAFT" | "AWAITING_PAYMENT" | "PAID" | "ABANDONED">
    skip?: number
    take?: number
    disciplineAccess?: Discipline[]
  }
) {
  await expireStaleOrders()
  return prisma.registrationPlan.findMany({
    where: {
      clubId,
      ...(options?.statuses ? { status: { in: options.statuses } } : {}),
      ...(options?.disciplineAccess
        ? { disciplineScope: { in: options.disciplineAccess } }
        : {}),
    },
    include: {
      // `disciplines` es solo para presentación: la franja de andarivel de la
      // tarjeta de planilla necesita saber de qué deporte habla el evento.
      event: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          disciplines: true,
        },
      },
      _count: { select: { athletes: true, registrations: true } },
      orders: {
        where: { status: { in: ["PENDING", "PAID"] } },
        select: { id: true, status: true, totalAmount: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    skip: options?.skip,
    take: options?.take,
  })
}

export async function searchClubAthletesForPlan(input: {
  clubId: string
  planId?: string
  query?: string
  page?: number
  pageSize?: number
  disciplineAccess?: Discipline[]
}) {
  const page = Math.max(1, Math.trunc(input.page ?? 1))
  const pageSize = Math.max(10, Math.min(100, Math.trunc(input.pageSize ?? 30)))
  const query = input.query?.trim()
  const search = query
    ? {
        OR: [
          { firstNames: { contains: query, mode: "insensitive" as const } },
          { lastNames: { contains: query, mode: "insensitive" as const } },
          { docNumber: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : {}

  const [total, rows, selectedRows] = await Promise.all([
    prisma.athlete.count({
      where: {
        clubId: input.clubId,
        isActive: true,
        ...(input.disciplineAccess
          ? { disciplines: { hasSome: input.disciplineAccess } }
          : {}),
        ...search,
      },
    }),
    prisma.athlete.findMany({
      where: {
        clubId: input.clubId,
        isActive: true,
        ...(input.disciplineAccess
          ? { disciplines: { hasSome: input.disciplineAccess } }
          : {}),
        ...search,
      },
      orderBy: [{ lastNames: "asc" }, { firstNames: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    input.planId
      ? prisma.registrationPlanAthlete.findMany({
          where: { planId: input.planId, plan: { clubId: input.clubId } },
          select: { athleteId: true },
        })
      : Promise.resolve([]),
  ])
  const selected = new Set(selectedRows.map((row) => row.athleteId))

  return {
    rows: rows.map((athlete) => ({
      ...athlete,
      selected: selected.has(athlete.id),
    })),
    page,
    pageSize,
    total,
    pageCount: Math.ceil(total / pageSize),
    selectedAthleteIds: [...selected],
  }
}

/**
 * Recorta `pricing` antes de devolver la validación al cliente: lleva
 * Prisma.Decimal, que no cruza el límite servidor→cliente de React. El desglose
 * que la UI necesita ya viaja en `summary`, como números.
 */
function serializableValidation(
  validation: PlanValidationWithPricing
): PlanValidationResult {
  return {
    planId: validation.planId,
    revision: validation.revision,
    valid: validation.valid,
    summary: validation.summary,
    issues: validation.issues,
  }
}

export type EntryChargeNote = "CHARGED" | "IN_ATHLETE_FEE" | "CLUB_PAYS_PER_ATHLETE"

/**
 * Por qué una formación aparece en S/ 0 en el comprobante. Sin esta nota la
 * línea parecería decir que la prueba fue gratis.
 */
export function entryChargeSuffix(note: EntryChargeNote): string {
  if (note === "IN_ATHLETE_FEE") return " | incluida en la cuota por deportista"
  if (note === "CLUB_PAYS_PER_ATHLETE") return " | sin cargo: el club paga por deportista"
  return ""
}

/**
 * Por que una formacion aparece en S/ 0. El orden importa: si la disciplina no
 * cobra por formacion, ESA es la razon real y gana sobre la eleccion del club,
 * aunque el club tambien se haya bajado del concepto.
 *
 * `chargesEntry` en `undefined` (disciplina ausente del desglose) se trata como
 * `true`: es el comportamiento historico y hoy no puede pasar, porque el motor
 * emite una linea ENTRY por cada formacion.
 */
export function entryChargeNoteFor(input: {
  chargesEntry: boolean
  paysEntry: boolean | null
}): EntryChargeNote {
  if (!input.chargesEntry) return "IN_ATHLETE_FEE"
  if (input.paysEntry === false) return "CLUB_PAYS_PER_ATHLETE"
  return "CHARGED"
}

function buildRegistrationDescription(
  plan: RegistrationPlanForValidation,
  registration: RegistrationPlanForValidation["registrations"][number],
  note: EntryChargeNote = "CHARGED"
): string {
  const modality = registration.modality
  const label = [
    disciplineLabel(modality.discipline),
    modality.name,
    modality.category,
  ]
    .filter(Boolean)
    .join(" — ")
  const athletes = registration.athletes
    .map(
      (row) =>
        `${row.athlete.firstNames} ${row.athlete.lastNames}${row.isReserve ? " (reserva)" : ""}`
    )
    .join(", ")
  return `${plan.event?.name ?? "Competencia"} | ${label} | ${athletes}${entryChargeSuffix(note)}`
}

function buildAthleteFeeDescription(
  plan: RegistrationPlanForValidation,
  discipline: string,
  athlete: { firstNames: string; lastNames: string; docType: string; docNumber: string }
): string {
  return `${plan.event?.name ?? "Competencia"} | ${disciplineLabel(discipline)} — Cuota por deportista | ${athlete.lastNames}, ${athlete.firstNames} · ${athlete.docType} ${athlete.docNumber}`
}

function eventSnapshot(plan: RegistrationPlanForValidation) {
  const event = plan.event!
  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    venue: event.venue,
    city: event.city,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    registrationDeadline: event.registrationDeadline.toISOString(),
    season: event.season
      ? { id: event.season.id, year: event.season.year, name: event.season.name }
      : null,
  }
}

function buildAthleteFeeSnapshot(input: {
  plan: RegistrationPlanForValidation
  discipline: string
  fee: Prisma.Decimal
  athlete: {
    id: string
    firstNames: string
    lastNames: string
    docType: string
    docNumber: string
    birthDate: Date
    sex: string
  }
  capturedAt: Date
}): Prisma.InputJsonValue {
  return {
    version: 2,
    kind: "ATHLETE_FEE",
    capturedAt: input.capturedAt.toISOString(),
    plan: { id: input.plan.id, revision: input.plan.revision },
    club: {
      id: input.plan.club.id,
      name: input.plan.club.name,
      code: input.plan.club.code,
    },
    event: eventSnapshot(input.plan),
    discipline: input.discipline,
    fee: input.fee.toString(),
    athlete: {
      id: input.athlete.id,
      firstNames: input.athlete.firstNames,
      lastNames: input.athlete.lastNames,
      docType: input.athlete.docType,
      docNumber: input.athlete.docNumber,
      birthDate: input.athlete.birthDate.toISOString(),
      sex: input.athlete.sex,
    },
  } as Prisma.InputJsonValue
}

function buildRegistrationSnapshot(
  plan: RegistrationPlanForValidation,
  registration: RegistrationPlanForValidation["registrations"][number],
  capturedAt: Date
): Prisma.InputJsonValue {
  const event = plan.event!
  const modality = registration.modality
  return {
    version: 1,
    capturedAt: capturedAt.toISOString(),
    plan: { id: plan.id, revision: plan.revision },
    club: { id: plan.club.id, name: plan.club.name, code: plan.club.code },
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      venue: event.venue,
      city: event.city,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      registrationDeadline: event.registrationDeadline.toISOString(),
      season: event.season
        ? { id: event.season.id, year: event.season.year, name: event.season.name }
        : null,
    },
    modality: {
      id: modality.id,
      discipline: modality.discipline,
      name: modality.name,
      category: modality.category,
      sexRule: modality.sexRule,
      birthYearFrom: modality.birthYearFrom,
      birthYearTo: modality.birthYearTo,
      allowsCategoryUpgrade: modality.allowsCategoryUpgrade,
      categoryUpgradeBirthYear: modality.categoryUpgradeBirthYear,
      minAthletes: modality.minAthletes,
      maxAthletes: modality.maxAthletes,
      price: modality.price.toString(),
      capacity: modality.capacity,
    },
    registration: {
      id: registration.id,
      athletes: registration.athletes.map((row) => ({
        id: row.athlete.id,
        firstNames: row.athlete.firstNames,
        lastNames: row.athlete.lastNames,
        docType: row.athlete.docType,
        docNumber: row.athlete.docNumber,
        birthDate: row.athlete.birthDate.toISOString(),
        sex: row.athlete.sex,
        disciplines: row.athlete.disciplines,
        isReserve: row.isReserve,
      })),
    },
  } as Prisma.InputJsonValue
}

export async function checkoutRegistrationPlan(input: {
  planId: string
  clubId: string
  userId: string
  expectedRevision: number
}): Promise<
  RegistrationPlanActionResult<{
    orderId: string
    revision: number
    reused: boolean
    validation?: PlanValidationResult
  }>
> {
  await expireStaleOrders()

  try {
    return await checkoutReservationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)

      const basicPlan = await tx.registrationPlan.findFirst({
        where: { id: input.planId, clubId: input.clubId },
        select: {
          id: true,
          status: true,
          revision: true,
          disciplineScope: true,
        },
      })
      if (!basicPlan) {
        return {
          success: false,
          code: "NOT_FOUND",
          error: "La planilla no existe o no pertenece a tu club.",
        }
      }
      if (
        !(await userMayActForClub(
          tx,
          input.userId,
          input.clubId,
          basicPlan.disciplineScope
        ))
      ) {
        return {
          success: false,
          code: "FORBIDDEN",
          error: "No tienes permiso para pagar esta planilla.",
        }
      }

      // The plan advisory lock makes this the idempotency key. A second click,
      // webhook race or client retry receives the same live/paid order.
      const existingOrder = await tx.order.findFirst({
        where: {
          registrationPlanId: basicPlan.id,
          clubId: input.clubId,
          status: { in: ["PENDING", "PAID"] },
        },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      })
      if (existingOrder) {
        return {
          success: true,
          orderId: existingOrder.id,
          revision: basicPlan.revision,
          reused: true,
        }
      }

      if (basicPlan.status !== "DRAFT") {
        return {
          success: false,
          code: "PLAN_NOT_EDITABLE",
          currentRevision: basicPlan.revision,
          error: "La planilla no está disponible para crear una nueva orden.",
        }
      }
      if (basicPlan.revision !== input.expectedRevision) {
        return {
          success: false,
          code: "REVISION_CONFLICT",
          currentRevision: basicPlan.revision,
          error: "La planilla cambió en otra pestaña. Recarga antes de pagar.",
        }
      }

      const modalityRows = await tx.registration.findMany({
        where: { planId: basicPlan.id },
        select: { modalityId: true },
      })
      await lockModalities(
        tx,
        modalityRows.map((row) => row.modalityId)
      )

      // Reload after locking: administrative changes to prices/rules and other
      // checkouts that use these modalities are now visible and stable.
      const plan = await loadRegistrationPlanForValidation(tx, {
        planId: input.planId,
        clubId: input.clubId,
      })
      const validation = await validateRegistrationPlanInTransaction(
        tx,
        {
          planId: input.planId,
          clubId: input.clubId,
          expectedRevision: input.expectedRevision,
          mode: "CHECKOUT",
        },
        plan
      )
      if (!validation.valid || !plan || !plan.event) {
        return {
          success: false,
          code: "VALIDATION_FAILED",
          currentRevision: validation.revision,
          validation: serializableValidation(validation),
          error:
            validation.issues.find((row) => row.severity === "ERROR")?.message ??
            "La planilla todavía tiene observaciones por corregir.",
        }
      }

      // El importe autoritativo sale del motor de precios, no de sumar aquí:
      // es el mismo cálculo que vio el club en la validación.
      const pricing = validation.pricing
      const capturedAt = new Date()

      // Las cuotas por deportista se materializan recién ahora. El único
      // (evento, disciplina, deportista) hace que un P2002 signifique "otra
      // planilla se la llevó primero", que es un cambio concurrente legítimo.
      const feeLines = pricing.chargeableLines.filter(
        (line) => line.kind === "ATHLETE_FEE"
      )
      const athleteById = new Map(
        plan.registrations
          .flatMap((registration) => registration.athletes)
          .map((row) => [row.athleteId, row.athlete])
      )
      const feeRows: Array<{
        id: string
        eventId: string
        discipline: Discipline
        athleteId: string
        clubId: string
        planId: string
        status: "IN_CART"
        fee: Prisma.Decimal
      }> = feeLines.map((line) => ({
        id: randomUUID(),
        eventId: plan.event!.id,
        discipline: line.discipline as Discipline,
        athleteId: line.athleteId!,
        clubId: input.clubId,
        planId: plan.id,
        status: "IN_CART" as const,
        fee: line.amount,
      }))
      for (const row of feeRows) {
        // upsert y no create: un intento de pago anterior pudo dejar la cuota
        // liberada (IN_CART) ocupando su único. Se reutiliza esa fila y se le
        // reasigna el id generado para poder enlazarla con el OrderItem.
        const existing = await tx.eventAthleteFee.findUnique({
          where: {
            eventId_discipline_athleteId: {
              eventId: row.eventId,
              discipline: row.discipline,
              athleteId: row.athleteId,
            },
          },
          select: { id: true, status: true },
        })
        if (!existing) {
          await tx.eventAthleteFee.create({ data: row })
          continue
        }
        if (existing.status !== "IN_CART") {
          // Otra planilla se la llevó entre la validación y este punto.
          throw new Error("La planilla cambió mientras se creaba la orden.")
        }
        await tx.eventAthleteFee.update({
          where: { id: existing.id },
          data: { fee: row.fee, planId: row.planId, clubId: row.clubId },
        })
        row.id = existing.id
      }

      const entryAmountById = new Map(
        pricing.lines
          .filter((line) => line.kind === "ENTRY")
          .map((line) => [line.registrationId!, line.amount])
      )
      // Por qué la línea de una formación puede valer 0: o el evento no cobra
      // por formación en esa disciplina, o el club eligió no pagar ese concepto.
      const chargesEntryByDiscipline = new Map(
        pricing.byDiscipline.map((row) => [row.discipline as string, row.chargesEntry])
      )
      const noteFor = (discipline: string): EntryChargeNote =>
        entryChargeNoteFor({
          chargesEntry: chargesEntryByDiscipline.get(discipline) ?? true,
          paysEntry: plan.paysEntry,
        })

      const created = await tx.order.create({
        data: {
          code: shortCode("INS"),
          kind: "REGISTRATION",
          clubId: input.clubId,
          userId: input.userId,
          registrationPlanId: plan.id,
          eventId: plan.event.id,
          totalAmount: pricing.total,
          currency: "PEN",
          status: "PENDING",
          expiresAt: new Date(
            capturedAt.getTime() + ORDER_EXPIRATION_MINUTES * 60 * 1_000
          ),
          items: {
            create: [
              // Una línea por formación SIEMPRE, aunque valga 0: es el registro
              // nominal congelado del que viven los reportes y la constancia.
              ...plan.registrations.map((registration) => {
                const amount =
                  entryAmountById.get(registration.id) ?? new Prisma.Decimal(0)
                return {
                  registrationId: registration.id,
                  unitPrice: amount,
                  description: buildRegistrationDescription(
                    plan,
                    registration,
                    noteFor(registration.modality.discipline)
                  ),
                  registrationSnapshot: buildRegistrationSnapshot(
                    plan,
                    registration,
                    capturedAt
                  ),
                }
              }),
              ...feeRows.map((row) => {
                const athlete = athleteById.get(row.athleteId)!
                return {
                  eventAthleteFeeId: row.id,
                  unitPrice: row.fee,
                  description: buildAthleteFeeDescription(
                    plan,
                    row.discipline,
                    athlete
                  ),
                  registrationSnapshot: buildAthleteFeeSnapshot({
                    plan,
                    discipline: row.discipline,
                    fee: row.fee,
                    athlete,
                    capturedAt,
                  }),
                }
              }),
            ],
          },
        },
      })

      const claimed = await tx.registration.updateMany({
        where: {
          planId: plan.id,
          id: { in: plan.registrations.map((row) => row.id) },
          status: "IN_CART",
          activeOrderId: null,
        },
        data: { status: "PENDING_PAYMENT", activeOrderId: created.id },
      })
      if (claimed.count !== plan.registrations.length) {
        throw new Error("La planilla cambió mientras se creaba la orden.")
      }

      if (feeRows.length > 0) {
        const claimedFees = await tx.eventAthleteFee.updateMany({
          where: {
            id: { in: feeRows.map((row) => row.id) },
            status: "IN_CART",
            activeOrderId: null,
          },
          data: { status: "PENDING_PAYMENT", activeOrderId: created.id },
        })
        if (claimedFees.count !== feeRows.length) {
          throw new Error("La planilla cambió mientras se creaba la orden.")
        }
      }

      // Orden sin costo: pasa cuando la planilla solo agrega pruebas de un
      // deportista cuya cuota ya está pagada. No hay pasarela que cobre S/ 0, y
      // dejarla PENDING congelaría la planilla hasta que expire, así que se
      // confirma acá mismo y el club ve su constancia de inmediato.
      const freeOfCharge = pricing.total.isZero()
      if (freeOfCharge) {
        await tx.order.update({
          where: { id: created.id },
          data: {
            status: "PAID",
            paidAt: capturedAt,
            provider: "SIN_COSTO",
            providerRef: "SIN_COSTO",
          },
        })
        await tx.registration.updateMany({
          where: { activeOrderId: created.id, status: "PENDING_PAYMENT" },
          data: { status: "PAID" },
        })
        if (feeRows.length > 0) {
          await tx.eventAthleteFee.updateMany({
            where: { activeOrderId: created.id, status: "PENDING_PAYMENT" },
            data: { status: "PAID" },
          })
        }
      }

      const updatedPlan = await tx.registrationPlan.updateMany({
        where: {
          id: plan.id,
          clubId: input.clubId,
          status: "DRAFT",
          revision: input.expectedRevision,
        },
        data: {
          status: freeOfCharge ? "PAID" : "AWAITING_PAYMENT",
          revision: { increment: 1 },
          currentStep: 4,
        },
      })
      if (updatedPlan.count !== 1) {
        throw new Error("La planilla cambió mientras se creaba la orden.")
      }

      return {
        success: true,
        orderId: created.id,
        revision: plan.revision + 1,
        reused: false,
        validation: serializableValidation(validation),
      }
    })
  } catch (error) {
    console.error("checkoutRegistrationPlan error:", error)
    return {
      success: false,
      code: isRetryableRegistrationPlanTransactionError(error)
        ? "CONCURRENT_CHANGE"
        : "UNEXPECTED_ERROR",
      error:
        "La planilla cambió mientras se creaba la orden. Revisa los cupos y vuelve a intentarlo.",
    }
  }
}
