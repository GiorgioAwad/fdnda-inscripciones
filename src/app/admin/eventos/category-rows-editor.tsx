"use client"

import { useRef, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { birthYearForMaxAge, type AgeRuleModeValue } from "@/lib/event-pricing"
import { leagueTotalMatches } from "@/lib/league"
import { plural } from "@/lib/utils"

// Un solo editor de categorías para los dos caminos que crean pruebas: el alta
// de la competencia y «Generar pruebas en lote». Antes el alta usaba filas con
// los años obligatorios y el generador pedía texto «Nombre|desde|hasta» con los
// años opcionales y un cuarto campo oculto para los varones: el mismo concepto
// con dos reglas distintas.
//
// El servidor sigue recibiendo el mismo texto de siempre (parseCategorySpecs en
// lib/event-categories), que arma `categoryRowsToText`. Así la regla de
// elegibilidad no cambia y solo cambia cómo se escribe.

export interface CategoryRowDraft {
  id: number
  label: string
  birthYearFrom: string
  birthYearTo: string
  maleBirthYearFrom: string
  /** Muestra el campo «Varones nacidos desde» aunque todavía esté vacío. */
  showMaleYear: boolean
  maxAgeYears: string
  isOpen: boolean
  expectedFemaleTeams: string
  expectedMaleTeams: string
}

function emptyCategoryRow(id: number): CategoryRowDraft {
  return {
    id,
    label: "",
    birthYearFrom: "",
    birthYearTo: "",
    maleBirthYearFrom: "",
    showMaleYear: false,
    maxAgeYears: "",
    isOpen: false,
    expectedFemaleTeams: "3",
    expectedMaleTeams: "3",
  }
}

export function useCategoryRows(initialCount = 1) {
  const nextId = useRef(initialCount)
  const [rows, setRows] = useState<CategoryRowDraft[]>(() =>
    Array.from({ length: initialCount }, (_, index) => emptyCategoryRow(index))
  )

  return {
    rows,
    add() {
      const id = nextId.current
      nextId.current += 1
      setRows((current) => [...current, emptyCategoryRow(id)])
    },
    remove(id: number) {
      setRows((current) => current.filter((row) => row.id !== id))
    },
    update(id: number, patch: Partial<CategoryRowDraft>) {
      setRows((current) =>
        current.map((row) => (row.id === id ? { ...row, ...patch } : row))
      )
    },
    /** Vuelve a una sola fila vacía (al cambiar de disciplina). */
    reset() {
      const id = nextId.current
      nextId.current += 1
      setRows([emptyCategoryRow(id)])
    },
  }
}

/** Las filas que el servidor recibe: una fila sin nombre no es una categoría. */
export function filledCategoryRows(rows: readonly CategoryRowDraft[]) {
  return rows.filter((row) => row.label.trim())
}

/**
 * Cuántas categorías salen de las filas. En rango de años, sin filas se crea
 * una sola versión de cada prueba sin categoría (parseCategorySpecs con texto
 * vacío); en Sub-N hace falta al menos una.
 */
export function categoryCount(
  rows: readonly CategoryRowDraft[],
  ageRuleMode: AgeRuleModeValue
): number {
  const filled = filledCategoryRows(rows).length
  return ageRuleMode === "MAX_AGE_ONLY" ? filled : Math.max(1, filled)
}

/** El texto que interpreta parseCategorySpecs, una categoría por línea. */
export function categoryRowsToText(
  rows: readonly CategoryRowDraft[],
  ageRuleMode: AgeRuleModeValue
): string {
  // «|» separa campos en ese formato: dentro de un nombre partiría la línea.
  const clean = (label: string) => label.trim().replace(/\|/g, "/")
  return filledCategoryRows(rows)
    .map((row) =>
      ageRuleMode === "MAX_AGE_ONLY"
        ? `${clean(row.label)}|${row.isOpen ? "OPEN" : row.maxAgeYears.trim()}`
        : [
            clean(row.label),
            row.birthYearFrom.trim(),
            row.birthYearTo.trim(),
            ...(row.maleBirthYearFrom.trim() ? [row.maleBirthYearFrom.trim()] : []),
          ].join("|")
    )
    .join("\n")
}

/**
 * Qué admite un rango de años, en palabras. Lo usa también el editor de
 * categorías por nivel del campeonato de niveles.
 */
export function birthYearRangeSummary(
  fromText: string,
  toText: string,
  maleFromText = ""
): string {
  const from = fromText.trim()
  const to = toText.trim()
  const male = maleFromText.trim()
  const base =
    from && to
      ? `Admite nacidos de ${from} a ${to}.`
      : from
        ? `Admite nacidos en ${from} o después.`
        : to
          ? `Admite nacidos en ${to} o antes.`
          : "Sin límite de edad."
  if (!male) return base
  return to
    ? `${base} Varones: nacidos de ${male} a ${to}.`
    : `${base} Varones: nacidos en ${male} o después.`
}

function maxAgeSummary(row: CategoryRowDraft, seasonYear: number | null): string {
  if (row.isOpen) return "Open: sin límite de edad."
  const age = Number(row.maxAgeYears)
  if (!Number.isInteger(age) || age < 1) return "Escribe la edad máxima o marca Open."
  if (seasonYear === null) {
    return `Sub-${age}: asigna una temporada para calcular el año de nacimiento.`
  }
  return `Sub-${age} en la temporada ${seasonYear}: admite nacidos en ${birthYearForMaxAge(seasonYear, age)} o después.`
}

const REMOVE_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center rounded-control text-fdnda-red-deep transition-colors hover:bg-fdnda-red-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-red/30"

export function CategoryRowsEditor({
  idPrefix,
  rows,
  onAdd,
  onRemove,
  onUpdate,
  ageRuleMode,
  seasonYear,
  namePlaceholder,
  allowMaleYear,
  league,
}: {
  idPrefix: string
  rows: readonly CategoryRowDraft[]
  onAdd: () => void
  onRemove: (id: number) => void
  onUpdate: (id: number, patch: Partial<CategoryRowDraft>) => void
  ageRuleMode: AgeRuleModeValue
  seasonYear: number | null
  namePlaceholder: string
  /** Solo Natación Artística: las bases dan a los varones un año más en algunas categorías. */
  allowMaleYear: boolean
  /** En una liga cada categoría declara cuántos planteles espera por sexo. */
  league?: { matchesPerTeam: number } | null
}) {
  const maxAge = ageRuleMode === "MAX_AGE_ONLY"

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-fdnda-ink">Categorías</legend>
      <p className="mt-1 text-xs leading-5 text-fdnda-muted">
        {maxAge
          ? "Una fila por categoría, con su edad máxima o como Open."
          : "Una fila por categoría. Deja un año vacío para no poner tope de ese lado."}
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-control border border-dashed border-fdnda-border px-3 py-2.5 text-sm text-fdnda-muted">
          {maxAge
            ? "Agrega al menos una categoría: en Sub-N u Open cada prueba necesita su edad máxima."
            : "Sin categorías: cada prueba se crea una sola vez, sin límite de edad."}
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {rows.map((row, index) => {
          const name = row.label.trim() || `${index + 1}`
          return (
            <div
              key={row.id}
              className="rounded-control border border-fdnda-border bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-fdnda-muted">
                  Categoría {index + 1}
                </p>
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  className={REMOVE_BUTTON}
                  aria-label={`Quitar la categoría ${name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div
                className={`grid gap-3 ${
                  maxAge
                    ? "sm:grid-cols-[minmax(12rem,1.35fr)_minmax(10rem,1fr)]"
                    : "sm:grid-cols-[minmax(12rem,1.35fr)_repeat(2,minmax(8rem,1fr))]"
                }`}
              >
                <div>
                  <Label htmlFor={`${idPrefix}-label-${row.id}`}>Nombre de la categoría</Label>
                  <Input
                    id={`${idPrefix}-label-${row.id}`}
                    value={row.label}
                    onChange={(event) => onUpdate(row.id, { label: event.target.value })}
                    placeholder={maxAge ? "Sub-16" : namePlaceholder}
                    maxLength={80}
                    required
                  />
                </div>

                {maxAge ? (
                  <div>
                    <Label htmlFor={`${idPrefix}-age-${row.id}`}>Edad máxima</Label>
                    <Input
                      id={`${idPrefix}-age-${row.id}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      value={row.maxAgeYears}
                      onChange={(event) =>
                        onUpdate(row.id, { maxAgeYears: event.target.value })
                      }
                      placeholder={row.isOpen ? "Sin límite" : "15"}
                      disabled={row.isOpen}
                      required={!row.isOpen}
                    />
                    <label className="mt-2 flex min-h-8 items-center gap-2 text-sm text-fdnda-ink">
                      <input
                        type="checkbox"
                        checked={row.isOpen}
                        onChange={(event) =>
                          onUpdate(row.id, {
                            isOpen: event.target.checked,
                            maxAgeYears: event.target.checked ? "" : row.maxAgeYears,
                          })
                        }
                        className="h-4 w-4 accent-fdnda-turquoise-deep"
                      />
                      Categoría Open, sin límite de edad
                    </label>
                  </div>
                ) : (
                  <>
                    <div>
                      <Label htmlFor={`${idPrefix}-from-${row.id}`}>Nacidos desde</Label>
                      <Input
                        id={`${idPrefix}-from-${row.id}`}
                        type="number"
                        inputMode="numeric"
                        min={1950}
                        max={row.birthYearTo || 2050}
                        value={row.birthYearFrom}
                        onChange={(event) =>
                          onUpdate(row.id, { birthYearFrom: event.target.value })
                        }
                        placeholder="Sin tope"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`${idPrefix}-to-${row.id}`}>Nacidos hasta</Label>
                      <Input
                        id={`${idPrefix}-to-${row.id}`}
                        type="number"
                        inputMode="numeric"
                        min={row.birthYearFrom || 1950}
                        max={2050}
                        value={row.birthYearTo}
                        onChange={(event) =>
                          onUpdate(row.id, { birthYearTo: event.target.value })
                        }
                        placeholder="Sin tope"
                      />
                    </div>
                  </>
                )}
              </div>

              {!maxAge && allowMaleYear ? (
                row.showMaleYear || row.maleBirthYearFrom ? (
                  <div className="mt-3 max-w-xs">
                    <Label htmlFor={`${idPrefix}-male-${row.id}`}>
                      Varones nacidos desde
                    </Label>
                    <Input
                      id={`${idPrefix}-male-${row.id}`}
                      type="number"
                      inputMode="numeric"
                      min={1950}
                      max={row.birthYearTo || 2050}
                      value={row.maleBirthYearFrom}
                      onChange={(event) =>
                        onUpdate(row.id, { maleBirthYearFrom: event.target.value })
                      }
                      placeholder="Igual que damas"
                    />
                    <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                      Para las categorías en que las bases dan a los varones un año
                      más, como Juvenil y Junior.
                    </p>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => onUpdate(row.id, { showMaleYear: true })}
                    aria-label={`Agregar un año distinto para varones en la categoría ${name}`}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Año distinto para varones
                  </Button>
                )
              ) : null}

              <p className="mt-2 text-xs leading-5 text-fdnda-muted">
                {maxAge
                  ? maxAgeSummary(row, seasonYear)
                  : birthYearRangeSummary(
                      row.birthYearFrom,
                      row.birthYearTo,
                      row.maleBirthYearFrom
                    )}
              </p>

              {league ? (
                <div className="mt-3 grid gap-3 border-t border-fdnda-border pt-3 sm:grid-cols-2">
                  {(
                    [
                      ["expectedFemaleTeams", "Damas"],
                      ["expectedMaleTeams", "Varones"],
                    ] as const
                  ).map(([field, sexLabel]) => (
                    <div key={field}>
                      <Label htmlFor={`${idPrefix}-${field}-${row.id}`}>
                        Planteles esperados · {sexLabel}
                      </Label>
                      <Input
                        id={`${idPrefix}-${field}-${row.id}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={40}
                        value={row[field]}
                        onChange={(event) =>
                          onUpdate(row.id, { [field]: event.target.value })
                        }
                        required
                      />
                      <p className="mt-1 text-xs text-fdnda-muted">
                        {plural(
                          leagueTotalMatches({
                            expectedTeams: Number(row[field]) || 0,
                            matchesPerTeam: league.matchesPerTeam,
                          }),
                          "partido",
                          "partidos"
                        )}{" "}
                        en la fase preliminar
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Agregar categoría
      </Button>
    </fieldset>
  )
}
