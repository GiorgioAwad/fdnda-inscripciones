"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Layers, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
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
import {
  ARTISTIC_LEVEL_LABELS,
  ARTISTIC_LEVEL_VALUES,
  stripLevelPrefix,
} from "@/lib/artistic-levels"
import { DISCIPLINE_VALUES, DISCIPLINES } from "@/lib/disciplines"
import {
  birthYearForMaxAge,
  disciplineConfigFor,
  maxAgeForBirthYear,
  type EventDisciplineConfigLike,
} from "@/lib/event-pricing"
import { leaguePriceBreakdown, leagueTotalMatches } from "@/lib/league"
import { formatMoney, SEX_RULE_LABELS } from "@/lib/utils"
import {
  bulkGenerateModalities,
  deleteModality,
  saveModality,
  setEventStatus,
  toggleModalityActive,
} from "../actions"

export interface ModalityRow {
  id: string
  discipline: string
  disciplineLabel: string
  name: string
  category: string
  /** Nivel del campeonato de niveles de artística. null fuera de ese formato. */
  level: string | null
  sexRule: string
  birthYearFrom: number | null
  birthYearTo: number | null
  allowsCategoryUpgrade: boolean
  categoryUpgradeBirthYear: number | null
  minAthletes: number
  maxAthletes: number
  price: number
  pricePerMatch: number | null
  matchesPerTeam: number | null
  expectedTeams: number | null
  capacity: number | null
  isActive: boolean
  totalRegistrations: number
  paidRegistrations: number
}

interface SeasonCategoryOption {
  id: string
  discipline: string
  name: string
  birthYearFrom: number | null
  birthYearTo: number | null
  sortOrder: number
}

