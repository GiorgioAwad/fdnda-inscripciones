"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Layers, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState } from "@/components/empty-state"
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
import { DISCIPLINE_VALUES, DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { DISCIPLINE_PRESETS } from "@/lib/event-presets"
import {
  birthYearForMaxAge,
  disciplineConfigFor,
  maxAgeForBirthYear,
  type EventDisciplineConfigLike,
} from "@/lib/event-pricing"
import { modalityDisplayName } from "@/lib/event-readiness"
import { leaguePriceBreakdown, leagueTotalMatches } from "@/lib/league"
import { formatMoney, plural, SEX_RULE_LABELS } from "@/lib/utils"
import {
  bulkGenerateModalities,
  deleteModality,
  saveModality,
  setEventStatus,
  toggleModalityActive,
} from "../actions"
import {
  categoryCount,
  CategoryRowsEditor,
  categoryRowsToText,
  useCategoryRows,
} from "../category-rows-editor"
import { DialogFormFooter, useDiscardGuard } from "../form-discard-guard"

// Mismo tope que MAX_BULK_MODALITIES en actions.ts.
const MAX_MODALITIES_PER_BATCH = 300

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
  /** Con orden emitida y sin pagar. */
  pendingRegistrations: number
  /** En la planilla de un club, todavía sin orden. */
  cartRegistrations: number
}

interface SeasonCategoryOption {
  id: string
  discipline: string
  name: string
  birthYearFrom: number | null
  birthYearTo: number | null
  sortOrder: number
}

function isDisciplineValue(value: string): value is DisciplineValue {
  return (DISCIPLINE_VALUES as readonly string[]).includes(value)
}

function displayName(modality: Pick<ModalityRow, "name" | "category">): string {
  return modalityDisplayName({ name: modality.name, category: modality.category || null })
}

const HELP = "mt-1 text-xs leading-5 text-fdnda-muted"
const NOTE = "rounded-control bg-fdnda-sky/25 px-3 py-2 text-xs leading-5 text-fdnda-navy"
const CHECK = "mt-0.5 h-4 w-4 shrink-0 accent-fdnda-turquoise-deep"

// ==================== ESTADO DE LA COMPETENCIA ====================

export function EventStatusControls({
  eventId,
  eventName,
  status,
  missingCount,
  deadlineLabel,
}: {
  eventId: string
  eventName: string
  status: string
  /** Requisitos sin cumplir según lib/event-readiness: con alguno no se puede abrir. */
  missingCount: number
  deadlineLabel: string
}) {
  const [isPending, startTransition] = useTransition()
  const [confirmingClose, setConfirmingClose] = useState(false)

  const change = (next: "DRAFT" | "OPEN" | "CLOSED") => {
    startTransition(async () => {
      const result = await setEventStatus(eventId, next)
      if (result.success) {
        toast.success(
          next === "OPEN"
            ? `Inscripciones de «${eventName}» abiertas hasta el ${deadlineLabel}.`
            : next === "CLOSED"
              ? `Inscripciones de «${eventName}» cerradas: los clubes ya no ven la competencia.`
              : `«${eventName}» volvió a borrador.`
        )
      } else {
        toast.error(
          result.error ?? "No se pudo cambiar el estado de la competencia. Vuelve a intentarlo."
        )
      }
      setConfirmingClose(false)
    })
  }

  return (
    <>
      {status !== "OPEN" ? (
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button
            // Una sola acción primaria: mientras falten requisitos la principal
            // es completar las pruebas, no abrir.
            variant={missingCount === 0 ? "default" : "outline"}
            disabled={missingCount > 0}
            loading={isPending}
            onClick={() => change("OPEN")}
          >
            Abrir inscripciones
          </Button>
          {missingCount > 0 ? (
            <a
              href="#requisitos"
              className="text-xs font-semibold text-fdnda-red-deep underline underline-offset-4"
            >
              {missingCount === 1 ? "Falta" : "Faltan"}{" "}
              {plural(missingCount, "requisito", "requisitos")}
            </a>
          ) : null}
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirmingClose(true)}>
          Cerrar inscripciones
        </Button>
      )}
      {status === "CLOSED" ? (
        <Button variant="ghost" onClick={() => change("DRAFT")} disabled={isPending}>
          Volver a borrador
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmingClose}
        onClose={() => setConfirmingClose(false)}
        title={`¿Cerrar las inscripciones de «${eventName}»?`}
        consequence="Los clubes dejarán de ver esta competencia y no podrán generar órdenes para sus planillas hasta que la reabras. Lo ya pagado se conserva. Podrás reabrirlas mientras el cierre de inscripciones no haya pasado."
        confirmLabel="Cerrar inscripciones"
        pending={isPending}
        onConfirm={() => change("CLOSED")}
      />
    </>
  )
}

