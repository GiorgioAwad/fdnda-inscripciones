"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BadgeCheck, Users } from "lucide-react"
import { DisciplineIcon } from "@/components/discipline-icon"
import { Button } from "@/components/ui/button"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Table,
  TableCard,
  TableCards,
  TableContainer,
  TableField,
  stickyCell,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table"
import { DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { formatDateOnly, formatMoney, plural } from "@/lib/utils"
import { registerExternalClubPayment } from "./actions"

// Lo que haría falta para registrar un pago recibido fuera de la pasarela.
// null = no se puede (ya está pagada, venció o la temporada no tiene cuota).
export interface ExternalPayment {
  fee: number
  validToISO: string
  // Orden por pagar del club que ya incluye esta afiliación.
  orderCode: string | null
}

export interface ClubDisciplineView {
  discipline: DisciplineValue
  affiliationId: string | null
  clubState: string
  fee: number | null
  validToISO: string | null
  athletesTotal: number
  athletesActive: number
  athletesPending: number
  athletesExpiredOrMissing: number
  payment: ExternalPayment | null
}

export interface ClubAffiliationRow {
  clubId: string
  clubName: string
  clubCode: string
  isActive: boolean
  athletesTotal: number
  disciplines: ClubDisciplineView[]
}

interface PaymentTarget {
  clubId: string
  clubName: string
  discipline: DisciplineValue
  payment: ExternalPayment
}

function settledState(state: string) {
  return state === "ACTIVA" || state === "POR_VENCER"
}

// Qué mostrar en lugar del botón cuando no hay pago que registrar.
function noPaymentNote(entry: ClubDisciplineView): string | null {
  if (settledState(entry.clubState)) return null
  if (entry.clubState === "VENCIDA") return "Vigencia terminada"
  return "Sin cuota fijada en la temporada"
}

function ClubName({ row }: { row: ClubAffiliationRow }) {
  return (
    <>
      <p className="font-bold text-fdnda-ink">{row.clubName}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-fdnda-muted">
        <span className="num">{row.clubCode}</span>
        {row.isActive ? null : <Badge variant="danger">Desactivado</Badge>}
      </p>
    </>
  )
}

function PadronLink({ row }: { row: ClubAffiliationRow }) {
  return (
    <Link
      href={`/admin/padron?club=${row.clubId}`}
      aria-label={`Padrón de ${row.clubName}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-fdnda-navy hover:bg-fdnda-sky/25"
    >
      <Users className="h-4 w-4" aria-hidden="true" />
      Padrón
    </Link>
  )
}

// Con cuota por disciplina, la unidad de gestión ya no es el club sino el par
// (club, disciplina): un club puede estar al día en polo y deber clavados.
export function ClubsAffiliationTable({
  rows,
  seasonName,
}: {
  rows: ClubAffiliationRow[]
  seasonName: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [target, setTarget] = useState<PaymentTarget | null>(null)

  const handleRegister = () => {
    if (!target) return
    const label = DISCIPLINES[target.discipline].label
    startTransition(async () => {
      const result = await registerExternalClubPayment({
        clubId: target.clubId,
        discipline: target.discipline,
      })
      if (result.success) {
        toast.success(
          `Pago de ${label} de ${target.clubName} registrado: afiliación vigente hasta el ${formatDateOnly(
            result.validToISO ?? target.payment.validToISO
          )}.`
        )
        setTarget(null)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const paymentButton = (
    row: ClubAffiliationRow,
    entry: ClubDisciplineView,
    className?: string
  ) => {
    if (entry.payment) {
      const payment = entry.payment
      return (
        <Button
          size="sm"
          variant="outline"
          className={className}
          disabled={isPending}
          aria-label={`Registrar pago externo de ${DISCIPLINES[entry.discipline].label} de ${row.clubName}`}
          onClick={() =>
            setTarget({
              clubId: row.clubId,
              clubName: row.clubName,
              discipline: entry.discipline,
              payment,
            })
          }
        >
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          <span className="whitespace-nowrap">Registrar pago externo</span>
        </Button>
      )
    }
    const note = noPaymentNote(entry)
    return note ? <span className="text-xs text-fdnda-muted">{note}</span> : null
  }

  return (
    <>
      {/* En móvil la tabla se sustituye por tarjetas: con diez columnas y un
          ancho mínimo de 1.024px, un teléfono de 390px obligaba a recorrer dos
          pantallas y media para llegar a las acciones. Aquí la unidad es el
          club, no el par club-disciplina. */}
      <TableCards>
        {rows.map((row) => (
          <TableCard
            key={row.clubId}
            lanes={row.disciplines.map((entry) => entry.discipline)}
            title={row.clubName}
            subtitle={<span className="num">{row.clubCode}</span>}
            badges={row.isActive ? null : <Badge variant="danger">Desactivado</Badge>}
            actions={<PadronLink row={row} />}
          >
            {row.disciplines.length === 0 ? (
              <TableField
                wide
                label="Disciplinas"
                value="Sin disciplinas habilitadas en la temporada vigente."
              />
            ) : (
              row.disciplines.map((entry) => {
                const badge =
                  AFFILIATION_STATE_BADGE[entry.clubState] ??
                  AFFILIATION_STATE_BADGE.SIN_AFILIAR
                const style = DISCIPLINES[entry.discipline]

                return (
                  <div
                    key={`${row.clubId}-${entry.discipline}`}
                    className="col-span-2 rounded-control border border-fdnda-border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fdnda-ink">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-chip text-white ${style.chip}`}
                        >
                          <DisciplineIcon
                            discipline={entry.discipline}
                            tone="light"
                            className="h-3.5 w-3.5"
                          />
                        </span>
                        {style.short}
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                      <TableField
                        label="Vigencia hasta"
                        value={
                          entry.validToISO ? (
                            <span className="num">
                              {formatDateOnly(entry.validToISO)}
                            </span>
                          ) : (
                            "—"
                          )
                        }
                      />
                      <TableField
                        label="Cuota del club"
                        value={
                          entry.fee === null ? (
                            "—"
                          ) : (
                            <span className="num">{formatMoney(entry.fee)}</span>
                          )
                        }
                      />
                      <TableField
                        label="Deportistas vigentes"
                        value={
                          <span className="num">
                            {entry.athletesActive} de {entry.athletesTotal}
                          </span>
                        }
                      />
                      <TableField
                        label="Pendientes de pago"
                        value={
                          <span
                            className={`num ${entry.athletesPending > 0 ? "font-bold text-fdnda-warning" : ""}`}
                          >
                            {entry.athletesPending}
                          </span>
                        }
                      />
                    </div>
                    <div className="mt-3">
                      {paymentButton(row, entry, "w-full")}
                    </div>
                  </div>
                )
              })
            )}
          </TableCard>
        ))}
      </TableCards>

      <TableContainer
        className="hidden md:block"
        aria-label="Afiliaciones por club y disciplina"
      >
        {/* Cinco columnas y no diez: vigencia y cuota viven con el estado del
            club, y los tres conteos de deportistas en una sola celda. A 1280 px
            la versión de diez columnas escondía las acciones. */}
        <Table className="min-w-[48rem]">
        <THead>
          <TR>
            <TH>Club</TH>
            <TH>Disciplina</TH>
            <TH>Afiliación del club</TH>
            <TH>Deportistas vigentes</TH>
            <TH className={`text-right ${stickyCell.head}`}>Acciones</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) =>
            row.disciplines.length === 0 ? (
              <TR key={row.clubId}>
                <TD>
                  <ClubName row={row} />
                </TD>
                <TD colSpan={3} className="text-xs text-fdnda-muted">
                  Sin disciplinas habilitadas en la temporada vigente.
                </TD>
                <TD className={stickyCell.cell}>
                  <div className="flex justify-end">
                    <PadronLink row={row} />
                  </div>
                </TD>
              </TR>
            ) : (
              row.disciplines.map((entry, index) => {
                const badge =
                  AFFILIATION_STATE_BADGE[entry.clubState] ??
                  AFFILIATION_STATE_BADGE.SIN_AFILIAR
                const style = DISCIPLINES[entry.discipline]
                const first = index === 0

                return (
                  <TR
                    key={`${row.clubId}-${entry.discipline}`}
                    // Solo la primera fila del club lleva borde superior marcado:
                    // agrupa visualmente sin necesidad de rowspan.
                    className={first ? "border-t-2 border-fdnda-border" : undefined}
                  >
                    <TD>{first ? <ClubName row={row} /> : null}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fdnda-ink">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-control text-white ${style.chip}`}
                        >
                          <DisciplineIcon
                            discipline={entry.discipline}
                            tone="light"
                            className="h-3.5 w-3.5"
                          />
                        </span>
                        {style.short}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {/* Cuota y vigencia existen solo cuando hay afiliación; sin
                          ella la insignia «Sin afiliar» ya lo dice todo. */}
                      {entry.fee !== null || entry.validToISO ? (
                        <p className="mt-1 whitespace-nowrap text-xs text-fdnda-muted">
                          {[
                            entry.fee === null ? null : `Cuota ${formatMoney(entry.fee)}`,
                            entry.validToISO
                              ? `hasta ${formatDateOnly(entry.validToISO)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </TD>
                    <TD>
                      <p className="whitespace-nowrap">
                        <span className="num font-bold text-fdnda-navy">
                          {entry.athletesActive}
                        </span>{" "}
                        <span className="text-xs text-fdnda-muted">
                          de <span className="num">{entry.athletesTotal}</span>
                        </span>
                      </p>
                      {entry.athletesPending > 0 ? (
                        <p className="text-xs font-semibold text-fdnda-warning">
                          {plural(entry.athletesPending, "pendiente de pago", "pendientes de pago")}
                        </p>
                      ) : null}
                      {entry.athletesExpiredOrMissing > 0 ? (
                        <p className="text-xs font-semibold text-fdnda-danger">
                          {plural(
                            entry.athletesExpiredOrMissing,
                            "vencido o sin afiliar",
                            "vencidos o sin afiliar"
                          )}
                        </p>
                      ) : null}
                    </TD>
                    <TD className={stickyCell.cell}>
                      {/* Apiladas, no en línea: «Padrón» es del club y el pago
                          es de la disciplina, así que no son hermanas. */}
                      <div className="flex flex-col items-end gap-1">
                        {first ? <PadronLink row={row} /> : null}
                        {paymentButton(row, entry)}
                      </div>
                    </TD>
                  </TR>
                )
              })
            )
          )}
        </TBody>
      </Table>
      </TableContainer>

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={
          target
            ? `¿Registrar el pago de ${DISCIPLINES[target.discipline].label} de ${target.clubName}?`
            : ""
        }
        consequence={
          target ? (
            <>
              <p>
                Cuota del club:{" "}
                <span className="num font-semibold">{formatMoney(target.payment.fee)}</span>{" "}
                · {seasonName}.
              </p>
              <p className="mt-2">
                Úsalo solo para depósitos recibidos fuera de Izipay. La afiliación de{" "}
                {target.clubName} en {DISCIPLINES[target.discipline].label} quedará
                vigente hasta el {formatDateOnly(target.payment.validToISO)} y no se puede
                deshacer desde el panel. Queda registrado quién lo hizo.
              </p>
              {target.payment.orderCode ? (
                <p className="mt-2 rounded-control border border-fdnda-warning-ring bg-fdnda-warning-soft px-3 py-2 font-semibold text-fdnda-warning">
                  Esta afiliación está en la orden {target.payment.orderCode}, que el club
                  todavía no paga. Si registras el pago aquí y el club paga después esa
                  orden, pagará dos veces.
                </p>
              ) : null}
            </>
          ) : null
        }
        confirmLabel="Registrar pago"
        pending={isPending}
        onConfirm={handleRegister}
      />
    </>
  )
}
