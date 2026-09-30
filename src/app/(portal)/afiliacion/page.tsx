import Link from "next/link"
import { redirect } from "next/navigation"
import { BadgeCheck, Clock3, CreditCard, ShoppingBag, Users } from "lucide-react"
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
import {
  DISCIPLINES,
  DISCIPLINE_VALUES,
  disciplineLabel,
  isDiscipline,
  type DisciplineValue,
} from "@/lib/disciplines"
import { expireStaleOrders } from "@/lib/orders"
import { cn, formatDateOnly, formatDateTimeLima, formatMoney } from "@/lib/utils"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { DisciplineIcon } from "@/components/discipline-icon"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { EmptyState } from "@/components/empty-state"
import { AddAthleteDialog } from "../deportistas/add-athlete-dialog"
import { AffiliateClubButton } from "./affiliate-club-button"
import { PendingAthletes } from "./pending-athletes"
import {
  canAccessDiscipline,
  disciplineInWhere,
  explicitDisciplineAccess,
  isClubCoordinator,
} from "@/lib/club-access"

export const dynamic = "force-dynamic"

// Todo lo de afiliar vive acá. Antes la cuota del club estaba en esta página y
// la de los deportistas escondida en /deportistas?tab=por-afiliar: la misma
// tarea repartida en dos pantallas que no se referenciaban entre sí.
const TABS = [
  { id: "club", label: "Cuota del club" },
  { id: "deportistas", label: "Deportistas por afiliar" },
  { id: "historial", label: "Historial" },
] as const

const HISTORY_PAGE_SIZE = 50
const PENDING_PAGE_SIZE = 50

