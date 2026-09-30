"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Dialog } from "@/components/ui/dialog"
import { DISCIPLINE_VALUES, DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { DISCIPLINE_PRESETS } from "@/lib/event-presets"
import { birthYearForMaxAge, type AgeRuleModeValue } from "@/lib/event-pricing"
import {
  ARTISTIC_LEVEL_LABELS,
  ARTISTIC_LEVEL_VALUES,
  levelCategoryPreset,
  type LevelCategoryDraft,
} from "@/lib/artistic-levels"
import { formatDateOnly, plural, SEX_RULE_LABELS } from "@/lib/utils"
import { saveEvent } from "./actions"
import {
  birthYearRangeSummary,
  categoryCount,
  CategoryRowsEditor,
  categoryRowsToText,
  filledCategoryRows,
  useCategoryRows,
} from "./category-rows-editor"
import { DialogFormFooter, useDiscardGuard, type DiscardGuard } from "./form-discard-guard"

// Mismo tope que MAX_BULK_MODALITIES en actions.ts (un archivo "use server" no
// puede exportar constantes). Se repite para avisar antes de enviar.
const MAX_MODALITIES_PER_BATCH = 300

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
  isLevelChampionship: boolean
  athleteFee: string
  ageRuleMode: AgeRuleModeValue
  /**
   * true si alguna prueba tiene inscripciones en una orden (por pagar o
   * pagada): disciplina, temporada, formato y cobro se congelan. Es la misma
   * condición que aplica saveEvent en el servidor.
   */
  hasLockedEntries: boolean
}

export interface SeasonOption {
  id: string
  name: string
  year: number
  isCurrent: boolean
  startDateISO: string
  endDateISO: string
}

function isDisciplineValue(value: string): value is DisciplineValue {
  return (DISCIPLINE_VALUES as readonly string[]).includes(value)
}

const SECTION = "space-y-4 rounded-surface border border-fdnda-border bg-fdnda-surface p-4"
const LEGEND = "px-1 font-heading text-base font-bold text-fdnda-navy"
const HELP = "mt-1 text-xs leading-5 text-fdnda-muted"
const NOTE = "rounded-control bg-fdnda-sky/25 px-3 py-2 text-xs leading-5 text-fdnda-navy"
const CHECK = "mt-0.5 h-4 w-4 shrink-0 accent-fdnda-turquoise-deep"
const REMOVE_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center rounded-control text-fdnda-red-deep transition-colors hover:bg-fdnda-red-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-red/30"

