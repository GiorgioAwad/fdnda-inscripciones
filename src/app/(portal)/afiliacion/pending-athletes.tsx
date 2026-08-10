"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
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
                <span className="text-xs tabular-nums opacity-70">
                  {value === "ALL"
                    ? rows.length
                    : rows.filter((row) => row.discipline === value).length}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-fdnda-surface px-4 py-3">
        <p className="text-sm text-fdnda-muted">
          Seleccionadas: <strong className="text-fdnda-ink">{selectedRows.length}</strong> ·
          Total <strong className="text-fdnda-navy">{formatMoney(selectedTotal)}</strong>
        </p>
        <Button onClick={handleAdd} loading={isPending} disabled={selectedRows.length === 0}>
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          Agregar al carrito de afiliación
        </Button>
      </div>

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH className="w-12">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-fdnda-navy"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                  aria-label="Seleccionar todas las afiliaciones visibles"
                />
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
                    <span className="mr-2 text-xs font-normal tabular-nums text-fdnda-muted">
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
                  <TD className="font-mono text-xs">{row.docLabel}</TD>
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
