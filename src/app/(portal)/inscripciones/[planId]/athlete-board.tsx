"use client"

import Link from "next/link"
import { Plus, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatDateOnly, SEX_LABELS } from "@/lib/utils"
import { AthleteEntryCard } from "./athlete-entry-card"
import { TeamFormationPanel, type FormationDraft } from "./team-formation-panel"
import type {
  AthletePageView,
  AthleteView,
  EntryView,
  ModalityView,
} from "../types"

// Paso 2: una sola pantalla. Arriba el buscador para sumar deportistas a la
// nómina; abajo, una tarjeta por deportista donde se marcan sus pruebas
// individuales. Las de equipo tienen su propio panel al final.

export function AthleteBoard({
  athletePage,
  roster,
  entries,
  modalities,
  lockedPairs,
  athleteFeeFor,
  expandedAthleteId,
  teamModalityId,
  editing,
  readOnly,
  busy,
  query,
  isNavigating,
  pageHref,
  onQueryChange,
  onSearch,
  onAddAthlete,
  onRemoveAthlete,
  onToggleExpand,
  onToggleModality,
  onSelectTeamModality,
  onStartFormation,
  onEditFormation,
  onChangeFormation,
  onDeleteFormation,
  onCloseFormation,
}: {
  athletePage: AthletePageView
  roster: AthleteView[]
  entries: EntryView[]
  modalities: ModalityView[]
  lockedPairs: Map<string, Set<string>>
  athleteFeeFor: (
    athlete: AthleteView
  ) => { label: string; amount: number; covered: boolean } | null
  expandedAthleteId: string | null
  teamModalityId: string
  editing: FormationDraft | null
  readOnly: boolean
  busy: boolean
  query: string
  isNavigating: boolean
  pageHref: (page: number) => string
  onQueryChange: (value: string) => void
  onSearch: () => void
  onAddAthlete: (athlete: AthleteView) => void
  onRemoveAthlete: (athlete: AthleteView) => void
  onToggleExpand: (athleteId: string) => void
  onToggleModality: (
    athleteId: string,
    modalityId: string,
    selected: boolean
  ) => void
  onSelectTeamModality: (modalityId: string) => void
  onStartFormation: () => void
  onEditFormation: (draft: FormationDraft) => void
  onChangeFormation: (draft: FormationDraft) => void
  onDeleteFormation: (entryId: string) => void
  onCloseFormation: () => void
}) {
  const individualModalities = modalities.filter((row) => row.maxAthletes === 1)
  const teamModalities = modalities.filter((row) => row.maxAthletes > 1)
  const rosterIds = new Set(roster.map((athlete) => athlete.id))
  // Las disciplinas que realmente ofrece esta competencia, deducidas de sus
  // pruebas: es lo que pinta la franja de la nómina.
  const eventDisciplines = [...new Set(modalities.map((row) => row.discipline))]

  // Pruebas individuales marcadas por deportista.
  const selectedByAthlete = new Map<string, Set<string>>()
  // Formaciones de equipo en las que participa cada deportista.
  const teamsByAthlete = new Map<string, string[]>()
  for (const entry of entries) {
    const modality = modalities.find((row) => row.id === entry.modalityId)
    if (!modality) continue
    for (const athleteId of entry.athleteIds) {
      if (modality.maxAthletes === 1) {
        const set = selectedByAthlete.get(athleteId) ?? new Set<string>()
        set.add(entry.modalityId)
        selectedByAthlete.set(athleteId, set)
      } else {
        const list = teamsByAthlete.get(athleteId) ?? []
        list.push([modality.name, modality.category].filter(Boolean).join(" · "))
        teamsByAthlete.set(athleteId, list)
      }
    }
  }

  const notInRoster = athletePage.rows.filter(
    (athlete) => !rosterIds.has(athlete.id)
  )

  return (
    <section className="space-y-5" aria-labelledby="board-heading">
      <div>
        <h2 id="board-heading" className="font-heading text-2xl text-fdnda-navy">
          Arma tu planilla
        </h2>
        <p className="mt-1 text-sm text-fdnda-muted">
          Busca a un deportista, agrégalo y marca sus pruebas en la misma pantalla.
          Todo se guarda solo.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        <label className="relative flex-1">
          <span className="sr-only">Buscar deportista</span>
          <Search
            className="pointer-events-none absolute left-3 top-3.5 z-10 h-4 w-4 text-fdnda-muted"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Nombre o documento"
            className="pl-10"
          />
        </label>
        <Button type="submit" variant="outline" loading={isNavigating}>
          Buscar
        </Button>
      </form>

      {notInRoster.length > 0 && !readOnly ? (
        <Card className="overflow-hidden">
          <div className="border-b border-fdnda-border bg-fdnda-surface px-4 py-3 text-eyebrow uppercase text-fdnda-muted">
            Agregar a la planilla · <span className="num">{athletePage.total}</span>{" "}
            resultado(s)
          </div>
          <ul className="divide-y divide-fdnda-border">
            {notInRoster.map((athlete) => (
              <li
                key={athlete.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-fdnda-ink">
                    {athlete.lastNames}, {athlete.firstNames}
                  </span>
                  <span className="block text-xs text-fdnda-muted">
                    {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
                    <span className="num">{formatDateOnly(athlete.birthDate)}</span> ·{" "}
                    {SEX_LABELS[athlete.sex]}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddAthlete(athlete)}
                  disabled={busy}
                >
                  <Plus className="h-4 w-4" /> Agregar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {athletePage.pageCount > 1 ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Páginas de deportistas"
        >
          <Link
            className={`text-sm font-bold text-fdnda-navy ${athletePage.page <= 1 ? "pointer-events-none opacity-40" : ""}`}
            href={pageHref(athletePage.page - 1)}
          >
            Anterior
          </Link>
          <span className="text-sm text-fdnda-muted">
            Página {athletePage.page} de {athletePage.pageCount}
          </span>
          <Link
            className={`text-sm font-bold text-fdnda-navy ${athletePage.page >= athletePage.pageCount ? "pointer-events-none opacity-40" : ""}`}
            href={pageHref(athletePage.page + 1)}
          >
            Siguiente
          </Link>
        </nav>
      ) : null}

      {/* La nómina es el dato que el delegado mira cien veces mientras arma la
          planilla, y estaba dicho en la misma voz que todo lo demás. Ahora es
          una barra de estado con la cifra en el rango de métrica y la franja de
          las disciplinas de la competencia. */}
      <Card lanes={eventDisciplines} className="overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-fdnda-border bg-fdnda-surface px-5 py-4">
          <span className="num text-metric text-fdnda-navy">{roster.length}</span>
          <span className="text-eyebrow uppercase text-fdnda-muted">
            deportista(s) en la planilla
          </span>
        </div>
        {roster.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Users className="h-8 w-8 text-fdnda-muted" aria-hidden="true" />
            <p className="text-sm text-fdnda-muted">
              Busca a tus deportistas arriba y agrégalos para asignarles pruebas.
            </p>
          </div>
        ) : (
          <ul>
            {roster.map((athlete) => (
              <AthleteEntryCard
                key={athlete.id}
                athlete={athlete}
                individualModalities={individualModalities}
                selectedModalityIds={selectedByAthlete.get(athlete.id) ?? new Set()}
                lockedModalityIds={lockedPairs.get(athlete.id) ?? new Set()}
                teamEntryLabels={teamsByAthlete.get(athlete.id) ?? []}
                expanded={expandedAthleteId === athlete.id}
                readOnly={readOnly}
                busy={busy}
                athleteFee={athleteFeeFor(athlete)}
                onToggleExpand={() => onToggleExpand(athlete.id)}
                onToggleModality={(modalityId, selected) =>
                  onToggleModality(athlete.id, modalityId, selected)
                }
                onRemove={() => onRemoveAthlete(athlete)}
              />
            ))}
          </ul>
        )}
      </Card>

      {teamModalities.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-heading text-lg font-bold text-fdnda-navy">
            Duetos, equipos y planteles
          </h3>
          <TeamFormationPanel
            modalities={teamModalities}
            activeModalityId={teamModalityId || teamModalities[0].id}
            roster={roster}
            entries={entries}
            editing={editing}
            readOnly={readOnly}
            saving={busy}
            onSelectModality={onSelectTeamModality}
            onStartNew={onStartFormation}
            onStartEdit={onEditFormation}
            onChange={onChangeFormation}
            onDelete={onDeleteFormation}
            onClose={onCloseFormation}
          />
        </div>
      ) : null}
    </section>
  )
}
