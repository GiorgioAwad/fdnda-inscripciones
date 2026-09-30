import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly, formatDateTimeLima } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { NewEventButton, type SeasonOption } from "./event-form-dialog"
import { eventStatusBadge } from "./event-status"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function EventosAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const requestedPage = Math.max(1, Math.trunc(Number((await searchParams).page) || 1))
  const [total, seasonRows] = await Promise.all([
    prisma.event.count(),
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
  ])
  const seasons: SeasonOption[] = seasonRows.map((season) => ({
    id: season.id,
    name: season.name,
    year: season.year,
    isCurrent: season.isCurrent,
    startDateISO: season.startDate.toISOString().slice(0, 10),
    endDateISO: season.endDate.toISOString().slice(0, 10),
  }))
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const events = await prisma.event.findMany({
    orderBy: { startDate: "desc" },
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      season: { select: { name: true, year: true } },
      _count: { select: { modalities: true } },
      modalities: {
        select: {
          _count: {
            select: { registrations: { where: { status: "PAID" } } },
          },
        },
      },
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Competencias"
        description="Cada competencia es de una disciplina. Entra a una para configurar sus pruebas, abrir inscripciones y descargar su reporte."
        actions={<NewEventButton seasons={seasons} />}
      />

      {total === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Todavía no hay competencias"
            action={<NewEventButton seasons={seasons} label="Crear la primera competencia" />}
          >
            Eliges la disciplina y el formulario propone sus pruebas, categorías y
            forma de cobro. La competencia nace en borrador: los clubes no la ven
            hasta que abras las inscripciones.
          </EmptyState>
        </Card>
      ) : (
        <>
          <TableContainer aria-label="Competencias">
            <Table>
              <THead>
                <TR>
                  <TH className="min-w-60">Competencia</TH>
                  <TH>Disciplina</TH>
                  <TH>Fechas y cierre</TH>
                  <TH className="text-right">Pruebas</TH>
                  <TH className="text-right">Pagadas</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {events.map((event) => {
                  const badge = eventStatusBadge(event.status, event.registrationDeadline)
                  const paidCount = event.modalities.reduce(
                    (sum, m) => sum + m._count.registrations,
                    0
                  )
                  const place = [event.venue, event.city].filter(Boolean).join(" · ")
                  return (
                    <TR key={event.id}>
                      <TD className="min-w-60">
                        <Link
                          href={`/admin/eventos/${event.id}`}
                          className="inline-flex min-h-11 items-center font-bold text-fdnda-navy underline-offset-4 hover:underline"
                        >
                          {event.name}
                        </Link>
                        {place ? <p className="text-xs text-fdnda-muted">{place}</p> : null}
                        <p className="text-xs text-fdnda-muted">
                          {event.season?.name ?? "Sin temporada"}
                        </p>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {event.disciplines.map((d) => (
                            <Badge key={d} variant="info">
                              {disciplineLabel(d)}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      {/* Fechas y cierre en una celda: eran dos columnas que a
                          1280 px empujaban el estado fuera de la vista. */}
                      <TD className="whitespace-nowrap">
                        <p>
                          {formatDateOnly(event.startDate)} – {formatDateOnly(event.endDate)}
                        </p>
                        <p className="text-xs text-fdnda-muted">
                          Cierre: {formatDateTimeLima(event.registrationDeadline)}
                        </p>
                      </TD>
                      <TD className="text-right">{event._count.modalities}</TD>
                      <TD className="text-right">{paidCount}</TD>
                      <TD className="whitespace-nowrap">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>
          <Pagination
            pathname="/admin/eventos"
            currentPage={currentPage}
            totalPages={totalPages}
          />
        </>
      )}
    </div>
  )
}