function EventForm({
  event,
  seasons,
  pending,
  guard,
  onSubmit,
}: {
  event?: EventFormData
  seasons: SeasonOption[]
  pending: boolean
  guard: DiscardGuard
  onSubmit: (formData: FormData) => void
}) {
  const creating = !event
  // Una competencia pertenece a una sola disciplina. Las creadas con el
  // formulario multidisciplina anterior conservan varias: se muestran en solo
  // lectura porque reducirlas borraría pruebas ya inscritas.
  const legacyDisciplines = event && event.disciplines.length > 1 ? event.disciplines : null
  const initialDiscipline =
    event && isDisciplineValue(event.disciplines[0] ?? "")
      ? (event.disciplines[0] as DisciplineValue)
      : ""
  const configLocked = event?.hasLockedEntries ?? false

  const [discipline, setDiscipline] = useState<DisciplineValue | "">(initialDiscipline)
  const preset = discipline ? DISCIPLINE_PRESETS[discipline] : null

  const [chargesEntry, setChargesEntry] = useState(
    event?.chargesEntry ?? preset?.defaultChargesEntry ?? true
  )
  const [chargesAthleteFee, setChargesAthleteFee] = useState(
    event?.chargesAthleteFee ?? preset?.defaultChargesAthleteFee ?? false
  )
  const [isLeague, setIsLeague] = useState(event?.isLeague ?? false)
  const [isLevelChampionship, setIsLevelChampionship] = useState(
    event?.isLevelChampionship ?? false
  )
  const [seasonId, setSeasonId] = useState(
    event?.seasonId || seasons.find((season) => season.isCurrent)?.id || ""
  )
  const season = seasons.find((option) => option.id === seasonId) ?? null
  const seasonYear = season?.year ?? null

  // Las bases publican las categorías por edad; el año de la temporada las
  // convierte en años de nacimiento. Es un punto de partida editable.
  const [levelRows, setLevelRows] = useState<LevelCategoryDraft[]>([])
  const [levelPresetYear, setLevelPresetYear] = useState<number | null>(null)
  const [levelRowsEdited, setLevelRowsEdited] = useState(false)

  const [matchesPerTeam, setMatchesPerTeam] = useState("4")
  const [ageRuleMode, setAgeRuleMode] = useState<AgeRuleModeValue>(
    event?.ageRuleMode ?? "RANGE"
  )
  const [selectedModalities, setSelectedModalities] = useState<string[]>([])
  const categories = useCategoryRows(1)

  function loadLevelPreset(year: number | null) {
    setLevelRows(year === null ? [] : levelCategoryPreset(year))
    setLevelPresetYear(year)
    setLevelRowsEdited(false)
  }

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
    setIsLevelChampionship(false)
    setLevelRows([])
    setLevelPresetYear(null)
    setLevelRowsEdited(false)
    setAgeRuleMode(next.defaultAgeRuleMode)
    setSelectedModalities(next.modalities.map((modality) => modality.name))
    categories.reset()
  }

  function chooseSeason(id: string) {
    setSeasonId(id)
    const year = seasons.find((option) => option.id === id)?.year ?? null
    // Sin cambios del admin se recalcula solo; con cambios se ofrece recalcular
    // (abajo) en vez de pisarlos sin avisar.
    if (isLevelChampionship && !levelRowsEdited) loadLevelPreset(year)
  }

  function updateLevelRow(
    index: number,
    field: "label" | "from" | "to" | "maleFrom",
    value: string
  ) {
    setLevelRowsEdited(true)
    setLevelRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row
        if (field === "label") return { ...row, label: value }
        // Campo vacío = sin tope de ese lado, que es como las bases expresan
        // «2018 o más» y «2011 o antes».
        const year = value.trim() === "" ? null : Number(value)
        return { ...row, [field]: year }
      })
    )
  }

  const filledCategories = filledCategoryRows(categories.rows)
  const categoriesText = categoryRowsToText(categories.rows, ageRuleMode)
  const leagueTeamCountsText = JSON.stringify(
    filledCategories.map((category) => ({
      FEMALE: Number(category.expectedFemaleTeams),
      MALE: Number(category.expectedMaleTeams),
    }))
  )

  // Cuántas pruebas va a crear el alta: la misma cuenta que buildModalityRows
  // (categorías × pruebas × sexos de cada prueba).
  const chosenModalities = preset
    ? preset.modalities.filter((modality) => selectedModalities.includes(modality.name))
    : []
  const sexVariants = chosenModalities.reduce(
    (sum, modality) => sum + modality.sexRules.length,
    0
  )
  const categoriesForCount = isLevelChampionship
    ? levelRows.length
    : categoryCount(categories.rows, ageRuleMode)
  const modalityCount =
    creating && chosenModalities.length > 0 ? categoriesForCount * sexVariants : 0

  let blocked: string | null = null
  if (preset && !configLocked && !chargesEntry && !chargesAthleteFee) {
    blocked = "Marca al menos un concepto de cobro en la sección 3."
  } else if (creating && chosenModalities.length > 0) {
    if (isLevelChampionship && levelRows.length === 0) {
      blocked = "Agrega al menos una categoría en algún nivel, o desmarca todas las pruebas."
    } else if (
      !isLevelChampionship &&
      ageRuleMode === "MAX_AGE_ONLY" &&
      categories.rows.length === 0
    ) {
      blocked = "Agrega al menos una categoría Sub-N u Open, o desmarca todas las pruebas."
    } else if (isLeague && categories.rows.length === 0) {
      // saveEvent exige planteles esperados por cada categoría de la liga.
      blocked = "Agrega al menos una categoría: en una liga cada una declara sus planteles esperados."
    } else if (modalityCount > MAX_MODALITIES_PER_BATCH) {
      blocked = `Son ${modalityCount} pruebas y el máximo es ${MAX_MODALITIES_PER_BATCH}: quita categorías o pruebas.`
    }
  }

  const submitLabel = !creating
    ? "Guardar cambios de la competencia"
    : !preset
      ? "Crear competencia"
      : modalityCount > 0
        ? `Crear competencia y ${plural(modalityCount, "prueba", "pruebas")}`
        : "Crear competencia sin pruebas"

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    // onSubmit y no <form action>: React 19 reinicia los campos no controlados
    // al terminar una acción de formulario, aunque el servidor devuelva un
    // error, y el admin perdía nombre, fechas y precios por un solo dato mal.
    formEvent.preventDefault()
    if (blocked || pending) return
    onSubmit(new FormData(formEvent.currentTarget))
  }

  const disciplineLabelText = discipline ? DISCIPLINES[discipline].label : ""

  return (
    <form onSubmit={handleSubmit} onChange={guard.markDirty} className="space-y-5">
      {event ? <input type="hidden" name="id" value={event.id} /> : null}

      {configLocked ? (
        <p className={NOTE}>
          Esta competencia ya tiene inscripciones en órdenes. Puedes cambiar nombre,
          sede, ciudad, fechas, cierre de inscripciones y descripción. Disciplina,
          temporada, formato y cobro quedan fijos. Las órdenes ya emitidas y sus
          constancias conservan los datos con que se generaron.
        </p>
      ) : null}

      {/* 1 · Disciplina y temporada: gobiernan todo lo que se muestra debajo. */}
      <fieldset className={SECTION}>
        <legend className={LEGEND}>1. Disciplina y temporada</legend>
        <div>
          <Label htmlFor="ev-discipline">Disciplina</Label>
          {legacyDisciplines ? (
            <div className="rounded-control border border-fdnda-border bg-white px-3.5 py-3 text-sm">
              <p className="font-semibold text-fdnda-ink">
                {legacyDisciplines
                  .map((value) =>
                    isDisciplineValue(value) ? DISCIPLINES[value].label : value
                  )
                  .join(" · ")}
              </p>
              <p className={HELP}>
                Competencia de varias disciplinas creada con el formulario anterior.
                Sus disciplinas no se cambian desde aquí para no dejar pruebas sin
                disciplina. El cobro y las edades de abajo aplican a{" "}
                {isDisciplineValue(legacyDisciplines[0] ?? "")
                  ? DISCIPLINES[legacyDisciplines[0] as DisciplineValue].label
                  : legacyDisciplines[0]}
                .
              </p>
              <input type="hidden" name="discipline" value={legacyDisciplines[0] ?? ""} />
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
                aria-describedby="ev-discipline-help"
              >
                <option value="" disabled>
                  Elige la disciplina
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
              <p id="ev-discipline-help" className={HELP}>
                {configLocked
                  ? "Fija: la competencia tiene inscripciones en órdenes."
                  : creating
                    ? "Cada disciplina trae su forma de cobrar, de medir las edades y sus pruebas habituales. Cambiarla reinicia las secciones 3 y 4."
                    : "Cambiarla reinicia el cobro y la forma de medir las edades."}
              </p>
            </>
          )}
        </div>

        <div>
          <Label htmlFor="ev-season">Temporada</Label>
          <Select
            id="ev-season"
            name="seasonId"
            required
            value={seasonId}
            onChange={(e) => chooseSeason(e.target.value)}
            disabled={configLocked}
            aria-describedby="ev-season-help"
          >
            <option value="" disabled>
              Elige la temporada
            </option>
            {seasons.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.year}){option.isCurrent ? " · vigente" : ""}
              </option>
            ))}
          </Select>
          {/* Un select deshabilitado no se envía: el espejo manda la misma
              temporada, que con inscripciones en órdenes no puede cambiar. */}
          {configLocked ? <input type="hidden" name="seasonId" value={seasonId} /> : null}
          <p id="ev-season-help" className={HELP}>
            {configLocked
              ? "Fija: la competencia tiene inscripciones en órdenes."
              : season
                ? `Define las categorías y las afiliaciones que se exigen. Va del ${formatDateOnly(season.startDateISO)} al ${formatDateOnly(season.endDateISO)}: las fechas de la competencia deben caer dentro.`
                : "Define las categorías y las afiliaciones que se exigen para competir."}
          </p>
        </div>
      </fieldset>

      {/* 2 · Datos de la competencia. */}
      <fieldset className={SECTION}>
        <legend className={LEGEND}>2. Datos de la competencia</legend>
        <div>
          <Label htmlFor="ev-name">Nombre de la competencia</Label>
          <Input
            id="ev-name"
            name="name"
            required
            minLength={5}
            maxLength={160}
            placeholder="Campeonato Nacional …"
            defaultValue={event?.name}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ev-venue">Sede (opcional)</Label>
            <Input
              id="ev-venue"
              name="venue"
              maxLength={120}
              placeholder="Centro Acuático VIDENA"
              defaultValue={event?.venue}
            />
          </div>
          <div>
            <Label htmlFor="ev-city">Ciudad (opcional)</Label>
            <Input
              id="ev-city"
              name="city"
              maxLength={60}
              placeholder="Lima"
              defaultValue={event?.city}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ev-start">Fecha de inicio</Label>
            <Input
              id="ev-start"
              name="startDate"
              type="date"
              required
              min={season?.startDateISO}
              max={season?.endDateISO}
              defaultValue={event?.startDateISO}
            />
          </div>
          <div>
            <Label htmlFor="ev-end">Fecha de fin</Label>
            <Input
              id="ev-end"
              name="endDate"
              type="date"
              required
              min={season?.startDateISO}
              max={season?.endDateISO}
              defaultValue={event?.endDateISO}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="ev-deadline">Cierre de inscripciones (hora de Lima)</Label>
          <Input
            id="ev-deadline"
            name="registrationDeadline"
            type="datetime-local"
            required
            defaultValue={event?.deadlineLocal}
            aria-describedby="ev-deadline-help"
          />
          <p id="ev-deadline-help" className={HELP}>
            Desde ese momento la competencia deja de aparecer a los clubes y ya no
            pueden generar órdenes.
          </p>
        </div>
        <div>
          <Label htmlFor="ev-description">Descripción (opcional)</Label>
          <Textarea
            id="ev-description"
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={event?.description}
          />
        </div>
      </fieldset>

      {/* Un fieldset deshabilitado deshabilita todo lo que tiene dentro, y un
          control deshabilitado no se envía. Sin estos espejos, editar una
          competencia con inscripciones en órdenes mandaba la configuración
          vacía y fallaba con «Marca al menos un concepto de cobro». Van FUERA
          del fieldset, igual que el espejo de `discipline`: adentro quedarían
          deshabilitados también. Los valores son los que la competencia ya
          tiene, porque no pueden cambiar, solo confirmarse. Las casillas se
          envían como «on» solo cuando están marcadas, que es lo que hace un
          checkbox. */}
      {discipline && preset && configLocked ? (
        <>
          {chargesEntry ? <input type="hidden" name="chargesEntry" value="on" /> : null}
          {chargesAthleteFee ? (
            <input type="hidden" name="chargesAthleteFee" value="on" />
          ) : null}
          {isLeague ? <input type="hidden" name="isLeague" value="on" /> : null}
          {isLevelChampionship ? (
            <input type="hidden" name="isLevelChampionship" value="on" />
          ) : null}
          <input type="hidden" name="ageRuleMode" value={ageRuleMode} />
          <input type="hidden" name="athleteFee" value={event?.athleteFee ?? ""} />
        </>
      ) : null}

      {/* 3 · Cobro y formato propios de la disciplina elegida. */}
      {discipline && preset ? (
        <fieldset className={SECTION} disabled={configLocked}>
          <legend className={LEGEND}>3. Cobro y formato de {disciplineLabelText}</legend>
          {configLocked ? (
            <p className={HELP}>Fijos: la competencia tiene inscripciones en órdenes.</p>
          ) : null}

          <fieldset>
            <legend className="text-sm font-semibold text-fdnda-ink">Qué se cobra</legend>
            <p className={HELP}>{preset.pricingHint}</p>
            <label className="mt-2 flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="chargesEntry"
                checked={chargesEntry}
                onChange={(e) => setChargesEntry(e.target.checked)}
                className={CHECK}
              />
              <span>
                <span className="font-medium text-fdnda-ink">Precio por formación</span>
                <span className="block text-xs leading-5 text-fdnda-muted">
                  Cada solo, dueto, equipo o plantel paga el precio de su prueba.
                </span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="chargesAthleteFee"
                checked={chargesAthleteFee}
                onChange={(e) => setChargesAthleteFee(e.target.checked)}
                className={CHECK}
              />
              <span>
                <span className="font-medium text-fdnda-ink">
                  Cuota de competencia por deportista
                </span>
                <span className="block text-xs leading-5 text-fdnda-muted">
                  Se cobra una sola vez por deportista en toda la competencia.
                </span>
              </span>
            </label>
            {chargesEntry && chargesAthleteFee ? (
              <p className={`mt-2 ${NOTE}`}>
                Cada club elige en su planilla si paga el precio por formación, la
                cuota de competencia por deportista o ambos (al menos uno).
              </p>
            ) : null}
            {!chargesEntry && !chargesAthleteFee ? (
              <p className="mt-2 text-xs font-semibold leading-5 text-fdnda-red-deep" role="alert">
                Marca al menos un concepto: la competencia tiene que cobrar algo.
              </p>
            ) : null}
            {event && !configLocked && chargesEntry !== event.chargesEntry ? (
              <p className={`mt-2 ${NOTE}`}>
                {chargesEntry
                  ? "Revisa el precio por formación de cada prueba antes de abrir inscripciones: las creadas sin este cobro tienen S/ 0."
                  : "Las pruebas conservan su precio, pero ya no se cobra: solo queda la cuota de competencia por deportista."}
              </p>
            ) : null}
          </fieldset>

          {chargesAthleteFee ? (
            <div>
              <Label htmlFor="ev-athlete-fee">Cuota de competencia por deportista (S/)</Label>
              <Input
                id="ev-athlete-fee"
                name="athleteFee"
                type="number"
                step="0.01"
                min={0.01}
                required
                defaultValue={event?.athleteFee}
                placeholder="80.00"
                aria-describedby="ev-athlete-fee-help"
              />
              <p id="ev-athlete-fee-help" className={HELP}>
                Se cobra una sola vez por deportista aunque compita en varias pruebas.
              </p>
            </div>
          ) : (
            <input type="hidden" name="athleteFee" value="" />
          )}

          {discipline === "WATER_POLO" ? (
            <div>
              <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-white px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  name="isLeague"
                  checked={isLeague}
                  onChange={(e) => setIsLeague(e.target.checked)}
                  className={CHECK}
                />
                <span>
                  <span className="font-medium text-fdnda-ink">Es una liga</span>
                  <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                    Cada plantel paga los partidos que juega en la fase preliminar:
                    precio por partido × partidos por plantel.
                  </span>
                </span>
              </label>
              {event && !configLocked && isLeague !== event.isLeague ? (
                <p className={`mt-2 ${NOTE}`}>
                  {isLeague
                    ? "Las pruebas que ya existen no cambian: edita cada una para completar el precio por partido, los partidos por plantel y los planteles esperados antes de abrir inscripciones."
                    : "Las pruebas que ya existen no cambian: conservan el precio que tienen."}
                </p>
              ) : null}
            </div>
          ) : null}

          {discipline === "ARTISTIC_SWIMMING" ? (
            <div>
              <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-white px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  name="isLevelChampionship"
                  checked={isLevelChampionship}
                  onChange={(e) => {
                    setIsLevelChampionship(e.target.checked)
                    // Volver a marcar la casilla no pisa categorías ya cargadas.
                    if (e.target.checked && levelRows.length === 0) {
                      loadLevelPreset(seasonYear)
                    }
                  }}
                  className={CHECK}
                />
                <span>
                  <span className="font-medium text-fdnda-ink">
                    Es un campeonato de niveles
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                    Básico, Intermedio y Avanzado compiten con categorías por edad
                    propias. Al crear la competencia se cargan las de las bases y
                    puedes editarlas.
                  </span>
                </span>
              </label>
              {event && !configLocked && isLevelChampionship !== event.isLevelChampionship ? (
                <p className={`mt-2 ${NOTE}`}>
                  {isLevelChampionship
                    ? "Las pruebas que ya existen no cambian: asígnales un nivel con «Editar prueba» o genera pruebas nuevas en lote."
                    : "Las pruebas que ya existen no cambian."}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label htmlFor="ev-age-rule">Cómo se miden las edades</Label>
            <Select
              id="ev-age-rule"
              name="ageRuleMode"
              value={ageRuleMode}
              onChange={(e) => setAgeRuleMode(e.target.value as AgeRuleModeValue)}
              aria-describedby="ev-age-rule-help"
            >
              <option value="RANGE">Rango de años de nacimiento (desde–hasta)</option>
              <option value="MAX_AGE_ONLY">Categorías Sub-N u Open</option>
            </Select>
            <p id="ev-age-rule-help" className={HELP}>
              {ageRuleMode === "MAX_AGE_ONLY"
                ? seasonYear !== null
                  ? `Solo cuenta la edad máxima: Sub-18 en la temporada ${seasonYear} admite nacidos en ${birthYearForMaxAge(seasonYear, 18)} o después. Open no tiene límite de edad.`
                  : "Solo cuenta la edad máxima; Open no tiene límite de edad. Elige la temporada para ver desde qué año admite cada categoría."
                : preset.categoryHint}
            </p>
            {event && !configLocked && ageRuleMode !== event.ageRuleMode ? (
              <p className={`mt-2 ${NOTE}`}>
                {ageRuleMode === "MAX_AGE_ONLY"
                  ? "Las pruebas que ya existen no cambian: edita y guarda las que tengan año «Nacidos hasta» antes de abrir inscripciones."
                  : "Las pruebas que ya existen no cambian."}
              </p>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {/* 4 · Pruebas iniciales: solo al crear, para que la competencia nazca lista. */}
      {creating && discipline && preset ? (
        <fieldset className={SECTION}>
          <legend className={LEGEND}>4. Pruebas iniciales (opcional)</legend>
          <p className={HELP}>
            Se crea una prueba por cada combinación de prueba, categoría y sexo.
            Después puedes agregar, editar o desactivar pruebas.
          </p>

          <fieldset>
            <legend className="text-sm font-semibold text-fdnda-ink">Pruebas</legend>
            <div className="mt-2 space-y-2">
              {preset.modalities.map((modality) => (
                <label key={modality.name} className="flex items-start gap-2.5 text-sm">
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
                    className={CHECK}
                  />
                  <span>
                    <span className="font-medium text-fdnda-ink">{modality.name}</span>
                    <span className="block text-xs leading-5 text-fdnda-muted">
                      {modality.sexRules.map((rule) => SEX_RULE_LABELS[rule]).join(" · ")}
                      {" · "}
                      {modality.minAthletes === modality.maxAthletes
                        ? plural(modality.minAthletes, "integrante", "integrantes")
                        : `${modality.minAthletes} a ${modality.maxAthletes} integrantes`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {chosenModalities.length === 0 ? (
              <p className={`mt-2 ${NOTE}`}>
                Sin pruebas marcadas: la competencia se crea vacía y agregas las
                pruebas después.
              </p>
            ) : null}
          </fieldset>

          {chosenModalities.length > 0 ? (
            <>
              {isLeague ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {chargesEntry ? (
                    <div>
                      <Label htmlFor="ev-preset-price">Precio por partido (S/)</Label>
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
                  <div>
                    <Label htmlFor="ev-matches">Partidos por plantel</Label>
                    <Input
                      id="ev-matches"
                      name="presetMatchesPerTeam"
                      type="number"
                      min={1}
                      max={40}
                      required
                      value={matchesPerTeam}
                      onChange={(e) => setMatchesPerTeam(e.target.value)}
                    />
                  </div>
                  <p className={`sm:col-span-2 ${HELP}`}>
                    {chargesEntry
                      ? `Cada plantel paga solo sus ${plural(Number(matchesPerTeam) || 0, "partido", "partidos")} de la fase preliminar.`
                      : `Cada plantel juega ${plural(Number(matchesPerTeam) || 0, "partido", "partidos")} en la fase preliminar.`}{" "}
                    Debajo, cada categoría calcula el total de partidos.
                  </p>
                </div>
              ) : chargesEntry ? (
                <div>
                  <Label htmlFor="ev-preset-price">Precio por formación (S/)</Label>
                  <Input
                    id="ev-preset-price"
                    name="presetPrice"
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    placeholder="60.00"
                    aria-describedby="ev-preset-price-help"
                  />
                  <p id="ev-preset-price-help" className={HELP}>
                    Todas las pruebas creadas tendrán este precio; luego puedes
                    cambiarlo en cada una.
                  </p>
                </div>
              ) : null}
              {!chargesEntry ? (
                <p className={NOTE}>
                  Sin precio por formación: esta competencia cobra solo la cuota de
                  competencia por deportista.
                </p>
              ) : null}

              {isLevelChampionship ? (
                <div className="space-y-3">
                  <input
                    type="hidden"
                    name="presetLevelCategories"
                    value={JSON.stringify(levelRows)}
                  />
                  {levelRowsEdited &&
                  seasonYear !== null &&
                  levelPresetYear !== null &&
                  seasonYear !== levelPresetYear ? (
                    <div className={NOTE}>
                      <p>
                        Cambiaste la temporada: las categorías de abajo se calcularon
                        para {levelPresetYear}. Recalcularlas descarta tus cambios.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => loadLevelPreset(seasonYear)}
                      >
                        Recalcular categorías para {seasonYear}
                      </Button>
                    </div>
                  ) : null}
                  {ARTISTIC_LEVEL_VALUES.map((level) => {
                    const levelLabel = ARTISTIC_LEVEL_LABELS[level]
                    const rowsInLevel = levelRows.filter((row) => row.level === level)
                    return (
                      <fieldset
                        key={level}
                        className="rounded-control border border-fdnda-border bg-white p-3"
                      >
                        <legend className="px-1 text-sm font-semibold text-fdnda-ink">
                          Nivel {levelLabel}
                        </legend>
                        {rowsInLevel.length === 0 ? (
                          <p className="text-xs text-fdnda-muted">
                            Sin categorías: este nivel no crea pruebas.
                          </p>
                        ) : null}
                        <div className="space-y-3">
                          {levelRows.map((row, index) =>
                            row.level !== level ? null : (
                              <div key={index}>
                                <div className="grid items-end gap-2 sm:grid-cols-[minmax(9rem,1.4fr)_repeat(3,minmax(6rem,1fr))_auto]">
                                  <div>
                                    <Label htmlFor={`lv-label-${index}`}>
                                      Nombre de la categoría
                                    </Label>
                                    <Input
                                      id={`lv-label-${index}`}
                                      value={row.label}
                                      onChange={(e) =>
                                        updateLevelRow(index, "label", e.target.value)
                                      }
                                      maxLength={80}
                                      required
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`lv-from-${index}`}>Nacidos desde</Label>
                                    <Input
                                      id={`lv-from-${index}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={1950}
                                      max={row.to ?? 2050}
                                      value={row.from ?? ""}
                                      onChange={(e) =>
                                        updateLevelRow(index, "from", e.target.value)
                                      }
                                      placeholder="Sin tope"
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`lv-to-${index}`}>Nacidos hasta</Label>
                                    <Input
                                      id={`lv-to-${index}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={row.from ?? 1950}
                                      max={2050}
                                      value={row.to ?? ""}
                                      onChange={(e) =>
                                        updateLevelRow(index, "to", e.target.value)
                                      }
                                      placeholder="Sin tope"
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`lv-male-${index}`}>
                                      Varones nacidos desde
                                    </Label>
                                    <Input
                                      id={`lv-male-${index}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={1950}
                                      max={row.to ?? 2050}
                                      value={row.maleFrom ?? ""}
                                      onChange={(e) =>
                                        updateLevelRow(index, "maleFrom", e.target.value)
                                      }
                                      placeholder="Igual que damas"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLevelRowsEdited(true)
                                      setLevelRows((current) =>
                                        current.filter((_, i) => i !== index)
                                      )
                                    }}
                                    className={REMOVE_BUTTON}
                                    aria-label={`Quitar la categoría ${row.label || "sin nombre"} del nivel ${levelLabel}`}
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                                  {birthYearRangeSummary(
                                    row.from === null ? "" : String(row.from),
                                    row.to === null ? "" : String(row.to),
                                    row.maleFrom === null ? "" : String(row.maleFrom)
                                  )}
                                </p>
                              </div>
                            )
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => {
                            setLevelRowsEdited(true)
                            setLevelRows((current) => [
                              ...current,
                              { level, label: "", from: null, to: null, maleFrom: null },
                            ])
                          }}
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Agregar categoría a {levelLabel}
                        </Button>
                      </fieldset>
                    )
                  })}
                </div>
              ) : (
                <>
                  <input type="hidden" name="presetCategoriesText" value={categoriesText} />
                  {isLeague ? (
                    <input
                      type="hidden"
                      name="presetLeagueTeamCounts"
                      value={leagueTeamCountsText}
                    />
                  ) : null}
                  <CategoryRowsEditor
                    idPrefix="ev-category"
                    rows={categories.rows}
                    onAdd={categories.add}
                    onRemove={categories.remove}
                    onUpdate={categories.update}
                    ageRuleMode={ageRuleMode}
                    seasonYear={seasonYear}
                    namePlaceholder={preset.categoryPlaceholder}
                    allowMaleYear={discipline === "ARTISTIC_SWIMMING"}
                    league={isLeague ? { matchesPerTeam: Number(matchesPerTeam) || 0 } : null}
                  />
                </>
              )}
            </>
          ) : null}
        </fieldset>
      ) : null}

      <DialogFormFooter
        guard={guard}
        discardTitle={
          creating
            ? "¿Descartar la competencia sin crearla?"
            : `¿Descartar los cambios de «${event.name}»?`
        }
        discardConsequence={
          creating
            ? "Se perderá lo que escribiste en este formulario."
            : "La competencia se queda como estaba."
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {blocked ? (
            <p
              className="text-sm font-semibold leading-5 text-fdnda-red-deep sm:mr-auto"
              role="status"
            >
              {blocked}
            </p>
          ) : null}
          <Button variant="outline" onClick={guard.requestClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={Boolean(blocked)}
            loading={pending}
            loadingText={creating ? "Creando competencia…" : "Guardando cambios…"}
          >
            {submitLabel}
          </Button>
        </div>
      </DialogFormFooter>
    </form>
  )
}

export function NewEventButton({
  seasons,
  label = "Nueva competencia",
}: {
  seasons: SeasonOption[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const guard = useDiscardGuard(() => setOpen(false))

  const handleSubmit = (formData: FormData) => {
    const name = String(formData.get("name") ?? "").trim()
    startTransition(async () => {
      const result = await saveEvent(formData)
      if (result.success && result.eventId) {
        const created = result.createdModalities ?? 0
        toast.success(
          created > 0
            ? `Competencia «${name}» creada en borrador con ${plural(created, "prueba", "pruebas")}. Revisa precios y requisitos para abrir inscripciones.`
            : `Competencia «${name}» creada en borrador. Agrega sus pruebas para poder abrir inscripciones.`
        )
        guard.reset()
        setOpen(false)
        router.push(`/admin/eventos/${result.eventId}`)
      } else {
        toast.error(result.error ?? "No se pudo crear la competencia. Vuelve a intentarlo.")
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={guard.requestClose}
        title="Nueva competencia"
        className="sm:max-w-2xl"
      >
        <EventForm
          seasons={seasons}
          pending={isPending}
          guard={guard}
          onSubmit={handleSubmit}
        />
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
  const guard = useDiscardGuard(() => setOpen(false))

  const handleSubmit = (formData: FormData) => {
    const name = String(formData.get("name") ?? "").trim() || event.name
    startTransition(async () => {
      const result = await saveEvent(formData)
      if (result.success) {
        toast.success(`Cambios de «${name}» guardados.`)
        guard.reset()
        setOpen(false)
      } else {
        toast.error(result.error ?? "No se pudieron guardar los cambios. Vuelve a intentarlo.")
      }
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Editar datos de la competencia
      </Button>
      <Dialog
        open={open}
        onClose={guard.requestClose}
        title={`Editar «${event.name}»`}
        className="sm:max-w-2xl"
      >
        <EventForm
          event={event}
          seasons={seasons}
          pending={isPending}
          guard={guard}
          onSubmit={handleSubmit}
        />
      </Dialog>
    </>
  )
}
