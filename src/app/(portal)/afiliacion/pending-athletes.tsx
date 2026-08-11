"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ShoppingBag } from "lucide-react"
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
import { cn, formatMoney } from "@/lib/utils"
import { addAffiliationsAction } from "./actions"

export interface PendingAthleteRow {
  athleteId: string
  discipline: DisciplineValue
  fullName: string
  docLabel: string
  birthDateLabel: string
  categoryLabel: string
  fee: number
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

export function PendingAthletes({
  rows,
  seasonYear,
}: {
  rows: PendingAthleteRow[]
  seasonYear: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<DisciplineValue | "ALL">("ALL")

  // Disciplinas presentes en la lista: no se ofrecen filtros vacíos.
  const availableDisciplines = useMemo(
    () => [...new Set(rows.map((row) => row.discipline))],
    [rows]
  )

  const visible = useMemo(
    () => (filter === "ALL" ? rows : rows.filter((row) => row.discipline === filter)),
    [rows, filter]
  )

  const selectable = visible.filter((row) => !row.inCart && !row.awaitingPayment)
  const allSelected =
    selectable.length > 0 && selectable.every((row) => selected.has(keyOf(row)))

  const selectedRows = rows.filter((row) => selected.has(keyOf(row)))
  const selectedTotal = selectedRows.reduce((sum, row) => sum + row.fee, 0)

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
        toast.success(`${count} afiliación(es) agregadas al carrito`, {
          action: {
            label: "Ir al carrito",
            onClick: () => router.push("/afiliacion/carrito"),
          },
        })
        setSelected(new Set())
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      {availableDisciplines.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por disciplina">
          {(["ALL", ...availableDisciplines] as const).map((value) => {
            const active = filter === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors",
                  active
                    ? "bg-fdnda-navy text-white ring-fdnda-navy"
                    : "bg-white text-fdnda-muted ring-fdnda-border hover:text-fdnda-navy"
                )}
              >
                {value === "ALL" ? "Todas" : DISCIPLINES[value].label}
                <span className="num text-xs opacity-70">
                  {value === "ALL"
                    ? rows.length
                    : rows.filter((row) => row.discipline === value).length}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

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
            Seleccionar todas las visibles
          </label>
          <p className="text-sm text-fdnda-muted">
            Seleccionadas: <strong className="num text-fdnda-ink">{selectedRows.length}</strong>{" "}
            · Total <strong className="num text-fdnda-navy">{formatMoney(selectedTotal)}</strong>
          </p>
        </div>
        <Button onClick={handleAdd} loading={isPending} disabled={selectedRows.length === 0}>
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          Agregar al carrito de afiliación
        </Button>
      </div>

      {/* En móvil el checkbox estaba en la primera columna y la cuota en la
          octava: seleccionar obligaba a ir y volver. Aquí el área de selección
          es la tarjeta entera. */}
      <TableCards>
        {visible.map((row) => {
          const badge =
            AFFILIATION_STATE_BADGE[row.state] ?? AFFILIATION_STATE_BADGE.SIN_AFILIAR
          const locked = row.inCart || row.awaitingPayment
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
                    disabled={locked}
                    onChange={() => toggle(row)}
                  />
                  <span>{row.fullName}</span>
                </label>
              }
              subtitle={
                <span className="ml-7 block">
                  {style.short} · <span className="num">{row.docLabel}</span>
                </span>
              }
              badges={
                row.inCart ? (
                  <Badge variant="info">En el carrito</Badge>
                ) : row.awaitingPayment ? (
                  <Badge variant="warning">Orden en curso</Badge>
                ) : (
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                )
              }
            >
              <TableField
                label="F. nacimiento"
                value={<span className="num">{row.birthDateLabel}</span>}
              />
              <TableField label="Categoría" value={row.categoryLabel} />
              <TableField
                label="Situación"
                value={
                  row.previousSeasonYear
                    ? `Reafiliación (última: ${row.previousSeasonYear})`
                    : "Nuevo en el club"
                }
              />
              <TableField
                label={`Cuota ${seasonYear}`}
                value={<span className="num font-semibold">{formatMoney(row.fee)}</span>}
              />
            </TableCard>
          )
        })}
      </TableCards>

      <TableContainer className="hidden md:block">
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
              <TH>Situación</TH>
              <TH className="text-right">Cuota {seasonYear}</TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((row, index) => {
              const badge =
                AFFILIATION_STATE_BADGE[row.state] ?? AFFILIATION_STATE_BADGE.SIN_AFILIAR
              const locked = row.inCart || row.awaitingPayment
              const style = DISCIPLINES[row.discipline]
              const Icon = style.icon

              return (
                <TR key={keyOf(row)}>
                  <TD>
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-fdnda-navy"
                      checked={selected.has(keyOf(row))}
                      disabled={locked}
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
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      {style.short}
                    </span>
                  </TD>
                  <TD className="num text-xs">{row.docLabel}</TD>
                  <TD className="text-xs">{row.birthDateLabel}</TD>
                  <TD className="text-xs">{row.categoryLabel}</TD>
                  <TD>
                    {row.inCart ? (
                      <Badge variant="info">En el carrito</Badge>
                    ) : row.awaitingPayment ? (
                      <Badge variant="warning">Orden en curso</Badge>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <span className="text-xs text-fdnda-muted">
                          {row.previousSeasonYear
                            ? `Reafiliación (última: ${row.previousSeasonYear})`
                            : "Nuevo en el club"}
                        </span>
                      </div>
                    )}
                  </TD>
                  <TD className="text-right font-semibold">{formatMoney(row.fee)}</TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  )
}
