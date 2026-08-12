"use client"

import { Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { disciplineLabel } from "@/lib/disciplines"
import { isAthleteEligible, validateEntryComposition } from "@/lib/eligibility"
import { formatMoney, SEX_LABELS, SEX_RULE_LABELS } from "@/lib/utils"
import type { AthleteView, EntryView, ModalityView } from "../types"

// Editor de formaciones de equipo (dueto, equipo artístico, plantel de polo).
// Es lo único que no cabe en la vista por deportista: hay que elegir a varios,
// respetar el tamaño de la formación y marcar quién va de reserva.

export interface FormationDraft {
  entryId?: string
  modalityId: string
  athleteIds: string[]
  reserveIds: string[]
}

function athleteName(athlete: AthleteView) {
  return `${athlete.lastNames}, ${athlete.firstNames}`
}

function modalityLabel(modality: ModalityView) {
  return [modality.name, modality.category].filter(Boolean).join(" · ")
}

function ruleLabel(modality: ModalityView) {
  // En «Sub-N» el año 'desde' es un tope de edad, no el piso de un rango.
  const years =
    modality.ageRuleMode === "MAX_AGE_ONLY" && modality.birthYearFrom !== null
      ? `nacidos en ${modality.birthYearFrom} o después`
      : modality.birthYearFrom || modality.birthYearTo
        ? `${modality.birthYearFrom ?? "…"}–${modality.birthYearTo ?? "…"}`
        : "sin límite de edad"
  const team =
    modality.minAthletes === modality.maxAthletes
      ? `${modality.minAthletes} integrantes`
      : `${modality.minAthletes}–${modality.maxAthletes} integrantes`
  return `${SEX_RULE_LABELS[modality.sexRule]} · ${years} · ${team}`
}

export function TeamFormationPanel({
  modalities,
  activeModalityId,
  roster,
  entries,
  editing,
  readOnly,
  saving,
  onSelectModality,
  onStartNew,
  onStartEdit,
  onChange,
  onDelete,
  onClose,
}: {
  modalities: ModalityView[]
  activeModalityId: string
  roster: AthleteView[]
  entries: EntryView[]
  editing: FormationDraft | null
  readOnly: boolean
  saving: boolean
  onSelectModality: (modalityId: string) => void
  onStartNew: () => void
  onStartEdit: (draft: FormationDraft) => void
  onChange: (draft: FormationDraft) => void
  onDelete: (entryId: string) => void
  onClose: () => void
}) {
  const modality = modalities.find((row) => row.id === activeModalityId) ?? null

  if (modalities.length === 0) {
    return (
      <Card className="p-5 text-sm text-fdnda-muted">
        Esta competencia no tiene pruebas de equipo.
      </Card>
    )
  }
  if (!modality) return null

  const modalityEntries = entries.filter((row) => row.modalityId === modality.id)
  const usedElsewhere = new Set(
    modalityEntries
      .filter((row) => row.id !== editing?.entryId)
      .flatMap((row) => row.athleteIds)
  )
  const eligible = roster.filter(
    (athlete) =>
      athlete.disciplines.includes(modality.discipline) &&
      isAthleteEligible(modality, athlete)
  )
  const selected = new Set(editing?.athleteIds ?? [])
  const reserves = new Set(editing?.reserveIds ?? [])
  const members = (editing?.athleteIds ?? [])
    .map((id) => roster.find((row) => row.id === id))
    .filter((row): row is AthleteView => Boolean(row))
  const problems = editing ? validateEntryComposition(modality, members) : []

  const toggle = (athleteId: string) => {
    if (!editing) return
    const athleteIds = selected.has(athleteId)
      ? editing.athleteIds.filter((id) => id !== athleteId)
      : [...editing.athleteIds, athleteId]
    if (athleteIds.length > modality.maxAthletes) return
    onChange({
      ...editing,
      athleteIds,
      reserveIds: editing.reserveIds.filter((id) => athleteIds.includes(id)),
    })
  }

  const toggleReserve = (athleteId: string) => {
    if (!editing) return
    onChange({
      ...editing,
      reserveIds: reserves.has(athleteId)
        ? editing.reserveIds.filter((id) => id !== athleteId)
        : [...editing.reserveIds, athleteId],
    })
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-fdnda-border bg-fdnda-surface p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-fdnda-muted">
            Prueba de equipo
          </span>
          <select
            value={activeModalityId}
            onChange={(event) => onSelectModality(event.target.value)}
            className="min-h-11 w-full rounded-control border border-fdnda-border bg-white px-3 text-sm font-semibold text-fdnda-ink focus:border-fdnda-turquoise focus:outline-none focus:ring-2 focus:ring-fdnda-turquoise/25"
          >
            {modalities.map((row) => (
              <option key={row.id} value={row.id}>
                {disciplineLabel(row.discipline)} · {modalityLabel(row)}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-fdnda-muted">
          {ruleLabel(modality)}
          {modality.chargesEntry
            ? ` · ${formatMoney(modality.price)} por formación`
            : " · incluida en la cuota por deportista"}
          {modality.upgradeYear ? ` · admite nacidos en ${modality.upgradeYear}` : ""}
        </p>
        {!readOnly ? (
          <Button size="sm" className="mt-3" onClick={onStartNew} disabled={saving}>
            <Plus className="h-4 w-4" /> Nueva formación
          </Button>
        ) : null}
      </div>

      {modalityEntries.length === 0 ? (
        <p className="p-5 text-sm text-fdnda-muted">
          Aún no hay formaciones en esta prueba.
        </p>
      ) : (
        <ul className="divide-y divide-fdnda-border">
          {modalityEntries.map((entry, index) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="text-xs font-bold text-fdnda-muted">#{index + 1}</span>
              <span className="min-w-0 flex-1 text-sm">
                {entry.athleteIds
                  .map((id) => {
                    const athlete = roster.find((row) => row.id === id)
                    return athlete
                      ? `${athleteName(athlete)}${entry.reserveIds.includes(id) ? " (reserva)" : ""}`
                      : "Deportista"
                  })
                  .join(" · ") || "Formación incompleta"}
              </span>
              {entry.status !== "IN_CART" ? (
                <Badge variant="accent">Bloqueada</Badge>
              ) : !readOnly ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onStartEdit({
                        entryId: entry.id,
                        modalityId: entry.modalityId,
                        athleteIds: entry.athleteIds,
                        reserveIds: entry.reserveIds,
                      })
                    }
                  >
                    Editar
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Eliminar formación"
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing?.modalityId === modality.id ? (
        <div className="border-t border-fdnda-border p-5">
          <h4 className="font-bold text-fdnda-navy">
            {editing.entryId ? "Editar formación" : "Nueva formación"}
          </h4>
          <ul className="mt-3 max-h-80 divide-y divide-fdnda-border overflow-y-auto rounded-control border border-fdnda-border">
            {eligible.map((athlete) => {
              const taken = usedElsewhere.has(athlete.id)
              const checked = selected.has(athlete.id)
              return (
                <li key={athlete.id}>
                  <label
                    className={`flex min-h-14 items-center gap-3 px-3 py-2 text-sm ${
                      taken
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer hover:bg-fdnda-surface"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={taken || saving}
                      onChange={() => toggle(athlete.id)}
                      className="h-5 w-5 accent-fdnda-navy"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{athleteName(athlete)}</span>
                      <span className="text-xs text-fdnda-muted">
                        {new Date(athlete.birthDate).getUTCFullYear()} ·{" "}
                        {SEX_LABELS[athlete.sex]}
                        {taken ? " · ya está en otra formación" : ""}
                      </span>
                    </span>
                    {checked && modality.maxAthletes > modality.minAthletes ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={(event) => {
                          event.preventDefault()
                          toggleReserve(athlete.id)
                        }}
                        className={`min-h-10 rounded-control px-3 text-xs font-bold ring-1 ring-inset disabled:opacity-50 ${
                          reserves.has(athlete.id)
                            ? "bg-fdnda-navy-soft text-fdnda-navy ring-fdnda-navy/20"
                            : "bg-white text-fdnda-muted ring-fdnda-border"
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
          {eligible.length === 0 ? (
            <p className="mt-3 text-sm text-fdnda-muted">
              No hay deportistas elegibles en la nómina. Agrégalos desde el buscador.
            </p>
          ) : null}
          {problems.length > 0 ? (
            <ul className="mt-3 rounded-control bg-fdnda-red-soft p-3 text-xs font-semibold text-fdnda-red-deep">
              {problems.map((problem) => (
                <li key={problem}>• {problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fdnda-muted">
              Cada cambio se autoguarda. Puedes cerrar una formación incompleta; el
              pago seguirá bloqueado.
            </p>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {saving ? "Guardando…" : "Cerrar edición"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
