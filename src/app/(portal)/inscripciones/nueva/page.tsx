import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { clubMayEnterEvent } from "@/lib/club-events"
import {
  createOrResumeRegistrationPlan,
  selectRegistrationPlanEvent,
} from "@/lib/registration-plans"
import { explicitDisciplineAccess } from "@/lib/club-access"
import type { OpenPlanError } from "../open-plan-errors"

export const dynamic = "force-dynamic"

// Si algo impide abrir la planilla de la competencia pedida, el club vuelve a
// Inscripciones con el motivo en `?error=`, en vez de caer en silencio en una
// planilla sin competencia.
function backWithError(reason: OpenPlanError): never {
  redirect(`/inscripciones?error=${reason}`)
}

export default async function NewRegistrationPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ evento?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const access = explicitDisciplineAccess(user)

  const { evento } = await searchParams
  const plan = await createOrResumeRegistrationPlan({
    clubId: user.clubId,
    createdById: user.id,
    scopeByCreator: access !== undefined,
    disciplineScope: access?.[0],
  })
  if (!plan.success) {
    backWithError(plan.code === "FORBIDDEN" ? "permiso" : "inesperado")
  }

  if (evento && !plan.eventId && plan.status === "DRAFT") {
    const event = await prisma.event.findUnique({
      where: { slug: evento },
      select: { id: true, disciplines: true },
    })
    if (!event) backWithError("competencia")
    // selectRegistrationPlanEvent revalida la afiliación por su cuenta; acá se
    // comprueba antes solo para no gastar la transacción en un enlace ajeno.
    if (!(await clubMayEnterEvent(user.clubId, event.disciplines, access))) {
      backWithError("afiliacion")
    }
    const selected = await selectRegistrationPlanEvent({
      planId: plan.planId,
      clubId: user.clubId,
      eventId: event.id,
      expectedRevision: plan.revision,
    })
    if (selected.success) redirect(`/inscripciones/${selected.planId}`)
    if (selected.existingPlanId) redirect(`/inscripciones/${selected.existingPlanId}`)
    backWithError(
      selected.code === "INVALID_EVENT"
        ? "no-disponible"
        : selected.code === "ACTIVE_PLAN_EXISTS"
          ? "planilla-activa"
          : "inesperado"
    )
  }

  redirect(`/inscripciones/${plan.planId}`)
}
