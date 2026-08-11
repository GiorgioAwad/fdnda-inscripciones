"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BadgeCheck, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import {
  Table,
  TableCard,
  TableCards,
  TableContainer,
  TableField,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table"
import { DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { formatDateOnly, formatMoney } from "@/lib/utils"
import { createPendingClubAffiliation, markAffiliationPaid } from "./actions"

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
}

export interface ClubAffiliationRow {
  clubId: string
  clubName: string
  clubCode: string
  athletesTotal: number
  disciplines: ClubDisciplineView[]
}

// Con cuota por disciplina, la unidad de gestión ya no es el club sino el par
// (club, disciplina): un club puede estar al día en polo y deber clavados.
export function ClubsAffiliationTable({ rows }: { rows: ClubAffiliationRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleMarkPaid = (row: ClubAffiliationRow, entry: ClubDisciplineView) => {
    const label = DISCIPLINES[entry.discipline].label

    startTransition(async () => {
      // Sin registro de afiliación todavía: se genera y se marca en dos pasos.
      if (!entry.affiliationId) {
        const created = await createPendingClubAffiliation(row.clubId, entry.discipline)
        if (!created.success) {
          toast.error(created.error)
          return
        }
        toast.success(
          `Cuota de ${label} generada para ${row.clubName}. Vuelve a marcarla como pagada.`
        )
        router.refresh()
        return
      }

      const result = await markAffiliationPaid({
        kind: "CLUB",
        affiliationId: entry.affiliationId,
      })
      if (result.success) {
        toast.success(`${label} de ${row.clubName} registrada como pagada`)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
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
            actions={
              <Link
                href={`/admin/padron?club=${row.clubId}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-fdnda-navy hover:bg-fdnda-sky/25"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Padrón
              </Link>
            }
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
                const settled =
                  entry.clubState === "ACTIVA" || entry.clubState === "POR_VENCER"
                const style = DISCIPLINES[entry.discipline]
                const Icon = style.icon

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
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        {style.short}
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                      <TableField
                        label="Vigencia"
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
                        label="Cuota"
                        value={
                          entry.fee === null ? (
                            "—"
                          ) : (
                            <span className="num">{formatMoney(entry.fee)}</span>
                          )
                        }
                      />
                      <TableField
                        label="Deportistas"
                        value={
                          <span className="num">
                            {entry.athletesActive}/{entry.athletesTotal}
                          </span>
                        }
                      />
                      <TableField
                        label="Por regularizar"
                        value={
                          <span
                            className={`num ${entry.athletesPending > 0 ? "font-bold text-fdnda-warning" : ""}`}
                          >
                            {entry.athletesPending}
                          </span>
                        }
                      />
                    </div>
                    {settled ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 w-full"
                        disabled={isPending}
                        onClick={() => handleMarkPaid(row, entry)}
                      >
                        <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                        {entry.affiliationId ? "Marcar pagada" : "Generar cuota"}
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </TableCard>
        ))}
      </TableCards>

      <TableContainer className="hidden md:block">
        <Table className="min-w-[64rem]">
        <THead>
          <TR>
            <TH>Club</TH>
            <TH>Disciplina</TH>
            <TH>Afiliación del club</TH>
            <TH>Vigencia</TH>
            <TH className="text-right">Cuota</TH>
            <TH className="text-right">Deportistas</TH>
            <TH className="text-right">Activas</TH>
            <TH className="text-right">Pendientes</TH>
            <TH className="text-right">Sin vigencia</TH>
            <TH className="text-right">Acciones</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) =>
            row.disciplines.length === 0 ? (
              <TR key={row.clubId}>
                <TD>
                  <p className="font-bold text-fdnda-ink">{row.clubName}</p>
                  <p className="num text-xs text-fdnda-muted">{row.clubCode}</p>
                </TD>
                <TD colSpan={8} className="text-xs text-fdnda-muted">
                  Sin disciplinas habilitadas en la temporada vigente.
                </TD>
                <TD>
                  <div className="flex justify-end">
                    <Link
                      href={`/admin/padron?club=${row.clubId}`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-fdnda-navy hover:bg-fdnda-sky/25"
                    >
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Padrón
                    </Link>
                  </div>
                </TD>
              </TR>
            ) : (
              row.disciplines.map((entry, index) => {
                const badge =
                  AFFILIATION_STATE_BADGE[entry.clubState] ??
                  AFFILIATION_STATE_BADGE.SIN_AFILIAR
                const settled =
                  entry.clubState === "ACTIVA" || entry.clubState === "POR_VENCER"
                const style = DISCIPLINES[entry.discipline]
                const Icon = style.icon
                const first = index === 0

                return (
                  <TR
                    key={`${row.clubId}-${entry.discipline}`}
                    // Solo la primera fila del club lleva borde superior marcado:
                    // agrupa visualmente sin necesidad de rowspan.
                    className={first ? "border-t-2 border-fdnda-border" : undefined}
                  >
                    <TD>
                      {first ? (
                        <>
                          <p className="font-bold text-fdnda-ink">{row.clubName}</p>
                          <p className="num text-xs text-fdnda-muted">
                            {row.clubCode}
                          </p>
                        </>
                      ) : null}
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fdnda-ink">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-control text-white ${style.chip}`}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        {style.short}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TD>
                    <TD className="text-xs">
                      {entry.validToISO ? formatDateOnly(entry.validToISO) : "—"}
                    </TD>
                    <TD className="text-right font-semibold">
                      {entry.fee === null ? "—" : formatMoney(entry.fee)}
                    </TD>
                    <TD className="num text-right">{entry.athletesTotal}</TD>
                    <TD className="num text-right font-bold text-fdnda-navy">
                      {entry.athletesActive}
                    </TD>
                    <TD className="num text-right">
                      {entry.athletesPending > 0 ? (
                        <span className="font-bold text-fdnda-warning">
                          {entry.athletesPending}
                        </span>
                      ) : (
                        "0"
                      )}
                    </TD>
                    <TD className="num text-right">
                      {entry.athletesExpiredOrMissing > 0 ? (
                        <span className="font-bold text-fdnda-red">
                          {entry.athletesExpiredOrMissing}
                        </span>
                      ) : (
                        "0"
                      )}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {first ? (
                          <Link
                            href={`/admin/padron?club=${row.clubId}`}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-fdnda-navy hover:bg-fdnda-sky/25"
                          >
                            <Users className="h-4 w-4" aria-hidden="true" />
                            Padrón
                          </Link>
                        ) : null}
                        {settled ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => handleMarkPaid(row, entry)}
                          >
                            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                            {entry.affiliationId ? "Marcar pagada" : "Generar cuota"}
                          </Button>
                        )}
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
    </>
  )
}
