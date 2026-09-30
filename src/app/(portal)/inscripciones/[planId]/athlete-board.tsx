"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Plus, Search, SearchX, Users } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button, buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly, SEX_LABELS, plural } from "@/lib/utils"
import { AthleteEntryCard } from "./athlete-entry-card"
import { athleteName, isDivingPair, modalityLabel, uncoveredDisciplines, type EntryPriceNote } from "./plan-labels"
import { TeamFormationPanel, type FormationDraft } from "./team-formation-panel"
import type {
  AthletePageView,
  AthleteView,
  EntryView,
  ModalityView,
} from "../types"

// Paso «Deportistas y pruebas»: una sola pantalla. Arriba el buscador del
// padrón; abajo, una tarjeta por deportista donde se marcan sus pruebas
// individuales. Las de equipo tienen su propio panel al final.

export function AthleteBoard({
  athletePage,
  roster,
  entries,
  modalities,
  lockedPairs,
  athleteFeesFor,
  entryPriceNote,
  expandedAthleteId,
  teamModalityId,
  editing,
  readOnly,
  blocked,
  formationSaving,
  query,
  searchedQuery,
  isNavigating,
  pageHref,
  chargeSelection,
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
  /** Por deportista: prueba → estado de la inscripción ya hecha en otra orden. */
  lockedPairs: Map<string, Map<string, string>>
  athleteFeesFor: (athlete: AthleteView) => { label: string; amount: number }[]
  entryPriceNote: EntryPriceNote
  expandedAthleteId: string | null
  teamModalityId: string
  editing: FormationDraft | null
  readOnly: boolean
  /** La planilla dejó de aceptar cambios hasta recargar. */
  blocked: boolean
  /** Hay un guardado en curso: el editor de formaciones espera a que termine. */
  formationSaving: boolean
  query: string
  /** Búsqueda que produjo `athletePage` (la de la URL), no la que se escribe. */
  searchedQuery: string
  isNavigating: boolean
  pageHref: (page: number) => string
  /** «Qué paga tu club», solo si la competencia cobra dos conceptos. */
  chargeSelection?: ReactNode
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
  onDeleteFormation: (entryId: string) => Promise<void>
  onCloseFormation: () => void
}) {
  const individualModalities = modalities.filter((row) => row.maxAthletes === 1)
  const teamModalities = modalities.filter((row) => row.maxAthletes > 1)
  const divingPairsOnly =
    teamModalities.length > 0 && teamModalities.every(isDivingPair)
  const rosterIds = new Set(roster.map((athlete) => athlete.id))
  // Las disciplinas que realmente ofrece esta competencia, deducidas de sus
  // pruebas: es lo que pinta la franja de la planilla.
  const eventDisciplines = [...new Set(modalities.map((row) => row.discipline))]
  const disabled = readOnly || blocked

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
        list.push(modalityLabel(modality))
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
          Busca en tu padrón, agrega a cada deportista y marca sus pruebas.
        </p>
      </div>

      {chargeSelection}

      {!readOnly ? (
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            onSearch()
          }}
        >
          <label className="relative flex-1">
            <span className="sr-only">Buscar deportista en tu padrón</span>
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
      ) : null}

      {readOnly ? null : searchedQuery && athletePage.total === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title={`No encontramos «${searchedQuery}» en tu padrón`}
            action={
              <Link href="/deportistas" className={buttonClasses({ variant: "outline" })}>
                Registrar deportista en el padrón
              </Link>
            }
          >
            Revisa el nombre o el número de documento. Aquí solo aparecen los
            deportistas del padrón de tu club.
          </EmptyState>
        </Card>
      ) : notInRoster.length > 0 ? (
        <Card className="overflow-hidden">
          <p className="border-b border-fdnda-border bg-fdnda-surface px-4 py-3 text-sm font-semibold text-fdnda-muted">
            {searchedQuery
              ? `${plural(athletePage.total, "coincidencia", "coincidencias")} con «${searchedQuery}»`
              : `Tu padrón · ${plural(athletePage.total, "deportista", "deportistas")}`}
          </p>
          <ul className="divide-y divide-fdnda-border">
            {notInRoster.map((athlete) => {
              const name = athleteName(athlete)
              const practisesEvent = eventDisciplines.some((discipline) =>
                athlete.disciplines.includes(discipline)
              )
              const uncovered = uncoveredDisciplines(athlete, eventDisciplines)
              return (
                <li
                  key={athlete.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-fdnda-ink">
                      {name}
                    </span>
                    <span className="block text-xs text-fdnda-muted">
                      {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
                      <span className="num">{formatDateOnly(athlete.birthDate)}</span> ·{" "}
                      {SEX_LABELS[athlete.sex]}
                    </span>
                    {!practisesEvent || uncovered.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {!practisesEvent ? (
                          <Badge variant="neutral">
                            No practica {eventDisciplines.map(disciplineLabel).join(", ")}
                          </Badge>
                        ) : null}
                        {uncovered.map((discipline) => (
                          <Badge key={discipline} variant="warning">
                            Sin afiliar en {disciplineLabel(discipline)}
                          </Badge>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {uncovered.length > 0 ? (
                    <Link
                      href="/afiliacion?tab=deportistas"
                      aria-label={`Afiliar a ${name}`}
                      className={buttonClasses({ variant: "ghost", size: "sm" })}
                    >
                      Afiliar
                    </Link>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Agregar a ${name} a la planilla`}
                    onClick={() => onAddAthlete(athlete)}
                    disabled={disabled}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Agregar
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : athletePage.rows.length > 0 ? (
        <p className="text-sm text-fdnda-muted">
          Todos los deportistas de esta página ya están en la planilla.
        </p>
      ) : null}

      {!readOnly && athletePage.pageCount > 1 ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Páginas del padrón"
        >
          {athletePage.page > 1 ? (
            <Link
              className="text-sm font-bold text-fdnda-navy underline-offset-4 hover:underline"
              href={pageHref(athletePage.page - 1)}
            >
              Resultados anteriores
            </Link>
          ) : (
            <span aria-disabled="true" className="text-sm font-bold text-fdnda-muted opacity-60">
              Resultados anteriores
            </span>
          )}
          <span className="text-sm text-fdnda-muted">
            Página {athletePage.page} de {athletePage.pageCount}
          </span>
          {athletePage.page < athletePage.pageCount ? (
            <Link
              className="text-sm font-bold text-fdnda-navy underline-offset-4 hover:underline"
              href={pageHref(athletePage.page + 1)}
            >
              Más resultados
            </Link>
          ) : (
            <span aria-disabled="true" className="text-sm font-bold text-fdnda-muted opacity-60">
              Más resultados
            </span>
          )}
        </nav>
      ) : null}

      {/* La planilla es el dato que el delegado mira cien veces mientras la
          arma: una barra de estado con la cifra y la franja de las disciplinas
          de la competencia. */}
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
                : "Busca a tus deportistas arriba y agrégalos para marcar sus pruebas."}
            </p>
          </div>
        ) : (
          <ul>
            {roster.map((athlete) => (
              <AthleteEntryCard
                key={athlete.id}
                athlete={athlete}
                individualModalities={individualModalities}
                eventDisciplines={eventDisciplines}
                selectedModalityIds={selectedByAthlete.get(athlete.id) ?? new Set()}
                lockedModalities={lockedPairs.get(athlete.id) ?? new Map()}
                teamEntryLabels={teamsByAthlete.get(athlete.id) ?? []}
                divingPairsOnly={divingPairsOnly}
                expanded={expandedAthleteId === athlete.id}
                readOnly={readOnly}
                disabled={disabled}
                athleteFees={athleteFeesFor(athlete)}
                entryPriceNote={entryPriceNote}
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
        <section className="space-y-3" aria-labelledby="teams-heading">
          <div>
            <h3 id="teams-heading" className="font-heading text-lg font-bold text-fdnda-navy">
              {divingPairsOnly ? "Clavados sincronizados" : "Pruebas de equipo"}
            </h3>
            <p className="mt-1 text-sm text-fdnda-muted">
              {divingPairsOnly
                ? "Forma una pareja de dos clavadistas para cada inscripción sincronizada."
                : "Arma aquí cada formación con sus integrantes y, si la prueba lo admite, sus reservas."}
            </p>
          </div>
          <TeamFormationPanel
            modalities={teamModalities}
            activeModalityId={teamModalityId || teamModalities[0].id}
            roster={roster}
            entries={entries}
            editing={editing}
            readOnly={readOnly}
            saving={formationSaving}
            entryPriceNote={entryPriceNote}
            onSelectModality={onSelectTeamModality}
            onStartNew={onStartFormation}
            onStartEdit={onEditFormation}
            onChange={onChangeFormation}
            onDelete={onDeleteFormation}
            onClose={onCloseFormation}
          />
        </section>
      ) : null}
    </section>
  )
}