export function EventStatusControls({
  eventId,
  status,
}: {
  eventId: string
  status: string
}) {
  const [isPending, startTransition] = useTransition()

  const change = (next: "DRAFT" | "OPEN" | "CLOSED") => {
    startTransition(async () => {
      const result = await setEventStatus(eventId, next)
      if (result.success) {
        toast.success(
          next === "OPEN"
            ? "Inscripciones abiertas"
            : next === "CLOSED"
              ? "Evento cerrado"
              : "Evento en borrador"
        )
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      {status !== "OPEN" ? (
        <Button onClick={() => change("OPEN")} disabled={isPending}>
          Abrir inscripciones
        </Button>
      ) : null}
      {status === "OPEN" ? (
        <Button variant="destructive" onClick={() => change("CLOSED")} disabled={isPending}>
          Cerrar inscripciones
        </Button>
      ) : null}
      {status === "CLOSED" ? (
        <Button variant="ghost" onClick={() => change("DRAFT")} disabled={isPending}>
          Volver a borrador
        </Button>
      ) : null}
    </>
  )
}

function yearRangeLabel(
  from: number | null,
  to: number | null,
  options: { ageRuleMode: string; seasonYear: number | null } = {
    ageRuleMode: "RANGE",
    seasonYear: null,
  }
): string {
  // En «Sub-N» el piso de año es la forma de expresar el tope de edad, así que
  // se muestra como "Sub 18 · 2009 o después" en vez de "desde 2009".
  if (
    options.ageRuleMode === "MAX_AGE_ONLY" &&
    from !== null &&
    to === null &&
    options.seasonYear !== null
  ) {
    return `Sub ${maxAgeForBirthYear(options.seasonYear, from)} · ${from} o después`
  }
  if (from === null && to === null) return "Sin límite"
  if (from !== null && to !== null) return `${from} – ${to}`
  if (from !== null) return `desde ${from}`
  return `hasta ${to}`
}

function teamSizeLabel(min: number, max: number): string {
  return min === max ? `${min}` : `${min}–${max}`
}

export function ModalitiesManager({
  eventId,
  isLeague,
  isLevelChampionship,
  eventDisciplines,
  disciplineConfigs,
  seasonCategories,
  seasonYear,
  modalities,
}: {
  eventId: string
  isLeague: boolean
  isLevelChampionship: boolean
  eventDisciplines: string[]
  disciplineConfigs: EventDisciplineConfigLike[]
  seasonCategories: SeasonCategoryOption[]
  seasonYear: number | null
  modalities: ModalityRow[]
}) {
  const [editing, setEditing] = useState<ModalityRow | null | "new">(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [formDiscipline, setFormDiscipline] = useState(eventDisciplines[0] ?? "")
  const [bulkDiscipline, setBulkDiscipline] = useState(eventDisciplines[0] ?? "")
  const [bulkNamesText, setBulkNamesText] = useState("")
  const [maxAge, setMaxAge] = useState("")
  const [isPending, startTransition] = useTransition()

  // Cómo mide las edades la disciplina que está abierta en cada diálogo.
  const formAgeRuleMode = disciplineConfigFor(disciplineConfigs, formDiscipline).ageRuleMode
  const bulkConfig = disciplineConfigFor(disciplineConfigs, bulkDiscipline)
  const parsedMaxAge = Number(maxAge)
  const computedBirthYearFrom =
    seasonYear !== null && Number.isInteger(parsedMaxAge) && parsedMaxAge > 0
      ? birthYearForMaxAge(seasonYear, parsedMaxAge)
      : null

  const handleSave = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveModality(formData)
      if (result.success) {
        toast.success("Prueba guardada")
        setEditing(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleBulk = (formData: FormData) => {
    startTransition(async () => {
      const result = await bulkGenerateModalities(formData)
      if (result.success) {
        toast.success(`Se generaron ${result.created} pruebas.`)
        setBulkOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  const disciplines = DISCIPLINE_VALUES.filter((value) =>
    eventDisciplines.includes(value)
  )

  const current = editing !== "new" ? editing : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-fdnda-ink">
          Pruebas / Modalidades ({modalities.length})
        </h2>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setBulkDiscipline(disciplines[0] ?? "")
              setBulkNamesText("")
              setBulkOpen(true)
            }}
          >
            <Layers className="h-4 w-4" /> Generador masivo
          </Button>
          <Button
            onClick={() => {
              setFormDiscipline(disciplines[0] ?? "")
              setMaxAge("")
              setEditing("new")
            }}
          >
            <Plus className="h-4 w-4" /> Nueva prueba
          </Button>
        </div>
      </div>

      {/* Diez columnas y tres acciones por fila: en un teléfono las acciones
          quedaban en la columna más lejana. En móvil la misma prueba se
          presenta apilada y con los botones al pie. */}
      <TableCards>
        {modalities.length === 0 ? (
          <li className="rounded-surface border border-fdnda-border bg-white p-6 text-center text-sm text-fdnda-muted">
            Sin pruebas. Usa «Nueva prueba» o el generador masivo.
          </li>
        ) : (
          modalities.map((m) => (
            <TableCard
              key={m.id}
              lanes={[m.discipline]}
              className={!m.isActive ? "opacity-60" : undefined}
              title={m.name}
              // El nivel ya viaja en la insignia de al lado: repetirlo en el
              // subtítulo daba «Básico» dos veces en la misma tarjeta. En la
              // tabla de escritorio, que no tiene columna de nivel, la
              // categoría se muestra completa para que la fila no quede
              // ambigua.
              subtitle={
                (m.level ? stripLevelPrefix(m.category) : m.category) || undefined
              }
              badges={
                <>
                  {m.level ? (
                    <Badge variant="neutral">
                      {ARTISTIC_LEVEL_LABELS[
                        m.level as keyof typeof ARTISTIC_LEVEL_LABELS
                      ]}
                    </Badge>
                  ) : null}
                  <Badge variant={m.isActive ? "success" : "neutral"}>
                    {m.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                </>
              }
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFormDiscipline(m.discipline)
                      setMaxAge(
                        seasonYear !== null && m.birthYearFrom !== null
                          ? String(maxAgeForBirthYear(seasonYear, m.birthYearFrom))
                          : ""
                      )
                      setEditing(m)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        const r = await toggleModalityActive(m.id)
                        if (!r.success) toast.error(r.error)
                      })
                    }
                  >
                    {m.isActive ? "Desactivar" : "Activar"}
                  </Button>
                </>
              }
            >
              <TableField label="Sexo" value={SEX_RULE_LABELS[m.sexRule]} />
              <TableField
                label="Años nac."
                value={
                  <span className="num">
                    {yearRangeLabel(m.birthYearFrom, m.birthYearTo, {
                      ageRuleMode: disciplineConfigFor(disciplineConfigs, m.discipline)
                        .ageRuleMode,
                      seasonYear,
                    })}
                  </span>
                }
              />
              <TableField
                label="Integrantes"
                value={teamSizeLabel(m.minAthletes, m.maxAthletes)}
              />
              <TableField
                label="Precio"
                value={
                  <span>
                    <span className="num">{formatMoney(m.price)}</span>
                    {m.pricePerMatch !== null && m.matchesPerTeam !== null ? (
                      <span className="mt-0.5 block text-xs font-normal text-fdnda-muted">
                        {leaguePriceBreakdown({
                          pricePerMatch: m.pricePerMatch,
                          matchesPerTeam: m.matchesPerTeam,
                        })}
                      </span>
                    ) : null}
                  </span>
                }
              />
              <TableField
                wide
                label="Inscritas"
                value={
                  <span className="num">
                    {m.paidRegistrations} / {m.totalRegistrations}
                    {m.capacity ? ` (cupo ${m.capacity})` : ""}
                  </span>
                }
              />
            </TableCard>
          ))
        )}
      </TableCards>

      <TableContainer className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>Disciplina</TH>
              <TH>Prueba</TH>
              <TH>Categoría</TH>
              <TH>Sexo</TH>
              <TH>Años nac.</TH>
              <TH>Integrantes</TH>
              <TH className="text-right">Precio</TH>
              <TH className="text-right">Inscritas</TH>
              <TH>Estado</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {modalities.length === 0 ? (
              <TR>
                <TD colSpan={10} className="py-10 text-center text-fdnda-muted">
                  Sin pruebas. Usa «Nueva prueba» o el generador masivo.
                </TD>
              </TR>
            ) : (
              modalities.map((m) => (
                <TR key={m.id} className={!m.isActive ? "opacity-50" : undefined}>
                  <TD className="text-xs">{m.disciplineLabel}</TD>
                  <TD className="font-medium text-fdnda-ink">{m.name}</TD>
                  <TD>{m.category || "—"}</TD>
                  <TD>{SEX_RULE_LABELS[m.sexRule]}</TD>
                  <TD>
                    {yearRangeLabel(m.birthYearFrom, m.birthYearTo, {
                      ageRuleMode: disciplineConfigFor(disciplineConfigs, m.discipline)
                        .ageRuleMode,
                      seasonYear,
                    })}
                    {m.allowsCategoryUpgrade &&
                    (m.categoryUpgradeBirthYear !== null || m.birthYearTo !== null) ? (
                      <span
                        className="mt-1 block text-xs text-fdnda-turquoise-deep"
                        title="Admite además a los del último año de la categoría inmediata inferior"
                      >
                        + sube {m.categoryUpgradeBirthYear ?? m.birthYearTo! + 1}
                      </span>
                    ) : null}
                  </TD>
                  <TD>{teamSizeLabel(m.minAthletes, m.maxAthletes)}</TD>
                  <TD className="text-right font-semibold">
                    {formatMoney(m.price)}
                    {m.matchesPerTeam !== null && m.pricePerMatch !== null ? (
                      <span className="block text-xs font-normal text-fdnda-muted">
                        {leaguePriceBreakdown({
                          pricePerMatch: m.pricePerMatch,
                          matchesPerTeam: m.matchesPerTeam,
                        })}
                        {m.expectedTeams !== null
                          ? ` · ${leagueTotalMatches({
                              expectedTeams: m.expectedTeams,
                              matchesPerTeam: m.matchesPerTeam,
                            })} partidos en la categoría`
                          : ""}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="text-right">
                    <span className="font-medium text-fdnda-success">
                      {m.paidRegistrations}
                    </span>
                    <span className="text-xs text-fdnda-muted">
                      {" "}
                      / {m.totalRegistrations}
                      {m.capacity ? ` (cupo ${m.capacity})` : ""}
                    </span>
                  </TD>
                  <TD>
                    <Badge variant={m.isActive ? "success" : "neutral"}>
                      {m.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Editar la prueba ${m.name}`}
                        onClick={() => {
                          setFormDiscipline(m.discipline)
                          // Recompone la N de «Sub-N» desde el año guardado.
                          setMaxAge(
                            seasonYear !== null && m.birthYearFrom !== null
                              ? String(maxAgeForBirthYear(seasonYear, m.birthYearFrom))
                              : ""
                          )
                          setEditing(m)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          startTransition(async () => {
                            const r = await toggleModalityActive(m.id)
                            if (!r.success) toast.error(r.error)
                          })
                        }
                      >
                        {m.isActive ? "Desactivar" : "Activar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-fdnda-red hover:bg-fdnda-red-soft hover:text-fdnda-red-deep"
                        onClick={() => {
                          if (!confirm(`¿Eliminar la prueba "${m.name}"?`)) return
                          startTransition(async () => {
                            const r = await deleteModality(m.id)
                            if (r.success) toast.success("Prueba eliminada")
                            else toast.error(r.error)
                          })
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableContainer>

      {/* Crear/editar prueba */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Nueva prueba" : "Editar prueba"}
      >
        <form action={handleSave} className="space-y-4">
          <input type="hidden" name="eventId" value={eventId} />
          {current ? <input type="hidden" name="id" value={current.id} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mod-discipline">Disciplina</Label>
              <Select
                id="mod-discipline"
                name="discipline"
                value={formDiscipline}
                onChange={(event) => setFormDiscipline(event.target.value)}
              >
                {disciplines.map((d) => (
                  <option key={d} value={d}>
                    {DISCIPLINES[d].label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="mod-sexRule">Sexo</Label>
              <Select id="mod-sexRule" name="sexRule" defaultValue={current?.sexRule ?? "ANY"}>
                <option value="FEMALE">Damas</option>
                <option value="MALE">Varones</option>
                <option value="MIXED">Mixto (≥1 varón y ≥1 dama)</option>
                <option value="ANY">Libre</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="mod-name">Nombre de la prueba</Label>
            <Input
              id="mod-name"
              name="name"
              required
              placeholder="Trampolín 3m / Dueto Libre"
              defaultValue={current?.name}
            />
          </div>
          {isLevelChampionship && formDiscipline === "ARTISTIC_SWIMMING" ? (
            <div>
              <Label htmlFor="mod-level">Nivel</Label>
              <Select
                id="mod-level"
                name="level"
                defaultValue={current?.level ?? ""}
              >
                <option value="">Sin nivel</option>
                {ARTISTIC_LEVEL_VALUES.map((level) => (
                  <option key={level} value={level}>
                    {ARTISTIC_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                El nombre del nivel se antepone a la categoría al guardar, para
                que el comprobante distinga dos pruebas homónimas de niveles
                distintos. Escribe la categoría sin él.
              </p>
            </div>
          ) : null}
          <div>
            <Label htmlFor="mod-category">Categoría (opcional)</Label>
            <Input
              id="mod-category"
              name="category"
              placeholder="Categoría B — Damas / Juvenil"
              // Una prueba con nivel se edita sin el prefijo: lo pone el
              // servidor a partir del selector de arriba. Sin nivel se muestra
              // la categoría tal cual está guardada.
              defaultValue={
                (current?.level
                  ? (stripLevelPrefix(current.category) ?? "")
                  : current?.category) ?? ""
              }
              list="season-category-options"
            />
            <datalist id="season-category-options">
              {seasonCategories
                .filter((category) => category.discipline === formDiscipline)
                .map((category) => (
                  <option key={category.id} value={category.name} />
                ))}
            </datalist>
          </div>
          {formAgeRuleMode === "MAX_AGE_ONLY" ? (
            // «Sub-N» usa solo tope de edad. Vacío representa Open.
            <div>
              <Label htmlFor="mod-maxAge">Edad máxima Sub-N (opcional)</Label>
              <Input
                id="mod-maxAge"
                type="number"
                min={1}
                max={99}
                placeholder="18"
                value={maxAge}
                onChange={(event) => setMaxAge(event.target.value)}
              />
              <input
                type="hidden"
                name="birthYearFrom"
                value={computedBirthYearFrom ?? ""}
              />
              <input type="hidden" name="birthYearTo" value="" />
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                {computedBirthYearFrom
                  ? `Admite a los nacidos en ${computedBirthYearFrom} o después (temporada ${seasonYear}). Los de categorías menores también entran.`
                  : seasonYear
                    ? "Indica la edad máxima, o déjala vacía para una categoría Open."
                    : "Asigna una temporada al evento para calcular el año de nacimiento."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mod-yearFrom">Año nac. desde</Label>
                <Input
                  id="mod-yearFrom"
                  name="birthYearFrom"
                  type="number"
                  placeholder="2013"
                  defaultValue={current?.birthYearFrom ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="mod-yearTo">Año nac. hasta</Label>
                <Input
                  id="mod-yearTo"
                  name="birthYearTo"
                  type="number"
                  placeholder="2014"
                  defaultValue={current?.birthYearTo ?? ""}
                />
              </div>
            </div>
          )}
          {formDiscipline === "ARTISTIC_SWIMMING" ? (
          <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-fdnda-surface px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="allowsCategoryUpgrade"
              defaultChecked={current?.allowsCategoryUpgrade ?? false}
              className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
            />
            <span>
              <span className="font-medium text-fdnda-ink">Sube de categoría</span>
              <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                Admite además a los deportistas del último año de la categoría
                inmediata inferior (el año siguiente al «hasta»). Regla de natación
                artística para pruebas tipo Solo, Figuras o Estrellas.
              </span>
            </span>
          </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mod-min">Mín. deportistas</Label>
              <Input
                id="mod-min"
                name="minAthletes"
                type="number"
                min={1}
                max={20}
                required
                defaultValue={current?.minAthletes ?? 1}
              />
            </div>
            <div>
              <Label htmlFor="mod-max">Máx. deportistas</Label>
              <Input
                id="mod-max"
                name="maxAthletes"
                type="number"
                min={1}
                max={20}
                required
                defaultValue={current?.maxAthletes ?? 1}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {isLeague ? (
              <>
                <div>
                  <Label htmlFor="mod-price-per-match">Precio por partido (S/)</Label>
                  <Input
                    id="mod-price-per-match"
                    name="pricePerMatch"
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    defaultValue={current?.pricePerMatch ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="mod-matches">Partidos por equipo</Label>
                  <Input
                    id="mod-matches"
                    name="matchesPerTeam"
                    type="number"
                    min={1}
                    max={40}
                    required
                    defaultValue={current?.matchesPerTeam ?? 4}
                  />
                </div>
                <div>
                  <Label htmlFor="mod-teams">Equipos esperados</Label>
                  <Input
                    id="mod-teams"
                    name="expectedTeams"
                    type="number"
                    min={1}
                    max={40}
                    required
                    defaultValue={current?.expectedTeams ?? 3}
                  />
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="mod-price">Precio (S/)</Label>
                <Input
                  id="mod-price"
                  name="price"
                  type="number"
                  step="0.01"
                  min={0}
                  required
                  defaultValue={current?.price ?? ""}
                />
              </div>
            )}
            <div>
              <Label htmlFor="mod-capacity">Cupo (opcional)</Label>
              <Input
                id="mod-capacity"
                name="capacity"
                type="number"
                min={1}
                placeholder="Sin límite"
                defaultValue={current?.capacity ?? ""}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Generador masivo */}
      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Generador masivo de pruebas"
        description="Genera la matriz pruebas × categorías × sexos en un solo paso."
        className="sm:max-w-2xl"
      >
        <form action={handleBulk} className="space-y-4">
          <input type="hidden" name="eventId" value={eventId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bulk-discipline">Disciplina</Label>
              <Select
                id="bulk-discipline"
                name="discipline"
                value={bulkDiscipline}
                onChange={(event) => setBulkDiscipline(event.target.value)}
              >
                {disciplines.map((d) => (
                  <option key={d} value={d}>
                    {DISCIPLINES[d].label}
                  </option>
                ))}
              </Select>
            </div>
            {isLeague ? (
              <>
                <div>
                  <Label htmlFor="bulk-price-per-match">Precio por partido (S/)</Label>
                  <Input id="bulk-price-per-match" name="pricePerMatch" type="number" step="0.01" min={0} required />
                </div>
                <div>
                  <Label htmlFor="bulk-matches">Partidos por equipo</Label>
                  <Input id="bulk-matches" name="matchesPerTeam" type="number" min={1} max={40} defaultValue={4} required />
                </div>
                <div>
                  <Label htmlFor="bulk-teams">Equipos esperados</Label>
                  <Input id="bulk-teams" name="expectedTeams" type="number" min={1} max={40} defaultValue={3} required />
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="bulk-price">Precio por prueba (S/)</Label>
                <Input id="bulk-price" name="price" type="number" step="0.01" min={0} required />
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="bulk-names">Pruebas (una por línea)</Label>
            {bulkDiscipline === "ARTISTIC_SWIMMING" ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {[
                  ["Solo Libre", "Solo"],
                  ["Figuras", "Figuras"],
                  ["Estrellas", "Estrellas"],
                ].map(([name, label]) => (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setBulkNamesText((current) =>
                        current.split("\n").includes(name)
                          ? current
                          : [current.trim(), name].filter(Boolean).join("\n")
                      )
                    }
                  >
                    + {label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Textarea
              id="bulk-names"
              name="namesText"
              rows={3}
              required
              placeholder={"Trampolín 1m\nTrampolín 3m\nPlataforma"}
              value={bulkNamesText}
              onChange={(event) => setBulkNamesText(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="bulk-categories">
              {bulkConfig.ageRuleMode === "MAX_AGE_ONLY"
                ? "Categorías Sub-N/Open (una por línea)"
                : "Categorías (una por línea: Nombre|añoDesde|añoHasta)"}
            </Label>
            <Textarea
              id="bulk-categories"
              name="categoriesText"
              rows={3}
              required={bulkConfig.ageRuleMode === "MAX_AGE_ONLY"}
              placeholder={
                bulkConfig.ageRuleMode === "MAX_AGE_ONLY"
                  ? "Sub 13\nSub 16\nOpen|OPEN"
                  : "Categoría D|2015|2017\nCategoría C|2013|2014\nCategoría B|2011|2012"
              }
            />
            <p className="mt-1 text-xs text-fdnda-muted">
              {bulkConfig.ageRuleMode === "MAX_AGE_ONLY"
                ? `Solo edad máxima: «Sub 18» admite a los nacidos en ${seasonYear ? birthYearForMaxAge(seasonYear, 18) : "…"} o después. Usa «Open|OPEN» para no limitar la edad.`
                : "Los años son opcionales («Juvenil» sin años = sin restricción). Vacío = una sola versión sin categoría."}
            </p>
          </div>
          {isLevelChampionship && bulkDiscipline === "ARTISTIC_SWIMMING" ? (
            <div>
              <Label htmlFor="bulk-level">Nivel</Label>
              <Select id="bulk-level" name="level" defaultValue="">
                <option value="">Sin nivel</option>
                {ARTISTIC_LEVEL_VALUES.map((level) => (
                  <option key={level} value={level}>
                    {ARTISTIC_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                El nombre del nivel se antepone a la categoría de cada prueba
                generada.
              </p>
            </div>
          ) : null}
          <div>
            <Label>Sexos a generar</Label>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["FEMALE", "Damas"],
                  ["MALE", "Varones"],
                  ["MIXED", "Mixto"],
                  ["ANY", "Libre"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="sexRules"
                    value={value}
                    defaultChecked={value === "FEMALE" || value === "MALE"}
                    className="h-4 w-4 accent-fdnda-turquoise-deep"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {bulkDiscipline === "ARTISTIC_SWIMMING" ? (
          <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-fdnda-surface px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="allowsCategoryUpgrade"
              className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
            />
            <span>
              <span className="font-medium text-fdnda-ink">Sube de categoría</span>
              <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                Cada categoría generada admite además a los del último año de la
                inmediata inferior. Las categorías sin año «hasta» se generan sin
                el permiso.
              </span>
            </span>
          </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bulk-min">Mín. deportistas</Label>
              <Input id="bulk-min" name="minAthletes" type="number" min={1} max={20} defaultValue={1} required />
            </div>
            <div>
              <Label htmlFor="bulk-max">Máx. deportistas</Label>
              <Input id="bulk-max" name="maxAthletes" type="number" min={1} max={20} defaultValue={1} required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Generar pruebas
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
