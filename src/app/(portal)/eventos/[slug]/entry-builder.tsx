"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  ClipboardCheck,
  Loader2,
  Lock,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EntrySummaryView } from "@/components/entry-summary-view"
import { disciplineStyle, type DisciplineValue } from "@/lib/disciplines"
import { validateEntryComposition } from "@/lib/eligibility"
import {
  athleteBlockedReason,
  athleteName,
  buildEntrySummary,
  canEnter,
  entersByUpgrade,
  isEditable,
  isTeamModality,
  modalityLabel,
  modalityRules,
  upgradeLabel,
  type PlanAthlete,
  type PlanEntry,
  type PlanModality,
} from "@/lib/entry-plan"
import { formatMoney, SEX_LABELS } from "@/lib/utils"
import { saveEntriesAction } from "./actions"

// Armador de inscripciones en el orden real del club: primero elige QUÉ
// deportistas lleva al evento y después en qué pruebas compite cada uno. La
// pantalla anterior obligaba al revés (prueba → deportistas), que es la lógica
// de una venta de entradas, no la de una planilla de inscripción.
//
// Al guardar, la planilla REEMPLAZA lo que el club tenía en el carrito de este
// evento; lo que ya entró a una orden (por pagar o pagado) se muestra bloqueado.

const STEPS = [
  { n: 1, label: "Deportistas", icon: Users },
  { n: 2, label: "Pruebas", icon: UserCheck },
  { n: 3, label: "Resumen", icon: ClipboardCheck },
] as const

function initials(athlete: PlanAthlete): string {
  return `${athlete.firstNames[0] ?? ""}${athlete.lastNames[0] ?? ""}`.toUpperCase()
}

function teamSizeLabel(modality: PlanModality): string {
  return modality.minAthletes === modality.maxAthletes
    ? `${modality.minAthletes}`
    : `${modality.minAthletes}–${modality.maxAthletes}`
}

