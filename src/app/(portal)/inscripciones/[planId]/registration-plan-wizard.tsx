"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { disciplineLabel } from "@/lib/disciplines"
import {
  checkoutPlanAction,
  deletePlanEntryAction,
  savePlanEntryAction,
  savePlanStepAction,
  setPlanAthleteAction,
  setPlanChargesAction,
  selectPlanEventAction,
  toggleAthleteModalityAction,
  validatePlanAction,
} from "../actions"
import { persistedStepFor, resumeStep, type StepNumber } from "../steps"
import { usePlanAutosave } from "../use-plan-autosave"
import { AthleteBoard } from "./athlete-board"
import { ChargeSelectionCard } from "./charge-selection-card"
import { EventStep } from "./event-step"
import { ReviewPanel } from "./review-panel"
import type { FormationDraft } from "./team-formation-panel"
import type {
  AthletePageView,
  AthleteView,
  EntryView,
  EventView,
  LockedEntryView,
  LockedPairView,
  ModalityView,
  PlanView,
  SerializableValidation,
} from "../types"

// El flujo tiene dos pasos de trabajo —elegir competencia y armar la planilla—
// más la revisión y el pago al final.
const STEPS = [
  { number: 1 as const, label: "Competencia", icon: CalendarDays },
  { number: 2 as const, label: "Deportistas y pruebas", icon: ClipboardCheck },
  { number: 3 as const, label: "Revisión y pago", icon: CheckCircle2 },
]