export default async function AfiliacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; disciplina?: string }>
}) {
  const { tab, page, disciplina } = await searchParams
  const activeTab = TABS.some((t) => t.id === tab) ? tab! : "club"
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1))

  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin/afiliaciones")

  await expireStaleOrders()

  const access = explicitDisciplineAccess(user)
  const disciplineWhere = disciplineInWhere(user)
  const panel = await getClubAffiliationPanel(user.clubId, access)
  const registrableDisciplines: DisciplineValue[] = isClubCoordinator(user)
    ? [...DISCIPLINE_VALUES]
    : DISCIPLINE_VALUES.filter((value) => canAccessDiscipline(user, value))

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
  // Lo que el club todavía puede agregar al carrito: el mismo criterio que el
  // globo del menú (sin carrito, sin orden viva y con cuota fijada).
  const actionablePending = pendingRows.filter(
    (row) => !row.inCart && !row.awaitingPayment && panel.fees.has(row.discipline)
  ).length
  const cartCount =
    panel.disciplines.filter((row) => row.clubInCart).length +
    pendingRows.filter((row) => row.inCart).length

  // Filtro por disciplina en la URL: se aplica antes de paginar para que los
  // conteos de los filtros y las páginas hablen de la misma lista.
  const pendingDisciplines = DISCIPLINE_VALUES.filter((value) =>
    pendingRows.some((row) => row.discipline === value)
  )
  const pendingFilter: DisciplineValue | null =
    isDiscipline(disciplina) && pendingDisciplines.includes(disciplina) ? disciplina : null
  const filteredPending = pendingFilter
    ? pendingRows.filter((row) => row.discipline === pendingFilter)
    : pendingRows
  const pendingTotalPages = Math.max(
    1,
    Math.ceil(filteredPending.length / PENDING_PAGE_SIZE)
  )
  const pendingPage = Math.min(requestedPage, pendingTotalPages)
  const visiblePendingRows = filteredPending.slice(
    (pendingPage - 1) * PENDING_PAGE_SIZE,
    pendingPage * PENDING_PAGE_SIZE
  )

  // Disciplinas que el club puede afiliar ahora mismo: con cuota, sin afiliación
  // vigente y sin estar ya en el carrito o en una orden.
  const clubAffiliable = panel.disciplines.filter(
    (row) =>
      row.fee !== null &&
      !isSettledState(row.clubState) &&
      !row.clubInCart &&
      !row.clubAwaitingPayment
  )
  const clubAffiliableTotal = clubAffiliable.reduce(
    (sum, row) => sum + (row.fee?.clubFee ?? 0),
    0
  )

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BadgeCheck}
        title="Estado de afiliación"
        description={
          panel.season
            ? `Cuota anual por disciplina de la ${panel.season.name.toLowerCase()}. Sin afiliación vigente, ni el club ni sus deportistas pueden inscribirse en competencias de esa disciplina.`
            : undefined
        }
        actions={
          cartCount > 0 ? (
            <Link
              href="/afiliacion/carrito"
              className={buttonClasses({ variant: "outline" })}
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              Pagar carrito ({cartCount})
            </Link>
          ) : null
        }
      />

      <nav
        aria-label="Secciones de afiliación"
        className="flex flex-wrap gap-1 border-b border-fdnda-border"
      >
        {TABS.map((item) => {
          const active = item.id === activeTab
          const count = item.id === "deportistas" ? actionablePending : 0

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
                <span className="num flex h-5 min-w-5 items-center justify-center rounded-full bg-fdnda-red px-1.5 text-[11px] font-bold text-white">
                  {count}
                  <span className="sr-only"> por afiliar</span>
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

      {!panel.season && activeTab !== "historial" ? (
        <Card>
          <EmptyState
            icon={Clock3}
            title="La temporada de afiliación aún no abre"
            action={
              <Link href="/deportistas" className={buttonClasses()}>
                <Users className="h-4 w-4" aria-hidden="true" />
                Registrar deportistas
              </Link>
            }
          >
            Sin temporada abierta no se puede pagar ninguna afiliación. Mientras
            tanto, puedes registrar a tus deportistas en el padrón.
          </EmptyState>
        </Card>
      ) : null}

      {panel.season && activeTab === "club" ? (
        panel.disciplines.length === 0 ? (
          <Card>
            <EmptyState icon={Clock3} title={`Cuotas ${panel.season.year} sin fijar`}>
              La FDNDA aún no fija las cuotas de afiliación {panel.season.year}. Hasta
              entonces no se puede afiliar al club en ninguna disciplina.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            {clubAffiliable.length >= 2 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-fdnda-border bg-white px-4 py-3">
                <p className="text-sm text-fdnda-muted">
                  Tu club no está afiliado en{" "}
                  <strong className="text-fdnda-ink">
                    {clubAffiliable
                      .map((row) => DISCIPLINES[row.discipline].label)
                      .join(", ")}
                  </strong>
                  . Total{" "}
                  <strong className="num text-fdnda-navy">
                    {formatMoney(clubAffiliableTotal)}
                  </strong>
                  .
                </p>
                <AffiliateClubButton
                  year={panel.season.year}
                  disciplines={clubAffiliable.map((row) => row.discipline)}
                  label={`Afiliar al club en las ${clubAffiliable.length} disciplinas`}
                />
              </div>
            ) : null}

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {panel.disciplines.map((row) => {
                const style = DISCIPLINES[row.discipline]
                const badge = AFFILIATION_STATE_BADGE[row.clubState]
                const settled = isSettledState(row.clubState)

                return (
                  <Card key={row.discipline} className="flex flex-col overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between gap-3 border-b border-fdnda-border py-4">
                      <h2 className="font-heading flex items-center gap-2 text-lg font-bold tracking-tight text-fdnda-navy">
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-control text-white ${style.chip}`}
                        >
                          <DisciplineIcon
                            discipline={row.discipline}
                            tone="light"
                            className="h-4 w-4"
                          />
                        </span>
                        {style.label}
                      </h2>
                      {row.clubInCart ? (
                        <Badge variant="info">En el carrito</Badge>
                      ) : row.clubAwaitingPayment ? (
                        <Badge variant="warning">Orden por pagar</Badge>
                      ) : (
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      )}
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col gap-3 pt-4 text-sm">
                      <dl className="space-y-2">
                        <div className="flex justify-between gap-3">
                          <dt className="text-fdnda-muted">Cuota de afiliación del club</dt>
                          <dd className="font-semibold text-fdnda-ink">
                            {row.fee ? formatMoney(row.clubFee ?? row.fee.clubFee) : "—"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-fdnda-muted">Cuota de afiliación por deportista</dt>
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
                          <dd className="num font-bold text-fdnda-navy">
                            {row.counts.active} / {row.counts.total}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-auto pt-1">
                        {!row.fee ? (
                          <p className="rounded-surface bg-fdnda-surface px-3 py-2 text-xs text-fdnda-muted">
                            {settled
                              ? "Tu club ya está afiliado. La cuota de esta disciplina aún no está fijada."
                              : "La FDNDA aún no fija la cuota de esta disciplina. No se puede afiliar hasta entonces."}
                          </p>
                        ) : row.clubAwaitingPayment ? (
                          <Link
                            href={
                              row.clubActiveOrderId
                                ? `/pago/${row.clubActiveOrderId}`
                                : "/pagos?tipo=afiliacion"
                            }
                            className={buttonClasses({ className: "w-full sm:w-auto" })}
                          >
                            <CreditCard className="h-4 w-4" aria-hidden="true" />
                            Pagar orden
                          </Link>
                        ) : row.clubInCart ? (
                          <Link
                            href="/afiliacion/carrito"
                            className={buttonClasses({
                              variant: "outline",
                              className: "w-full sm:w-auto",
                            })}
                          >
                            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                            Pagar en el carrito
                          </Link>
                        ) : settled ? (
                          <p className="flex items-center gap-2 rounded-surface bg-fdnda-turquoise-soft px-3 py-2 text-xs font-semibold text-fdnda-navy">
                            <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {row.clubPaidAt
                              ? `Afiliación pagada el ${formatDateTimeLima(row.clubPaidAt)}`
                              : "Afiliación vigente"}
                          </p>
                        ) : (
                          <AffiliateClubButton
                            year={panel.season!.year}
                            disciplines={[row.discipline]}
                            label="Agregar cuota del club al carrito"
                            variant={clubAffiliable.length >= 2 ? "outline" : "default"}
                          />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      ) : null}

      {panel.season && activeTab === "deportistas" ? (
        panel.athletes.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="Aún no tienes deportistas en el padrón"
              action={<AddAthleteDialog disciplineAccess={registrableDisciplines} />}
            >
              Regístralos primero con su número de documento. Al registrarlos, la
              cuota de afiliación de cada disciplina que practican entra al carrito,
              si la FDNDA ya la fijó.
            </EmptyState>
          </Card>
        ) : pendingRows.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="Todos tus deportistas están afiliados"
              action={
                <Link href="/inscripciones/nueva" className={buttonClasses()}>
                  Inscribir en una competencia
                </Link>
              }
            >
              Tienen su afiliación {panel.season.year} vigente en todas las
              disciplinas que practican.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            {pendingDisciplines.length > 1 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por disciplina">
                {[null, ...pendingDisciplines].map((value) => {
                  const active = pendingFilter === value
                  const count = value
                    ? pendingRows.filter((row) => row.discipline === value).length
                    : pendingRows.length
                  return (
                    <Link
                      key={value ?? "all"}
                      href={
                        value
                          ? `/afiliacion?tab=deportistas&disciplina=${value}`
                          : "/afiliacion?tab=deportistas"
                      }
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors",
                        active
                          ? "bg-fdnda-navy text-white ring-fdnda-navy"
                          : "bg-white text-fdnda-muted ring-fdnda-border hover:text-fdnda-navy"
                      )}
                    >
                      {value ? DISCIPLINES[value].label : "Todas"}
                      <span className="num text-xs opacity-70">{count}</span>
                    </Link>
                  )
                })}
              </div>
            ) : null}
            <PendingAthletes
              key={`${pendingFilter ?? "all"}-${pendingPage}`}
              seasonYear={panel.season.year}
              multiPage={pendingTotalPages > 1}
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
                fee: panel.fees.get(row.discipline)?.athleteFee ?? null,
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
              query={{ tab: "deportistas", disciplina: pendingFilter }}
            />
          </div>
        )
      ) : null}

      {activeTab === "historial" ? (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-extrabold tracking-tight text-fdnda-navy">
              Afiliaciones del club
            </h2>
            {clubHistory.length === 0 ? (
              <Card>
                <EmptyState icon={BadgeCheck} title="Tu club aún no tiene afiliaciones">
                  Aquí aparecerá cada afiliación del club por temporada y disciplina,
                  con su fecha de pago.
                </EmptyState>
              </Card>
            ) : (
              <TableContainer aria-label="Historial de afiliaciones del club">
                <Table>
                  <THead>
                    <TR>
                      <TH>Temporada</TH>
                      <TH>Disciplina</TH>
                      <TH>Vigencia</TH>
                      <TH className="text-right">Cuota</TH>
                      <TH>Pagada el</TH>
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
          </section>

          <section>
            <h2 className="mb-3 text-lg font-extrabold tracking-tight text-fdnda-navy">
              Afiliaciones de deportistas
            </h2>
            {athleteHistory.length === 0 ? (
              <Card>
                <EmptyState icon={Users} title="Tus deportistas aún no tienen afiliaciones">
                  Aquí aparecerá la afiliación de cada deportista por temporada y
                  disciplina.
                </EmptyState>
              </Card>
            ) : (
              <TableContainer aria-label="Historial de afiliaciones de deportistas">
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
                          <TD className="num text-xs">
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
            <Pagination
              pathname="/afiliacion"
              currentPage={historyPage}
              totalPages={historyTotalPages}
              query={{ tab: "historial" }}
              className="mt-4"
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}