// ==================== PRUEBAS ====================

function yearRangeLabel(
  from: number | null,
  to: number | null,
  options: { ageRuleMode: string; seasonYear: number | null }
): string {
  // En «Sub-N» el piso de año es la forma de expresar el tope de edad, así que
  // se muestra como "Sub-18 · 2009 o después" en vez de "desde 2009".
  if (
    options.ageRuleMode === "MAX_AGE_ONLY" &&
    from !== null &&
    to === null &&
    options.seasonYear !== null
  ) {
    return `Sub-${maxAgeForBirthYear(options.seasonYear, from)} · ${from} o después`
  }
  if (from === null && to === null) return "Sin límite"
  if (from !== null && to !== null) return `${from} – ${to}`
  if (from !== null) return `${from} o después`
  return `${to} o antes`
}

function teamSizeLabel(min: number, max: number): string {
  return min === max ? `${min}` : `${min} a ${max}`
}

interface ManagerContext {
  eventId: string
  isLeague: boolean
  isLevelChampionship: boolean
  disciplines: string[]
  disciplineConfigs: EventDisciplineConfigLike[]
  seasonCategories: SeasonCategoryOption[]
  seasonYear: number | null
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
  const [editing, setEditing] = useState<ModalityRow | "new" | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ModalityRow | null>(null)
  const [pendingDeactivate, setPendingDeactivate] = useState<ModalityRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const disciplines = DISCIPLINE_VALUES.filter((value) => eventDisciplines.includes(value))
  const context: ManagerContext = {
    eventId,
    isLeague,
    isLevelChampionship,
    disciplines,
    disciplineConfigs,
    seasonCategories,
    seasonYear,
  }
  const showDiscipline = disciplines.length > 1
  const activeCount = modalities.filter((modality) => modality.isActive).length

  const runToggle = (modality: ModalityRow) => {
    startTransition(async () => {
      const result = await toggleModalityActive(modality.id)
      if (result.success) {
        toast.success(
          modality.isActive
            ? `Prueba «${displayName(modality)}» desactivada: los clubes ya no pueden elegirla.`
            : `Prueba «${displayName(modality)}» activada.`
        )
      } else {
        toast.error(result.error ?? "No se pudo cambiar la prueba. Vuelve a intentarlo.")
      }
      setPendingDeactivate(null)
    })
  }

