import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly } from "@/lib/utils"
import { Badge, EVENT_STATUS_BADGE } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { NewEventButton } from "./event-form-dialog"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function EventosAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const requestedPage = Math.max(1, Math.trunc(Number((await searchParams).page) || 1))
  const [total, seasons] = await Promise.all([
    prisma.event.count(),
    prisma.season.findMany({
      orderBy: { year: "desc" },
      select: { id: true, name: true, year: true, isCurrent: true },
    }),
  ])
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
        title="Eventos"
        description="Crea eventos y configura sus pruebas/modalidades."
        actions={<NewEventButton seasons={seasons} />}
      />

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH className="min-w-64">Evento</TH>
              <TH>Disciplinas</TH>
              <TH>Fechas</TH>
              <TH>Cierre inscripción</TH>
              <TH>Pruebas</TH>
              <TH>Insc. pagadas</TH>
              <TH>Estado</TH>
            </TR>
          </THead>
          <TBody>
            {events.length === 0 ? (
              <TR>
                <TD colSpan={7} className="py-10 text-center text-fdnda-muted">
                  Aún no hay eventos. Crea el primero.
                </TD>
              </TR>
            ) : (
              events.map((event) => {
                const badge = EVENT_STATUS_BADGE[event.status]
                const paidCount = event.modalities.reduce(
                  (sum, m) => sum + m._count.registrations,
                  0
                )
                return (
                  <TR key={event.id}>
                    <TD className="min-w-64">
                      <Link
                        href={`/admin/eventos/${event.id}`}
                        className="inline-flex min-h-11 items-center font-bold text-fdnda-navy underline-offset-4 hover:underline"
                      >
                        {event.name}
                      </Link>
                      <p className="text-xs text-fdnda-muted">
                        {event.venue ?? ""} {event.city ? `· ${event.city}` : ""}
                      </p>
                      <p className="text-xs text-fdnda-muted">
                        {event.season?.name ?? "Temporada por asignar"}
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
                    <TD>
                      {formatDateOnly(event.startDate)} – {formatDateOnly(event.endDate)}
                    </TD>
                    <TD>
                      {new Intl.DateTimeFormat("es-PE", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Lima",
                      }).format(event.registrationDeadline)}
                    </TD>
                    <TD>{event._count.modalities}</TD>
                    <TD>{paidCount}</TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TD>
                  </TR>
                )
              })
            )}
          </TBody>
        </Table>
      </TableContainer>
      <Pagination
        pathname="/admin/eventos"
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  )
}
