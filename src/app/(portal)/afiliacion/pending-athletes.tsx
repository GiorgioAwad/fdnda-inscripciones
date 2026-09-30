"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ShoppingBag } from "lucide-react"
import { DisciplineIcon } from "@/components/discipline-icon"
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
import { formatMoney, plural } from "@/lib/utils"
import { addAffiliationsAction } from "./actions"

export interface PendingAthleteRow {
  athleteId: string
  discipline: DisciplineValue
  fullName: string
  docLabel: string
  birthDateLabel: string
  categoryLabel: string
  // null = la FDNDA todavía no fijó la cuota de esa disciplina: no se puede
  // agregar al carrito (addAffiliationsToCart lo rechazaría).
  fee: number | null
  state: string
  inCart: boolean
  awaitingPayment: boolean
  previousSeasonYear: number | null
}

// Cada fila es un par (deportista, disciplina): con cuota por disciplina, un
// mismo deportista puede estar al día en polo y deber la de clavados.
function keyOf(row: { athleteId: string; discipline: DisciplineValue }): string {
  return `${row.athleteId}:${row.discipline}`
}

function isLocked(row: PendingAthleteRow): boolean {
  return row.inCart || row.awaitingPayment || row.fee === null
}

function historyLabel(row: PendingAthleteRow): string {
  return row.previousSeasonYear
    ? `Reafiliación · última en ${row.previousSeasonYear}`
    : "Primera afiliación con tu club"
}

// Estado que se muestra: el carrito y la orden mandan sobre el estado base.
function StateBadge({ row, seasonYear }: { row: PendingAthleteRow; seasonYear: number }) {
  if (row.inCart) return <Badge variant="info">En el carrito</Badge>
  if (row.awaitingPayment) return <Badge variant="warning">Orden por pagar</Badge>
  if (row.fee === null) return <Badge variant="neutral">Sin cuota {seasonYear}</Badge>
  const badge = AFFILIATION_STATE_BADGE[row.state] ?? AFFILIATION_STATE_BADGE.SIN_AFILIAR
  return <Badge variant={badge.variant}>{badge.label}</Badge>
}

