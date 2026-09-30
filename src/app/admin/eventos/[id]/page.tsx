import Link from "next/link"
import { notFound } from "next/navigation"
import { BarChart3, CalendarDays, CircleAlert, CircleCheck } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { disciplineLabel } from "@/lib/disciplines"
import { disciplineConfigFor } from "@/lib/event-pricing"
import { eventReadiness, readinessModalityFrom } from "@/lib/event-readiness"
import { formatDateOnly, formatDateTimeLima, formatMoney, plural } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { EditEventButton, type SeasonOption } from "../event-form-dialog"
import { eventStatusBadge, isDeadlinePassed } from "../event-status"
import { DeleteEventButton } from "./delete-event-button"
import { EventStatusControls, ModalitiesManager } from "./modalities-manager"

export const dynamic = "force-dynamic"

// Lima = UTC-5 fijo; datetime-local para el form de edición.
function toLimaLocalInput(date: Date): string {
  return new Date(date.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16)
}

function missingText(count: number): string {
  return `${count === 1 ? "Falta" : "Faltan"} ${plural(count, "requisito", "requisitos")}`
}

export default async function EventoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [event, seasonRows, registrationGroups] = await Promise.all([
    prisma.event.findUnique({
      where: { id },
      include: {
        season: {
          include: { categories: true, fees: { select: { discipline: true } } },
        },
        disciplineConfigs: true,
        modalities: { orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }] },
      },
    }),
    prisma.season.findMany({
      orderBy: { year: "desc" },
      select: {
        id: true,
        name: true,
        year: true,
        isCurrent: true,
        startDate: true,
        endDate: true,
      },
    }),
    // Una sola consulta para contar inscripciones por prueba y estado: el
    // detalle necesita separar las del carrito (se pueden perder al desactivar
    // una prueba) de las que ya tienen orden (congelan la configuración).
    prisma.registration.groupBy({
      by: ["modalityId", "status"],
      where: { modality: { eventId: id } },
      _count: { _all: true },
    }),
  ])

  if (!event) notFound()

  const seasons: SeasonOption[] = seasonRows.map((season) => ({
    id: season.id,
    name: season.name,
    year: season.year,
    isCurrent: season.isCurrent,
    startDateISO: season.startDate.toISOString().slice(0, 10),
    endDateISO: season.endDate.toISOString().slice(0, 10),
  }))

  const countsByModality = new Map<string, { cart: number; pending: number; paid: number }>()
  for (const group of registrationGroups) {
    const counts = countsByModality.get(group.modalityId) ?? { cart: 0, pending: 0, paid: 0 }
    if (group.status === "IN_CART") counts.cart += group._count._all
    else if (group.status === "PENDING_PAYMENT") counts.pending += group._count._all
    else if (group.status === "PAID") counts.paid += group._count._all
    countsByModality.set(group.modalityId, counts)
  }
  const totalRegistrations = registrationGroups.reduce(
    (sum, group) => sum + group._count._all,
    0
  )
  // Misma condición que saveEvent: solo una inscripción con orden (por pagar o
  // pagada) congela el cobro. Una que sigue en el carrito todavía no compró nada.
  const hasLockedEntries = registrationGroups.some(
    (group) => group.status !== "IN_CART" && group._count._all > 0
  )

  const badge = eventStatusBadge(event.status, event.registrationDeadline)
  const deadlinePassed = isDeadlinePassed(event.registrationDeadline)
  const deadlineLabel = formatDateTimeLima(event.registrationDeadline)
  // Configuración de la disciplina principal, que es la única para eventos
  // nuevos. Sin fila vale el default histórico (cobra por formación + RANGE).
  const primaryDiscipline = event.disciplines[0] ?? ""
  const primaryConfig = disciplineConfigFor(event.disciplineConfigs, primaryDiscipline)
  const disciplinesText = event.disciplines.map(disciplineLabel).join(" y ")

  const readiness = eventReadiness({
    registrationDeadline: event.registrationDeadline,
    isLeague: event.isLeague,
    disciplines: event.disciplines,
    disciplineConfigs: event.disciplineConfigs,
    season: event.season
      ? {
          name: event.season.name,
          feeDisciplines: event.season.fees.map((fee) => fee.discipline),
        }
      : null,
    modalities: event.modalities.map(readinessModalityFrom),
  })

  const visibility =
    event.status === "DRAFT"
      ? "Borrador: los clubes todavía no ven esta competencia."
      : event.status === "CLOSED"
        ? "Inscripciones cerradas: los clubes no ven esta competencia."
        : deadlinePassed
          ? `Plazo vencido: desde el ${deadlineLabel} los clubes ya no ven esta competencia. Cambia el cierre en «Editar datos de la competencia» o cierra las inscripciones.`
          : `Los clubes de ${disciplinesText} pueden inscribir hasta el ${deadlineLabel}.`

  const fee = primaryConfig.athleteFee ? formatMoney(primaryConfig.athleteFee) : null
  const entryText = event.isLeague
    ? "precio por partido de cada plantel"
    : "precio por formación de cada prueba"
  const chargeSummary =
    primaryConfig.chargesEntry && primaryConfig.chargesAthleteFee
      ? `${entryText[0].toUpperCase()}${entryText.slice(1)} + cuota de competencia de ${fee ?? "S/ 0"} por deportista. Cada club elige cuál paga, o ambos.`
      : primaryConfig.chargesAthleteFee
        ? `Cuota de competencia de ${fee ?? "S/ 0"} por deportista. Las pruebas no tienen precio propio.`
        : `${entryText[0].toUpperCase()}${entryText.slice(1)}.`

  const place = [event.venue, event.city].filter(Boolean).join(" · ")

  const facts: Array<{ label: string; value: string }> = [
    {
      label: "Fechas",
      value: `${formatDateOnly(event.startDate)} – ${formatDateOnly(event.endDate)}`,
    },
    { label: "Sede", value: place || "Sin sede registrada" },
    { label: "Temporada", value: event.season?.name ?? "Sin temporada" },
    {
      label: "Cierre de inscripciones",
      value: deadlinePassed ? `${deadlineLabel} (ya pasó)` : deadlineLabel,
    },
    { label: "Cobro", value: chargeSummary },
    {
      label: "Edades",
      value:
        primaryConfig.ageRuleMode === "MAX_AGE_ONLY"
          ? "Categorías Sub-N u Open"
          : "Rango de años de nacimiento",
    },
    ...(event.isLeague
      ? [{ label: "Formato", value: "Liga: precio por partido × partidos por plantel" }]
      : []),
    ...(event.isLevelChampionship
      ? [{ label: "Formato", value: "Campeonato de niveles: Básico, Intermedio y Avanzado" }]
      : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin/eventos", label: "Volver a Competencias" }}
        icon={CalendarDays}
        lanes={event.disciplines}
        title={event.name}
        description={
          <>
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {event.disciplines.map((value) => (
                <Badge key={value} variant="info">
                  {disciplineLabel(value)}
                </Badge>
              ))}
              {event.isLeague ? <Badge variant="accent">Liga</Badge> : null}
              {event.isLevelChampionship ? (
                <Badge variant="accent">Campeonato de niveles</Badge>
              ) : null}
            </span>
            <span className="mt-2 block text-fdnda-ink">{visibility}</span>
          </>
        }
        actions={
          <>
            <Link
              href={`/admin/eventos/${event.id}/reporte`}
              className={buttonClasses({ variant: "outline" })}
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> Reporte de inscripciones
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
            <EventStatusControls
              eventId={event.id}
              eventName={event.name}
              status={event.status}
              missingCount={readiness.missing.length}
              deadlineLabel={deadlineLabel}
            />
          </>
        }
      />

      <section aria-label="Datos de la competencia">
        <Card className="p-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => (
              <div key={`${fact.label}-${fact.value}`} className="min-w-0">
                <dt className="text-sm font-semibold text-fdnda-muted">{fact.label}</dt>
                <dd className="mt-0.5 text-sm leading-6 text-fdnda-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
          {event.description ? (
            <p className="mt-4 border-t border-fdnda-border pt-4 text-sm leading-6 text-fdnda-muted">
              {event.description}
            </p>
          ) : null}
        </Card>
      </section>

      {event.status !== "OPEN" ? (
        <section id="requisitos" aria-labelledby="requisitos-titulo" className="scroll-mt-6">
          <Card className="p-5">
            <h2
              id="requisitos-titulo"
              className="font-heading text-lg font-bold text-fdnda-navy"
            >
              Requisitos para abrir inscripciones
            </h2>
            <p className="mt-1 text-sm leading-6 text-fdnda-muted">
              {readiness.ready
                ? "Todo listo: ya puedes abrir las inscripciones."
                : `${missingText(readiness.missing.length)}. Cuando los completes se habilita «Abrir inscripciones».`}
            </p>
            <ul className="mt-4 space-y-3">
              {readiness.checks.map((item) => (
                <li key={item.key} className="flex items-start gap-2.5">
                  {item.ok ? (
                    <CircleCheck
                      className="mt-0.5 h-5 w-5 shrink-0 text-fdnda-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 h-5 w-5 shrink-0 text-fdnda-red-deep"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 text-sm leading-6">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-fdnda-ink">
                      <Badge variant={item.ok ? "success" : "danger"}>
                        {item.ok ? "Listo" : "Falta"}
                      </Badge>
                      {item.label}
                    </p>
                    {item.problem ? (
                      <p className="text-fdnda-muted">
                        {item.problem}
                        {item.key === "AFFILIATION_FEE" ? (
                          <>
                            {" "}
                            <Link
                              href="/admin/temporadas"
                              className="font-semibold text-fdnda-turquoise-deep underline underline-offset-4"
                            >
                              Configurar cuotas en Temporadas
                            </Link>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <ModalitiesManager
        eventId={event.id}
        isLeague={event.isLeague}
        isLevelChampionship={event.isLevelChampionship}
        eventDisciplines={event.disciplines}
        disciplineConfigs={event.disciplineConfigs.map((config) => ({
          discipline: config.discipline,
          chargesEntry: config.chargesEntry,
          chargesAthleteFee: config.chargesAthleteFee,
          athleteFee: config.athleteFee?.toString() ?? null,
          ageRuleMode: config.ageRuleMode,
        }))}
        seasonYear={event.season?.year ?? null}
        seasonCategories={
          event.season?.categories.map((category) => ({
            id: category.id,
            discipline: category.discipline,
            name: category.name,
            birthYearFrom: category.birthYearFrom,
            birthYearTo: category.birthYearTo,
            sortOrder: category.sortOrder,
          })) ?? []
        }
        modalities={event.modalities.map((m) => {
          const counts = countsByModality.get(m.id) ?? { cart: 0, pending: 0, paid: 0 }
          return {
            id: m.id,
            discipline: m.discipline,
            disciplineLabel: disciplineLabel(m.discipline),
            name: m.name,
            category: m.category ?? "",
            level: m.level,
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
            totalRegistrations: counts.cart + counts.pending + counts.paid,
            paidRegistrations: counts.paid,
            pendingRegistrations: counts.pending,
            cartRegistrations: counts.cart,
          }
        })}
      />

      {totalRegistrations === 0 ? (
        <section
          aria-labelledby="eliminar-titulo"
          className="rounded-surface border border-fdnda-border bg-white p-5"
        >
          <h2 id="eliminar-titulo" className="font-heading text-lg font-bold text-fdnda-navy">
            Eliminar competencia
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-fdnda-muted">
            Esta competencia no tiene inscripciones: si la creaste por error puedes
            eliminarla junto con sus pruebas. Cuando un club inscriba a alguien ya
            no se podrá eliminar; entonces se cierran las inscripciones.
          </p>
          <div className="mt-3">
            <DeleteEventButton
              eventId={event.id}
              eventName={event.name}
              modalityCount={event.modalities.length}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
