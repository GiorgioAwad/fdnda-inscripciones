import { notFound, redirect } from "next/navigation"
import { ClipboardList } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { clubEventWhere, getClubEventScope } from "@/lib/club-events"
import { disciplineConfigFor } from "@/lib/event-pricing"
import { validateRegistrationPlan } from "@/lib/plan-validation"
import { assertPlanAccess, explicitDisciplineAccess } from "@/lib/club-access"
import { formatDateTimeLima } from "@/lib/utils"
import { resumeStep } from "../steps"
import {
  athleteDisciplinesCoveringEvent,
  getRegistrationPlan,
  listClubAthletesForDisciplines,
} from "@/lib/registration-plans"
import { RegistrationPlanWizard } from "./registration-plan-wizard"
import type {
  AthleteView,
  EventView,
  LockedEntryView,
  LockedPairView,
  ModalityView,
  PlanView,
} from "../types"

export const dynamic = "force-dynamic"

function athleteView(
  athlete: {
    id: string
    firstNames: string
    lastNames: string
    docType: string
    docNumber: string
    birthDate: Date
    sex: "M" | "F"
    disciplines: string[]
  },
  covered: Map<string, string[]> | null
): AthleteView {
  return {
    id: athlete.id,
    firstNames: athlete.firstNames,
    lastNames: athlete.lastNames,
    docType: athlete.docType,
    docNumber: athlete.docNumber,
    birthDate: athlete.birthDate.toISOString(),
    sex: athlete.sex,
    disciplines: athlete.disciplines,
    coveredDisciplines: covered ? (covered.get(athlete.id) ?? []) : null,
  }
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
    id: event.id,
    name: event.name,
    slug: event.slug,
    venue: event.venue,
    city: event.city,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    registrationDeadline: event.registrationDeadline.toISOString(),
    registrationDeadlineLabel: formatDateTimeLima(event.registrationDeadline),
    disciplines: event.disciplines,
    seasonName: event.season?.name ?? null,
  }
}

export default async function RegistrationPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const { planId } = await params
  try {
    await assertPlanAccess({ ...user, clubId: user.clubId }, planId)
  } catch {
    notFound()
  }
  const access = explicitDisciplineAccess(user)

  const [plan, scope] = await Promise.all([
    getRegistrationPlan({ planId, clubId: user.clubId }),
    getClubEventScope(user.clubId, access),
  ])
  if (!plan) notFound()
  const planDisciplineWhere = plan.disciplineScope
    ? { discipline: plan.disciplineScope }
    : access
      ? { discipline: { in: access } }
      : {}

  // Solo una planilla sin competencia muestra el selector, y solo ofrece
  // competencias de las disciplinas del club.
  const events =
    plan.eventId || scope.disciplines.length === 0
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

  // La planilla se arma por prueba: para cada una se listan los elegibles del
  // padrón, así que se carga el padrón de las disciplinas que tienen pruebas
  // (ya recortadas al alcance del usuario por planDisciplineWhere).
  const padron = await listClubAthletesForDisciplines({
    clubId: user.clubId,
    disciplines: [...new Set(modalities.map((row) => row.discipline))],
  })
  // Afiliación de cada deportista visible (padrón y planilla), con el mismo
  // criterio que la revisión: así el club la ve antes de marcar.
  const covered = plan.eventId
    ? await athleteDisciplinesCoveringEvent({
        clubId: user.clubId,
        eventId: plan.eventId,
        athleteIds: [
          ...padron.map((row) => row.id),
          ...plan.athletes.map((row) => row.athleteId),
        ],
      })
    : null

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

  // Leer el reloj acá (servidor) y no en el render del cliente.
  const now = new Date()
  const closedReason: PlanView["closedReason"] = !plan.event
    ? null
    : plan.event.status !== "OPEN"
      ? "CLOSED"
      : plan.event.registrationDeadline < now
        ? "DEADLINE"
        : null

  const activeOrder = plan.orders[0] ?? null
  const view: PlanView = {
    id: plan.id,
    status: plan.status,
    revision: plan.revision,
    currentStep: plan.currentStep,
    clubName: plan.club.name,
    event: plan.event ? eventView(plan.event) : null,
    roster: plan.athletes.map((row) => athleteView(row.athlete, covered)),
    entries: plan.registrations.map((entry) => ({
      id: entry.id,
      modalityId: entry.modalityId,
      status: entry.status,
      athleteIds: entry.athletes.map((row) => row.athleteId),
      reserveIds: entry.athletes.filter((row) => row.isReserve).map((row) => row.athleteId),
    })),
    activeOrder: activeOrder
      ? {
          id: activeOrder.id,
          code: activeOrder.code,
          status: activeOrder.status,
          totalAmount: Number(activeOrder.totalAmount),
        }
      : null,
    paysEntry: plan.paysEntry,
    paysAthleteFee: plan.paysAthleteFee,
    closedReason,
  }

  const modalityViews: ModalityView[] = modalities.map((modality) => {
    const config = disciplineConfigFor(disciplineConfigs, modality.discipline)
    return {
      id: modality.id,
      discipline: modality.discipline,
      name: modality.name,
      category: modality.category,
      level: modality.level,
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
      athleteFee: config.athleteFee === null ? null : Number(config.athleteFee),
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

  // Si un borrador reanuda en revisión, se valida acá y el club ve el total sin
  // pasar por un spinner. Una planilla con orden no se revalida: su orden ya
  // fijó importes y reglas, y revalidarla contra el estado actual de la
  // competencia mostraría errores que no le corresponden.
  const initialValidation =
    plan.status === "DRAFT" &&
    resumeStep(plan.currentStep, Boolean(plan.eventId)) === 3
      ? await validateRegistrationPlan({
          planId,
          clubId: user.clubId,
          expectedRevision: plan.revision,
          mode: "REVIEW",
        })
      : null

  const statusLine = !plan.event
    ? "Elige la competencia para empezar a inscribir."
    : plan.status === "PAID"
      ? "Planilla pagada"
      : plan.status === "AWAITING_PAYMENT"
        ? "Orden pendiente de pago"
        : plan.status === "ABANDONED"
          ? "Planilla reemplazada"
          : closedReason === "CLOSED"
            ? "Inscripciones cerradas"
            : closedReason === "DEADLINE"
              ? `Inscripciones cerradas el ${formatDateTimeLima(plan.event.registrationDeadline)}`
              : `Inscripción hasta el ${formatDateTimeLima(plan.event.registrationDeadline)}`

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        back={{ href: "/inscripciones", label: "Volver a Inscripciones" }}
        title={plan.event?.name ?? "Nueva planilla"}
        description={`Club ${plan.club.name} · ${statusLine}`}
      />
      <RegistrationPlanWizard
        initialPlan={view}
        athletes={padron.map((row) => athleteView(row, covered))}
        events={events.map(eventView)}
        modalities={modalityViews}
        lockedEntries={lockedEntryViews}
        lockedPairs={lockedPairs}
        hasAffiliations={scope.disciplines.length > 0}
        initialValidation={initialValidation}
      />
    </div>
  )
}
