import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { clubMayEnterEvent } from "@/lib/club-events"
import {
  createOrResumeRegistrationPlan,
  selectRegistrationPlanEvent,
} from "@/lib/registration-plans"
import { explicitDisciplineAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

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
  if (!plan.success) redirect(`/inscripciones?error=${encodeURIComponent(plan.error)}`)

  if (evento && !plan.eventId && plan.status === "DRAFT") {
    const event = await prisma.event.findUnique({
      where: { slug: evento },
      select: { id: true, disciplines: true },
    })
    // selectRegistrationPlanEvent revalida la afiliación por su cuenta; acá se
    // comprueba antes solo para no gastar la transacción en un enlace ajeno.
    if (
      event &&
      (await clubMayEnterEvent(user.clubId, event.disciplines, access))
    ) {
      const selected = await selectRegistrationPlanEvent({
        planId: plan.planId,
        clubId: user.clubId,
        eventId: event.id,
        expectedRevision: plan.revision,
      })
      if (selected.success) redirect(`/inscripciones/${selected.planId}`)
    }
  }

  redirect(`/inscripciones/${plan.planId}`)
}
