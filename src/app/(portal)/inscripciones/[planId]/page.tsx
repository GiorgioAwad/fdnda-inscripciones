import { notFound, redirect } from "next/navigation"
import { ClipboardList } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { clubEventWhere, getClubEventScope } from "@/lib/club-events"
import { disciplineConfigFor } from "@/lib/event-pricing"
import { validateRegistrationPlan } from "@/lib/plan-validation"
import { assertPlanAccess, explicitDisciplineAccess } from "@/lib/club-access"
import { resumeStep } from "../steps"
import {
  getRegistrationPlan,
  searchClubAthletesForPlan,
} from "@/lib/registration-plans"
import { RegistrationPlanWizard } from "./registration-plan-wizard"
import type {
  AthletePageView,
  AthleteView,
  EventView,
  LockedEntryView,
  LockedPairView,
  ModalityView,
  PlanView,
} from "../types"

export const dynamic = "force-dynamic"

function athleteView(athlete: {
  id: string
  firstNames: string
  lastNames: string
  docType: string
  docNumber: string
  birthDate: Date
  sex: "M" | "F"
  disciplines: string[]
}): AthleteView {
  return { ...athlete, birthDate: athlete.birthDate.toISOString() }
}

function eventView(event: {
  id: string
  name: string
  slug: string
  venue: string | null
  city: string | null
  startDate: Date
  endDate: Date
  registrationDeadline: Date
  disciplines: string[]
  season?: { name: string } | null
}): EventView {
  return {
    ...event,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    registrationDeadline: event.registrationDeadline.toISOString(),
    seasonName: event.season?.name ?? null,
  }
}

export default async function RegistrationPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const [{ planId }, filters] = await Promise.all([params, searchParams])
  try {
    await assertPlanAccess({ ...user, clubId: user.clubId }, planId)
  } catch {
    notFound()
  }
  const access = explicitDisciplineAccess(user)
  const pageNumber = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1)

  const [plan, athletePage, scope] = await Promise.all([
    getRegistrationPlan({ planId, clubId: user.clubId }),
    searchClubAthletesForPlan({
      clubId: user.clubId,
      planId,
      query: filters.q,
      page: pageNumber,
      pageSize: 30,
      disciplineAccess: access,
    }),
    getClubEventScope(user.clubId, access),
  ])
  if (!plan) notFound()
  const planDisciplineWhere = plan.disciplineScope
    ? { discipline: plan.disciplineScope }
    : access
      ? { discipline: { in: access } }
      : {}

  // El selector solo ofrece competencias de las disciplinas del club.
  const events =
    scope.disciplines.length === 0
      ? []
      : await prisma.event.findMany({
          where: clubEventWhere(scope.disciplines, {
            requireOpen: true,
            requireFutureDeadline: true,
            requireSeason: true,
          }),
          include: { season: { select: { name: true } } },
          orderBy: [{ startDate: "asc" }, { name: "asc" }],
        })

  const [modalities, disciplineConfigs] = plan.eventId
    ? await Promise.all([
        prisma.eventModality.findMany({
          where: { eventId: plan.eventId, isActive: true, ...planDisciplineWhere },
          orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        }),
        prisma.eventDisciplineConfig.findMany({
          where: { eventId: plan.eventId, ...planDisciplineWhere },
        }),
      ])
    : [[], []]

  const lockedEntries = plan.eventId
    ? await prisma.registration.findMany({
        where: {
          clubId: user.clubId,
          modality: { eventId: plan.eventId, ...planDisciplineWhere },
          status: { in: ["PENDING_PAYMENT", "PAID"] },
          OR: [{ planId: { not: plan.id } }, { planId: null }],
        },
        include: {
          modality: { select: { name: true, category: true, discipline: true } },
          athletes: { include: { athlete: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : []

  const view: PlanView = {
    id: plan.id,
    status: plan.status,
    revision: plan.revision,
    currentStep: plan.currentStep,
    clubName: plan.club.name,
    event: plan.event ? eventView(plan.event) : null,
    roster: plan.athletes.map((row) => athleteView(row.athlete)),
    entries: plan.registrations.map((entry) => ({
      id: entry.id,
      modalityId: entry.modalityId,
      status: entry.status,
      athleteIds: entry.athletes.map((row) => row.athleteId),
      reserveIds: entry.athletes.filter((row) => row.isReserve).map((row) => row.athleteId),
    })),
    activeOrder: plan.orders[0]
      ? { id: plan.orders[0].id, status: plan.orders[0].status }
      : null,
    paysEntry: plan.paysEntry,
    paysAthleteFee: plan.paysAthleteFee,
  }

  const athletePageView: AthletePageView = {
    rows: athletePage.rows.map((row) => athleteView(row)),
    page: athletePage.page,
    pageSize: athletePage.pageSize,
    total: athletePage.total,
    pageCount: athletePage.pageCount,
  }
  const modalityViews: ModalityView[] = modalities.map((modality) => {
    const config = disciplineConfigFor(disciplineConfigs, modality.discipline)
    return {
      id: modality.id,
      discipline: modality.discipline,
      name: modality.name,
      category: modality.category,
      sexRule: modality.sexRule,
      birthYearFrom: modality.birthYearFrom,
      birthYearTo: modality.birthYearTo,
      upgradeYear: modality.categoryUpgradeBirthYear,
      minAthletes: modality.minAthletes,
      maxAthletes: modality.maxAthletes,
      price: Number(modality.price),
      pricePerMatch:
        modality.pricePerMatch === null ? null : Number(modality.pricePerMatch),
      matchesPerTeam: modality.matchesPerTeam,
      capacity: modality.capacity,
      ageRuleMode: config.ageRuleMode,
      chargesEntry: config.chargesEntry,
      chargesAthleteFee: config.chargesAthleteFee,
    }
  })
  const lockedEntryViews: LockedEntryView[] = lockedEntries.map((entry) => ({
    id: entry.id,
    modalityId: entry.modalityId,
    modalityName: entry.modality.name,
    category: entry.modality.category,
    discipline: entry.modality.discipline,
    status: entry.status,
    athleteIds: entry.athletes.map((row) => row.athleteId),
    reserveIds: entry.athletes.filter((row) => row.isReserve).map((row) => row.athleteId),
  }))
  // Pares ya confirmados: la casilla se pinta marcada y bloqueada en lugar de
  // dejar que el club choque con el único de base al guardar.
  const lockedPairs: LockedPairView[] = lockedEntries.flatMap((entry) =>
    entry.athletes.map((row) => ({
      modalityId: entry.modalityId,
      athleteId: row.athleteId,
      status: entry.status,
    }))
  )

  // Si la planilla reanuda en revisión, se valida acá y el club ve el total sin
  // pasar por un spinner. En los otros pasos no se gasta la consulta.
  const initialValidation =
    resumeStep(plan.currentStep, Boolean(plan.eventId)) === 3
      ? await validateRegistrationPlan({
          planId,
          clubId: user.clubId,
          expectedRevision: plan.revision,
          mode: "REVIEW",
        })
      : null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        eyebrow="Inscripciones deportivas"
        title={plan.event?.name ?? "Nueva planilla"}
        description={`Club ${plan.club.name} · Borrador persistente con control de cambios.`}
      />
      <RegistrationPlanWizard
        initialPlan={view}
        athletePage={athletePageView}
        events={events.map(eventView)}
        modalities={modalityViews}
        lockedEntries={lockedEntryViews}
        lockedPairs={lockedPairs}
        hasAffiliations={scope.disciplines.length > 0}
        initialValidation={initialValidation}
        initialQuery={filters.q ?? ""}
      />
    </div>
  )
}
