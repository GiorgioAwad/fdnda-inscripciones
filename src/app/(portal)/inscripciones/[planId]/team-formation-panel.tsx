"use client"

import { useState } from "react"
import { Check, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ARTISTIC_LEVEL_LABELS, groupByLevel } from "@/lib/artistic-levels"
import { disciplineLabel } from "@/lib/disciplines"
import { athleteEligibilityError, validateEntryComposition } from "@/lib/eligibility"
import { leaguePriceBreakdown } from "@/lib/league"
import { birthYearOf, plural, SEX_LABELS, SEX_RULE_LABELS } from "@/lib/utils"
import type { AthleteView, EntryView, ModalityView } from "../types"
import { athleteName, isDivingPair, modalityLabel, type EntryPriceNote } from "./plan-labels"

// Editor de parejas de clavados sincronizados y formaciones (dueto, equipo artístico,
// plantel de polo). Es lo único que no cabe en la vista por deportista: hay que
// elegir a varios, respetar el número de integrantes y marcar quién es reserva.
//
// Una formación nueva no se guarda hasta que tiene su primer integrante: así
// «Armar formación» no deja en la planilla una formación vacía que bloquee el
// pago si el club cambia de idea.

export interface FormationDraft {
  entryId?: string
  modalityId: string
  athleteIds: string[]
  reserveIds: string[]
}

function sizeLabel(modality: ModalityView) {
  return modality.minAthletes === modality.maxAthletes
    ? plural(modality.minAthletes, "integrante", "integrantes")
    : `de ${modality.minAthletes} a ${modality.maxAthletes} integrantes`
}

function ruleLabel(modality: ModalityView) {
  // En «Sub-N» el año 'desde' es un tope de edad, no el piso de un rango.
  const years =
    modality.ageRuleMode === "MAX_AGE_ONLY" && modality.birthYearFrom !== null
      ? `nacidos en ${modality.birthYearFrom} o después`
      : modality.birthYearFrom !== null && modality.birthYearTo !== null
        ? `nacidos entre ${modality.birthYearFrom} y ${modality.birthYearTo}`
        : modality.birthYearFrom !== null
          ? `nacidos en ${modality.birthYearFrom} o después`
          : modality.birthYearTo !== null
            ? `nacidos en ${modality.birthYearTo} o antes`
            : "sin límite de edad"
  return `${SEX_RULE_LABELS[modality.sexRule]} · ${years} · ${sizeLabel(modality)}`
}