export function PendingAthletes({
  rows,
  seasonYear,
  multiPage,
}: {
  rows: PendingAthleteRow[]
  seasonYear: number
  // Con varias páginas la selección solo alcanza a la página visible.
  multiPage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const selectable = rows.filter((row) => !isLocked(row))
  const allSelected =
    selectable.length > 0 && selectable.every((row) => selected.has(keyOf(row)))

  const selectedRows = rows.filter((row) => selected.has(keyOf(row)))
  const selectedTotal = selectedRows.reduce((sum, row) => sum + (row.fee ?? 0), 0)

  const toggle = (row: PendingAthleteRow) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const key = keyOf(row)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const row of selectable) next.delete(keyOf(row))
      } else {
        for (const row of selectable) next.add(keyOf(row))
      }
      return next
    })
  }

  const handleAdd = () => {
    const count = selectedRows.length
    startTransition(async () => {
      const result = await addAffiliationsAction({
        athletes: selectedRows.map((row) => ({
          athleteId: row.athleteId,
          discipline: row.discipline,
        })),
      })
      if (result.success) {
        const added = result.added ?? count
        toast.success(
          added === 1
            ? "1 afiliación agregada al carrito"
            : `${added} afiliaciones agregadas al carrito`,
          {
            action: {
              label: "Pagar carrito",
              onClick: () => router.push("/afiliacion/carrito"),
            },
          }
        )
        setSelected(new Set())
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const selectAllLabel = multiPage
    ? `Seleccionar las ${selectable.length} de esta página`
    : `Seleccionar todas (${selectable.length})`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-fdnda-border bg-fdnda-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* «Seleccionar todas» vive aquí y no en la cabecera de la tabla: en
              móvil la tabla se sustituye por tarjetas, y el control tiene que
              existir una sola vez en la página, no uno por vista. */}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-fdnda-ink">
            <input
              type="checkbox"
              className="h-5 w-5 accent-fdnda-navy"
              checked={allSelected}
              disabled={selectable.length === 0}
              onChange={toggleAll}
            />
            {selectAllLabel}
          </label>
          <p className="text-sm text-fdnda-muted" aria-live="polite">
            {selectedRows.length === 0 ? (
              "Ninguna seleccionada"
            ) : (
              <>
                <strong className="num text-fdnda-ink">
                  {plural(selectedRows.length, "seleccionada", "seleccionadas")}
                </strong>{" "}
                · Total <strong className="num text-fdnda-navy">{formatMoney(selectedTotal)}</strong>
              </>
            )}
          </p>
        </div>
        <Button onClick={handleAdd} loading={isPending} disabled={selectedRows.length === 0}>
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          {selectedRows.length === 0
            ? "Agregar al carrito"
            : `Agregar ${plural(selectedRows.length, "afiliación", "afiliaciones")} al carrito`}
        </Button>
      </div>

      {/* En móvil el checkbox estaba en la primera columna y la cuota en la
          octava: seleccionar obligaba a ir y volver. Aquí el área de selección
          es la tarjeta entera. */}
      <TableCards>
        {rows.map((row) => {
          const style = DISCIPLINES[row.discipline]

          return (
            <TableCard
              key={keyOf(row)}
              lanes={[row.discipline]}
              title={
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-fdnda-navy"
                    checked={selected.has(keyOf(row))}
                    disabled={isLocked(row)}
                    onChange={() => toggle(row)}
                    aria-label={`Seleccionar ${style.label} de ${row.fullName}`}
                  />
                  <span>{row.fullName}</span>
                </label>
              }
              subtitle={
                <span className="ml-7 block">
                  {style.short} · <span className="num">{row.docLabel}</span>
                </span>
              }
              badges={<StateBadge row={row} seasonYear={seasonYear} />}
            >
              <TableField
                label="F. nacimiento"
                value={<span className="num">{row.birthDateLabel}</span>}
              />
              <TableField label="Categoría" value={row.categoryLabel} />
              <TableField label="Situación" value={historyLabel(row)} />
              <TableField
                label={`Cuota ${seasonYear}`}
                value={
                  <span className="num font-semibold">
                    {row.fee === null ? "Sin fijar" : formatMoney(row.fee)}
                  </span>
                }
              />
            </TableCard>
          )
        })}
      </TableCards>

      <TableContainer className="hidden md:block" aria-label="Deportistas por afiliar">
        <Table>
          <THead>
            <TR>
              <TH className="w-12">
                <span className="sr-only">Seleccionar</span>
              </TH>
              <TH>Deportista</TH>
              <TH>Disciplina</TH>
              <TH>Documento</TH>
              <TH>F. nacimiento</TH>
              <TH>Categoría</TH>
              <TH>Estado</TH>
              <TH className="text-right">Cuota {seasonYear}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row, index) => {
              const style = DISCIPLINES[row.discipline]

              return (
                <TR key={keyOf(row)}>
                  <TD>
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-fdnda-navy"
                      checked={selected.has(keyOf(row))}
                      disabled={isLocked(row)}
                      onChange={() => toggle(row)}
                      aria-label={`Seleccionar ${style.label} de ${row.fullName}`}
                    />
                  </TD>
                  <TD className="font-bold text-fdnda-ink">
                    <span className="num mr-2 text-xs font-normal text-fdnda-muted">
                      {index + 1}
                    </span>
                    {row.fullName}
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-fdnda-ink">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-control text-white ${style.chip}`}
                      >
                        <DisciplineIcon
                          discipline={row.discipline}
                          tone="light"
                          className="h-3.5 w-3.5"
                        />
                      </span>
                      {style.short}
                    </span>
                  </TD>
                  <TD className="num text-xs">{row.docLabel}</TD>
                  <TD className="text-xs">{row.birthDateLabel}</TD>
                  <TD className="text-xs">{row.categoryLabel}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <StateBadge row={row} seasonYear={seasonYear} />
                      <span className="text-xs text-fdnda-muted">{historyLabel(row)}</span>
                    </div>
                  </TD>
                  <TD className="text-right font-semibold">
                    {row.fee === null ? (
                      <span className="text-xs font-normal text-fdnda-muted">Sin fijar</span>
                    ) : (
                      formatMoney(row.fee)
                    )}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  )
}