  // Desactivar no borra nada, pero una planilla sin orden que ya tiene la
  // prueba queda con un error «ya no está disponible» (lib/plan-validation) y
  // el club tiene que quitarla antes de generar su orden: eso se avisa antes.
  const requestToggle = (modality: ModalityRow) => {
    if (modality.isActive && modality.cartRegistrations > 0) {
      setPendingDeactivate(modality)
    } else {
      runToggle(modality)
    }
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result = await deleteModality(target.id)
      if (result.success) {
        toast.success(`Prueba «${displayName(target)}» eliminada.`)
      } else {
        toast.error(result.error ?? "No se pudo eliminar la prueba. Vuelve a intentarlo.")
      }
      setPendingDelete(null)
    })
  }

  const priceView = (modality: ModalityRow) => {
    if (!disciplineConfigFor(disciplineConfigs, modality.discipline).chargesEntry) {
      return <span className="text-fdnda-muted">Incluido en la cuota de competencia</span>
    }
    return (
      <span>
        <span className="num font-semibold">{formatMoney(modality.price)}</span>
        {modality.pricePerMatch !== null && modality.matchesPerTeam !== null ? (
          <span className="mt-0.5 block text-xs font-normal text-fdnda-muted">
            {leaguePriceBreakdown({
              pricePerMatch: modality.pricePerMatch,
              matchesPerTeam: modality.matchesPerTeam,
            })}
            {modality.expectedTeams !== null
              ? ` · ${plural(
                  leagueTotalMatches({
                    expectedTeams: modality.expectedTeams,
                    matchesPerTeam: modality.matchesPerTeam,
                  }),
                  "partido",
                  "partidos"
                )} en la categoría`
              : ""}
          </span>
        ) : null}
      </span>
    )
  }

  const registrationsView = (modality: ModalityRow) => (
    <span className="num">
      <span className="font-semibold text-fdnda-success">
        {plural(modality.paidRegistrations, "pagada", "pagadas")}
      </span>
      <span className="text-fdnda-muted"> · {modality.totalRegistrations} en total</span>
      {modality.capacity ? (
        <span className="text-fdnda-muted"> · cupo {modality.capacity}</span>
      ) : null}
    </span>
  )

  const yearsView = (modality: ModalityRow) => (
    <>
      <span className="num">
        {yearRangeLabel(modality.birthYearFrom, modality.birthYearTo, {
          ageRuleMode: disciplineConfigFor(disciplineConfigs, modality.discipline)
            .ageRuleMode,
          seasonYear,
        })}
      </span>
      {modality.allowsCategoryUpgrade &&
      (modality.categoryUpgradeBirthYear !== null || modality.birthYearTo !== null) ? (
        <span className="mt-1 block text-xs text-fdnda-turquoise-deep">
          Suben de categoría los nacidos en{" "}
          {modality.categoryUpgradeBirthYear ?? modality.birthYearTo! + 1}
        </span>
      ) : null}
    </>
  )

  const openNew = () => setEditing("new")
  const openBulk = () => setBulkOpen(true)

  return (
    <section aria-labelledby="pruebas-titulo" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="pruebas-titulo" className="font-heading text-lg font-bold text-fdnda-navy">
            Pruebas
          </h2>
          {modalities.length > 0 ? (
            <p className="text-sm text-fdnda-muted">
              {plural(modalities.length, "prueba", "pruebas")} ·{" "}
              {plural(activeCount, "activa", "activas")}
            </p>
          ) : null}
        </div>
        {modalities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openBulk}>
              <Layers className="h-4 w-4" aria-hidden="true" /> Generar pruebas en lote
            </Button>
            <Button variant="outline" onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Crear prueba
            </Button>
          </div>
        ) : null}
      </div>

      {modalities.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="Esta competencia aún no tiene pruebas"
            action={
              <>
                <Button onClick={openBulk}>
                  <Layers className="h-4 w-4" aria-hidden="true" /> Generar pruebas en lote
                </Button>
                <Button variant="outline" onClick={openNew}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Crear una prueba
                </Button>
              </>
            }
          >
            Necesitas al menos una prueba activa para abrir inscripciones. En lote
            combinas nombres, categorías y sexos de una sola vez.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Diez columnas y tres acciones por fila: en un teléfono las acciones
              quedaban en la columna más lejana. En móvil la misma prueba se
              presenta apilada y con los botones al pie. */}
          <TableCards>
            {modalities.map((m) => {
              const name = displayName(m)
              return (
                <TableCard
                  key={m.id}
                  lanes={[m.discipline]}
                  className={!m.isActive ? "opacity-60" : undefined}
                  title={m.name}
                  // El nivel ya viaja en la insignia de al lado: repetirlo en el
                  // subtítulo daba «Básico» dos veces en la misma tarjeta.
                  subtitle={
                    (m.level ? stripLevelPrefix(m.category) : m.category) || undefined
                  }
                  badges={
                    <>
                      {m.level ? (
                        <Badge variant="neutral">
                          {ARTISTIC_LEVEL_LABELS[m.level as keyof typeof ARTISTIC_LEVEL_LABELS]}
                        </Badge>
                      ) : null}
                      <Badge variant={m.isActive ? "success" : "neutral"}>
                        {m.isActive ? "Activa" : "Desactivada"}
                      </Badge>
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(m)}
                        aria-label={`Editar la prueba ${name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => requestToggle(m)}
                        disabled={isPending}
                        aria-label={`${m.isActive ? "Desactivar" : "Activar"} la prueba ${name}`}
                      >
                        {m.isActive ? "Desactivar" : "Activar"}
                      </Button>
                      {m.totalRegistrations === 0 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-fdnda-red-deep hover:bg-fdnda-red-soft"
                          onClick={() => setPendingDelete(m)}
                          aria-label={`Eliminar la prueba ${name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Eliminar
                        </Button>
                      ) : null}
                    </>
                  }
                >
                  <TableField label="Sexo" value={SEX_RULE_LABELS[m.sexRule]} />
                  <TableField label="Nacidos" value={yearsView(m)} />
                  <TableField
                    label="Integrantes"
                    value={teamSizeLabel(m.minAthletes, m.maxAthletes)}
                  />
                  <TableField label="Precio" value={priceView(m)} />
                  <TableField wide label="Inscripciones" value={registrationsView(m)} />
                </TableCard>
              )
            })}
          </TableCards>

          <TableContainer className="hidden md:block" aria-label="Pruebas de la competencia">
            <Table>
              <THead>
                <TR>
                  {showDiscipline ? <TH>Disciplina</TH> : null}
                  <TH>Prueba</TH>
                  <TH>Categoría</TH>
                  <TH>Sexo</TH>
                  <TH>Nacidos</TH>
                  <TH>Integrantes</TH>
                  <TH className="text-right">Precio</TH>
                  <TH className="text-right">Inscripciones</TH>
                  <TH>Estado</TH>
                  <TH className="text-right">Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {modalities.map((m) => {
                  const name = displayName(m)
                  return (
                    <TR key={m.id} className={!m.isActive ? "opacity-60" : undefined}>
                      {showDiscipline ? (
                        <TD className="text-xs">{m.disciplineLabel}</TD>
                      ) : null}
                      <TD className="font-medium text-fdnda-ink">{m.name}</TD>
                      <TD>{m.category || "Sin categoría"}</TD>
                      <TD>{SEX_RULE_LABELS[m.sexRule]}</TD>
                      <TD>{yearsView(m)}</TD>
                      <TD>{teamSizeLabel(m.minAthletes, m.maxAthletes)}</TD>
                      <TD className="text-right">{priceView(m)}</TD>
                      <TD className="text-right">{registrationsView(m)}</TD>
                      <TD>
                        <Badge variant={m.isActive ? "success" : "neutral"}>
                          {m.isActive ? "Activa" : "Desactivada"}
                        </Badge>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={`Editar la prueba ${name}`}
                            onClick={() => setEditing(m)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => requestToggle(m)}
                            disabled={isPending}
                            aria-label={`${m.isActive ? "Desactivar" : "Activar"} la prueba ${name}`}
                          >
                            {m.isActive ? "Desactivar" : "Activar"}
                          </Button>
                          {/* Con inscripciones la prueba no se elimina (deleteModality lo
                              rechaza): el camino es desactivarla. */}
                          {m.totalRegistrations === 0 ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-fdnda-red-deep hover:bg-fdnda-red-soft"
                              aria-label={`Eliminar la prueba ${name}`}
                              onClick={() => setPendingDelete(m)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>
        </>
      )}

      {editing !== null ? (
        <ModalityFormDialog
          key={editing === "new" ? "new" : editing.id}
          context={context}
          modality={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {bulkOpen ? (
        <BulkGenerateDialog context={context} onClose={() => setBulkOpen(false)} />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete ? `¿Eliminar la prueba «${displayName(pendingDelete)}»?` : ""}
        consequence="No tiene inscripciones. Se borra de la competencia y no se puede deshacer."
        confirmLabel="Eliminar prueba"
        destructive
        pending={isPending}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={pendingDeactivate !== null}
        onClose={() => setPendingDeactivate(null)}
        title={pendingDeactivate ? `¿Desactivar «${displayName(pendingDeactivate)}»?` : ""}
        consequence={
          pendingDeactivate
            ? `Hay ${plural(pendingDeactivate.cartRegistrations, "inscripción", "inscripciones")} de esta prueba en planillas que aún no generan orden. Esos clubes tendrán que quitarla antes de generar su orden. Las inscripciones con orden emitida o pagada se conservan.`
            : ""
        }
        confirmLabel="Desactivar prueba"
        pending={isPending}
        onConfirm={() => pendingDeactivate && runToggle(pendingDeactivate)}
      />
    </section>
  )
}

// ==================== CREAR / EDITAR UNA PRUEBA ====================

function PriceFields({
  context,
  discipline,
  idPrefix,
  current,
}: {
  context: ManagerContext
  discipline: string
  idPrefix: string
  current: ModalityRow | null
}) {
  const config = disciplineConfigFor(context.disciplineConfigs, discipline)

  if (context.isLeague) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${idPrefix}-price-per-match`}>Precio por partido (S/)</Label>
          <Input
            id={`${idPrefix}-price-per-match`}
            name="pricePerMatch"
            type="number"
            step="0.01"
            min={0}
            required
            defaultValue={current?.pricePerMatch ?? ""}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-matches`}>Partidos por plantel</Label>
          <Input
            id={`${idPrefix}-matches`}
            name="matchesPerTeam"
            type="number"
            min={1}
            max={40}
            required
            defaultValue={current?.matchesPerTeam ?? 4}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-teams`}>Planteles esperados</Label>
          <Input
            id={`${idPrefix}-teams`}
            name="expectedTeams"
            type="number"
            min={1}
            max={40}
            required
            defaultValue={current?.expectedTeams ?? 3}
            aria-describedby={`${idPrefix}-teams-help`}
          />
        </div>
        <p id={`${idPrefix}-teams-help`} className={`sm:col-span-3 ${HELP}`}>
          Cada plantel paga precio por partido × partidos por plantel. Los planteles
          esperados solo sirven para calcular los partidos de la fase preliminar; no
          limitan inscripciones.
        </p>
      </div>
    )
  }

  if (!config.chargesEntry) {
    // Sin precio por formación el cobro está en la cuota de competencia por
    // deportista: la prueba conserva su precio (0 si es nueva) y no se cobra.
    return (
      <>
        <input type="hidden" name="price" value={current?.price ?? 0} />
        <p className={NOTE}>
          {DISCIPLINES[discipline as DisciplineValue]?.label ?? discipline} cobra{" "}
          {config.athleteFee
            ? `una cuota de competencia de ${formatMoney(config.athleteFee)} por deportista`
            : "solo la cuota de competencia por deportista"}
          : las pruebas no tienen precio por formación.
        </p>
      </>
    )
  }

  return (
    <div className="max-w-xs">
      <Label htmlFor={`${idPrefix}-price`}>Precio por formación (S/)</Label>
      <Input
        id={`${idPrefix}-price`}
        name="price"
        type="number"
        step="0.01"
        min={0}
        required
        defaultValue={current?.price ?? ""}
      />
    </div>
  )
}

function DisciplineField({
  context,
  idPrefix,
  value,
  onChange,
}: {
  context: ManagerContext
  idPrefix: string
  value: string
  onChange: (value: string) => void
}) {
  // Las competencias nuevas son de una sola disciplina: el selector solo tiene
  // sentido en las antiguas de varias.
  if (context.disciplines.length <= 1) {
    return <input type="hidden" name="discipline" value={value} />
  }
  return (
    <div>
      <Label htmlFor={`${idPrefix}-discipline`}>Disciplina</Label>
      <Select
        id={`${idPrefix}-discipline`}
        name="discipline"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {context.disciplines.map((d) => (
          <option key={d} value={d}>
            {DISCIPLINES[d as DisciplineValue]?.label ?? d}
          </option>
        ))}
      </Select>
    </div>
  )
}

function ModalityFormDialog({
  context,
  modality,
  onClose,
}: {
  context: ManagerContext
  modality: ModalityRow | null
  onClose: () => void
}) {
  const current = modality
  const { seasonYear } = context
  const [formDiscipline, setFormDiscipline] = useState(
    current?.discipline ?? context.disciplines[0] ?? ""
  )
  // Recompone la N de «Sub-N» desde el año guardado.
  const [maxAge, setMaxAge] = useState(() =>
    current && seasonYear !== null && current.birthYearFrom !== null
      ? String(maxAgeForBirthYear(seasonYear, current.birthYearFrom))
      : ""
  )
  const [isPending, startTransition] = useTransition()
  const guard = useDiscardGuard(onClose)

  const ageRuleMode = disciplineConfigFor(context.disciplineConfigs, formDiscipline).ageRuleMode
  const parsedMaxAge = Number(maxAge)
  const computedBirthYearFrom =
    seasonYear !== null && Number.isInteger(parsedMaxAge) && parsedMaxAge > 0
      ? birthYearForMaxAge(seasonYear, parsedMaxAge)
      : null
  const preset = isDisciplineValue(formDiscipline) ? DISCIPLINE_PRESETS[formDiscipline] : null
  const categoryOptions = context.seasonCategories.filter(
    (category) => category.discipline === formDiscipline
  )

  const handleSubmit = (formEvent: FormEvent<HTMLFormElement>) => {
    // onSubmit y no <form action>: React 19 reinicia los campos no controlados
    // al terminar la acción, aunque el servidor devuelva un error.
    formEvent.preventDefault()
    if (isPending) return
    const formData = new FormData(formEvent.currentTarget)
    const name = displayName({
      name: String(formData.get("name") ?? "").trim(),
      category: String(formData.get("category") ?? "").trim(),
    })
    startTransition(async () => {
      const result = await saveModality(formData)
      if (result.success) {
        toast.success(current ? `Cambios de «${name}» guardados.` : `Prueba «${name}» creada.`)
        guard.reset()
        onClose()
      } else {
        toast.error(result.error ?? "No se pudo guardar la prueba. Vuelve a intentarlo.")
      }
    })
  }

  const title = current ? `Editar «${displayName(current)}»` : "Nueva prueba"

  return (
    <Dialog open onClose={guard.requestClose} title={title}>
      <form onSubmit={handleSubmit} onChange={guard.markDirty} className="space-y-4">
        <input type="hidden" name="eventId" value={context.eventId} />
        {current ? <input type="hidden" name="id" value={current.id} /> : null}

        {current && current.totalRegistrations > 0 ? (
          <p className={NOTE}>
            Esta prueba tiene{" "}
            {plural(current.totalRegistrations, "inscripción", "inscripciones")} (
            {plural(current.paidRegistrations, "pagada", "pagadas")}). Los cambios valen
            para lo que se inscriba desde ahora y para las planillas que aún no generan
            orden; las órdenes ya emitidas y sus constancias conservan el precio y los
            datos con que se generaron.
          </p>
        ) : null}

        <DisciplineField
          context={context}
          idPrefix="mod"
          value={formDiscipline}
          onChange={setFormDiscipline}
        />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <Label htmlFor="mod-name">Nombre de la prueba</Label>
            <Input
              id="mod-name"
              name="name"
              required
              minLength={2}
              placeholder={preset?.modalities[0]?.name ?? "Trampolín 3m"}
              defaultValue={current?.name}
            />
          </div>
          <div>
            <Label htmlFor="mod-sexRule">Sexo</Label>
            <Select id="mod-sexRule" name="sexRule" defaultValue={current?.sexRule ?? "ANY"}>
              <option value="FEMALE">{SEX_RULE_LABELS.FEMALE}</option>
              <option value="MALE">{SEX_RULE_LABELS.MALE}</option>
              <option value="MIXED">{SEX_RULE_LABELS.MIXED} (al menos un varón y una dama)</option>
              <option value="ANY">{SEX_RULE_LABELS.ANY}</option>
            </Select>
          </div>
        </div>

        {context.isLevelChampionship && formDiscipline === "ARTISTIC_SWIMMING" ? (
          <div>
            <Label htmlFor="mod-level">Nivel</Label>
            <Select
              id="mod-level"
              name="level"
              defaultValue={current?.level ?? ""}
              aria-describedby="mod-level-help"
            >
              <option value="">Sin nivel</option>
              {ARTISTIC_LEVEL_VALUES.map((level) => (
                <option key={level} value={level}>
                  {ARTISTIC_LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
            <p id="mod-level-help" className={HELP}>
              Al guardar, el nivel se antepone a la categoría para que la orden
              distinga dos pruebas iguales de niveles distintos. Escribe la
              categoría sin el nivel.
            </p>
          </div>
        ) : null}

        <div>
          <Label htmlFor="mod-category">Categoría (opcional)</Label>
          <Input
            id="mod-category"
            name="category"
            maxLength={80}
            placeholder={categoryOptions[0]?.name ?? preset?.categoryPlaceholder ?? "Juvenil"}
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
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.name} />
            ))}
          </datalist>
        </div>

        {ageRuleMode === "MAX_AGE_ONLY" ? (
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
              aria-describedby="mod-maxAge-help"
            />
            <input type="hidden" name="birthYearFrom" value={computedBirthYearFrom ?? ""} />
            <input type="hidden" name="birthYearTo" value="" />
            <p id="mod-maxAge-help" className={HELP}>
              {computedBirthYearFrom
                ? `Sub-${parsedMaxAge} en la temporada ${seasonYear}: admite nacidos en ${computedBirthYearFrom} o después. Los de categorías menores también entran.`
                : seasonYear
                  ? "Escribe la edad máxima, o déjala vacía para una categoría Open."
                  : "Asigna una temporada a la competencia para calcular el año de nacimiento."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mod-yearFrom">Nacidos desde</Label>
              <Input
                id="mod-yearFrom"
                name="birthYearFrom"
                type="number"
                inputMode="numeric"
                min={1950}
                max={2050}
                placeholder="Sin tope"
                defaultValue={current?.birthYearFrom ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="mod-yearTo">Nacidos hasta</Label>
              <Input
                id="mod-yearTo"
                name="birthYearTo"
                type="number"
                inputMode="numeric"
                min={1950}
                max={2050}
                placeholder="Sin tope"
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
              className={CHECK}
            />
            <span>
              <span className="font-medium text-fdnda-ink">Sube de categoría</span>
              <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                Admite además a los deportistas del último año de la categoría
                inmediata inferior (el año siguiente a «Nacidos hasta»). Regla de
                Natación Artística para pruebas tipo Solo, Figuras o Estrellas.
              </span>
            </span>
          </label>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mod-min">Integrantes mínimos</Label>
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
            <Label htmlFor="mod-max">Integrantes máximos</Label>
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

        <PriceFields
          context={context}
          discipline={formDiscipline}
          idPrefix="mod"
          current={current}
        />

        <div className="max-w-xs">
          <Label htmlFor="mod-capacity">Cupo de inscripciones (opcional)</Label>
          <Input
            id="mod-capacity"
            name="capacity"
            type="number"
            min={1}
            placeholder="Sin límite"
            defaultValue={current?.capacity ?? ""}
            aria-describedby="mod-capacity-help"
          />
          <p id="mod-capacity-help" className={HELP}>
            Máximo de inscripciones en esta prueba sumando todos los clubes. Vacío =
            sin límite.
          </p>
        </div>

        <DialogFormFooter
          guard={guard}
          discardTitle={
            current
              ? `¿Descartar los cambios de «${displayName(current)}»?`
              : "¿Descartar la prueba sin crearla?"
          }
          discardConsequence={
            current
              ? "La prueba se queda como estaba."
              : "Se perderá lo que escribiste en este formulario."
          }
        >
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={guard.requestClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={isPending}
              loadingText={current ? "Guardando cambios…" : "Creando prueba…"}
            >
              {current ? "Guardar cambios de la prueba" : "Crear prueba"}
            </Button>
          </div>
        </DialogFormFooter>
      </form>
    </Dialog>
  )
}

// ==================== GENERAR PRUEBAS EN LOTE ====================

const SEX_OPTIONS = ["FEMALE", "MALE", "MIXED", "ANY"] as const

function BulkGenerateDialog({
  context,
  onClose,
}: {
  context: ManagerContext
  onClose: () => void
}) {
  const [discipline, setDiscipline] = useState(context.disciplines[0] ?? "")
  const [namesText, setNamesText] = useState("")
  const [sexRules, setSexRules] = useState<string[]>(["FEMALE", "MALE"])
  const categories = useCategoryRows(1)
  const [isPending, startTransition] = useTransition()
  const guard = useDiscardGuard(onClose)

  const config = disciplineConfigFor(context.disciplineConfigs, discipline)
  const preset = isDisciplineValue(discipline) ? DISCIPLINE_PRESETS[discipline] : null
  const names = namesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const suggestions = (preset?.modalities ?? [])
    .map((modality) => modality.name)
    .filter((name) => !names.includes(name))
  // La misma cuenta que buildModalityRows: nombres × categorías × sexos.
  const count =
    names.length * categoryCount(categories.rows, config.ageRuleMode) * sexRules.length

  let blocked: string | null = null
  if (names.length === 0) blocked = "Escribe al menos un nombre de prueba."
  else if (sexRules.length === 0) blocked = "Marca al menos un sexo."
  else if (config.ageRuleMode === "MAX_AGE_ONLY" && categories.rows.length === 0) {
    blocked = "Agrega al menos una categoría Sub-N u Open."
  } else if (count > MAX_MODALITIES_PER_BATCH) {
    blocked = `Son ${count} pruebas y el máximo por lote es ${MAX_MODALITIES_PER_BATCH}: genéralas en varios lotes.`
  }

  const handleSubmit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    if (blocked || isPending) return
    const formData = new FormData(formEvent.currentTarget)
    startTransition(async () => {
      const result = await bulkGenerateModalities(formData)
      if (result.success) {
        const created = result.created ?? 0
        toast.success(`${plural(created, "prueba generada", "pruebas generadas")}.`)
        guard.reset()
        onClose()
      } else {
        toast.error(result.error ?? "No se pudieron generar las pruebas. Vuelve a intentarlo.")
      }
    })
  }

  return (
    <Dialog
      open
      onClose={guard.requestClose}
      title="Generar pruebas en lote"
      description="Crea una prueba por cada combinación de nombre, categoría y sexo. Por ejemplo: 3 nombres × 3 categorías × 2 sexos = 18 pruebas."
      className="sm:max-w-2xl"
    >
      <form onSubmit={handleSubmit} onChange={guard.markDirty} className="space-y-5">
        <input type="hidden" name="eventId" value={context.eventId} />
        <input
          type="hidden"
          name="categoriesText"
          value={categoryRowsToText(categories.rows, config.ageRuleMode)}
        />

        <DisciplineField
          context={context}
          idPrefix="bulk"
          value={discipline}
          onChange={setDiscipline}
        />

        <div>
          <Label htmlFor="bulk-names">Nombres de las pruebas (uno por línea)</Label>
          {suggestions.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {suggestions.map((name) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Agregar ${name} a la lista`}
                  onClick={() => {
                    guard.markDirty()
                    setNamesText((current) =>
                      [current.trim(), name].filter(Boolean).join("\n")
                    )
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> {name}
                </Button>
              ))}
            </div>
          ) : null}
          <Textarea
            id="bulk-names"
            name="namesText"
            rows={3}
            required
            placeholder={(preset?.modalities ?? [])
              .slice(0, 3)
              .map((modality) => modality.name)
              .join("\n")}
            value={namesText}
            onChange={(event) => setNamesText(event.target.value)}
          />
        </div>

        <CategoryRowsEditor
          idPrefix="bulk-category"
          rows={categories.rows}
          onAdd={categories.add}
          onRemove={categories.remove}
          onUpdate={categories.update}
          ageRuleMode={config.ageRuleMode}
          seasonYear={context.seasonYear}
          namePlaceholder={preset?.categoryPlaceholder ?? "Juvenil"}
          allowMaleYear={discipline === "ARTISTIC_SWIMMING"}
        />

        {context.isLevelChampionship && discipline === "ARTISTIC_SWIMMING" ? (
          <div>
            <Label htmlFor="bulk-level">Nivel</Label>
            <Select
              id="bulk-level"
              name="level"
              defaultValue=""
              aria-describedby="bulk-level-help"
            >
              <option value="">Sin nivel</option>
              {ARTISTIC_LEVEL_VALUES.map((level) => (
                <option key={level} value={level}>
                  {ARTISTIC_LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
            <p id="bulk-level-help" className={HELP}>
              El nivel se antepone a la categoría de cada prueba generada.
            </p>
          </div>
        ) : null}

        <fieldset>
          <legend className="text-sm font-semibold text-fdnda-ink">Sexos a generar</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {SEX_OPTIONS.map((value) => (
              <label key={value} className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="sexRules"
                  value={value}
                  checked={sexRules.includes(value)}
                  onChange={(event) =>
                    setSexRules((current) =>
                      event.target.checked
                        ? [...current, value]
                        : current.filter((rule) => rule !== value)
                    )
                  }
                  className="h-4 w-4 accent-fdnda-turquoise-deep"
                />
                {SEX_RULE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        {discipline === "ARTISTIC_SWIMMING" ? (
          <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-fdnda-surface px-3 py-2.5 text-sm">
            <input type="checkbox" name="allowsCategoryUpgrade" className={CHECK} />
            <span>
              <span className="font-medium text-fdnda-ink">Sube de categoría</span>
              <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                Cada categoría generada admite además a los nacidos en el año
                siguiente a su «Nacidos hasta». Las categorías sin «Nacidos hasta» se
                generan sin esta opción.
              </span>
            </span>
          </label>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="bulk-min">Integrantes mínimos</Label>
            <Input
              id="bulk-min"
              name="minAthletes"
              type="number"
              min={1}
              max={20}
              defaultValue={1}
              required
            />
          </div>
          <div>
            <Label htmlFor="bulk-max">Integrantes máximos</Label>
            <Input
              id="bulk-max"
              name="maxAthletes"
              type="number"
              min={1}
              max={20}
              defaultValue={1}
              required
            />
          </div>
        </div>

        <PriceFields context={context} discipline={discipline} idPrefix="bulk" current={null} />

        <DialogFormFooter
          guard={guard}
          discardTitle="¿Descartar el lote sin generar las pruebas?"
          discardConsequence="Se perderá lo que escribiste en este formulario."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {blocked ? (
              <p className="text-sm leading-5 text-fdnda-muted sm:mr-auto" role="status">
                {blocked}
              </p>
            ) : null}
            <Button variant="outline" onClick={guard.requestClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={Boolean(blocked)}
              loading={isPending}
              loadingText="Generando pruebas…"
            >
              {count > 0 && count <= MAX_MODALITIES_PER_BATCH
                ? `Generar ${plural(count, "prueba", "pruebas")}`
                : "Generar pruebas"}
            </Button>
          </div>
        </DialogFormFooter>
      </form>
    </Dialog>
  )
}
