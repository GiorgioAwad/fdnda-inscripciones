import Link from "next/link"
import { notFound } from "next/navigation"
import { BarChart3, Download } from "lucide-react"
import { getEventReport } from "@/lib/event-report"
import { expireStaleOrders } from "@/lib/orders"
import { formatDateTimeLima, formatMoney } from "@/lib/utils"
import { buttonClasses } from "@/components/ui/button"
import { Badge, ORDER_STATUS_BADGE } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Pagination } from "@/components/pagination"
import { PageHeader } from "@/components/page-header"
import { PrintButton } from "@/components/print-button"
import { PrintSheetFooter, PrintSheetHeader } from "@/components/print-sheet"
import { disciplineLabel } from "@/lib/disciplines"

export const dynamic = "force-dynamic"

const REPORT_PAGE_SIZE = 50

const SECTION_TITLE = "mb-1 font-heading text-xl text-fdnda-navy"
const SECTION_HELP = "mb-3 text-sm leading-6 text-fdnda-muted"

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

  const pageCount = (total: number) => Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE))
  const pageFor = (value: string | undefined, total: number) =>
    Math.min(Math.max(1, Math.trunc(Number(value) || 1)), pageCount(total))
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
  // Imprimir saca la página que se ve: si algún listado tiene más de una, el
  // papel no trae todas las filas y hay que decirlo antes de firmarlo.
  const isPaginated = [
    report.nominalRows.length,
    report.athleteFeeRows.length,
    report.orderRows.length,
  ].some((total) => pageCount(total) > 1)
  const generatedAt = formatDateTimeLima(new Date())
  const eventHref = `/admin/eventos/${id}`

  // Qué decir cuando todavía no hay nada: depende de si los clubes pueden
  // inscribir. En borrador o cerrada nadie la ve, y el camino es la competencia.
  const notVisible = report.event.status !== "OPEN"
  const notVisibleText =
    report.event.status === "DRAFT"
      ? "La competencia está en borrador y los clubes todavía no la ven."
      : "Las inscripciones de esta competencia están cerradas."

  const summary: Array<{ label: string; value: string }> = [
    { label: "Inscripciones pagadas", value: String(report.totals.paidRegistrations) },
    { label: "Inscripciones por pagar", value: String(report.totals.pendingRegistrations) },
    {
      label: "Deportistas con inscripción pagada",
      value: String(report.totals.distinctAthletes),
    },
    { label: "Recaudado", value: formatMoney(report.totals.revenue) },
  ]

  return (
    <div className="print-landscape space-y-6">
      <PrintSheetHeader
        title="Reporte de inscripciones"
        eventName={report.event.name}
        disciplines={report.event.disciplines}
        meta={[
          ...summary,
          { label: "Datos al", value: generatedAt },
        ]}
      />

      <PageHeader
        className="print-hidden"
        back={{ href: eventHref, label: "Volver a la competencia" }}
        icon={BarChart3}
        lanes={report.event.disciplines}
        title={report.event.name}
        description={`Reporte de inscripciones pagadas y por pagar, cuotas de competencia y órdenes. Datos al ${generatedAt}.`}
        actions={
          <div className="print-hidden flex flex-col items-start gap-1.5 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <PrintButton label={isPaginated ? "Imprimir esta página" : "Imprimir reporte"} />
              <a
                href={`/api/admin/eventos/${id}/export`}
                download
                className={buttonClasses()}
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Descargar Excel del reporte
              </a>
            </div>
            {isPaginated ? (
              <p className="max-w-sm text-xs leading-5 text-fdnda-muted sm:text-right">
                Se imprimen solo las filas visibles de cada listado. El Excel trae
                todas.
              </p>
            ) : null}
          </div>
        }
      />

      <section aria-label="Totales de la competencia" className="print-hidden">
        <Card className="p-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            {summary.map((row) => (
              <div key={row.label}>
                <dt className="text-sm font-semibold text-fdnda-muted">{row.label}</dt>
                <dd className="num mt-0.5 text-lg font-semibold text-fdnda-ink">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section>
        <h2 className={SECTION_TITLE}>Resumen por prueba</h2>
        <p className={SECTION_HELP}>Pagadas y por pagar de cada prueba, con lo recaudado.</p>
        <TableContainer aria-label="Resumen por prueba">
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
              {report.modalityRows.length === 0 ? (
                <TR>
                  <TD colSpan={9} className="py-8 text-center text-fdnda-muted">
                    Esta competencia no tiene pruebas.{" "}
                    <Link
                      href={eventHref}
                      className="print-hidden font-semibold text-fdnda-turquoise-deep underline underline-offset-4"
                    >
                      Agregar pruebas a la competencia
                    </Link>
                  </TD>
                </TR>
              ) : (
                report.modalityRows.map((row) => (
                  <TR key={row.modalityId}>
                    <TD className="text-xs">{disciplineLabel(row.discipline)}</TD>
                    <TD className="font-medium text-fdnda-ink">{row.name}</TD>
                    <TD>{row.category || "Sin categoría"}</TD>
                    <TD>{row.sexLabel}</TD>
                    <TD className="text-right">{formatMoney(row.price)}</TD>
                    <TD className="text-right font-semibold text-fdnda-success">
                      {row.paidCount}
                    </TD>
                    <TD className="text-right text-fdnda-warning">{row.pendingCount}</TD>
                    <TD className="text-right">{row.athleteCount}</TD>
                    <TD className="text-right font-semibold">{formatMoney(row.revenue)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableContainer>
      </section>

      <section>
        <h2 className={SECTION_TITLE}>Inscripciones pagadas por club</h2>
        <p className={SECTION_HELP}>Solo cuenta lo pagado.</p>
        <TableContainer aria-label="Inscripciones pagadas por club">
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
                    {notVisible
                      ? `Todavía no hay inscripciones pagadas. ${notVisibleText}`
                      : "Todavía no hay inscripciones pagadas: aparecen aquí cuando un club paga su orden."}
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
        <h2 className={SECTION_TITLE}>Listado nominal</h2>
        <p className={SECTION_HELP}>
          Una fila por deportista y prueba, pagadas y por pagar ({report.nominalRows.length}{" "}
          en total).
        </p>
        <TableContainer aria-label="Listado nominal de inscripciones">
          <Table>
            <THead>
              <TR>
                <TH>Deportista</TH>
                <TH>N.º de documento</TH>
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
                    {notVisible ? (
                      <>
                        Todavía no hay inscripciones. {notVisibleText}{" "}
                        <Link
                          href={eventHref}
                          className="print-hidden font-semibold text-fdnda-turquoise-deep underline underline-offset-4"
                        >
                          Revisar requisitos para abrir inscripciones
                        </Link>
                      </>
                    ) : (
                      "Todavía no hay inscripciones: aparecen aquí cuando un club genera la orden de su planilla."
                    )}
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
                    <TD className="num text-xs">{row.docNumber}</TD>
                    <TD>{row.birthYear}</TD>
                    <TD>{row.sex}</TD>
                    <TD>{row.clubName}</TD>
                    <TD>{row.modalityName}</TD>
                    <TD>{row.category || "Sin categoría"}</TD>
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
          totalPages={pageCount(report.nominalRows.length)}
          pageParam="nominalPage"
          query={paginationQuery}
          className="mt-4"
        />
      </section>

      {report.athleteFeeRows.length > 0 ? (
        <section>
          <h2 className={SECTION_TITLE}>Cuotas de competencia por deportista</h2>
          <p className={SECTION_HELP}>
            Disciplinas que cobran un monto fijo por deportista para toda la
            competencia: sus pruebas figuran en S/ 0 porque el cobro está aquí.
            Recaudado por cuotas: {formatMoney(report.totals.athleteFeeRevenue)} (
            {report.athleteFeeRows.length} en total).
          </p>
          <TableContainer aria-label="Cuotas de competencia por deportista">
            <Table>
              <THead>
                <TR>
                  <TH>Deportista</TH>
                  <TH>N.º de documento</TH>
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
                    <TD className="num text-xs">{row.docNumber}</TD>
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
            totalPages={pageCount(report.athleteFeeRows.length)}
            pageParam="feePage"
            query={paginationQuery}
            className="mt-4"
          />
        </section>
      ) : null}

      <section>
        <h2 className={SECTION_TITLE}>Órdenes de esta competencia</h2>
        <p className={SECTION_HELP}>
          El monto es solo la parte de cada orden que corresponde a esta competencia.
        </p>
        <TableContainer aria-label="Órdenes de esta competencia">
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Club</TH>
                <TH>Fecha</TH>
                <TH className="text-right">Inscripciones</TH>
                <TH className="text-right">Monto de esta competencia</TH>
                <TH>Proveedor de pago</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {report.orderRows.length === 0 ? (
                <TR>
                  <TD colSpan={7} className="py-8 text-center text-fdnda-muted">
                    Todavía no hay órdenes: se crean cuando un club genera la orden de
                    su planilla.
                  </TD>
                </TR>
              ) : (
                orderRows.map((order) => {
                  const badge = ORDER_STATUS_BADGE[order.status]
                  return (
                    <TR key={order.code}>
                      <TD className="num text-xs">
                        <span className="flex flex-wrap items-center gap-2">
                          {order.code}
                          {/* Órdenes históricas que mezclan competencias: se
                              conservan sin dividir (schema.prisma, Order.isLegacy). */}
                          {order.isLegacy ? (
                            <Badge variant="warning">Incluye otras competencias</Badge>
                          ) : null}
                        </span>
                      </TD>
                      <TD>{order.clubName}</TD>
                      <TD>{formatDateTimeLima(order.createdAt)}</TD>
                      <TD className="text-right">{order.itemCount}</TD>
                      <TD className="text-right font-semibold">
                        {formatMoney(order.eventAmount)}
                      </TD>
                      <TD>{order.provider || "Sin proveedor"}</TD>
                      <TD>
                        <Badge variant={badge?.variant ?? "neutral"}>
                          {badge?.label ?? order.status}
                        </Badge>
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
          totalPages={pageCount(report.orderRows.length)}
          pageParam="orderPage"
          query={paginationQuery}
          className="mt-4"
        />
      </section>
      <PrintSheetFooter signatureLabel="Nombre y firma del responsable de la federación" />
    </div>
  )
}
