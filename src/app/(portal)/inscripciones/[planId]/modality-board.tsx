"use client"

import { useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ChevronRight, Lock, Trash2, Users } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button, buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ARTISTIC_LEVEL_LABELS, groupByLevel, isArtisticLevel } from "@/lib/artistic-levels"
import { disciplineLabel } from "@/lib/disciplines"
import { athleteEligibilityError, competesUpACategory } from "@/lib/eligibility"
import { leaguePriceBreakdown } from "@/lib/league"
import { birthYearOf, formatMoney, plural, SEX_LABELS } from "@/lib/utils"
import type { AthleteView, EntryView, ModalityView } from "../types"
import { AthleteFilter, FILTER_FROM, matchesAthleteFilter } from "./athlete-filter"
import {
  athleteName,
  isDivingPair,
  modalityLabel,
  ruleLabel,
  uncoveredDisciplines,
  type EntryPriceNote,
} from "./plan-labels"
import { TeamFormationPanel, type FormationDraft } from "./team-formation-panel"

// Paso «Pruebas y deportistas»: el club elige una prueba de la competencia y
// marca, entre los deportistas de su padrón, a los que cumplen sus condiciones
// (disciplina, año de nacimiento y sexo). Marcar a alguien lo suma a la
// planilla; abajo queda el resumen por deportista para revisar o quitar.

export interface AthleteFeeNote {
  label: string
  amount: number
}