export function EntryBuilder({
  eventSlug,
  eventId,
  modalities,
  athletes,
  entries: initialEntries,
  affiliatedDisciplines,
  canEdit,
  lockedReason,
}: {
  eventSlug: string
  eventId: string
  modalities: PlanModality[]
  athletes: PlanAthlete[]
  entries: PlanEntry[]
  affiliatedDisciplines: DisciplineValue[]
  canEdit: boolean
  // Por qué la planilla es de solo lectura (plazo cerrado, sin club, …).
  lockedReason: string | null
}) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState("")
  const nextKey = useRef(0)

  const locked = useMemo(
    () => initialEntries.filter((entry) => !isEditable(entry)),
    [initialEntries]
  )
  const [entries, setEntries] = useState<PlanEntry[]>(() =>
    initialEntries.filter(isEditable)
  )
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialEntries.flatMap((entry) => entry.athleteIds))
  )
  const [dirty, setDirty] = useState(false)

  const [teamDialog, setTeamDialog] = useState<{
    modality: PlanModality
    entryKey: string | null
    athleteIds: string[]
    reserveIds: string[]
  } | null>(null)

  const individualModalities = useMemo(
    () => modalities.filter((modality) => !isTeamModality(modality)),
    [modalities]
  )
  const teamModalities = useMemo(
    () => modalities.filter(isTeamModality),
    [modalities]
  )

  // Deportistas que ya están en una inscripción fuera del carrito: no se pueden
  // sacar de la planilla desde acá.
  const lockedAthleteIds = useMemo(
    () => new Set(locked.flatMap((entry) => entry.athleteIds)),
    [locked]
  )

  const allEntries = useMemo(() => [...locked, ...entries], [locked, entries])

  const summary = useMemo(
    () =>
      buildEntrySummary({
        modalities,
        athletes,
        entries: allEntries,
        selectedAthleteIds: [...selected],
      }),
    [modalities, athletes, allEntries, selected]
  )

  const selectedAthletes = useMemo(
    () => athletes.filter((athlete) => selected.has(athlete.id)),
    [athletes, selected]
  )

  // Un deportista puede entrar al evento si practica alguna de sus disciplinas y
  // tiene esa afiliación vigente.
  const eventDisciplines = useMemo(
    () => [...new Set(modalities.map((modality) => modality.discipline))],
    [modalities]
  )

  const athleteBlock = (athlete: PlanAthlete): string | null => {
    const practised = eventDisciplines.filter((discipline) =>
      athlete.disciplines.includes(discipline)
    )
    if (practised.length === 0) {
      return "No practica ninguna disciplina de este evento"
    }
    const open = practised.filter(
      (discipline) =>
        athlete.affiliatedIn.includes(discipline) &&
        affiliatedDisciplines.includes(discipline)
    )
    if (open.length === 0) {
      return "Sin afiliación vigente en las disciplinas del evento"
    }
    return null
  }

  const visibleAthletes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return athletes
    return athletes.filter((athlete) =>
      `${athlete.firstNames} ${athlete.lastNames} ${athlete.docNumber}`
        .toLowerCase()
        .includes(needle)
    )
  }, [athletes, search])

  // ==================== MUTACIONES DE LA PLANILLA ====================

  const makeKey = () => `nueva-${nextKey.current++}`

  const touch = () => setDirty(true)

  const toggleAthlete = (athlete: PlanAthlete) => {
    if (lockedAthleteIds.has(athlete.id)) return
    touch()

    if (selected.has(athlete.id)) {
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(athlete.id)
        return next
      })
      // Sacar a alguien de la planilla lo saca de todas sus pruebas.
      setEntries((rows) =>
        rows
          .map((row) => ({
            ...row,
            athleteIds: row.athleteIds.filter((id) => id !== athlete.id),
            reserveIds: row.reserveIds.filter((id) => id !== athlete.id),
          }))
          .filter((row) => row.athleteIds.length > 0)
      )
      return
    }

    setSelected((prev) => new Set(prev).add(athlete.id))
  }

  const selectAllEligible = () => {
    touch()
    setSelected((prev) => {
      const next = new Set(prev)
      for (const athlete of visibleAthletes) {
        if (!athleteBlock(athlete)) next.add(athlete.id)
      }
      return next
    })
  }

  // Deja solo lo que no se puede editar: los deportistas que ya están en una orden.
  const clearSelection = () => {
    touch()
    setSelected(new Set(lockedAthleteIds))
    setEntries([])
  }

  const individualEntry = (athleteId: string, modalityId: string) =>
    entries.find(
      (entry) =>
        entry.modalityId === modalityId &&
        entry.athleteIds.length === 1 &&
        entry.athleteIds[0] === athleteId
    )

  const isLockedIn = (athleteId: string, modalityId: string) =>
    locked.some(
      (entry) => entry.modalityId === modalityId && entry.athleteIds.includes(athleteId)
    )

  const toggleIndividual = (athlete: PlanAthlete, modality: PlanModality) => {
    touch()
    setEntries((prev) => {
      const found = prev.find(
        (entry) =>
          entry.modalityId === modality.id &&
          entry.athleteIds.length === 1 &&
          entry.athleteIds[0] === athlete.id
      )
      if (found) return prev.filter((entry) => entry !== found)
      return [
        ...prev,
        {
          key: makeKey(),
          modalityId: modality.id,
          athleteIds: [athlete.id],
          reserveIds: [],
          status: "IN_CART" as const,
          isNew: true,
        },
      ]
    })
  }

  const removeEntry = (key: string) => {
    touch()
    setEntries((prev) => prev.filter((entry) => entry.key !== key))
  }

  const openTeamDialog = (modality: PlanModality, entry?: PlanEntry) => {
    setTeamDialog({
      modality,
      entryKey: entry?.key ?? null,
      athleteIds: entry ? [...entry.athleteIds] : [],
      reserveIds: entry ? [...entry.reserveIds] : [],
    })
  }

  const commitTeamDialog = () => {
    if (!teamDialog) return
    touch()
    const { modality, entryKey, athleteIds, reserveIds } = teamDialog
    setEntries((prev) => {
      if (entryKey) {
        return prev.map((entry) =>
          entry.key === entryKey ? { ...entry, athleteIds, reserveIds } : entry
        )
      }
      return [
        ...prev,
        {
          key: makeKey(),
          modalityId: modality.id,
          athleteIds,
          reserveIds,
          status: "IN_CART" as const,
          isNew: true,
        },
      ]
    })
    setTeamDialog(null)
  }

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveEntriesAction({
        eventId,
        entries: entries.map((entry) => ({
          modalityId: entry.modalityId,
          athleteIds: entry.athleteIds,
          reserveIds: entry.reserveIds,
        })),
      })
      if (result.success) {
        setDirty(false)
        toast.success(
          entries.length === 0
            ? "Se vació la planilla de este evento."
            : `Planilla guardada: ${entries.length} inscripción(es) en el carrito.`,
          {
            action: {
              label: "Ir al carrito",
              onClick: () => router.push("/carrito"),
            },
          }
        )
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  // ==================== RENDER ====================

  const readOnly = !canEdit

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap items-center gap-2" aria-label="Pasos de la inscripción">
        {STEPS.map(({ n, label, icon: Icon }) => {
          const active = step === n
          const done = step > n
          return (
            <li key={n}>
              <button
                type="button"
                onClick={() => setStep(n)}
                aria-current={active ? "step" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-control px-3.5 py-2 text-sm font-bold ring-1 ring-inset transition-colors ${
                  active
                    ? "bg-fdnda-navy text-white ring-fdnda-navy"
                    : done
                      ? "bg-fdnda-turquoise-soft text-fdnda-navy ring-fdnda-turquoise/30"
                      : "bg-white text-fdnda-muted ring-fdnda-border hover:text-fdnda-navy"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="tabular-nums">{n}.</span> {label}
              </button>
            </li>
          )
        })}
      </ol>

      {readOnly && lockedReason ? (
        <p className="flex items-start gap-2 rounded-surface border border-fdnda-warning-ring/70 bg-fdnda-warning-soft px-4 py-3 text-sm font-semibold text-fdnda-warning">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {lockedReason}
        </p>
      ) : null}

      {/* ---------- PASO 1: DEPORTISTAS ---------- */}
      {step === 1 ? (
        <Card className="overflow-hidden">
          <div className="border-b border-fdnda-border bg-fdnda-surface px-5 py-4">
            <h2 className="font-heading text-lg font-bold text-fdnda-navy">
              ¿Qué deportistas llevas a este evento?
            </h2>
            <p className="mt-1 text-sm text-fdnda-muted">
              Marca a los que van a competir. En el paso siguiente eliges las pruebas
              de cada uno.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-fdnda-border px-5 py-3">
            <div className="relative min-w-56 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fdnda-muted"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o documento"
                aria-label="Buscar deportista"
                className="pl-9"
              />
            </div>
            {!readOnly ? (
              <>
                <Button variant="outline" size="sm" onClick={selectAllEligible}>
                  Seleccionar todos
                </Button>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Limpiar
                </Button>
              </>
            ) : null}
          </div>

          {visibleAthletes.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-fdnda-muted">
              {athletes.length === 0 ? (
                <>
                  Tu club todavía no tiene deportistas en el padrón.{" "}
                  <Link href="/deportistas" className="underline">
                    Agrégalos aquí
                  </Link>
                  .
                </>
              ) : (
                "Ningún deportista coincide con la búsqueda."
              )}
            </p>
          ) : (
            <ul className="divide-y divide-fdnda-border">
              {visibleAthletes.map((athlete) => {
                const block = athleteBlock(athlete)
                const isLocked = lockedAthleteIds.has(athlete.id)
                const checked = selected.has(athlete.id)
                const disabled = readOnly || isLocked || (block !== null && !checked)
                const entryCount =
                  summary.byAthlete.find((row) => row.athlete.id === athlete.id)?.entries
                    .length ?? 0

                return (
                  <li key={athlete.id}>
                    <label
                      className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5 ${
                        disabled
                          ? "cursor-not-allowed bg-fdnda-surface"
                          : checked
                            ? "cursor-pointer bg-fdnda-turquoise-soft"
                            : "cursor-pointer hover:bg-fdnda-sky-soft"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-fdnda-navy"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleAthlete(athlete)}
                      />
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white ${
                          athlete.sex === "F" ? "bg-fdnda-red" : "bg-fdnda-navy"
                        }`}
                        aria-hidden="true"
                      >
                        {initials(athlete)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-fdnda-ink">
                          {athleteName(athlete)}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                          {athlete.birthYear} · {SEX_LABELS[athlete.sex]} ·{" "}
                          {athlete.docType} {athlete.docNumber}
                          {Object.entries(athlete.categoryByDiscipline).length > 0
                            ? ` · ${Object.entries(athlete.categoryByDiscipline)
                                .map(
                                  ([discipline, name]) =>
                                    `${disciplineStyle(discipline).short}: ${name}`
                                )
                                .join(" · ")}`
                            : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {isLocked ? (
                          <Badge variant="accent">
                            <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                            En una orden
                          </Badge>
                        ) : null}
                        {entryCount > 0 ? (
                          <Badge variant="success">{entryCount} prueba(s)</Badge>
                        ) : null}
                        {block ? (
                          <Badge variant="danger" title={block}>
                            {block}
                          </Badge>
                        ) : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-fdnda-border bg-fdnda-surface px-5 py-4">
            <p className="text-sm font-semibold text-fdnda-navy">
              {selected.size} deportista(s) seleccionado(s)
            </p>
            <Button onClick={() => setStep(2)} disabled={selected.size === 0}>
              Elegir sus pruebas
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ---------- PASO 2: PRUEBAS ---------- */}
      {step === 2 ? (
        <div className="space-y-6">
          {selectedAthletes.length === 0 ? (
            <Card className="px-5 py-10 text-center text-sm text-fdnda-muted">
              Todavía no elegiste deportistas.{" "}
              <button
                type="button"
                onClick={() => setStep(1)}
                className="font-semibold text-fdnda-navy underline"
              >
                Vuelve al paso 1
              </button>
              .
            </Card>
          ) : null}

          {individualModalities.length > 0 && selectedAthletes.length > 0 ? (
            <section className="space-y-4">
              <div>
                <h2 className="font-heading text-lg font-bold text-fdnda-navy">
                  Pruebas individuales
                </h2>
                <p className="mt-1 text-sm text-fdnda-muted">
                  Marca las pruebas de cada deportista. Solo aparecen las que puede
                  competir por edad, sexo y afiliación.
                </p>
              </div>

              {selectedAthletes.map((athlete) => {
                const available = individualModalities.filter((modality) =>
                  canEnter(modality, athlete)
                )
                const blocked = individualModalities
                  .filter((modality) => !canEnter(modality, athlete))
                  .map((modality) => ({
                    modality,
                    reason: athleteBlockedReason(modality, athlete)!,
                  }))

                return (
                  <Card key={athlete.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3 border-b border-fdnda-border bg-fdnda-surface px-4 py-3 sm:px-5">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white ${
                          athlete.sex === "F" ? "bg-fdnda-red" : "bg-fdnda-navy"
                        }`}
                        aria-hidden="true"
                      >
                        {initials(athlete)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-fdnda-ink">{athleteName(athlete)}</p>
                        <p className="text-xs text-fdnda-muted">
                          {athlete.birthYear} · {SEX_LABELS[athlete.sex]}
                          {Object.entries(athlete.categoryByDiscipline).length > 0
                            ? ` · ${Object.entries(athlete.categoryByDiscipline)
                                .map(
                                  ([discipline, name]) =>
                                    `${disciplineStyle(discipline).short}: ${name}`
                                )
                                .join(" · ")}`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="px-4 py-3 sm:px-5">
                      {available.length === 0 ? (
                        <p className="py-2 text-sm text-fdnda-muted">
                          No hay pruebas individuales disponibles para este deportista.
                        </p>
                      ) : (
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {available.map((modality) => {
                            const style = disciplineStyle(modality.discipline)
                            const lockedIn = isLockedIn(athlete.id, modality.id)
                            const entry = individualEntry(athlete.id, modality.id)
                            const checked = lockedIn || Boolean(entry)
                            const upgraded = entersByUpgrade(modality, athlete)
                            return (
                              <li key={modality.id}>
                                <label
                                  className={`flex h-full items-start gap-2.5 rounded-surface border px-3 py-2.5 text-sm ${
                                    lockedIn || readOnly
                                      ? "cursor-not-allowed border-fdnda-border bg-fdnda-surface"
                                      : checked
                                        ? "cursor-pointer border-fdnda-turquoise bg-fdnda-turquoise-soft"
                                        : "cursor-pointer border-fdnda-border hover:border-fdnda-turquoise/60 hover:bg-fdnda-sky-soft"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-5 w-5 shrink-0 accent-fdnda-navy"
                                    checked={checked}
                                    disabled={lockedIn || readOnly}
                                    onChange={() => toggleIndividual(athlete, modality)}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block font-bold text-fdnda-ink">
                                      {modalityLabel(modality)}
                                    </span>
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fdnda-muted">
                                      <span className={style.accent}>
                                        {formatMoney(modality.price)}
                                      </span>
                                      {upgraded ? (
                                        <Badge variant="warning">
                                          <ArrowUpCircle
                                            className="mr-1 h-3 w-3"
                                            aria-hidden="true"
                                          />
                                          Sube de categoría
                                        </Badge>
                                      ) : null}
                                      {lockedIn ? (
                                        <Badge variant="accent">En una orden</Badge>
                                      ) : null}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      {blocked.length > 0 ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-semibold text-fdnda-muted">
                            {blocked.length} prueba(s) no disponible(s) para{" "}
                            {athlete.firstNames}
                          </summary>
                          <ul className="mt-2 space-y-1 text-xs leading-5 text-fdnda-muted">
                            {blocked.map(({ modality, reason }) => (
                              <li key={modality.id}>
                                <span className="font-semibold">
                                  {modalityLabel(modality)}
                                </span>
                                : {reason}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  </Card>
                )
              })}
            </section>
          ) : null}

          {teamModalities.length > 0 && selectedAthletes.length > 0 ? (
            <section className="space-y-4">
              <div>
                <h2 className="font-heading text-lg font-bold text-fdnda-navy">
                  Duetos, equipos y planteles
                </h2>
                <p className="mt-1 text-sm text-fdnda-muted">
                  Arma cada formación con los deportistas que ya seleccionaste. Puedes
                  inscribir más de una formación por prueba.
                </p>
              </div>

              {teamModalities.map((modality) => {
                const style = disciplineStyle(modality.discipline)
                const Icon = style.icon
                const own = entries.filter((entry) => entry.modalityId === modality.id)
                const lockedOwn = locked.filter(
                  (entry) => entry.modalityId === modality.id
                )
                const eligible = selectedAthletes.filter((athlete) =>
                  canEnter(modality, athlete)
                )

                return (
                  <Card key={modality.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3 border-b border-fdnda-border bg-fdnda-surface px-4 py-3 sm:px-5">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-white ${style.chip}`}
                        aria-hidden="true"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-fdnda-ink">
                          {modalityLabel(modality)}
                        </p>
                        <p className="text-xs leading-5 text-fdnda-muted">
                          {modalityRules(modality)} · {formatMoney(modality.price)}
                          {upgradeLabel(modality) ? (
                            <span className="block text-fdnda-turquoise-deep">
                              {upgradeLabel(modality)}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      {!readOnly ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openTeamDialog(modality)}
                          disabled={eligible.length < modality.minAthletes}
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" /> Agregar
                          formación
                        </Button>
                      ) : null}
                    </div>

                    {own.length === 0 && lockedOwn.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-fdnda-muted sm:px-5">
                        {eligible.length < modality.minAthletes
                          ? `Necesitas al menos ${modality.minAthletes} deportistas elegibles seleccionados (tienes ${eligible.length}).`
                          : "Sin formaciones inscritas."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-fdnda-border">
                        {lockedOwn.map((entry, index) => (
                          <li
                            key={entry.key}
                            className="flex flex-wrap items-center gap-3 bg-fdnda-surface px-4 py-3 sm:px-5"
                          >
                            <span className="text-xs font-bold text-fdnda-muted">
                              #{index + 1}
                            </span>
                            <span className="min-w-0 flex-1 text-sm text-fdnda-ink">
                              {entry.athleteIds
                                .map((id) => {
                                  const athlete = athletes.find((a) => a.id === id)
                                  return athlete ? athleteName(athlete) : "—"
                                })
                                .join(" · ")}
                            </span>
                            <Badge variant="accent">
                              <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                              En una orden
                            </Badge>
                          </li>
                        ))}
                        {own.map((entry, index) => {
                          const members = entry.athleteIds
                            .map((id) => athletes.find((a) => a.id === id))
                            .filter((a): a is PlanAthlete => Boolean(a))
                          const problems = validateEntryComposition(modality, members)
                          return (
                            <li
                              key={entry.key}
                              className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5"
                            >
                              <span className="mt-1 text-xs font-bold text-fdnda-muted">
                                #{lockedOwn.length + index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-fdnda-ink">
                                  {members
                                    .map(
                                      (athlete) =>
                                        `${athleteName(athlete)}${
                                          entry.reserveIds.includes(athlete.id)
                                            ? " (reserva)"
                                            : ""
                                        }`
                                    )
                                    .join(" · ")}
                                </p>
                                {problems.length > 0 ? (
                                  <ul className="mt-1 space-y-0.5 text-xs font-semibold text-fdnda-red-deep">
                                    {problems.map((problem, i) => (
                                      <li key={i}>• {problem}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                              {!readOnly ? (
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openTeamDialog(modality, entry)}
                                  >
                                    Editar
                                  </Button>
                                  <button
                                    type="button"
                                    onClick={() => removeEntry(entry.key)}
                                    aria-label="Quitar formación"
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-control text-fdnda-muted transition-colors hover:bg-fdnda-red-soft hover:text-fdnda-red"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                </div>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </Card>
                )
              })}
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Deportistas
            </Button>
            <Button onClick={() => setStep(3)}>
              Ver resumen y validar
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---------- PASO 3: RESUMEN ---------- */}
      {step === 3 ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-bold text-fdnda-navy">
                Resumen de inscripciones
              </h2>
              <p className="mt-1 text-sm text-fdnda-muted">
                Revisa que todo esté correcto antes de enviar la planilla al carrito.
              </p>
            </div>
            <Link href={`/eventos/${eventSlug}/resumen`}>
              <Button variant="outline" size="sm">
                <Printer className="h-4 w-4" aria-hidden="true" /> Hoja imprimible
              </Button>
            </Link>
          </div>

          <EntrySummaryView summary={summary} />

          <div className="sticky bottom-4">
            <div className="flex flex-col gap-3 rounded-surface border-2 border-fdnda-navy bg-white px-5 py-4 shadow-[0_12px_32px_rgb(2_55_125/0.12)] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                  {summary.editableCount} inscripción(es) editable(s)
                </p>
                <p className="text-2xl font-extrabold tabular-nums tracking-tight text-fdnda-navy">
                  {formatMoney(summary.payable)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Corregir
                </Button>
                {readOnly ? null : (
                  <Button
                    onClick={handleSave}
                    disabled={isPending || !summary.isValid}
                    title={
                      summary.isValid
                        ? undefined
                        : "Corrige los problemas antes de guardar"
                    }
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="h-4 w-4" aria-hidden="true" />
                    )}
                    Guardar y enviar al carrito
                  </Button>
                )}
                {!dirty && summary.payable > 0 ? (
                  <Link href="/carrito">
                    <Button variant="secondary">Ir al carrito</Button>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------- DIÁLOGO DE FORMACIONES ---------- */}
      <Dialog
        open={teamDialog !== null}
        onClose={() => setTeamDialog(null)}
        title={teamDialog ? modalityLabel(teamDialog.modality) : ""}
        description={teamDialog ? modalityRules(teamDialog.modality) : undefined}
      >
        {teamDialog ? (
          <TeamPicker
            modality={teamDialog.modality}
            athletes={selectedAthletes}
            athleteIds={teamDialog.athleteIds}
            reserveIds={teamDialog.reserveIds}
            takenIds={
              new Set(
                [...locked, ...entries]
                  .filter(
                    (entry) =>
                      entry.modalityId === teamDialog.modality.id &&
                      entry.key !== teamDialog.entryKey
                  )
                  .flatMap((entry) => entry.athleteIds)
              )
            }
            onChange={(athleteIds, reserveIds) =>
              setTeamDialog((prev) => (prev ? { ...prev, athleteIds, reserveIds } : prev))
            }
            onCancel={() => setTeamDialog(null)}
            onCommit={commitTeamDialog}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

// Selector de integrantes de un dueto/equipo/plantel: valida la composición en
// vivo con las mismas reglas que revalida el servidor al guardar.
function TeamPicker({
  modality,
  athletes,
  athleteIds,
  reserveIds,
  takenIds,
  onChange,
  onCancel,
  onCommit,
}: {
  modality: PlanModality
  athletes: PlanAthlete[]
  athleteIds: string[]
  reserveIds: string[]
  // Deportistas ya usados en otra formación de la misma prueba.
  takenIds: Set<string>
  onChange: (athleteIds: string[], reserveIds: string[]) => void
  onCancel: () => void
  onCommit: () => void
}) {
  const chosen = new Set(athleteIds)
  const reserves = new Set(reserveIds)
  const members = athleteIds
    .map((id) => athletes.find((a) => a.id === id))
    .filter((a): a is PlanAthlete => Boolean(a))
  const problems = validateEntryComposition(modality, members)
  const roster = athletes.filter((athlete) => canEnter(modality, athlete))

  const toggle = (athleteId: string) => {
    if (chosen.has(athleteId)) {
      onChange(
        athleteIds.filter((id) => id !== athleteId),
        reserveIds.filter((id) => id !== athleteId)
      )
      return
    }
    if (athleteIds.length >= modality.maxAthletes) {
      toast.warning(`Máximo ${modality.maxAthletes} integrantes en esta prueba.`)
      return
    }
    onChange([...athleteIds, athleteId], reserveIds)
  }

  const toggleReserve = (athleteId: string) => {
    onChange(
      athleteIds,
      reserves.has(athleteId)
        ? reserveIds.filter((id) => id !== athleteId)
        : [...reserveIds, athleteId]
    )
  }

  return (
    <div className="space-y-4">
      {roster.length === 0 ? (
        <p className="py-4 text-center text-sm text-fdnda-muted">
          Ninguno de los deportistas seleccionados cumple las reglas de esta prueba.
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-fdnda-border overflow-y-auto rounded-control border border-fdnda-border">
          {roster.map((athlete) => {
            const taken = takenIds.has(athlete.id)
            const isChosen = chosen.has(athlete.id)
            const upgraded = entersByUpgrade(modality, athlete)
            return (
              <li key={athlete.id}>
                <label
                  className={`flex items-center gap-3 px-3.5 py-2.5 text-sm ${
                    taken
                      ? "cursor-not-allowed bg-fdnda-surface opacity-60"
                      : isChosen
                        ? "cursor-pointer bg-fdnda-turquoise-soft"
                        : "cursor-pointer hover:bg-fdnda-sky-soft"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-fdnda-navy"
                    checked={isChosen}
                    disabled={taken}
                    onChange={() => toggle(athlete.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-fdnda-ink">
                      {athleteName(athlete)}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-fdnda-muted">
                      {athlete.birthYear} · {SEX_LABELS[athlete.sex]}
                      {taken ? " · ya está en otra formación" : ""}
                      {upgraded ? (
                        <Badge variant="warning">
                          <ArrowUpCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                          Sube de categoría
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                  {isChosen && modality.maxAthletes > modality.minAthletes ? (
                    <button
                      type="button"
                      aria-pressed={reserves.has(athlete.id)}
                      onClick={(e) => {
                        e.preventDefault()
                        toggleReserve(athlete.id)
                      }}
                      className={`min-h-11 shrink-0 rounded-control px-3 py-1 text-xs font-bold ring-1 ring-inset transition-colors ${
                        reserves.has(athlete.id)
                          ? "bg-fdnda-navy-soft text-fdnda-navy ring-fdnda-navy/20"
                          : "bg-white text-fdnda-muted ring-fdnda-border hover:text-fdnda-navy"
                      }`}
                    >
                      {reserves.has(athlete.id) ? "Reserva" : "¿Reserva?"}
                    </button>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <div
        aria-live="polite"
        className="flex items-center justify-between gap-3 rounded-surface bg-fdnda-surface px-4 py-3 text-sm"
      >
        <span className="text-fdnda-muted">
          Integrantes: <strong className="text-fdnda-ink">{athleteIds.length}</strong> de{" "}
          {teamSizeLabel(modality)}
        </span>
        <span className="font-extrabold text-fdnda-navy">
          {formatMoney(modality.price)}
        </span>
      </div>

      {athleteIds.length > 0 && problems.length > 0 ? (
        <ul
          role="alert"
          className="space-y-1 rounded-surface bg-fdnda-red-soft px-4 py-3 text-xs font-semibold text-fdnda-red-deep ring-1 ring-inset ring-fdnda-red/20"
        >
          {problems.map((problem, i) => (
            <li key={i}>• {problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button className="w-full sm:w-auto" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          className="w-full sm:w-auto"
          onClick={onCommit}
          disabled={athleteIds.length === 0 || problems.length > 0}
        >
          Guardar formación
        </Button>
      </div>
    </div>
  )
}
