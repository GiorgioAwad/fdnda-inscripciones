import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, BarChart3, Download, Medal, Receipt, Users, Wallet } from "lucide-react"
import { getEventReport } from "@/lib/event-report"
import { expireStaleOrders } from "@/lib/orders"
import { formatDateTimeLima, formatMoney } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge, ORDER_STATUS_BADGE } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { StatCard, type StatTone } from "@/components/stat-card"
import { Pagination } from "@/components/pagination"
import { PageHeader } from "@/components/page-header"
import { PrintButton } from "@/components/print-button"
import { PrintSheetFooter, PrintSheetHeader } from "@/components/print-sheet"
import { disciplineLabel } from "@/lib/disciplines"

export const dynamic = "force-dynamic"

const REPORT_PAGE_SIZE = 50

export default async function ReporteEventoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    nominalPage?: string
    feePage?: string
    orderPage?: string
  }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  await expireStaleOrders()

  const report = await getEventReport(id)
  if (!report) notFound()

  const pageFor = (value: string | undefined, total: number) =>
    Math.min(
      Math.max(1, Math.trunc(Number(value) || 1)),
      Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE))
    )
  const nominalPage = pageFor(query.nominalPage, report.nominalRows.length)
  const feePage = pageFor(query.feePage, report.athleteFeeRows.length)
  const orderPage = pageFor(query.orderPage, report.orderRows.length)
  const nominalRows = report.nominalRows.slice(
    (nominalPage - 1) * REPORT_PAGE_SIZE,
    nominalPage * REPORT_PAGE_SIZE
  )
  const athleteFeeRows = report.athleteFeeRows.slice(
    (feePage - 1) * REPORT_PAGE_SIZE,
    feePage * REPORT_PAGE_SIZE
  )
  const orderRows = report.orderRows.slice(
    (orderPage - 1) * REPORT_PAGE_SIZE,
    orderPage * REPORT_PAGE_SIZE
  )
  const paginationQuery = {
    nominalPage,
    feePage,
    orderPage,
  }

  const stats: Array<{
    label: string
    value: string
    icon: typeof Medal
    tone: StatTone
  }> = [
    {
      label: "Inscripciones pagadas",
      value: String(report.totals.paidRegistrations),
      icon: Medal,
      tone: "turquoise",
    },
    {
      label: "Por pagar",
      value: String(report.totals.pendingRegistrations),
      icon: Receipt,
      tone: "warning",
    },
    {
      label: "Deportistas (pagados)",
      value: String(report.totals.distinctAthletes),
      icon: Users,
      tone: "navy",
    },
    {
      label: "Recaudado",
      value: formatMoney(report.totals.revenue),
      icon: Wallet,
      tone: "turquoise",
    },
  ]

  return (
    <div className="print-landscape space-y-6">
      <PrintSheetHeader
        title="Reporte de inscripciones"
        eventName={report.event.name}
        disciplines={report.event.disciplines}
        meta={[
          { label: "Inscripciones pagadas", value: String(report.totals.paidRegistrations) },
          { label: "Por pagar", value: String(report.totals.pendingRegistrations) },
          { label: "Deportistas", value: String(report.totals.distinctAthletes) },
          { label: "Recaudado", value: formatMoney(report.totals.revenue) },
        ]}
      />

      <Link
        href={`/admin/eventos/${id}`}
        className="print-hidden inline-flex items-center gap-1 text-xs text-fdnda-muted hover:text-fdnda-ink"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Volver al evento
      </Link>

      <PageHeader
        className="print-hidden"
        icon={BarChart3}
        eyebrow="Reporte de evento"
        lanes={report.event.disciplines}
        title={report.event.name}
        description="Inscripciones, cuotas y recaudación de la competencia."
        actions={
          <div className="print-hidden flex flex-wrap gap-2">
            <PrintButton label="Imprimir reporte" />
            <a href={`/api/admin/eventos/${id}/export`} download>
              <Button>
                <Download className="h-4 w-4" aria-hidden="true" /> Exportar Excel
              </Button>
            </a>
          </div>
        }
      />

      <div className="print-hidden grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            tone={stat.tone}
          />
        ))}
      </div>

      <section>
        <h2 className="mb-3 font-heading text-xl text-fdnda-navy">
          Resumen por prueba
        </h2>
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Disciplina</TH>
                <TH>Prueba</TH>
                <TH>Categoría</TH>
                <TH>Sexo</TH>
                <TH className="text-right">Precio</TH>
                <TH className="text-right">Pagadas</TH>
                <TH className="text-right">Por pagar</TH>
                <TH className="text-right">Deportistas</TH>
                <TH className="text-right">Recaudado</TH>
              </TR>
            </THead>
            <TBody>
              {report.modalityRows.map((row) => (
                <TR key={row.modalityId}>
                  <TD className="text-xs">{disciplineLabel(row.discipline)}</TD>
                  <TD className="font-medium text-fdnda-ink">{row.name}</TD>
                  <TD>{row.category || "—"}</TD>
                  <TD>{row.sexLabel}</TD>
                  <TD className="text-right">{formatMoney(row.price)}</TD>
                  <TD className="text-right font-semibold text-fdnda-success">
                    {row.paidCount}
                  </TD>
                  <TD className="text-right text-fdnda-warning">{row.pendingCount}</TD>
                  <TD className="text-right">{row.athleteCount}</TD>
                  <TD className="text-right font-semibold">{formatMoney(row.revenue)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </section>

      <section>
        <h2 className="mb-3 font-heading text-xl text-fdnda-navy">
          Por club (solo pagadas)
        </h2>
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Club</TH>
                <TH className="text-right">Inscripciones</TH>
                <TH className="text-right">Deportistas</TH>
                <TH className="text-right">Monto</TH>
              </TR>
            </THead>
            <TBody>
              {report.clubRows.length === 0 ? (
                <TR>
                  <TD colSpan={4} className="py-8 text-center text-fdnda-muted">
                    Todavía no hay inscripciones pagadas.
                  </TD>
                </TR>
              ) : (
                report.clubRows.map((row) => (
                  <TR key={row.clubName}>
                    <TD className="font-medium text-fdnda-ink">{row.clubName}</TD>
                    <TD className="text-right">{row.paidCount}</TD>
                    <TD className="text-right">{row.athleteCount}</TD>
                    <TD className="text-right font-semibold">
                      {formatMoney(row.amount)}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableContainer>
      </section>

      <section>
        <h2 className="mb-3 font-heading text-xl text-fdnda-navy">
          Listado nominal ({report.nominalRows.length})
        </h2>
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Deportista</TH>
                <TH>Documento</TH>
                <TH>Año</TH>
                <TH>Sexo</TH>
                <TH>Club</TH>
                <TH>Prueba</TH>
                <TH>Categoría</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {report.nominalRows.length === 0 ? (
                <TR>
                  <TD colSpan={8} className="py-8 text-center text-fdnda-muted">
                    Sin inscripciones todavía.
                  </TD>
                </TR>
              ) : (
                nominalRows.map((row, index) => (
                  <TR key={(nominalPage - 1) * REPORT_PAGE_SIZE + index}>
                    <TD className="font-medium text-fdnda-ink">
                      {row.athleteName}
                      {row.isReserve ? (
                        <span className="ml-1 text-xs text-fdnda-neutral">(reserva)</span>
                      ) : null}
                    </TD>
                    <TD className="font-mono text-xs">{row.docNumber}</TD>
                    <TD>{row.birthYear}</TD>
                    <TD>{row.sex}</TD>
                    <TD>{row.clubName}</TD>
                    <TD>{row.modalityName}</TD>
                    <TD>{row.category || "—"}</TD>
                    <TD>
                      <Badge variant={row.status === "Pagada" ? "success" : "warning"}>
                        {row.status}
                      </Badge>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableContainer>
        <Pagination
          pathname={`/admin/eventos/${id}/reporte`}
          currentPage={nominalPage}
          totalPages={Math.max(
            1,
            Math.ceil(report.nominalRows.length / REPORT_PAGE_SIZE)
          )}
          pageParam="nominalPage"
          query={paginationQuery}
          className="mt-4"
        />
      </section>

      {report.athleteFeeRows.length > 0 ? (
        <section>
          <h2 className="mb-1 font-heading text-xl text-fdnda-navy">
            Cuotas por deportista ({report.athleteFeeRows.length})
          </h2>
          <p className="mb-3 text-sm text-fdnda-muted">
            Disciplinas que cobran un monto fijo por deportista para todo el
            evento: sus pruebas figuran en S/ 0 porque el cobro está acá.
            Recaudado por cuotas: {formatMoney(report.totals.athleteFeeRevenue)}.
          </p>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Deportista</TH>
                  <TH>Documento</TH>
                  <TH>Año</TH>
                  <TH>Sexo</TH>
                  <TH>Club</TH>
                  <TH>Disciplina</TH>
                  <TH className="text-right">Cuota</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {athleteFeeRows.map((row, index) => (
                  <TR key={`${row.docNumber}-${row.discipline}-${index}`}>
                    <TD className="font-medium text-fdnda-ink">{row.athleteName}</TD>
                    <TD className="font-mono text-xs">{row.docNumber}</TD>
                    <TD>{row.birthYear}</TD>
                    <TD>{row.sex}</TD>
                    <TD>{row.clubName}</TD>
                    <TD>{disciplineLabel(row.discipline)}</TD>
                    <TD className="text-right font-semibold">{formatMoney(row.fee)}</TD>
                    <TD>
                      <Badge variant={row.status === "Pagada" ? "success" : "warning"}>
                        {row.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
          <Pagination
            pathname={`/admin/eventos/${id}/reporte`}
            currentPage={feePage}
            totalPages={Math.max(
              1,
              Math.ceil(report.athleteFeeRows.length / REPORT_PAGE_SIZE)
            )}
            pageParam="feePage"
            query={paginationQuery}
            className="mt-4"
          />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-heading text-xl text-fdnda-navy">
          Órdenes con inscripciones de este evento
        </h2>
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Club</TH>
                <TH>Fecha</TH>
                <TH className="text-right">Inscripciones</TH>
                <TH className="text-right">Monto (evento)</TH>
                <TH>Proveedor</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {report.orderRows.length === 0 ? (
                <TR>
                  <TD colSpan={7} className="py-8 text-center text-fdnda-muted">
                    Sin órdenes todavía.
                  </TD>
                </TR>
              ) : (
                orderRows.map((order) => {
                  const badge = ORDER_STATUS_BADGE[order.status]
                  return (
                    <TR key={order.code}>
                      <TD className="font-mono text-xs">
                        <span className="flex flex-wrap items-center gap-2">
                          {order.code}
                          {order.isLegacy ? <Badge variant="warning">Legado</Badge> : null}
                        </span>
                      </TD>
                      <TD>{order.clubName}</TD>
                      <TD>{formatDateTimeLima(order.createdAt)}</TD>
                      <TD className="text-right">{order.itemCount}</TD>
                      <TD className="text-right font-semibold">
                        {formatMoney(order.eventAmount)}
                      </TD>
                      <TD>{order.provider || "—"}</TD>
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
          pathname={`/admin/eventos/${id}/reporte`}
          currentPage={orderPage}
          totalPages={Math.max(
            1,
            Math.ceil(report.orderRows.length / REPORT_PAGE_SIZE)
          )}
          pageParam="orderPage"
          query={paginationQuery}
          className="mt-4"
        />
      </section>
      <PrintSheetFooter signatureLabel="Nombre y firma del responsable de la federación" />
    </div>
  )
}