export function ModalityBoard({
  athletes,
  roster,
  entries,
  modalities,
  lockedPairs,
  athleteFees,
  entryPriceNote,
  activeModalityId,
  editing,
  readOnly,
  blocked,
  formationSaving,
  chargeSelection,
  onSelectModality,
  onToggleModality,
  onRemoveAthlete,
  onStartFormation,
  onEditFormation,
  onChangeFormation,
  onDeleteFormation,
  onCloseFormation,
}: {
  /** Padrón de las disciplinas de la competencia, más quien ya esté en la planilla. */
  athletes: AthleteView[]
  roster: AthleteView[]
  entries: EntryView[]
  modalities: ModalityView[]
  /** Por deportista: prueba → estado de la inscripción ya hecha en otra orden. */
  lockedPairs: Map<string, Map<string, string>>
  athleteFees: AthleteFeeNote[]
  entryPriceNote: EntryPriceNote
  activeModalityId: string
  editing: FormationDraft | null
  readOnly: boolean
  /** La planilla dejó de aceptar cambios hasta recargar. */
  blocked: boolean
  /** Hay un guardado en curso: el editor de formaciones espera a que termine. */
  formationSaving: boolean
  /** «Qué paga tu club», solo si la competencia cobra dos conceptos. */
  chargeSelection?: ReactNode
  onSelectModality: (modalityId: string) => void
  onToggleModality: (athleteId: string, modalityId: string, selected: boolean) => void
  onRemoveAthlete: (athlete: AthleteView) => void
  onStartFormation: () => void
  onEditFormation: (draft: FormationDraft) => void
  onChangeFormation: (draft: FormationDraft) => void
  onDeleteFormation: (entryId: string) => Promise<void>
  onCloseFormation: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const eventDisciplines = [...new Set(modalities.map((row) => row.discipline))]
  const active =
    modalities.find((row) => row.id === activeModalityId) ?? modalities[0] ?? null

  const entriesByModality = new Map<string, EntryView[]>()
  for (const entry of entries) {
    const list = entriesByModality.get(entry.modalityId) ?? []
    list.push(entry)
    entriesByModality.set(entry.modalityId, list)
  }

  function selectModality(modalityId: string) {
    onSelectModality(modalityId)
    // En pantallas angostas la lista queda arriba del panel: se lleva la vista
    // a los deportistas de la prueba recién elegida.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      )
    }
  }

  if (modalities.length === 0) {
    return (
      <Card>
        <EmptyState icon={Users} title="Esta competencia aún no tiene pruebas">
          Cuando la FDNDA publique sus pruebas podrás inscribir a tus deportistas
          aquí.
        </EmptyState>
      </Card>
    )
  }

  return (
    <section className="space-y-5" aria-labelledby="board-heading">
      <div>
        <h2 id="board-heading" className="font-heading text-2xl text-fdnda-navy">
          Arma tu planilla
        </h2>
        <p className="mt-1 text-sm text-fdnda-muted">
          Elige una prueba y marca a los deportistas de tu padrón que van a
          competir en ella. Solo aparecen los que cumplen sus condiciones.
        </p>
      </div>

      {chargeSelection}

      {athleteFees.map((fee) => (
        <p
          key={fee.label}
          className="rounded-control bg-fdnda-sky/30 px-3 py-2 text-xs font-semibold text-fdnda-navy"
        >
          Cuota de competencia de {fee.label}: {formatMoney(fee.amount)} por
          deportista. Se cobra una vez aunque participe en varias pruebas de{" "}
          {fee.label}; si ya la pagaste en otra orden de esta competencia, no se
          vuelve a cobrar.
        </p>
      ))}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ModalityList
          modalities={modalities}
          activeId={active?.id ?? ""}
          entriesByModality={entriesByModality}
          onSelect={selectModality}
        />
        <div ref={panelRef} className="scroll-mt-24">
          {active ? (
            <Card lanes={[active.discipline]} className="overflow-hidden">
              <ModalityHeader modality={active} entryPriceNote={entryPriceNote} />
              {active.maxAthletes === 1 ? (
                <IndividualAthletes
                  key={active.id}
                  modality={active}
                  athletes={athletes}
                  entries={entriesByModality.get(active.id) ?? []}
                  lockedPairs={lockedPairs}
                  readOnly={readOnly}
                  disabled={readOnly || blocked}
                  onToggle={(athleteId, selected) =>
                    onToggleModality(athleteId, active.id, selected)
                  }
                />
              ) : (
                <TeamFormationPanel
                  key={active.id}
                  modality={active}
                  athletes={athletes}
                  entries={entries}
                  editing={editing}
                  readOnly={readOnly}
                  saving={formationSaving}
                  onStartNew={onStartFormation}
                  onStartEdit={onEditFormation}
                  onChange={onChangeFormation}
                  onDelete={onDeleteFormation}
                  onClose={onCloseFormation}
                />
              )}
            </Card>
          ) : null}
        </div>
      </div>

      <RosterSummary
        roster={roster}
        entries={entries}
        modalities={modalities}
        eventDisciplines={eventDisciplines}
        readOnly={readOnly}
        disabled={readOnly || blocked}
        onSelectModality={selectModality}
        onRemove={onRemoveAthlete}
      />
    </section>
  )
}

