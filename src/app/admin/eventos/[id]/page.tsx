import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, BarChart3 } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { disciplineLabel } from "@/lib/disciplines"
import { disciplineConfigFor } from "@/lib/event-pricing"
import { formatDateOnly, formatDateTimeLima } from "@/lib/utils"
import { Badge, EVENT_STATUS_BADGE } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EditEventButton } from "../event-form-dialog"
import { EventStatusControls, ModalitiesManager } from "./modalities-manager"

export const dynamic = "force-dynamic"

// Lima = UTC-5 fijo; datetime-local para el form de edición.
function toLimaLocalInput(date: Date): string {
  return new Date(date.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16)
}

export default async function EventoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [event, seasons] = await Promise.all([
    prisma.event.findUnique({
      where: { id },
      include: {
        season: { include: { categories: true } },
        disciplineConfigs: true,
        modalities: {
          orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
          include: {
            _count: { select: { registrations: true } },
            registrations: {
              where: { status: "PAID" },
              select: { id: true },
            },
          },
        },
      },
    }),
    prisma.season.findMany({
      orderBy: { year: "desc" },
      select: { id: true, name: true, year: true, isCurrent: true },
    }),
  ])

  if (!event) notFound()

  const badge = EVENT_STATUS_BADGE[event.status]
  // Configuración de la disciplina principal, que es la única para eventos
  // nuevos. Sin fila vale el default histórico (cobra por formación + RANGE).
  const primaryDiscipline = event.disciplines[0] ?? ""
  const primaryConfig = disciplineConfigFor(event.disciplineConfigs, primaryDiscipline)
  // Una inscripción ya vendida congela cómo cobra y cómo mide edades el evento.
  const hasLockedEntries = event.modalities.some(
    (modality) => modality._count.registrations > 0
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-5 overflow-hidden rounded-surface border border-fdnda-border bg-white p-5 shadow-raised sm:p-6">
        <div className="min-w-0">
          <Link
            href="/admin/eventos"
            className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-sm font-bold text-fdnda-muted underline-offset-4 hover:text-fdnda-navy hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Eventos
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight text-fdnda-navy sm:text-2xl">
            {event.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fdnda-muted">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {event.disciplines.map((value) => (
              <Badge key={value} variant="info">
                {disciplineLabel(value)}
              </Badge>
            ))}
            {event.isLeague ? <Badge variant="accent">Liga</Badge> : null}
            <span className="font-medium">
              {formatDateOnly(event.startDate)} – {formatDateOnly(event.endDate)}
            </span>
            {event.venue ? <span>· {event.venue}</span> : null}
          </div>
          <p className="mt-2 text-xs font-semibold text-fdnda-turquoise-deep">
            {primaryConfig.chargesEntry && primaryConfig.chargesAthleteFee
              ? "Cobra la formación y una cuota por deportista"
              : primaryConfig.chargesAthleteFee
                ? "Cuota fija por deportista"
                : "Precio por formación"}
            {primaryConfig.ageRuleMode === "MAX_AGE_ONLY"
              ? " · categorías Sub-N/Open"
              : ""}
          </p>
          <p className="mt-2 text-xs font-bold text-fdnda-red-deep">
            Cierre de inscripciones: {formatDateTimeLima(event.registrationDeadline)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/eventos/${event.id}/reporte`}>
            <Button variant="secondary">
              <BarChart3 className="h-4 w-4" /> Reporte
            </Button>
          </Link>
          <EditEventButton
            event={{
              id: event.id,
              name: event.name,
              disciplines: event.disciplines,
              venue: event.venue ?? "",
              city: event.city ?? "",
              startDateISO: event.startDate.toISOString().slice(0, 10),
              endDateISO: event.endDate.toISOString().slice(0, 10),
              deadlineLocal: toLimaLocalInput(event.registrationDeadline),
              description: event.description ?? "",
              seasonId: event.seasonId ?? "",
              chargesEntry: primaryConfig.chargesEntry,
              chargesAthleteFee: primaryConfig.chargesAthleteFee,
              isLeague: event.isLeague,
              isLevelChampionship: event.isLevelChampionship,
              athleteFee: primaryConfig.athleteFee ?? "",
              ageRuleMode: primaryConfig.ageRuleMode,
              hasLockedEntries,
            }}
            seasons={seasons}
          />
          <EventStatusControls eventId={event.id} status={event.status} />
        </div>
      </div>

      {event.description ? (
        <Card>
          <CardContent className="p-5 text-sm text-fdnda-muted">
            {event.description}
          </CardContent>
        </Card>
      ) : null}

      <ModalitiesManager
        eventId={event.id}
        isLeague={event.isLeague}
        eventDisciplines={event.disciplines}
        disciplineConfigs={event.disciplineConfigs.map((config) => ({
          discipline: config.discipline,
          chargesEntry: config.chargesEntry,
          chargesAthleteFee: config.chargesAthleteFee,
          athleteFee: config.athleteFee?.toString() ?? null,
          ageRuleMode: config.ageRuleMode,
        }))}
        seasonYear={event.season?.year ?? null}
        seasonCategories={event.season?.categories.map((category) => ({
          id: category.id,
          discipline: category.discipline,
          name: category.name,
          birthYearFrom: category.birthYearFrom,
          birthYearTo: category.birthYearTo,
          sortOrder: category.sortOrder,
        })) ?? []}
        modalities={event.modalities.map((m) => ({
          id: m.id,
          discipline: m.discipline,
          disciplineLabel: disciplineLabel(m.discipline),
          name: m.name,
          category: m.category ?? "",
          sexRule: m.sexRule,
          birthYearFrom: m.birthYearFrom,
          birthYearTo: m.birthYearTo,
          allowsCategoryUpgrade: m.allowsCategoryUpgrade,
          categoryUpgradeBirthYear: m.categoryUpgradeBirthYear,
          minAthletes: m.minAthletes,
          maxAthletes: m.maxAthletes,
          price: Number(m.price),
          pricePerMatch: m.pricePerMatch === null ? null : Number(m.pricePerMatch),
          matchesPerTeam: m.matchesPerTeam,
          expectedTeams: m.expectedTeams,
          capacity: m.capacity,
          isActive: m.isActive,
          totalRegistrations: m._count.registrations,
          paidRegistrations: m.registrations.length,
        }))}
      />
    </div>
  )
}
