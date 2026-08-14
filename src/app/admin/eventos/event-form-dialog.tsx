"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Dialog } from "@/components/ui/dialog"
import { DISCIPLINE_VALUES, DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { DISCIPLINE_PRESETS } from "@/lib/event-presets"
import type { AgeRuleModeValue } from "@/lib/event-pricing"
import { leagueTotalMatches } from "@/lib/league"
import { saveEvent } from "./actions"

export interface EventFormData {
  id: string
  name: string
  disciplines: string[]
  venue: string
  city: string
  startDateISO: string // YYYY-MM-DD
  endDateISO: string
  deadlineLocal: string // YYYY-MM-DDTHH:mm (hora Lima)
  description: string
  seasonId: string
  chargesEntry: boolean
  chargesAthleteFee: boolean
  isLeague: boolean
  athleteFee: string
  ageRuleMode: AgeRuleModeValue
  /** true si el evento ya vendió inscripciones: la configuración se congela. */
  hasLockedEntries: boolean
}

export interface SeasonOption {
  id: string
  name: string
  year: number
  isCurrent: boolean
}

interface CategoryDraft {
  id: number
  label: string
  birthYearFrom: string
  birthYearTo: string
  maxAgeYears: string
  isOpen: boolean
  expectedFemaleTeams: string
  expectedMaleTeams: string
}

function emptyCategory(id: number): CategoryDraft {
  return {
    id,
    label: "",
    birthYearFrom: "",
    birthYearTo: "",
    maxAgeYears: "",
    isOpen: false,
    expectedFemaleTeams: "3",
    expectedMaleTeams: "3",
  }
}

function isDisciplineValue(value: string): value is DisciplineValue {
  return (DISCIPLINE_VALUES as readonly string[]).includes(value)
}

export function EventFormFields({
  event,
  seasons,
}: {
  event?: EventFormData
  seasons: SeasonOption[]
}) {
  // Un evento pertenece a una sola disciplina. Los eventos creados con el
  // formulario multidisciplina anterior conservan varias: se muestran en solo
  // lectura porque reducirlas borraría pruebas ya inscritas.
  const legacyDisciplines = event && event.disciplines.length > 1 ? event.disciplines : null
  const initialDiscipline =
    event && isDisciplineValue(event.disciplines[0] ?? "")
      ? (event.disciplines[0] as DisciplineValue)
      : ""

  const [discipline, setDiscipline] = useState<DisciplineValue | "">(initialDiscipline)
  const preset = discipline ? DISCIPLINE_PRESETS[discipline] : null

  const [chargesEntry, setChargesEntry] = useState(
    event?.chargesEntry ?? preset?.defaultChargesEntry ?? true
  )
  const [chargesAthleteFee, setChargesAthleteFee] = useState(
    event?.chargesAthleteFee ?? preset?.defaultChargesAthleteFee ?? false
  )
  const [isLeague, setIsLeague] = useState(event?.isLeague ?? false)
  const [matchesPerTeam, setMatchesPerTeam] = useState("4")
  const [ageRuleMode, setAgeRuleMode] = useState<AgeRuleModeValue>(
    event?.ageRuleMode ?? "RANGE"
  )
  const [selectedModalities, setSelectedModalities] = useState<string[]>([])
  const [categoryRows, setCategoryRows] = useState<CategoryDraft[]>([
    emptyCategory(0),
  ])
  const nextCategoryId = useRef(1)

  // Elegir disciplina reinicia la configuración a lo que ese deporte espera.
  function chooseDiscipline(value: string) {
    if (!isDisciplineValue(value)) {
      setDiscipline("")
      return
    }
    setDiscipline(value)
    const next = DISCIPLINE_PRESETS[value]
    setChargesEntry(next.defaultChargesEntry)
    setChargesAthleteFee(next.defaultChargesAthleteFee)
    setIsLeague(false)
    setAgeRuleMode(next.defaultAgeRuleMode)
    setSelectedModalities(next.modalities.map((modality) => modality.name))
    const categoryId = nextCategoryId.current
    nextCategoryId.current += 1
    setCategoryRows([emptyCategory(categoryId)])
  }

  function updateCategory(
    id: number,
    field: Exclude<keyof CategoryDraft, "id" | "isOpen">,
    value: string
  ) {
    setCategoryRows((current) =>
      current.map((category) =>
        category.id === id ? { ...category, [field]: value } : category
      )
    )
  }

  function setCategoryOpen(id: number, isOpen: boolean) {
    setCategoryRows((current) =>
      current.map((category) =>
        category.id === id
          ? { ...category, isOpen, maxAgeYears: isOpen ? "" : category.maxAgeYears }
          : category
      )
    )
  }

  function addCategory() {
    const categoryId = nextCategoryId.current
    nextCategoryId.current += 1
    setCategoryRows((current) => [...current, emptyCategory(categoryId)])
  }

  function removeCategory(id: number) {
    setCategoryRows((current) => current.filter((category) => category.id !== id))
  }

  const categoriesText = categoryRows
    .filter((category) => category.label.trim())
    .map((category) =>
      ageRuleMode === "MAX_AGE_ONLY"
        ? `${category.label.trim()}|${category.isOpen ? "OPEN" : category.maxAgeYears}`
        : `${category.label.trim()}|${category.birthYearFrom}|${category.birthYearTo}`
    )
    .join("\n")
  const leagueTeamCountsText = JSON.stringify(
    categoryRows
      .filter((category) => category.label.trim())
      .map((category) => ({
        FEMALE: Number(category.expectedFemaleTeams),
        MALE: Number(category.expectedMaleTeams),
      }))
  )

  const configLocked = event?.hasLockedEntries ?? false

  return (
    <>
      {event ? <input type="hidden" name="id" value={event.id} /> : null}

      {/* 1 · Disciplina: gobierna todo lo que se muestra debajo. */}
      <div>
        <Label htmlFor="ev-discipline">Disciplina</Label>
        {legacyDisciplines ? (
          <div className="rounded-control border border-fdnda-border bg-fdnda-surface px-3.5 py-3 text-sm">
            <p className="font-semibold text-fdnda-ink">
              {legacyDisciplines
                .map((value) =>
                  isDisciplineValue(value) ? DISCIPLINES[value].label : value
                )
                .join(" · ")}
            </p>
            <p className="mt-1 text-xs leading-5 text-fdnda-muted">
              Evento multidisciplina creado con el formulario anterior. Sus
              disciplinas no se modifican desde acá para no dejar pruebas
              huérfanas; configura cada una desde sus pruebas.
            </p>
            <input
              type="hidden"
              name="discipline"
              value={legacyDisciplines[0] ?? ""}
            />
          </div>
        ) : (
          <>
            <Select
              id="ev-discipline"
              name="discipline"
              required
              value={discipline}
              onChange={(e) => chooseDiscipline(e.target.value)}
              disabled={configLocked}
            >
              <option value="" disabled>
                Selecciona la disciplina
              </option>
              {DISCIPLINE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {DISCIPLINES[value].label}
                </option>
              ))}
            </Select>
            {configLocked ? (
              <input type="hidden" name="discipline" value={discipline} />
            ) : null}
            <p className="mt-1 text-xs text-fdnda-muted">
              {configLocked
                ? "El evento ya tiene inscripciones en una orden: la disciplina y su cobro quedaron fijos."
                : "Cada disciplina trae su propia forma de cobrar, medir edades y nombrar sus pruebas."}
            </p>
          </>
        )}
      </div>

      {/* 2 · Datos generales. */}
      <div>
        <Label htmlFor="ev-season">Temporada deportiva</Label>
        <Select
          id="ev-season"
          name="seasonId"
          required
          defaultValue={
            event?.seasonId || seasons.find((season) => season.isCurrent)?.id || ""
          }
        >
          <option value="" disabled>
            Selecciona una temporada
          </option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name} ({season.year}){season.isCurrent ? " · vigente" : ""}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-fdnda-muted">
          Define las categorías y afiliaciones exigidas para competir.
        </p>
      </div>
      <div>
        <Label htmlFor="ev-name">Nombre del evento</Label>
        <Input
          id="ev-name"
          name="name"
          required
          placeholder="Campeonato Nacional …"
          defaultValue={event?.name}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ev-venue">Sede</Label>
          <Input
            id="ev-venue"
            name="venue"
            placeholder="Centro Acuático VIDENA"
            defaultValue={event?.venue}
          />
        </div>
        <div>
          <Label htmlFor="ev-city">Ciudad</Label>
          <Input id="ev-city" name="city" placeholder="Lima" defaultValue={event?.city} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ev-start">Inicio</Label>
          <Input
            id="ev-start"
            name="startDate"
            type="date"
            required
            defaultValue={event?.startDateISO}
          />
        </div>
        <div>
          <Label htmlFor="ev-end">Fin</Label>
          <Input
            id="ev-end"
            name="endDate"
            type="date"
            required
            defaultValue={event?.endDateISO}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ev-deadline">Cierre de inscripciones (hora Lima)</Label>
        <Input
          id="ev-deadline"
          name="registrationDeadline"
          type="datetime-local"
          required
          defaultValue={event?.deadlineLocal}
        />
      </div>
      <div>
        <Label htmlFor="ev-description">Descripción (opcional)</Label>
        <Textarea
          id="ev-description"
          name="description"
          rows={3}
          defaultValue={event?.description}
        />
      </div>

      {/* 3 · Configuración propia de la disciplina elegida. */}
      {discipline && preset ? (
        <fieldset
          className="rounded-surface border border-fdnda-border bg-fdnda-surface p-4"
          disabled={configLocked}
        >
          <legend className="px-1 text-sm font-bold text-fdnda-navy">
            Configuración de {DISCIPLINES[discipline].label}
          </legend>

          <div className="mt-2 space-y-4">
            <fieldset>
              <legend className="text-sm font-bold text-fdnda-ink">Qué se cobra</legend>
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                {preset.pricingHint}
              </p>
              <label className="mt-2 flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="chargesEntry"
                  checked={chargesEntry}
                  onChange={(e) => setChargesEntry(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>Inscripción por formación (cada plantel, dueto o equipo paga)</span>
              </label>
              <label className="mt-2 flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="chargesAthleteFee"
                  checked={chargesAthleteFee}
                  onChange={(e) => setChargesAthleteFee(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>Cuota por deportista (una sola vez en todo el evento)</span>
              </label>
              {chargesEntry && chargesAthleteFee ? (
                <p className="mt-2 rounded-control bg-fdnda-sky/25 p-2 text-xs text-fdnda-navy">
                  Con los dos conceptos, cada club elige en su planilla cuáles
                  paga. Debe marcar al menos uno.
                </p>
              ) : null}
            </fieldset>

            {discipline === "WATER_POLO" ? (
              <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-white px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  name="isLeague"
                  checked={isLeague}
                  onChange={(event) => setIsLeague(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>
                  <span className="font-medium text-fdnda-ink">Es una liga</span>
                  <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                    El precio de cada plantel sale de los partidos que juega en
                    la fase preliminar.
                  </span>
                </span>
              </label>
            ) : null}

            {chargesAthleteFee ? (
              <div>
                <Label htmlFor="ev-athlete-fee">Cuota por deportista (S/)</Label>
                <Input
                  id="ev-athlete-fee"
                  name="athleteFee"
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  defaultValue={event?.athleteFee}
                  placeholder="80.00"
                />
                <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                  Se cobra una sola vez por deportista aunque compita en varias
                  pruebas.
                </p>
              </div>
            ) : (
              <input type="hidden" name="athleteFee" value="" />
            )}

            <div>
              <Label htmlFor="ev-age-rule">Cómo se miden las edades</Label>
              <Select
                id="ev-age-rule"
                name="ageRuleMode"
                value={ageRuleMode}
                onChange={(e) => setAgeRuleMode(e.target.value as AgeRuleModeValue)}
              >
                <option value="RANGE">Rango de años de nacimiento (desde–hasta)</option>
                <option value="MAX_AGE_ONLY">Categorías «Sub-N» u Open</option>
              </Select>
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                {ageRuleMode === "MAX_AGE_ONLY"
                  ? "Sub-18 admite a los nacidos en ese año o después; Open no tiene límite de edad."
                  : preset.categoryHint}
              </p>
            </div>

            {/* Pruebas iniciales: solo al crear, para que el evento nazca listo. */}
            {!event ? (
              <>
                <div>
                  <Label>Pruebas del evento</Label>
                  <div className="space-y-2">
                    {preset.modalities.map((modality) => (
                      <label
                        key={modality.name}
                        className="flex items-start gap-2.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          name="presetModalities"
                          value={modality.name}
                          checked={selectedModalities.includes(modality.name)}
                          onChange={(e) =>
                            setSelectedModalities((current) =>
                              e.target.checked
                                ? [...current, modality.name]
                                : current.filter((name) => name !== modality.name)
                            )
                          }
                          className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                        />
                        <span>
                          <span className="font-medium text-fdnda-ink">
                            {modality.name}
                          </span>
                          <span className="ml-2 text-xs text-fdnda-muted">
                            {modality.minAthletes === modality.maxAthletes
                              ? `${modality.minAthletes} integrante(s)`
                              : `${modality.minAthletes}–${modality.maxAthletes} integrantes`}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                    Se generan combinando cada prueba con las categorías de abajo.
                    Después puedes agregar, editar o desactivar pruebas.
                  </p>
                </div>

                {selectedModalities.length > 0 ? (
                  <>
                    <div>
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <Label className="mb-0">Categorías</Label>
                          <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                            {ageRuleMode === "MAX_AGE_ONLY"
                              ? "Agrega cada grupo e indica su edad máxima."
                              : "Agrega cada grupo y su rango inclusivo de años de nacimiento."}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addCategory}
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Agregar categoría
                        </Button>
                      </div>

                      <input
                        type="hidden"
                        name="presetCategoriesText"
                        value={categoriesText}
                      />
                      {isLeague ? (
                        <input
                          type="hidden"
                          name="presetLeagueTeamCounts"
                          value={leagueTeamCountsText}
                        />
                      ) : null}

                      <div className="mt-3 space-y-3">
                        {categoryRows.map((category, index) => (
                          <div
                            key={category.id}
                            className="rounded-control border border-fdnda-border bg-white p-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                                Categoría {index + 1}
                              </p>
                              {categoryRows.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeCategory(category.id)}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-control text-fdnda-red-deep transition-colors hover:bg-fdnda-red-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-red/30"
                                  aria-label={`Quitar categoría ${index + 1}`}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                            <div
                              className={`grid gap-3 ${
                                ageRuleMode === "MAX_AGE_ONLY"
                                  ? "sm:grid-cols-[minmax(12rem,1.35fr)_minmax(10rem,1fr)]"
                                  : "sm:grid-cols-[minmax(12rem,1.35fr)_repeat(2,minmax(8rem,1fr))]"
                              }`}
                            >
                              <div>
                                <Label
                                  htmlFor={`ev-category-label-${category.id}`}
                                  className="whitespace-nowrap"
                                >
                                  Nombre del grupo
                                </Label>
                                <Input
                                  id={`ev-category-label-${category.id}`}
                                  value={category.label}
                                  onChange={(event) =>
                                    updateCategory(category.id, "label", event.target.value)
                                  }
                                  placeholder={
                                    ageRuleMode === "MAX_AGE_ONLY" ? "Sub 16" : "Grupo D"
                                  }
                                  maxLength={80}
                                  required
                                />
                              </div>

                              {ageRuleMode === "MAX_AGE_ONLY" ? (
                                <div>
                                  <Label
                                    htmlFor={`ev-category-age-${category.id}`}
                                    className="whitespace-nowrap"
                                  >
                                    Edad máxima
                                  </Label>
                                  <Input
                                    id={`ev-category-age-${category.id}`}
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={99}
                                    value={category.maxAgeYears}
                                    onChange={(event) =>
                                      updateCategory(
                                        category.id,
                                        "maxAgeYears",
                                        event.target.value
                                      )
                                    }
                                    placeholder={category.isOpen ? "Sin límite" : "15"}
                                    disabled={category.isOpen}
                                    required={!category.isOpen}
                                  />
                                  <label className="mt-2 flex items-center gap-2 text-xs font-medium text-fdnda-muted">
                                    <input
                                      type="checkbox"
                                      checked={category.isOpen}
                                      onChange={(event) =>
                                        setCategoryOpen(category.id, event.target.checked)
                                      }
                                      className="h-4 w-4 accent-fdnda-turquoise-deep"
                                    />
                                    Categoría Open, sin límite de edad
                                  </label>
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <Label
                                      htmlFor={`ev-category-from-${category.id}`}
                                      className="whitespace-nowrap"
                                    >
                                      Nacidos desde
                                    </Label>
                                    <Input
                                      id={`ev-category-from-${category.id}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={1950}
                                      max={category.birthYearTo || 2050}
                                      value={category.birthYearFrom}
                                      onChange={(event) =>
                                        updateCategory(
                                          category.id,
                                          "birthYearFrom",
                                          event.target.value
                                        )
                                      }
                                      placeholder="2015"
                                      required
                                    />
                                  </div>
                                  <div>
                                    <Label
                                      htmlFor={`ev-category-to-${category.id}`}
                                      className="whitespace-nowrap"
                                    >
                                      Nacidos hasta
                                    </Label>
                                    <Input
                                      id={`ev-category-to-${category.id}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={category.birthYearFrom || 1950}
                                      max={2050}
                                      value={category.birthYearTo}
                                      onChange={(event) =>
                                        updateCategory(
                                          category.id,
                                          "birthYearTo",
                                          event.target.value
                                        )
                                      }
                                      placeholder="2017"
                                      required
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                            {isLeague ? (
                              <div className="mt-3 grid gap-3 border-t border-fdnda-border pt-3 sm:grid-cols-2">
                                <div>
                                  <Label
                                    htmlFor={`ev-category-female-teams-${category.id}`}
                                  >
                                    Equipos esperados · Femenino
                                  </Label>
                                  <Input
                                    id={`ev-category-female-teams-${category.id}`}
                                    type="number"
                                    min={1}
                                    max={40}
                                    value={category.expectedFemaleTeams}
                                    onChange={(event) =>
                                      updateCategory(
                                        category.id,
                                        "expectedFemaleTeams",
                                        event.target.value
                                      )
                                    }
                                    required
                                  />
                                  <p className="mt-1 text-xs text-fdnda-muted">
                                    {leagueTotalMatches({
                                      expectedTeams:
                                        Number(category.expectedFemaleTeams) || 0,
                                      matchesPerTeam: Number(matchesPerTeam) || 0,
                                    })}{" "}
                                    partidos preliminares
                                  </p>
                                </div>
                                <div>
                                  <Label
                                    htmlFor={`ev-category-male-teams-${category.id}`}
                                  >
                                    Equipos esperados · Masculino
                                  </Label>
                                  <Input
                                    id={`ev-category-male-teams-${category.id}`}
                                    type="number"
                                    min={1}
                                    max={40}
                                    value={category.expectedMaleTeams}
                                    onChange={(event) =>
                                      updateCategory(
                                        category.id,
                                        "expectedMaleTeams",
                                        event.target.value
                                      )
                                    }
                                    required
                                  />
                                  <p className="mt-1 text-xs text-fdnda-muted">
                                    {leagueTotalMatches({
                                      expectedTeams:
                                        Number(category.expectedMaleTeams) || 0,
                                      matchesPerTeam: Number(matchesPerTeam) || 0,
                                    })}{" "}
                                    partidos preliminares
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    {chargesEntry ? (
                      <div>
                        <Label htmlFor="ev-preset-price">
                          {isLeague ? "Precio por partido (S/)" : "Precio por prueba (S/)"}
                        </Label>
                        <Input
                          id="ev-preset-price"
                          name="presetPrice"
                          type="number"
                          step="0.01"
                          min={0}
                          required
                          placeholder="60.00"
                        />
                      </div>
                    ) : null}

                    {isLeague ? (
                      <div>
                        <div>
                          <Label htmlFor="ev-matches">Partidos por equipo</Label>
                          <Input
                            id="ev-matches"
                            name="presetMatchesPerTeam"
                            type="number"
                            min={1}
                            max={40}
                            required
                            value={matchesPerTeam}
                            onChange={(event) => setMatchesPerTeam(event.target.value)}
                          />
                        </div>
                        <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                          Cada plantel paga solo sus {Number(matchesPerTeam) || 0}{" "}
                          partidos de la fase preliminar. La cantidad total de
                          partidos se calcula arriba para cada categoría y sexo.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </fieldset>
      ) : null}
    </>
  )
}

export function NewEventButton({ seasons }: { seasons: SeasonOption[] }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveEvent(formData)
      if (result.success && result.eventId) {
        toast.success("Evento creado con sus pruebas. Revísalas y ábrelo.")
        setOpen(false)
        router.push(`/admin/eventos/${result.eventId}`)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Nuevo evento
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo evento"
        className="sm:max-w-2xl"
      >
        <form action={handleSubmit} className="space-y-4">
          <EventFormFields seasons={seasons} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Crear evento
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}

export function EditEventButton({
  event,
  seasons,
}: {
  event: EventFormData
  seasons: SeasonOption[]
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveEvent(formData)
      if (result.success) {
        toast.success("Evento actualizado")
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Editar evento
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Editar evento"
        className="sm:max-w-2xl"
      >
        <form action={handleSubmit} className="space-y-4">
          <EventFormFields event={event} seasons={seasons} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