// Lista de pruebas, por disciplina y, en el campeonato de niveles, por nivel.
function ModalityList({
  modalities,
  activeId,
  entriesByModality,
  onSelect,
}: {
  modalities: ModalityView[]
  activeId: string
  entriesByModality: Map<string, EntryView[]>
  onSelect: (modalityId: string) => void
}) {
  const disciplines = [...new Set(modalities.map((row) => row.discipline))]
  return (
    <Card className="overflow-hidden lg:sticky lg:top-4">
      <p className="border-b border-fdnda-border bg-fdnda-surface px-4 py-3 text-sm font-semibold text-fdnda-muted">
        {plural(modalities.length, "prueba", "pruebas")} en esta competencia
      </p>
      <nav
        aria-label="Pruebas de la competencia"
        className="max-h-[28rem] overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        {disciplines.map((discipline) => (
          <div key={discipline}>
            {disciplines.length > 1 ? (
              <h3 className="border-b border-fdnda-border bg-white px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-fdnda-navy">
                {disciplineLabel(discipline)}
              </h3>
            ) : null}
            {groupByLevel(modalities.filter((row) => row.discipline === discipline)).map(
              (group) => (
                <div key={group.level ?? "sin-nivel"}>
                  {group.level ? (
                    <h4 className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-fdnda-turquoise-deep">
                      {ARTISTIC_LEVEL_LABELS[group.level]}
                    </h4>
                  ) : null}
                  <ul>
                    {group.rows.map((modality) => {
                      const current = modality.id === activeId
                      const count = entriesByModality.get(modality.id)?.length ?? 0
                      const team = modality.maxAthletes > 1
                      const pair = isDivingPair(modality)
                      return (
                        <li key={modality.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(modality.id)}
                            aria-current={current ? "true" : undefined}
                            className={`flex min-h-12 w-full items-center gap-2 border-l-4 px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none ${
                              current
                                ? "border-fdnda-navy bg-fdnda-navy-soft"
                                : "border-transparent hover:bg-fdnda-surface"
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-fdnda-ink">
                                {modalityLabel(modality, group.level)}
                              </span>
                              <span className="block text-xs text-fdnda-muted">
                                {ruleLabel(modality)}
                              </span>
                            </span>
                            {count > 0 ? (
                              <Badge variant="accent">
                                {team
                                  ? plural(count, pair ? "pareja" : "formación", pair ? "parejas" : "formaciones")
                                  : plural(count, "inscrito", "inscritos")}
                              </Badge>
                            ) : null}
                            <ChevronRight
                              className={`h-4 w-4 shrink-0 ${current ? "text-fdnda-navy" : "text-fdnda-muted"}`}
                              aria-hidden="true"
                            />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            )}
          </div>
        ))}
      </nav>
    </Card>
  )
}

function ModalityHeader({
  modality,
  entryPriceNote,
}: {
  modality: ModalityView
  entryPriceNote: EntryPriceNote
}) {
  return (
    <div className="border-b border-fdnda-border bg-fdnda-surface px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
        {disciplineLabel(modality.discipline)}
        {modality.level && isArtisticLevel(modality.level)
          ? ` · ${ARTISTIC_LEVEL_LABELS[modality.level]}`
          : ""}
      </p>
      <h3 className="font-heading text-xl text-fdnda-navy">{modalityLabel(modality)}</h3>
      <p className="mt-1 text-xs text-fdnda-muted">
        {ruleLabel(modality)} · {entryPriceNote(modality)}
        {modality.upgradeYear
          ? ` · admite nacidos en ${modality.upgradeYear} por ascenso de categoría`
          : ""}
      </p>
      {modality.chargesEntry &&
      modality.pricePerMatch !== null &&
      modality.matchesPerTeam !== null ? (
        <p className="mt-1 text-xs font-semibold text-fdnda-navy">
          {leaguePriceBreakdown({
            pricePerMatch: modality.pricePerMatch,
            matchesPerTeam: modality.matchesPerTeam,
          })}
        </p>
      ) : null}
    </div>
  )
}

// Casillas de una prueba individual: un deportista elegible por fila.
function IndividualAthletes({
  modality,
  athletes,
  entries,
  lockedPairs,
  readOnly,
  disabled,
  onToggle,
}: {
  modality: ModalityView
  athletes: AthleteView[]
  /** Inscripciones de esta planilla en esta prueba. */
  entries: EntryView[]
  lockedPairs: Map<string, Map<string, string>>
  readOnly: boolean
  disabled: boolean
  onToggle: (athleteId: string, selected: boolean) => void
}) {
  const [filter, setFilter] = useState("")
  const selected = new Set(entries.flatMap((entry) => entry.athleteIds))
  const practising = athletes.filter((athlete) =>
    athlete.disciplines.includes(modality.discipline)
  )
  const rows: { athlete: AthleteView; reason: string | null }[] = []
  const ineligible: { athlete: AthleteView; reason: string }[] = []
  for (const athlete of athletes) {
    const reason = athlete.disciplines.includes(modality.discipline)
      ? athleteEligibilityError(modality, athlete)
      : `No tiene ${disciplineLabel(modality.discipline)} registrada en el padrón.`
    // Quien ya está marcado sigue visible aunque haya dejado de ser elegible:
    // sin eso no habría forma de desmarcarlo.
    if (reason === null || selected.has(athlete.id)) rows.push({ athlete, reason })
    else if (practising.includes(athlete)) ineligible.push({ athlete, reason })
  }
  const visible = rows.filter(({ athlete }) => matchesAthleteFilter(athlete, filter))
  const markedCount = rows.filter(
    ({ athlete }) =>
      selected.has(athlete.id) || lockedPairs.get(athlete.id)?.has(modality.id)
  ).length

  if (rows.length === 0) {
    return (
      <div className="space-y-3 px-4 py-5 text-sm text-fdnda-muted">
        <p>
          {practising.length === 0
            ? `Ningún deportista de tu padrón tiene ${disciplineLabel(modality.discipline)} registrada.`
            : `Ninguno de tus ${plural(practising.length, "deportista", "deportistas")} de ${disciplineLabel(modality.discipline)} cumple las condiciones de esta prueba.`}
        </p>
        <Link href="/deportistas" className={buttonClasses({ variant: "outline", size: "sm" })}>
          Abrir el padrón de deportistas
        </Link>
        <IneligibleList rows={ineligible} />
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fdnda-navy" aria-live="polite">
          {plural(markedCount, "marcado", "marcados")} de{" "}
          {plural(rows.length, "deportista elegible", "deportistas elegibles")}
        </p>
      </div>
      {rows.length >= FILTER_FROM ? (
        <AthleteFilter value={filter} onChange={setFilter} />
      ) : null}
      <ul className="divide-y divide-fdnda-border rounded-control border border-fdnda-border bg-white">
        {visible.length === 0 ? (
          <li className="px-3 py-3 text-sm text-fdnda-muted">
            Nadie coincide con «{filter.trim()}».
          </li>
        ) : null}
        {visible.map(({ athlete, reason }) => {
          const lockedStatus = lockedPairs.get(athlete.id)?.get(modality.id)
          const locked = lockedStatus !== undefined
          const checked = locked || selected.has(athlete.id)
          const uncovered = uncoveredDisciplines(athlete, [modality.discipline])
          const upgraded = reason === null && competesUpACategory(modality, athlete)
          return (
            <li key={athlete.id}>
              <label
                className={`flex min-h-14 items-center gap-3 px-3 py-2 text-sm transition-colors motion-reduce:transition-none ${
                  locked
                    ? "cursor-not-allowed bg-fdnda-sunken text-fdnda-muted"
                    : "cursor-pointer hover:bg-fdnda-surface has-checked:bg-fdnda-navy-soft"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked || readOnly || disabled}
                  onChange={(event) => onToggle(athlete.id, event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-fdnda-navy"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-fdnda-ink">
                    {athleteName(athlete)}
                  </span>
                  <span className="block text-xs text-fdnda-muted">
                    {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
                    <span className="num">{birthYearOf(athlete.birthDate)}</span> ·{" "}
                    {SEX_LABELS[athlete.sex]}
                    {locked
                      ? ` · Ya inscrito en otra orden (${lockedStatus === "PAID" ? "pagada" : "pago pendiente"})`
                      : reason
                        ? ` · ${reason}`
                        : ""}
                  </span>
                </span>
                {upgraded ? <Badge variant="accent">Sube de categoría</Badge> : null}
                {uncovered.length > 0 ? (
                  <Badge variant="warning">Sin afiliar</Badge>
                ) : null}
                {locked ? <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              </label>
            </li>
          )
        })}
      </ul>
      {rows.some(({ athlete }) => uncoveredDisciplines(athlete, [modality.discipline]).length > 0) ? (
        <p className="text-xs text-fdnda-muted">
          Los deportistas «Sin afiliar» no tienen una afiliación de{" "}
          {disciplineLabel(modality.discipline)} que cubra esta competencia: puedes
          marcarlos, pero la planilla no se podrá pagar hasta{" "}
          <Link
            href="/afiliacion?tab=deportistas"
            className="font-semibold text-fdnda-navy underline underline-offset-2"
          >
            afiliarlos
          </Link>
          .
        </p>
      ) : null}
      <IneligibleList rows={ineligible} />
    </div>
  )
}

function IneligibleList({ rows }: { rows: { athlete: AthleteView; reason: string }[] }) {
  if (rows.length === 0) return null
  return (
    <details className="rounded-control border border-fdnda-border bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-fdnda-navy">
        {plural(rows.length, "deportista no cumple", "deportistas no cumplen")} las
        condiciones
      </summary>
      <ul className="max-h-72 divide-y divide-fdnda-border overflow-y-auto border-t border-fdnda-border">
        {rows.map(({ athlete, reason }) => (
          <li key={athlete.id} className="px-3 py-2 text-sm">
            <span className="block font-medium text-fdnda-ink">{athleteName(athlete)}</span>
            <span className="block text-xs text-fdnda-muted">{reason}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

// Resumen por deportista de lo marcado: para revisar de un vistazo y quitar a
// alguien de la planilla con todas sus pruebas.
function RosterSummary({
  roster,
  entries,
  modalities,
  eventDisciplines,
  readOnly,
  disabled,
  onSelectModality,
  onRemove,
}: {
  roster: AthleteView[]
  entries: EntryView[]
  modalities: ModalityView[]
  eventDisciplines: string[]
  readOnly: boolean
  disabled: boolean
  onSelectModality: (modalityId: string) => void
  onRemove: (athlete: AthleteView) => void
}) {
  const modalityById = new Map(modalities.map((row) => [row.id, row]))
  const byAthlete = new Map<string, ModalityView[]>()
  for (const entry of entries) {
    const modality = modalityById.get(entry.modalityId)
    if (!modality) continue
    for (const athleteId of entry.athleteIds) {
      const list = byAthlete.get(athleteId) ?? []
      if (!list.includes(modality)) list.push(modality)
      byAthlete.set(athleteId, list)
    }
  }

  return (
    <Card lanes={eventDisciplines} className="overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-fdnda-border bg-fdnda-surface px-5 py-4">
        <span className="num text-metric text-fdnda-navy">{roster.length}</span>
        <span className="text-sm font-semibold text-fdnda-muted">
          {roster.length === 1 ? "deportista en la planilla" : "deportistas en la planilla"}
        </span>
      </div>
      {roster.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Users className="h-8 w-8 text-fdnda-muted" aria-hidden="true" />
          <p className="text-sm text-fdnda-muted">
            {readOnly
              ? "Esta planilla no tiene deportistas."
              : "Elige una prueba arriba y marca a tus deportistas: aparecerán aquí."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-fdnda-border">
          {roster.map((athlete) => {
            const name = athleteName(athlete)
            const own = byAthlete.get(athlete.id) ?? []
            const uncovered = uncoveredDisciplines(athlete, eventDisciplines)
            return (
              <li
                key={athlete.id}
                id={`athlete-${athlete.id}`}
                tabIndex={-1}
                className="flex scroll-mt-24 flex-wrap items-center gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fdnda-turquoise"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-fdnda-ink">{name}</span>
                  <span className="block text-xs text-fdnda-muted">
                    {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
                    <span className="num">{birthYearOf(athlete.birthDate)}</span> ·{" "}
                    {SEX_LABELS[athlete.sex]}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {own.length === 0 ? (
                      <Badge variant="neutral">Sin pruebas marcadas</Badge>
                    ) : (
                      own.map((modality) => (
                        <button
                          key={modality.id}
                          type="button"
                          onClick={() => onSelectModality(modality.id)}
                          className="rounded-full"
                          aria-label={`Ver la prueba ${modalityLabel(modality)}`}
                        >
                          <Badge variant="accent">{modalityLabel(modality)}</Badge>
                        </button>
                      ))
                    )}
                    {uncovered.map((discipline) => (
                      <Badge key={discipline} variant="warning">
                        Sin afiliar en {disciplineLabel(discipline)}
                      </Badge>
                    ))}
                  </span>
                </span>
                {!readOnly ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Quitar a ${name} de la planilla`}
                    onClick={() => onRemove(athlete)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
