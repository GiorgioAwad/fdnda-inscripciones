import Link from "next/link"
import { redirect } from "next/navigation"
import { BadgeCheck, Clock3, ShoppingBag, Users } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  affiliationState,
  getClubAffiliationPanel,
  getSeasonCategories,
  isSettledState,
  pendingAffiliationRows,
} from "@/lib/affiliations"
import { categoryLabelFor } from "@/lib/categories"
import { DISCIPLINES, disciplineLabel } from "@/lib/disciplines"
import { expireStaleOrders } from "@/lib/orders"
import { cn, formatDateOnly, formatDateTimeLima, formatMoney } from "@/lib/utils"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { EmptyState } from "@/components/empty-state"
import { AffiliateClubButton } from "./affiliate-club-button"
import { PendingAthletes } from "./pending-athletes"
import { disciplineInWhere, explicitDisciplineAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

// Todo lo de afiliar vive acá. Antes la cuota del club estaba en esta página y
// la de los deportistas escondida en /deportistas?tab=por-afiliar: la misma
// tarea repartida en dos pantallas que no se referenciaban entre sí.
const TABS = [
  { id: "club", label: "Club" },
  { id: "deportistas", label: "Deportistas" },
  { id: "historial", label: "Historial" },
] as const

const HISTORY_PAGE_SIZE = 50
const PENDING_PAGE_SIZE = 50

export default async function AfiliacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const { tab, page } = await searchParams
  const activeTab = TABS.some((t) => t.id === tab) ? tab! : "club"
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1))

  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin/afiliaciones")

  await expireStaleOrders()

  const access = explicitDisciplineAccess(user)
  const disciplineWhere = disciplineInWhere(user)
  const panel = await getClubAffiliationPanel(user.clubId, access)

  const athleteHistoryTotal =
    activeTab === "historial"
      ? await prisma.athleteAffiliation.count({
          where: { clubId: user.clubId, ...disciplineWhere },
        })
      : 0
  const historyTotalPages = Math.max(
    1,
    Math.ceil(athleteHistoryTotal / HISTORY_PAGE_SIZE)
  )
  const historyPage = Math.min(requestedPage, historyTotalPages)

  const [categories, clubHistory, athleteHistory] = await Promise.all([
    panel.season ? getSeasonCategories(panel.season.id) : Promise.resolve([]),
    activeTab === "historial"
      ? prisma.clubAffiliation.findMany({
          where: { clubId: user.clubId, ...disciplineWhere },
          include: { season: true },
          orderBy: [{ season: { year: "desc" } }, { discipline: "asc" }],
        })
      : Promise.resolve([]),
    activeTab === "historial"
      ? prisma.athleteAffiliation.findMany({
          where: { clubId: user.clubId, ...disciplineWhere },
          include: { athlete: true, season: true },
          orderBy: [
            { season: { year: "desc" } },
            { discipline: "asc" },
            { athlete: { lastNames: "asc" } },
          ],
          skip: (historyPage - 1) * HISTORY_PAGE_SIZE,
          take: HISTORY_PAGE_SIZE,
        })
      : Promise.resolve([]),
  ])

  const pendingRows = pendingAffiliationRows(panel.athletes)
  const pendingTotalPages = Math.max(
    1,
    Math.ceil(pendingRows.length / PENDING_PAGE_SIZE)
  )
  const pendingPage = Math.min(requestedPage, pendingTotalPages)
  const visiblePendingRows = pendingRows.slice(
    (pendingPage - 1) * PENDING_PAGE_SIZE,
    pendingPage * PENDING_PAGE_SIZE
  )

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BadgeCheck}
        eyebrow="Afiliación"
        title="Estado de afiliación"
        description={
          panel.season
            ? `Cuota anual por disciplina de la ${panel.season.name.toLowerCase()}. Habilita al club y a sus deportistas para competir.`
            : "La federación aún no habilitó la temporada de afiliaciones."
        }
        actions={
          <Link href="/afiliacion/carrito">
            <Button variant="outline">
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              Ir al carrito
            </Button>
          </Link>
        }
      />

      <nav
        aria-label="Secciones de afiliación"
        className="flex flex-wrap gap-1 border-b border-fdnda-border"
      >
        {TABS.map((item) => {
          const active = item.id === activeTab
          const count = item.id === "deportistas" ? pendingRows.length : 0

          return (
            <Link
              key={item.id}
              href={`/afiliacion?tab=${item.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors",
                active
                  ? "border-fdnda-navy text-fdnda-navy"
                  : "border-transparent text-fdnda-muted hover:border-fdnda-sky hover:text-fdnda-navy"
              )}
            >
              {item.label}
              {count > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-fdnda-red px-1.5 text-[11px] font-bold tabular-nums text-white">
                  {count}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

      {!panel.season ? (
        <Card>
          <EmptyState icon={Clock3} title="Temporada no habilitada">
            La federación todavía no abrió la temporada de afiliaciones. Vuelve a
            consultar pronto.
          </EmptyState>
        </Card>
      ) : activeTab === "club" ? (
        panel.disciplines.length === 0 ? (
          <Card>
            <EmptyState icon={Clock3} title="Sin disciplinas habilitadas">
              La federación aún no fijó las cuotas {panel.season.year}.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {panel.disciplines.map((row) => {
              const style = DISCIPLINES[row.discipline]
              const Icon = style.icon
              const badge = AFFILIATION_STATE_BADGE[row.clubState]
              const settled = isSettledState(row.clubState)

              return (
                <Card key={row.discipline} className="flex flex-col overflow-hidden">
                  <CardHeader className="flex-row items-center justify-between gap-3 border-b border-fdnda-border py-4">
                    <CardTitle className="flex items-center gap-2">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-control text-white ${style.chip}`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      {style.label}
                    </CardTitle>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col gap-3 pt-4 text-sm">
                    <dl className="space-y-2">
                      <div className="flex justify-between gap-3">
                        <dt className="text-fdnda-muted">Cuota del club</dt>
                        <dd className="font-semibold text-fdnda-ink">
                          {row.fee ? formatMoney(row.clubFee ?? row.fee.clubFee) : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-fdnda-muted">Cuota por deportista</dt>
                        <dd className="font-semibold text-fdnda-ink">
                          {row.fee ? formatMoney(row.fee.athleteFee) : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-fdnda-muted">Vigencia</dt>
                        <dd className="font-semibold text-fdnda-ink">
                          {row.clubValidFrom && row.clubValidTo
                            ? `${formatDateOnly(row.clubValidFrom)} – ${formatDateOnly(row.clubValidTo)}`
                            : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-fdnda-muted">Deportistas vigentes</dt>
                        <dd className="font-bold tabular-nums text-fdnda-navy">
                          {row.counts.active} / {row.counts.total}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-auto pt-1">
                      {!row.fee ? (
                        <p className="rounded-surface bg-fdnda-surface px-3 py-2 text-xs text-fdnda-muted">
                          La federación no fijó la cuota {panel.season!.year} de esta
                          disciplina.
                        </p>
                      ) : row.clubAwaitingPayment ? (
                        <Link href="/pagos">
                          <Button variant="outline" className="w-full sm:w-auto">
                            Orden en curso · completar pago
                          </Button>
                        </Link>
                      ) : row.clubInCart ? (
                        <Link href="/afiliacion/carrito">
                          <Button variant="outline" className="w-full sm:w-auto">
                            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                            En el carrito
                          </Button>
                        </Link>
                      ) : settled ? (
                        <p className="flex items-center gap-2 rounded-surface bg-fdnda-turquoise-soft px-3 py-2 text-xs font-semibold text-fdnda-navy">
                          <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Club habilitado
                          {row.clubPaidAt
                            ? ` · pagada el ${formatDateTimeLima(row.clubPaidAt)}`
                            : ""}
                        </p>
                      ) : (
                        <AffiliateClubButton
                          year={panel.season!.year}
                          discipline={row.discipline}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )
      ) : null}

      {panel.season && activeTab === "deportistas" ? (
        pendingRows.length === 0 ? (
          <Card>
            <EmptyState icon={Users} title="Todos tus deportistas están al día">
              No hay afiliaciones pendientes para la temporada vigente.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            <PendingAthletes
              seasonYear={panel.season.year}
              rows={visiblePendingRows.map((row) => ({
                athleteId: row.athleteId,
                discipline: row.discipline,
                fullName: `${row.lastNames}, ${row.firstNames}`,
                docLabel: `${row.docType} ${row.docNumber}`,
                birthDateLabel: formatDateOnly(row.birthDate),
                categoryLabel: categoryLabelFor(
                  categories,
                  row.birthDate,
                  row.discipline
                ),
                fee: panel.fees.get(row.discipline)?.athleteFee ?? 0,
                state: row.state,
                inCart: row.inCart,
                awaitingPayment: row.awaitingPayment,
                previousSeasonYear: row.previousSeasonYear,
              }))}
            />
            <Pagination
              pathname="/afiliacion"
              currentPage={pendingPage}
              totalPages={pendingTotalPages}
              query={{ tab: "deportistas" }}
            />
          </div>
        )
      ) : null}

      {panel.season && activeTab === "historial" ? (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-extrabold tracking-tight text-fdnda-navy">
              Cuotas del club
            </h2>
            {clubHistory.length === 0 ? (
              <Card>
                <EmptyState icon={BadgeCheck} title="Sin afiliaciones registradas">
                  Aquí verás el historial de cuotas anuales del club por disciplina.
                </EmptyState>
              </Card>
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>Temporada</TH>
                      <TH>Disciplina</TH>
                      <TH>Vigencia</TH>
                      <TH className="text-right">Cuota</TH>
                      <TH>Pago</TH>
                      <TH>Estado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {clubHistory.map((row) => {
                      const badge = AFFILIATION_STATE_BADGE[affiliationState(row)]
                      return (
                        <TR key={row.id}>
                          <TD className="font-bold text-fdnda-ink">{row.season.name}</TD>
                          <TD className="text-xs">{disciplineLabel(row.discipline)}</TD>
                          <TD className="text-xs">
                            {formatDateOnly(row.validFrom)} – {formatDateOnly(row.validTo)}
                          </TD>
                          <TD className="text-right font-semibold">
                            {formatMoney(row.fee)}
                          </TD>
                          <TD className="text-xs">
                            {row.paidAt ? formatDateTimeLima(row.paidAt) : "—"}
                          </TD>
                          <TD>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            )}
            <Pagination
              pathname="/afiliacion"
              currentPage={historyPage}
              totalPages={historyTotalPages}
              query={{ tab: "historial" }}
              className="mt-4"
            />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-extrabold tracking-tight text-fdnda-navy">
              Cuotas de deportistas
            </h2>
            {athleteHistory.length === 0 ? (
              <Card>
                <EmptyState icon={Users} title="Sin historial de afiliaciones">
                  Aquí verás las afiliaciones de tus deportistas por temporada.
                </EmptyState>
              </Card>
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>Temporada</TH>
                      <TH>Disciplina</TH>
                      <TH>Deportista</TH>
                      <TH>Documento</TH>
                      <TH>Vigencia</TH>
                      <TH className="text-right">Cuota</TH>
                      <TH>Estado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {athleteHistory.map((row) => {
                      const badge = AFFILIATION_STATE_BADGE[affiliationState(row)]
                      return (
                        <TR key={row.id}>
                          <TD className="font-bold text-fdnda-ink">{row.season.name}</TD>
                          <TD className="text-xs">{disciplineLabel(row.discipline)}</TD>
                          <TD>
                            {row.athlete.lastNames}, {row.athlete.firstNames}
                          </TD>
                          <TD className="font-mono text-xs">
                            {row.athlete.docType} {row.athlete.docNumber}
                          </TD>
                          <TD className="text-xs">
                            {formatDateOnly(row.validFrom)} – {formatDateOnly(row.validTo)}
                          </TD>
                          <TD className="text-right font-semibold">
                            {formatMoney(row.fee)}
                          </TD>
                          <TD>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