export function RegistrationPlanWizard({
  initialPlan,
  athletePage,
  events,
  modalities,
  lockedEntries,
  lockedPairs,
  hasAffiliations,
  initialValidation,
  initialQuery,
}: {
  initialPlan: PlanView
  athletePage: AthletePageView
  events: EventView[]
  modalities: ModalityView[]
  lockedEntries: LockedEntryView[]
  lockedPairs: LockedPairView[]
  hasAffiliations: boolean
  /** Ya calculada en el servidor cuando la planilla reanuda en revisión. */
  initialValidation: SerializableValidation | null
  initialQuery: string
}) {
  const router = useRouter()
  const [isNavigating, startTransition] = useTransition()
  const [plan, setPlan] = useState(initialPlan)
  const [step, setStep] = useState<StepNumber>(
    resumeStep(initialPlan.currentStep, Boolean(initialPlan.event))
  )
  const [query, setQuery] = useState(initialQuery)
  const [roster, setRoster] = useState(initialPlan.roster)
  const [entries, setEntries] = useState(initialPlan.entries)
  const [expandedAthleteId, setExpandedAthleteId] = useState<string | null>(
    initialPlan.roster[0]?.id ?? null
  )
  const [teamModalityId, setTeamModalityId] = useState(
    modalities.find((row) => row.maxAthletes > 1)?.id ?? ""
  )
  const [editing, setEditing] = useState<FormationDraft | null>(null)
  const [validation, setValidation] = useState<SerializableValidation | null>(
    initialValidation
  )
  const [checkingOut, setCheckingOut] = useState(false)
  // null (nunca eligió) significa "paga los dos", así que arranca todo marcado.
  // OJO: `charges` es la fuente viva de la elección del club durante toda la
  // sesión del wizard. `initialPlan.paysEntry`/`paysAthleteFee` solo siembran
  // este estado en el primer render: `plan` (el estado de más arriba) nunca se
  // vuelve a sincronizar con lo que el club elige, porque `onApplied` sólo
  // mergea `id`/`revision`/`status` y `changeCharges` escribe en `charges`, no
  // en `plan`. Cualquier componente que necesite saber qué está pagando el
  // club AHORA (por ejemplo ReviewPanel) tiene que recibir `charges`, nunca
  // `plan.paysEntry`/`plan.paysAthleteFee`.
  const [charges, setCharges] = useState({
    paysEntry: initialPlan.paysEntry ?? true,
    paysAthleteFee: initialPlan.paysAthleteFee ?? true,
  })

  const {
    savingCount,
    blockedMessage,
    currentRevision,
    enqueue,
    awaitSaved,
    block,
    fail,
  } = usePlanAutosave({
    initialRevision: initialPlan.revision,
    onApplied: (state) =>
      setPlan((current) => ({
        ...current,
        id: state.planId,
        revision: state.revision,
        status: state.status ?? current.status,
      })),
  })

  const readOnly = plan.status !== "DRAFT"
  const busy = savingCount > 0 || Boolean(blockedMessage)

  // Pares (deportista, prueba) ya confirmados en otra orden: se pintan marcados
  // y bloqueados, en vez de dejar que el club choque con DUPLICATE_ENTRY.
  const lockedByAthlete = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const pair of lockedPairs) {
      const set = map.get(pair.athleteId) ?? new Set<string>()
      set.add(pair.modalityId)
      map.set(pair.athleteId, set)
    }
    return map
  }, [lockedPairs])

  // Cuota fija que le toca a un deportista según las disciplinas que practica y
  // el modo de cobro del evento. Solo cuenta si además el club la eligió pagar.
  const athleteFeeFor = useMemo(() => {
    const perAthlete = modalities.filter(
      (row) => row.chargesAthleteFee && charges.paysAthleteFee
    )
    const covered = new Set(
      (validation?.issues ?? [])
        .filter((issue) => issue.code === "ATHLETE_FEE_ALREADY_PAID")
        .map((issue) => issue.athleteId)
    )
    const feeByDiscipline = new Map(
      (validation?.summary.byDiscipline ?? [])
        .filter((row) => row.chargesAthleteFee && row.athleteCount > 0)
        .map((row) => [
          row.discipline as string,
          row.feesAmount / Math.max(1, row.athleteCount),
        ])
    )
    return (athlete: AthleteView) => {
      const modality = perAthlete.find((row) =>
        athlete.disciplines.includes(row.discipline)
      )
      if (!modality) return null
      return {
        label: disciplineLabel(modality.discipline),
        amount: feeByDiscipline.get(modality.discipline) ?? 0,
        covered: covered.has(athlete.id),
      }
    }
  }, [modalities, validation, charges])

  // El evento ofrece elección solo si alguna de sus pruebas cobra los dos.
  const ofreceEleccion = useMemo(
    () => modalities.some((row) => row.chargesEntry && row.chargesAthleteFee),
    [modalities]
  )

  function changeCharges(next: { paysEntry: boolean; paysAthleteFee: boolean }) {
    if (readOnly || blockedMessage) return
    setCharges(next)
    void enqueue((expectedRevision) =>
      setPlanChargesAction({ planId: plan.id, expectedRevision, ...next })
    )
  }

  async function runValidation() {
    try {
      await awaitSaved()
      const result = await validatePlanAction({
        planId: plan.id,
        expectedRevision: currentRevision(),
      })
      setValidation(result)
      if (result?.issues.some((issue) => issue.code === "REVISION_CONFLICT")) {
        block(
          "La planilla cambió en otra pestaña. Recarga para revisar la versión vigente."
        )
      }
    } catch {
      // El aviso de autoguardado ya explica cómo recuperarse.
    }
  }

  function goToStep(next: StepNumber) {
    setStep(next)
    if (next !== 3) setValidation(null)
    // El guardado del paso se encola ANTES de validar: también incrementa la
    // revisión, así que validar primero usaría una que el servidor ya dejó
    // obsoleta y todo terminaría en un falso conflicto.
    if (!readOnly && !blockedMessage) {
      void enqueue((expectedRevision) =>
        savePlanStepAction({
          planId: plan.id,
          expectedRevision,
          currentStep: persistedStepFor(next),
        })
      )
    }
    // La validación se dispara desde acá y no desde un efecto: entrar a la
    // revisión es un evento del usuario, no una sincronización de estado.
    if (next === 3) void runValidation()
  }

  async function selectEvent(eventId: string) {
    const result = await enqueue((expectedRevision) =>
      selectPlanEventAction({ planId: plan.id, expectedRevision, eventId })
    )
    if (result.success) {
      window.location.assign(`/inscripciones/${result.planId}`)
    } else if (result.existingPlanId) {
      window.location.assign(`/inscripciones/${result.existingPlanId}`)
    }
  }

  function addAthlete(athlete: AthleteView) {
    if (readOnly || blockedMessage) return
    setRoster((current) => [...current, athlete])
    setExpandedAthleteId(athlete.id)
    void enqueue((expectedRevision) =>
      setPlanAthleteAction({
        planId: plan.id,
        expectedRevision,
        athleteId: athlete.id,
        selected: true,
      })
    )
  }

  function removeAthlete(athlete: AthleteView) {
    if (readOnly || blockedMessage) return
    setRoster((current) => current.filter((row) => row.id !== athlete.id))
    // El servidor borra las formaciones que quedan vacías por esta remoción;
    // acá se refleja lo mismo para que la vista no muestre fantasmas.
    setEntries((current) =>
      current
        .map((entry) => ({
          ...entry,
          athleteIds: entry.athleteIds.filter((id) => id !== athlete.id),
          reserveIds: entry.reserveIds.filter((id) => id !== athlete.id),
        }))
        .filter((entry) => entry.athleteIds.length > 0)
    )
    void enqueue((expectedRevision) =>
      setPlanAthleteAction({
        planId: plan.id,
        expectedRevision,
        athleteId: athlete.id,
        selected: false,
      })
    )
  }

  async function toggleModality(
    athleteId: string,
    modalityId: string,
    selected: boolean
  ) {
    if (readOnly || blockedMessage) return
    // Actualización optimista: la casilla responde de inmediato y la cola
    // reconcilia con lo que devuelva el servidor.
    const optimisticId = `optimistic-${athleteId}-${modalityId}`
    setEntries((current) =>
      selected
        ? [
            ...current,
            {
              id: optimisticId,
              modalityId,
              status: "IN_CART",
              athleteIds: [athleteId],
              reserveIds: [],
            },
          ]
        : current.filter(
            (entry) =>
              !(
                entry.modalityId === modalityId &&
                entry.athleteIds.length === 1 &&
                entry.athleteIds[0] === athleteId
              )
          )
    )

    const result = await enqueue((expectedRevision) =>
      toggleAthleteModalityAction({
        planId: plan.id,
        expectedRevision,
        athleteId,
        modalityId,
        selected,
      })
    )

    if (!result.success) {
      // Revertir: el servidor no aceptó el cambio.
      setEntries((current) =>
        selected
          ? current.filter((entry) => entry.id !== optimisticId)
          : current
      )
      return
    }
    if (selected && result.registrationId) {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === optimisticId ? { ...entry, id: result.registrationId! } : entry
        )
      )
    }
    // Marcar una prueba también suma al deportista a la nómina en el servidor.
    setRoster((current) =>
      current.some((row) => row.id === athleteId)
        ? current
        : [...current, ...athletePage.rows.filter((row) => row.id === athleteId)]
    )
  }

  function upsertLocalEntry(draft: FormationDraft, registrationId: string) {
    const next: EntryView = {
      id: registrationId,
      modalityId: draft.modalityId,
      status: "IN_CART",
      athleteIds: draft.athleteIds,
      reserveIds: draft.reserveIds,
    }
    setEntries((current) =>
      current.some((row) => row.id === registrationId)
        ? current.map((row) => (row.id === registrationId ? next : row))
        : [...current, next]
    )
  }

  async function persistFormation(draft: FormationDraft) {
    const result = await enqueue((expectedRevision) =>
      savePlanEntryAction({
        planId: plan.id,
        expectedRevision,
        registrationId: draft.entryId,
        modalityId: draft.modalityId,
        athleteIds: draft.athleteIds,
        reserveIds: draft.reserveIds,
      })
    )
    if (!result.success) return
    const savedId = result.registrationId!
    upsertLocalEntry(draft, savedId)
    setEditing((current) =>
      current && current.modalityId === draft.modalityId
        ? { ...current, entryId: savedId }
        : current
    )
  }

  function startFormation() {
    const draft: FormationDraft = {
      modalityId: teamModalityId,
      athleteIds: [],
      reserveIds: [],
    }
    setEditing(draft)
    void persistFormation(draft)
  }

  function changeFormation(draft: FormationDraft) {
    setEditing(draft)
    void persistFormation(draft)
  }

  async function deleteFormation(entryId: string) {
    const result = await enqueue((expectedRevision) =>
      deletePlanEntryAction({ planId: plan.id, expectedRevision, registrationId: entryId })
    )
    if (result.success) {
      setEntries((current) => current.filter((row) => row.id !== entryId))
    }
  }

  async function printPersistedRevision() {
    try {
      await awaitSaved()
      window.open(
        `/inscripciones/${plan.id}/resumen?revision=${currentRevision()}`,
        "_blank",
        "noopener,noreferrer"
      )
    } catch {
      toast.error("Resuelve el conflicto de guardado antes de imprimir.")
    }
  }

  async function checkout() {
    setCheckingOut(true)
    try {
      await awaitSaved()
      const result = await checkoutPlanAction({
        planId: plan.id,
        expectedRevision: currentRevision(),
      })
      if (result.success) {
        router.push(`/pago/${result.orderId}`)
        return
      }
      if (result.validation) {
        setValidation(result.validation)
        toast.error(result.error)
      } else {
        fail(result)
      }
    } finally {
      setCheckingOut(false)
    }
  }

  const pageHref = (page: number) => {
    const params = new URLSearchParams()
    if (initialQuery) params.set("q", initialQuery)
    if (page > 1) params.set("page", String(page))
    const suffix = params.toString()
    return `/inscripciones/${plan.id}${suffix ? `?${suffix}` : ""}`
  }

  return (
    <div className="space-y-6">
      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Progreso de la planilla">
        {STEPS.map(({ number, label, icon: Icon }) => (
          <li key={number}>
            <button
              type="button"
              onClick={() => goToStep(number)}
              disabled={number > 1 && !plan.event}
              aria-current={step === number ? "step" : undefined}
              className={`flex min-h-12 w-full items-center gap-2 rounded-control px-3 text-left text-sm font-bold ring-1 ring-inset transition-colors disabled:opacity-45 ${
                step === number
                  ? "bg-fdnda-navy text-white ring-fdnda-navy"
                  : number < step
                    ? "bg-fdnda-sky/35 text-fdnda-navy ring-fdnda-sky"
                    : "bg-white text-fdnda-muted ring-fdnda-border"
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-current/10">
                {number < step ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div
        role="status"
        aria-live="polite"
        className={`flex min-h-11 items-center gap-2 rounded-control px-3 text-xs font-semibold ${
          blockedMessage
            ? "bg-fdnda-red-soft text-fdnda-red-deep"
            : "bg-fdnda-surface text-fdnda-muted"
        }`}
      >
        {blockedMessage ? (
          <>
            <AlertTriangle className="h-4 w-4 shrink-0" /> {blockedMessage}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => window.location.reload()}
            >
              Recargar
            </Button>
          </>
        ) : savingCount > 0 ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Guardando{" "}
            {savingCount > 1 ? `${savingCount} cambios` : "cambio"}…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4 text-fdnda-success" /> Todos los cambios
            están guardados · revisión {plan.revision}
          </>
        )}
      </div>

      {readOnly ? (
        <Card className="border-fdnda-sky bg-fdnda-sky/20 p-4 text-sm text-fdnda-navy">
          Esta planilla está bloqueada porque{" "}
          {plan.status === "PAID"
            ? "ya fue pagada"
            : plan.status === "ABANDONED"
              ? "fue reemplazada por otra planilla"
              : "tiene una orden activa"}
          .
          {plan.activeOrder ? (
            <Link className="ml-2 font-bold underline" href={`/pago/${plan.activeOrder.id}`}>
              Ver orden
            </Link>
          ) : null}
        </Card>
      ) : null}

      {step === 1 ? (
        <>
          <EventStep
            events={events}
            plan={plan}
            disabled={busy || readOnly}
            hasAffiliations={hasAffiliations}
            onSelect={(eventId) => void selectEvent(eventId)}
          />
          {plan.event ? (
            <div className="flex justify-end">
              <Button onClick={() => goToStep(2)}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          {ofreceEleccion ? (
            <ChargeSelectionCard
              paysEntry={charges.paysEntry}
              paysAthleteFee={charges.paysAthleteFee}
              entryLabel="Inscripción por equipo"
              athleteFeeLabel="Cuota por deportista"
              disabled={busy || readOnly}
              onChange={changeCharges}
            />
          ) : null}
          <AthleteBoard
            athletePage={athletePage}
            roster={roster}
            entries={entries}
            modalities={modalities}
            lockedPairs={lockedByAthlete}
            athleteFeeFor={athleteFeeFor}
            expandedAthleteId={expandedAthleteId}
            teamModalityId={teamModalityId}
            editing={editing}
            readOnly={readOnly}
            busy={busy}
            query={query}
            isNavigating={isNavigating}
            pageHref={pageHref}
            onQueryChange={setQuery}
            onSearch={() => {
              void awaitSaved().then(() => {
                const params = new URLSearchParams()
                if (query.trim()) params.set("q", query.trim())
                startTransition(() => router.push(`/inscripciones/${plan.id}?${params}`))
              })
            }}
            onAddAthlete={addAthlete}
            onRemoveAthlete={removeAthlete}
            onToggleExpand={(athleteId) =>
              setExpandedAthleteId((current) =>
                current === athleteId ? null : athleteId
              )
            }
            onToggleModality={(athleteId, modalityId, selected) =>
              void toggleModality(athleteId, modalityId, selected)
            }
            onSelectTeamModality={(modalityId) => {
              setTeamModalityId(modalityId)
              setEditing(null)
            }}
            onStartFormation={startFormation}
            onEditFormation={setEditing}
            onChangeFormation={changeFormation}
            onDeleteFormation={(entryId) => void deleteFormation(entryId)}
            onCloseFormation={() => setEditing(null)}
          />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => goToStep(1)} disabled={readOnly}>
              <ArrowLeft className="h-4 w-4" /> Competencia
            </Button>
            <Button onClick={() => goToStep(3)}>
              Revisar y pagar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <ReviewPanel
            validation={validation}
            plan={plan}
            charges={charges}
            lockedEntries={lockedEntries}
            checkingOut={checkingOut}
            blocked={Boolean(blockedMessage)}
            saving={savingCount > 0}
            onPrint={() => void printPersistedRevision()}
            onCheckout={() => void checkout()}
          />
          <div className="flex justify-start">
            <Button variant="outline" onClick={() => goToStep(2)} disabled={readOnly}>
              <ArrowLeft className="h-4 w-4" /> Corregir la planilla
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
