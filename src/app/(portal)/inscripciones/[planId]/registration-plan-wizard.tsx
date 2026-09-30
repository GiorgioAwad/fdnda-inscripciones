"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Button, buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { disciplineLabel } from "@/lib/disciplines"
import { formatMoney, plural } from "@/lib/utils"
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
import { athleteName, isDivingPair } from "./plan-labels"
import { OrderPanel, ReviewPanel } from "./review-panel"
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

// Con la competencia ya elegida (se elige en Inscripciones, antes de entrar) la
// planilla tiene dos pasos visibles: armarla y revisarla para pagar. Una
// planilla sin competencia solo muestra el selector de competencias.
const STEPS = [
  { number: 2 as const, label: "Deportistas y pruebas", icon: ClipboardCheck },
  { number: 3 as const, label: "Revisión y pago", icon: CheckCircle2 },
]

const savedTimeFormat = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Lima",
})

function priceRange(prices: number[], unit: string) {
  if (prices.length === 0) return ""
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max
    ? `${formatMoney(min)} ${unit}`
    : `De ${formatMoney(min)} a ${formatMoney(max)} ${unit}, según la prueba`
}

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
  /** Ya calculada en el servidor cuando un borrador reanuda en revisión. */
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
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [removing, setRemoving] = useState<AthleteView | null>(null)
  // Deportista al que hay que llevar la vista al volver desde la revisión.
  const focusAthleteRef = useRef<string | null>(null)
  // null (nunca eligió) significa "paga los dos", así que arranca todo marcado.
  // OJO: `charges` es la fuente viva de la elección del club durante toda la
  // sesión. `initialPlan.paysEntry`/`paysAthleteFee` solo siembran este estado:
  // `plan` nunca se vuelve a sincronizar con lo que el club elige, porque
  // `onApplied` sólo mergea `id`/`revision`/`status`.
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
    onApplied: (state) => {
      setLastSavedAt(new Date())
      setPlan((current) => ({
        ...current,
        id: state.planId,
        revision: state.revision,
        status: state.status ?? current.status,
      }))
    },
  })

  const readOnly = plan.status !== "DRAFT"
  const blocked = Boolean(blockedMessage)
  const visibleStep: StepNumber = plan.event ? (step === 3 ? 3 : 2) : 1

  useEffect(() => {
    const athleteId = focusAthleteRef.current
    if (!athleteId || visibleStep !== 2) return
    focusAthleteRef.current = null
    const row = document.getElementById(`athlete-${athleteId}`)
    row?.scrollIntoView({ block: "center" })
    row?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus()
  }, [visibleStep, expandedAthleteId])

  // Pares (deportista, prueba) ya inscritos en otra orden: se pintan marcados y
  // bloqueados, con su estado, en vez de dejar que el club choque con
  // DUPLICATE_ENTRY al guardar.
  const lockedByAthlete = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    for (const pair of lockedPairs) {
      const byModality = map.get(pair.athleteId) ?? new Map<string, string>()
      byModality.set(pair.modalityId, pair.status)
      map.set(pair.athleteId, byModality)
    }
    return map
  }, [lockedPairs])

  // La competencia ofrece elegir qué paga el club solo en las disciplinas que
  // cobran los dos conceptos a la vez.
  const choiceModalities = useMemo(
    () => modalities.filter((row) => row.chargesEntry && row.chargesAthleteFee),
    [modalities]
  )

  // Cuota de competencia por deportista, por disciplina. Sale de la
  // configuración de la competencia (ModalityView.athleteFee), no de la
  // validación: la validación solo existe en la revisión, y mientras se arma la
  // planilla el monto salía en S/ 0.00. Donde el club puede elegir, solo cuenta
  // si la eligió pagar (misma regla que `appliedCharges` en event-pricing.ts).
  const athleteFeesFor = useMemo(() => {
    const feeByDiscipline = new Map<string, number>()
    for (const row of modalities) {
      if (!row.chargesAthleteFee || row.athleteFee === null) continue
      const offersChoice = row.chargesEntry && row.chargesAthleteFee
      if (offersChoice && !charges.paysAthleteFee) continue
      feeByDiscipline.set(row.discipline, row.athleteFee)
    }
    return (athlete: AthleteView) =>
      [...feeByDiscipline]
        .filter(([discipline]) => athlete.disciplines.includes(discipline))
        .map(([discipline, amount]) => ({ label: disciplineLabel(discipline), amount }))
  }, [modalities, charges.paysAthleteFee])

  const entryPriceNote = (modality: ModalityView) => {
    if (!modality.chargesEntry) return "incluida en la cuota de competencia"
    if (modality.chargesAthleteFee && !charges.paysEntry) {
      return "sin cargo: tu club paga por deportista"
    }
    return modality.maxAthletes > 1
      ? `${formatMoney(modality.price)} por ${isDivingPair(modality) ? "pareja" : "formación"}`
      : formatMoney(modality.price)
  }

  const modalityById = useMemo(
    () => new Map(modalities.map((row) => [row.id, row])),
    [modalities]
  )
  const incompleteEntries = entries.filter((entry) => {
    const modality = modalityById.get(entry.modalityId)
    return (
      modality !== undefined &&
      modality.maxAthletes > 1 &&
      entry.athleteIds.length < modality.minAthletes
    )
  })
  const incompleteFormations = incompleteEntries.length
  const incompleteDivingPairs =
    incompleteEntries.length > 0 &&
    incompleteEntries.every((entry) => {
      const modality = modalityById.get(entry.modalityId)
      return modality !== undefined && isDivingPair(modality)
    })

  function changeCharges(next: { paysEntry: boolean; paysAthleteFee: boolean }) {
    if (readOnly || blockedMessage) return
    const previous = charges
    setCharges(next)
    void enqueue((expectedRevision) =>
      setPlanChargesAction({ planId: plan.id, expectedRevision, ...next })
    ).then((result) => {
      if (result.success) return
      setCharges((current) =>
        current.paysEntry === next.paysEntry &&
        current.paysAthleteFee === next.paysAthleteFee
          ? previous
          : current
      )
    })
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
          "Esta planilla se modificó en otra pestaña o por otra persona. Recárgala para ver la última versión."
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
    // Una planilla con orden no se revalida: la orden ya fijó sus importes.
    if (next === 3 && !readOnly) void runValidation()
  }

  function fixInPlan(athleteId?: string) {
    if (athleteId) {
      setExpandedAthleteId(athleteId)
      focusAthleteRef.current = athleteId
    }
    goToStep(2)
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
    ).then((result) => {
      if (!result.success) {
        setRoster((current) => current.filter((row) => row.id !== athlete.id))
      }
    })
  }

  function requestRemoveAthlete(athlete: AthleteView) {
    if (readOnly || blockedMessage) return
    // Sin pruebas no hay nada que perder: se quita sin preguntar.
    if (entries.some((entry) => entry.athleteIds.includes(athlete.id))) {
      setRemoving(athlete)
    } else {
      removeAthlete(athlete)
    }
  }

  function removeAthlete(athlete: AthleteView) {
    if (readOnly || blockedMessage) return
    const rosterIndex = roster.findIndex((row) => row.id === athlete.id)
    const touched = entries.filter((entry) => entry.athleteIds.includes(athlete.id))
    const touchedIds = new Set(touched.map((entry) => entry.id))
    setRoster((current) => current.filter((row) => row.id !== athlete.id))
    // El servidor borra las inscripciones que quedan vacías POR esta remoción
    // (las individuales del deportista); una formación armada vacía a
    // propósito no se toca. Acá se refleja lo mismo.
    setEntries((current) =>
      current
        .map((entry) =>
          touchedIds.has(entry.id)
            ? {
                ...entry,
                athleteIds: entry.athleteIds.filter((id) => id !== athlete.id),
                reserveIds: entry.reserveIds.filter((id) => id !== athlete.id),
              }
            : entry
        )
        .filter((entry) => !touchedIds.has(entry.id) || entry.athleteIds.length > 0)
    )
    void enqueue((expectedRevision) =>
      setPlanAthleteAction({
        planId: plan.id,
        expectedRevision,
        athleteId: athlete.id,
        selected: false,
      })
    ).then((result) => {
      if (result.success) return
      // Revertir: el servidor no lo quitó.
      setRoster((current) => {
        if (current.some((row) => row.id === athlete.id)) return current
        const next = [...current]
        next.splice(Math.max(0, Math.min(rosterIndex, next.length)), 0, athlete)
        return next
      })
      setEntries((current) => {
        const present = new Set(current.map((entry) => entry.id))
        const restored = current.map((entry) => {
          const before = touched.find((row) => row.id === entry.id)
          return before
            ? { ...entry, athleteIds: before.athleteIds, reserveIds: before.reserveIds }
            : entry
        })
        return [...restored, ...touched.filter((row) => !present.has(row.id))]
      })
    })
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
    const isTarget = (entry: EntryView) =>
      entry.modalityId === modalityId &&
      entry.athleteIds.length === 1 &&
      entry.athleteIds[0] === athleteId
    const removed = selected ? [] : entries.filter(isTarget)
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
        : current.filter((entry) => !isTarget(entry))
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
          : [
              ...current,
              ...removed.filter((row) => !current.some((entry) => entry.id === row.id)),
            ]
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
    // Marcar una prueba también suma al deportista a la planilla en el servidor.
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

  async function persistFormation(
    draft: FormationDraft,
    previous: FormationDraft | null
  ) {
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
    if (!result.success) {
      // Revertir el editor a lo último que sí quedó guardado.
      setEditing((current) => (current === draft ? previous : current))
      return
    }
    const savedId = result.registrationId!
    upsertLocalEntry(draft, savedId)
    setEditing((current) =>
      current && current.modalityId === draft.modalityId
        ? { ...current, entryId: savedId }
        : current
    )
  }

  // Una formación nueva no se guarda hasta que tiene su primer integrante.
  function startFormation() {
    setEditing({ modalityId: teamModalityId, athleteIds: [], reserveIds: [] })
  }

  function changeFormation(draft: FormationDraft) {
    const previous = editing
    setEditing(draft)
    if (!draft.entryId && draft.athleteIds.length === 0) return
    void persistFormation(draft, previous)
  }

  async function deleteFormation(entryId: string) {
    const result = await enqueue((expectedRevision) =>
      deletePlanEntryAction({ planId: plan.id, expectedRevision, registrationId: entryId })
    )
    if (result.success) {
      setEntries((current) => current.filter((row) => row.id !== entryId))
      setEditing((current) => (current?.entryId === entryId ? null : current))
    }
  }

  // Cerrar una formación que quedó sin integrantes la elimina: vacía no
  // significa nada y bloquearía el pago.
  function closeFormation() {
    const current = editing
    setEditing(null)
    if (current?.entryId && current.athleteIds.length === 0 && !blockedMessage) {
      void deleteFormation(current.entryId)
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
      toast.error("Recarga la planilla antes de imprimir: tu último cambio no se guardó.")
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
    } catch {
      // awaitSaved lanzó porque la planilla quedó bloqueada: el aviso ya está.
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

  const athleteNameById = (athleteId: string) => {
    const athlete = roster.find((row) => row.id === athleteId)
    return athlete ? athleteName(athlete) : null
  }

  const athleteFeeByDiscipline = new Map<string, number>()
  for (const row of choiceModalities) {
    if (row.athleteFee !== null) athleteFeeByDiscipline.set(row.discipline, row.athleteFee)
  }
  const athleteFeeDetail =
    athleteFeeByDiscipline.size === 1
      ? `${formatMoney([...athleteFeeByDiscipline.values()][0])} por deportista, una vez por competencia`
      : [...athleteFeeByDiscipline]
          .map(([discipline, fee]) => `${disciplineLabel(discipline)}: ${formatMoney(fee)}`)
          .join(" · ") || "Una vez por deportista en esta competencia"

  return (
    <div className="space-y-6">
      {plan.event ? (
        <ol className="grid gap-2 sm:grid-cols-2" aria-label="Pasos de la planilla">
          {STEPS.map(({ number, label, icon: Icon }, index) => {
            const current = visibleStep === number
            const done = number < visibleStep
            return (
              <li key={number}>
                <button
                  type="button"
                  onClick={() => goToStep(number)}
                  aria-current={current ? "step" : undefined}
                  className={`flex min-h-12 w-full items-center gap-2.5 rounded-control px-3 py-1.5 text-left text-sm font-bold ring-1 ring-inset transition-colors ${
                    current
                      ? "bg-fdnda-navy text-white ring-fdnda-navy"
                      : done
                        ? "bg-fdnda-sky/35 text-fdnda-navy ring-fdnda-sky"
                        : "bg-white text-fdnda-navy ring-fdnda-border"
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-current/10"
                    aria-hidden="true"
                  >
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold opacity-80">
                      Paso {index + 1} de {STEPS.length}
                    </span>
                    <span className="block">{label}</span>
                  </span>
                  {done ? <span className="sr-only">(completado)</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
      ) : null}

      {!readOnly || blockedMessage ? (
        <div
          role="status"
          aria-live="polite"
          className={`flex min-h-11 flex-wrap items-center gap-2 rounded-control px-3 py-1.5 text-xs font-semibold ${
            blockedMessage
              ? "bg-fdnda-red-soft text-fdnda-red-deep"
              : "bg-fdnda-surface text-fdnda-muted"
          }`}
        >
          {blockedMessage ? (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{blockedMessage}</span>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Recargar planilla
              </Button>
            </>
          ) : savingCount > 0 ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {savingCount > 1 ? `Guardando ${savingCount} cambios…` : "Guardando el cambio…"}
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-fdnda-success" aria-hidden="true" />
              {lastSavedAt
                ? `Cambios guardados a las ${savedTimeFormat.format(lastSavedAt)}`
                : "Cambios guardados"}
            </>
          )}
        </div>
      ) : null}

      {plan.status === "DRAFT" && plan.event && plan.closedReason ? (
        <Card className="flex items-start gap-2 border-fdnda-warning-ring bg-fdnda-warning-soft p-4 text-sm font-semibold text-fdnda-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-fdnda-warning" aria-hidden="true" />
          <p>
            {plan.closedReason === "DEADLINE"
              ? `El cierre de inscripciones fue el ${plan.event.registrationDeadlineLabel}. Esta planilla ya no se puede pagar.`
              : "Las inscripciones de esta competencia están cerradas. Esta planilla ya no se puede pagar."}
          </p>
        </Card>
      ) : null}

      {readOnly && visibleStep !== 3 ? <ReadOnlyNotice plan={plan} /> : null}

      {visibleStep === 1 ? (
        <EventStep
          events={events}
          disabled={blocked || savingCount > 0 || readOnly}
          hasAffiliations={hasAffiliations}
          onSelect={(eventId) => void selectEvent(eventId)}
        />
      ) : null}

      {visibleStep === 2 ? (
        <>
          <AthleteBoard
            athletePage={athletePage}
            roster={roster}
            entries={entries}
            modalities={modalities}
            lockedPairs={lockedByAthlete}
            athleteFeesFor={athleteFeesFor}
            entryPriceNote={entryPriceNote}
            expandedAthleteId={expandedAthleteId}
            teamModalityId={teamModalityId}
            editing={editing}
            readOnly={readOnly}
            blocked={blocked}
            formationSaving={savingCount > 0 || blocked}
            query={query}
            searchedQuery={initialQuery.trim()}
            isNavigating={isNavigating}
            pageHref={pageHref}
            chargeSelection={
              choiceModalities.length > 0 ? (
                <ChargeSelectionCard
                  paysEntry={charges.paysEntry}
                  paysAthleteFee={charges.paysAthleteFee}
                  entryDetail={priceRange(
                    choiceModalities.map((row) => row.price),
                    "por formación"
                  )}
                  athleteFeeDetail={athleteFeeDetail}
                  disabled={blocked || readOnly}
                  onChange={changeCharges}
                />
              ) : null
            }
            onQueryChange={setQuery}
            onSearch={() => {
              void awaitSaved()
                .then(() => {
                  const params = new URLSearchParams()
                  if (query.trim()) params.set("q", query.trim())
                  startTransition(() => router.push(`/inscripciones/${plan.id}?${params}`))
                })
                .catch(() => {
                  // Bloqueada: el aviso de arriba pide recargar.
                })
            }}
            onAddAthlete={addAthlete}
            onRemoveAthlete={requestRemoveAthlete}
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
            onDeleteFormation={deleteFormation}
            onCloseFormation={closeFormation}
          />
          <div className="flex flex-col gap-3 rounded-surface border border-fdnda-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-semibold text-fdnda-ink">
                {plural(roster.length, "deportista", "deportistas")} ·{" "}
                {plural(entries.length, "prueba inscrita", "pruebas inscritas")}
                {incompleteFormations > 0
                  ? ` · ${plural(incompleteFormations, incompleteDivingPairs ? "pareja incompleta" : "formación incompleta", incompleteDivingPairs ? "parejas incompletas" : "formaciones incompletas")}`
                  : ""}
              </p>
              {!readOnly ? (
                <p className="text-xs text-fdnda-muted">
                  El total y lo que falte para pagar se revisan en el paso 2.
                </p>
              ) : null}
            </div>
            <Button onClick={() => goToStep(3)}>
              {readOnly ? "Ver estado de la orden" : "Revisar y pagar"}{" "}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </>
      ) : null}

      {visibleStep === 3 ? (
        <>
          {readOnly ? (
            <OrderPanel
              plan={plan}
              lockedEntries={lockedEntries}
              onPrint={() => void printPersistedRevision()}
            />
          ) : (
            <ReviewPanel
              validation={validation}
              lockedEntries={lockedEntries}
              checkingOut={checkingOut}
              blocked={blocked}
              saving={savingCount > 0}
              athleteNameById={athleteNameById}
              onPrint={() => void printPersistedRevision()}
              onCheckout={() => void checkout()}
              onFix={fixInPlan}
              onRemoveAthlete={(athleteId) => {
                const athlete = roster.find((row) => row.id === athleteId)
                if (athlete) requestRemoveAthlete(athlete)
              }}
              onReload={() => window.location.reload()}
            />
          )}
          <div className="flex justify-start">
            <Button variant="outline" onClick={() => goToStep(2)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver a deportistas y
              pruebas
            </Button>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `¿Quitar a ${athleteName(removing)} de la planilla?` : ""}
        consequence="Se desmarcan todas sus pruebas y se retira de las inscripciones compartidas con otros deportistas. Sigue en el padrón de tu club."
        confirmLabel="Quitar de la planilla"
        destructive
        onConfirm={() => {
          if (removing) removeAthlete(removing)
          setRemoving(null)
          // Si se quitó desde la revisión, la validación ya no refleja la
          // planilla: se recalcula cuando la remoción termine de guardarse.
          if (visibleStep === 3) {
            setValidation(null)
            void runValidation()
          }
        }}
      />
    </div>
  )
}

// Por qué una planilla ya no se edita y qué hacer a continuación.
function ReadOnlyNotice({ plan }: { plan: PlanView }) {
  const order = plan.activeOrder
  const small = buttonClasses({ size: "sm" })
  const outline = buttonClasses({ size: "sm", variant: "outline" })
  return (
    <Card className="flex flex-col gap-3 border-fdnda-sky bg-fdnda-sky/20 p-4 text-sm text-fdnda-navy sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-2xl">
        {plan.status === "PAID"
          ? "Esta planilla ya está pagada y no se modifica. Para inscribir a más deportistas en esta competencia, inicia una nueva planilla."
          : plan.status === "AWAITING_PAYMENT"
            ? "Esta planilla tiene una orden pendiente de pago y ya no se puede modificar. Si la orden vence sin pagarse, la planilla vuelve a borrador."
            : "Esta planilla fue reemplazada por otra de la misma competencia y ya no se usa."}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {order ? (
          <Link href={`/pago/${order.id}`} className={small}>
            {order.status === "PAID" ? "Ver constancia" : "Pagar orden"}
          </Link>
        ) : null}
        {plan.status === "PAID" && plan.event && !plan.closedReason ? (
          <Link
            href={`/inscripciones/nueva?evento=${encodeURIComponent(plan.event.slug)}`}
            className={outline}
          >
            Inscribir más deportistas
          </Link>
        ) : null}
        {plan.status === "ABANDONED" || !order ? (
          <Link href="/inscripciones" className={outline}>
            Volver a Inscripciones
          </Link>
        ) : null}
      </div>
    </Card>
  )
}
