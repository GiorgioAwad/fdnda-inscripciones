"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireClubUser } from "@/lib/auth"
import {
  abandonRegistrationPlan,
  checkoutRegistrationPlan,
  deleteRegistrationPlanEntry,
  replaceRegistrationPlanRoster,
  saveRegistrationPlanEntry,
  setRegistrationPlanAthleteSelection,
  setRegistrationPlanCharges,
  selectRegistrationPlanEvent,
  toggleRegistrationPlanIndividualEntry,
  updateRegistrationPlanStep,
  type RegistrationPlanActionError,
} from "@/lib/registration-plans"
import { validateRegistrationPlan } from "@/lib/plan-validation"
import {
  assertAthletesAccess,
  assertEventAccess,
  assertModalityAccess,
  assertPlanAccess,
} from "@/lib/club-access"

const id = z.string().trim().min(1).max(100)
const revision = z.number().int().nonnegative()

const mutationSchema = z.object({ planId: id, expectedRevision: revision })

const invalid = (error = "Los datos enviados no son válidos."): RegistrationPlanActionError => ({
  success: false,
  code: "UNEXPECTED_ERROR",
  error,
})

function refresh(planId: string) {
  revalidatePath("/inscripciones")
  revalidatePath(`/inscripciones/${planId}`)
  revalidatePath(`/inscripciones/${planId}/resumen`)
}

async function authorize(work: () => Promise<void>) {
  try {
    await work()
    return null
  } catch {
    return invalid("No autorizado para esta disciplina.")
  }
}

export async function savePlanRosterAction(input: {
  planId: string
  expectedRevision: number
  athleteIds: string[]
}) {
  const parsed = mutationSchema
    .extend({ athleteIds: z.array(id).max(2_000) })
    .safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(async () => {
    await assertPlanAccess(user, parsed.data.planId)
    await assertAthletesAccess(user, parsed.data.athleteIds)
  })
  if (denied) return denied
  const result = await replaceRegistrationPlanRoster({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function setPlanAthleteAction(input: {
  planId: string
  expectedRevision: number
  athleteId: string
  selected: boolean
}) {
  const parsed = mutationSchema
    .extend({ athleteId: id, selected: z.boolean() })
    .safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(async () => {
    await assertPlanAccess(user, parsed.data.planId)
    await assertAthletesAccess(user, [parsed.data.athleteId])
  })
  if (denied) return denied
  const result = await setRegistrationPlanAthleteSelection({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function selectPlanEventAction(input: {
  planId: string
  expectedRevision: number
  eventId: string
}) {
  const parsed = mutationSchema.extend({ eventId: id }).safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(async () => {
    await assertPlanAccess(user, parsed.data.planId)
    await assertEventAccess(user, parsed.data.eventId)
  })
  if (denied) return denied
  const result = await selectRegistrationPlanEvent({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function savePlanEntryAction(input: {
  planId: string
  expectedRevision: number
  registrationId?: string
  modalityId: string
  athleteIds: string[]
  reserveIds: string[]
}) {
  const parsed = mutationSchema
    .extend({
      registrationId: id.optional(),
      modalityId: id,
      athleteIds: z.array(id).max(100),
      reserveIds: z.array(id).max(100),
    })
    .safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(async () => {
    await assertPlanAccess(user, parsed.data.planId)
    await assertModalityAccess(user, parsed.data.modalityId)
    await assertAthletesAccess(user, [
      ...parsed.data.athleteIds,
      ...parsed.data.reserveIds,
    ])
  })
  if (denied) return denied
  const { planId, expectedRevision, ...entry } = parsed.data
  const result = await saveRegistrationPlanEntry({
    planId,
    expectedRevision,
    clubId: user.clubId,
    entry,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function toggleAthleteModalityAction(input: {
  planId: string
  expectedRevision: number
  athleteId: string
  modalityId: string
  selected: boolean
}) {
  const parsed = mutationSchema
    .extend({ athleteId: id, modalityId: id, selected: z.boolean() })
    .safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(async () => {
    await assertPlanAccess(user, parsed.data.planId)
    await assertModalityAccess(user, parsed.data.modalityId)
    await assertAthletesAccess(user, [parsed.data.athleteId])
  })
  if (denied) return denied
  const result = await toggleRegistrationPlanIndividualEntry({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function deletePlanEntryAction(input: {
  planId: string
  expectedRevision: number
  registrationId: string
}) {
  const parsed = mutationSchema.extend({ registrationId: id }).safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(() => assertPlanAccess(user, parsed.data.planId))
  if (denied) return denied
  const result = await deleteRegistrationPlanEntry({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function savePlanStepAction(input: {
  planId: string
  expectedRevision: number
  currentStep: number
}) {
  const parsed = mutationSchema
    .extend({ currentStep: z.number().int().min(1).max(4) })
    .safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(() => assertPlanAccess(user, parsed.data.planId))
  if (denied) return denied
  const result = await updateRegistrationPlanStep({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function setPlanChargesAction(input: {
  planId: string
  expectedRevision: number
  paysEntry: boolean
  paysAthleteFee: boolean
}) {
  const parsed = mutationSchema
    .extend({ paysEntry: z.boolean(), paysAthleteFee: z.boolean() })
    .safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(() => assertPlanAccess(user, parsed.data.planId))
  if (denied) return denied
  const result = await setRegistrationPlanCharges({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}

export async function validatePlanAction(input: {
  planId: string
  expectedRevision: number
}) {
  const parsed = mutationSchema.safeParse(input)
  if (!parsed.success) return null
  const user = await requireClubUser()
  const denied = await authorize(() => assertPlanAccess(user, parsed.data.planId))
  if (denied) return null
  return validateRegistrationPlan({
    ...parsed.data,
    clubId: user.clubId,
    mode: "REVIEW",
  })
}

export async function checkoutPlanAction(input: {
  planId: string
  expectedRevision: number
}) {
  const parsed = mutationSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(() => assertPlanAccess(user, parsed.data.planId))
  if (denied) return denied
  const result = await checkoutRegistrationPlan({
    ...parsed.data,
    clubId: user.clubId,
    userId: user.id,
  })
  if (result.success) refresh(parsed.data.planId)
  return result
}

export async function abandonPlanAction(input: {
  planId: string
  expectedRevision: number
}) {
  const parsed = mutationSchema.safeParse(input)
  if (!parsed.success) return invalid()
  const user = await requireClubUser()
  const denied = await authorize(() => assertPlanAccess(user, parsed.data.planId))
  if (denied) return denied
  const result = await abandonRegistrationPlan({
    ...parsed.data,
    clubId: user.clubId,
  })
  if (result.success) refresh(result.planId)
  return result
}