export function TeamFormationPanel({
  modalities,
  activeModalityId,
  roster,
  entries,
  editing,
  readOnly,
  saving,
  entryPriceNote,
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
  entryPriceNote: EntryPriceNote
  onSelectModality: (modalityId: string) => void
  onStartNew: () => void
  onStartEdit: (draft: FormationDraft) => void
  onChange: (draft: FormationDraft) => void
  onDelete: (entryId: string) => Promise<void>
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState<{
    entryId: string
    number: number
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const modality = modalities.find((row) => row.id === activeModalityId) ?? null
  if (!modality) return null
  const divingPair = isDivingPair(modality)
  const groupNoun = divingPair ? "pareja" : "formación"
  const groupTitle = divingPair ? "Pareja" : "Formación"

  const fullLabel = `${disciplineLabel(modality.discipline)} · ${modalityLabel(modality)}`
  const modalityEntries = entries.filter((row) => row.modalityId === modality.id)
  const numberOf = new Map(modalityEntries.map((row, index) => [row.id, index + 1]))
  const takenBy = new Map<string, number>()
  for (const row of modalityEntries) {
    if (row.id === editing?.entryId) continue
    for (const athleteId of row.athleteIds) {
      takenBy.set(athleteId, numberOf.get(row.id) ?? 0)
    }
  }
  const selected = new Set(editing?.athleteIds ?? [])
  const reserves = new Set(editing?.reserveIds ?? [])
  // Quienes practican la disciplina, más quien ya esté marcado aunque no la
  // practique: sin eso no habría forma de desmarcarlo.
  const candidates = roster.filter(
    (athlete) =>
      athlete.disciplines.includes(modality.discipline) || selected.has(athlete.id)
  )
  const reasonFor = (athlete: AthleteView) =>
    athlete.disciplines.includes(modality.discipline)
      ? athleteEligibilityError(modality, athlete)
      : `No tiene ${disciplineLabel(modality.discipline)} registrada en el padrón.`
  const eligibleCount = candidates.filter((athlete) => reasonFor(athlete) === null).length
  const members = (editing?.athleteIds ?? [])
    .map((id) => roster.find((row) => row.id === id))
    .filter((row): row is AthleteView => Boolean(row))
  const problems = editing ? validateEntryComposition(modality, members) : []
  const full = selected.size >= modality.maxAthletes
  const editingNumber = editing?.entryId ? numberOf.get(editing.entryId) : undefined
  const newOpen = editing?.modalityId === modality.id && !editing.entryId

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
          <span className="mb-1 block text-sm font-semibold text-fdnda-ink">
            {divingPair ? "Prueba sincronizada" : "Prueba de equipo"}
          </span>
          <select
            value={activeModalityId}
            onChange={(event) => onSelectModality(event.target.value)}
            className="min-h-11 w-full rounded-control border border-fdnda-border bg-white px-3 text-sm font-semibold text-fdnda-ink focus:border-fdnda-turquoise focus:outline-none focus:ring-2 focus:ring-fdnda-turquoise/25"
          >
            {groupByLevel(modalities).map((group) =>
              group.level === null ? (
                group.rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {disciplineLabel(row.discipline)} · {modalityLabel(row)}
                  </option>
                ))
              ) : (
                <optgroup key={group.level} label={ARTISTIC_LEVEL_LABELS[group.level]}>
                  {group.rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {disciplineLabel(row.discipline)} ·{" "}
                      {modalityLabel(row, group.level)}
                    </option>
                  ))}
                </optgroup>
              )
            )}
          </select>
        </label>
        <p className="mt-2 text-xs text-fdnda-muted">
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
        {!readOnly ? (
          <Button
            size="sm"
            className="mt-3"
            onClick={onStartNew}
            disabled={saving || newOpen}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Armar {groupNoun}
          </Button>
        ) : null}
      </div>

      {modalityEntries.length === 0 ? (
        <p className="p-5 text-sm text-fdnda-muted">
          {readOnly
            ? `Esta planilla no tiene ${divingPair ? "parejas" : "formaciones"} en esta prueba.`
            : `Aún no hay ${divingPair ? "parejas" : "formaciones"} en esta prueba. Usa «Armar ${groupNoun}» para elegir a sus integrantes.`}
        </p>
      ) : (
        <ul className="divide-y divide-fdnda-border">
          {modalityEntries.map((entry) => {
            const number = numberOf.get(entry.id) ?? 0
            const missing = modality.minAthletes - entry.athleteIds.length
            const names = entry.athleteIds
              .map((id) => {
                const athlete = roster.find((row) => row.id === id)
                if (!athlete) return null
                return `${athleteName(athlete)}${entry.reserveIds.includes(id) ? " (reserva)" : ""}`
              })
              .filter(Boolean)
              .join(" · ")
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="text-sm font-bold text-fdnda-navy">
                  {groupTitle} {number}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {names || "Sin integrantes"}
                </span>
                {missing > 0 ? (
                  <Badge variant="warning">
                    {missing === 1 ? "Falta" : "Faltan"}{" "}
                    {plural(missing, "integrante", "integrantes")}
                  </Badge>
                ) : null}
                {entry.status !== "IN_CART" ? (
                  <Badge variant={entry.status === "PAID" ? "success" : "warning"}>
                    {entry.status === "PAID" ? "Pagada" : "Pago pendiente"}
                  </Badge>
                ) : !readOnly ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Editar ${groupNoun} ${number} de ${fullLabel}`}
                      disabled={saving}
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
                      aria-label={`Eliminar ${groupNoun} ${number} de ${fullLabel}`}
                      disabled={saving}
                      onClick={() => setConfirming({ entryId: entry.id, number })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {editing?.modalityId === modality.id ? (
        <div className="border-t border-fdnda-border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-bold text-fdnda-navy">
              {editingNumber ? `${groupTitle} ${editingNumber}` : `Nueva ${groupNoun}`}
            </h4>
            <p className="text-sm font-semibold text-fdnda-navy" aria-live="polite">
              Integrantes: <span className="num">{selected.size}</span> de{" "}
              <span className="num">{modality.maxAthletes}</span>
              {modality.minAthletes !== modality.maxAthletes
                ? ` (mínimo ${modality.minAthletes})`
                : ""}
            </p>
          </div>
          {candidates.length === 0 ? (
            <p className="mt-3 text-sm text-fdnda-muted">
              Ningún deportista de la planilla practica{" "}
              {disciplineLabel(modality.discipline)}. Agrégalos desde el buscador de
              arriba.
            </p>
          ) : (
            <ul className="mt-3 max-h-80 divide-y divide-fdnda-border overflow-y-auto rounded-control border border-fdnda-border">
              {candidates.map((athlete) => {
                const name = athleteName(athlete)
                const checked = selected.has(athlete.id)
                const reason = reasonFor(athlete)
                const taken = takenBy.get(athlete.id)
                const blockedReason = reason
                  ? reason
                  : taken !== undefined
                    ? `Ya está en la ${groupNoun} ${taken}.`
                    : full && !checked
                      ? `${groupTitle} completa.`
                      : null
                const unavailable = !checked && blockedReason !== null
                return (
                  <li key={athlete.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                    <label
                      className={`flex min-w-0 flex-1 items-center gap-3 text-sm ${
                        unavailable ? "cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saving || unavailable}
                        onChange={() => toggle(athlete.id)}
                        className="h-5 w-5 shrink-0 accent-fdnda-navy"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block font-semibold ${unavailable ? "text-fdnda-muted" : "text-fdnda-ink"}`}
                        >
                          {name}
                        </span>
                        <span className="block text-xs text-fdnda-muted">
                          {birthYearOf(athlete.birthDate)} · {SEX_LABELS[athlete.sex]}
                          {blockedReason ? ` · ${blockedReason}` : ""}
                        </span>
                      </span>
                    </label>
                    {checked && modality.maxAthletes > modality.minAthletes ? (
                      <button
                        type="button"
                        disabled={saving}
                        aria-pressed={reserves.has(athlete.id)}
                        aria-label={`Reserva: ${name}`}
                        onClick={() => toggleReserve(athlete.id)}
                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-control px-3 text-xs font-bold ring-1 ring-inset disabled:opacity-50 ${
                          reserves.has(athlete.id)
                            ? "bg-fdnda-navy-soft text-fdnda-navy ring-fdnda-navy/20"
                            : "bg-white text-fdnda-muted ring-fdnda-border"
                        }`}
                      >
                        {reserves.has(athlete.id) ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : null}
                        Reserva
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {candidates.length > 0 && eligibleCount === 0 ? (
            <p className="mt-3 text-sm text-fdnda-muted">
              Ningún deportista de la planilla cumple las condiciones de esta prueba (
              {ruleLabel(modality)}). Agrega otros desde el buscador de arriba.
            </p>
          ) : null}
          {problems.length > 0 ? (
            <ul className="mt-3 list-inside list-disc space-y-1 rounded-control bg-fdnda-red-soft p-3 text-xs font-semibold text-fdnda-red-deep">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs text-fdnda-muted">
              Cada cambio se guarda solo. Si cierras la {groupNoun} sin integrantes,
              se elimina; si la cierras incompleta, la planilla no se podrá pagar
              hasta completarla.
            </p>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {saving ? "Guardando…" : "Cerrar edición"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={`¿Eliminar la ${groupNoun} ${confirming?.number ?? ""} de ${fullLabel}?`}
        consequence={`Se quita de la planilla. Sus integrantes siguen en la planilla y puedes armar otra ${groupNoun}.`}
        confirmLabel={`Eliminar ${groupNoun}`}
        destructive
        pending={deleting}
        onConfirm={async () => {
          if (!confirming) return
          setDeleting(true)
          try {
            await onDelete(confirming.entryId)
          } finally {
            setDeleting(false)
            setConfirming(null)
          }
        }}
      />
    </Card>
  )
}
