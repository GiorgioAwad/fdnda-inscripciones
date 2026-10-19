"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { disciplineLabel } from "@/lib/disciplines"
import { athleteEligibilityError, validateEntryComposition } from "@/lib/eligibility"
import { birthYearOf, plural, SEX_LABELS } from "@/lib/utils"
import type { AthleteView, EntryView, ModalityView } from "../types"
import { AthleteFilter, FILTER_FROM, matchesAthleteFilter } from "./athlete-filter"
import { athleteName, isDivingPair, modalityLabel } from "./plan-labels"

// Editor de parejas de clavados sincronizados y formaciones (dueto, equipo artístico,
// plantel de polo) de la prueba elegida. Hay que elegir a varios, respetar el
// número de integrantes y marcar quién es reserva; los candidatos salen del
// padrón del club, y guardar la formación suma a sus integrantes a la planilla.
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

export function TeamFormationPanel({
  modality,
  athletes,
  entries,
  editing,
  readOnly,
  saving,
  onStartNew,
  onStartEdit,
  onChange,
  onDelete,
  onClose,
}: {
  modality: ModalityView
  /** Padrón elegible más la planilla: de acá salen candidatos y nombres. */
  athletes: AthleteView[]
  entries: EntryView[]
  editing: FormationDraft | null
  readOnly: boolean
  saving: boolean
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
  const [filter, setFilter] = useState("")
  const divingPair = isDivingPair(modality)
  const groupNoun = divingPair ? "pareja" : "formación"
  const groupTitle = divingPair ? "Pareja" : "Formación"

  const fullLabel = `${disciplineLabel(modality.discipline)} · ${modalityLabel(modality)}`
  const byId = new Map(athletes.map((row) => [row.id, row]))
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
  const reasonFor = (athlete: AthleteView) =>
    athlete.disciplines.includes(modality.discipline)
      ? athleteEligibilityError(modality, athlete)
      : `No tiene ${disciplineLabel(modality.discipline)} registrada en el padrón.`
  // Los elegibles, más quien ya esté marcado aunque haya dejado de serlo: sin
  // eso no habría forma de desmarcarlo.
  const candidates = athletes.filter(
    (athlete) => reasonFor(athlete) === null || selected.has(athlete.id)
  )
  const visibleCandidates = candidates.filter((athlete) =>
    matchesAthleteFilter(athlete, filter)
  )
  const members = (editing?.athleteIds ?? [])
    .map((id) => byId.get(id))
    .filter((row): row is AthleteView => Boolean(row))
  const problems = editing ? validateEntryComposition(modality, members) : []
  const full = selected.size >= modality.maxAthletes
  const editingNumber = editing?.entryId ? numberOf.get(editing.entryId) : undefined
  const isEditingHere = editing?.modalityId === modality.id
  const newOpen = isEditingHere && !editing.entryId

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
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fdnda-border px-4 py-3">
        <p className="text-sm font-semibold text-fdnda-muted">
          {modalityEntries.length === 0
            ? divingPair
              ? "Sin parejas todavía"
              : "Sin formaciones todavía"
            : plural(
                modalityEntries.length,
                divingPair ? "pareja" : "formación",
                divingPair ? "parejas" : "formaciones"
              )}
        </p>
        {!readOnly ? (
          <Button size="sm" onClick={onStartNew} disabled={saving || newOpen}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Armar {groupNoun}
          </Button>
        ) : null}
      </div>

      {modalityEntries.length === 0 && newOpen ? null : modalityEntries.length === 0 ? (
        <p className="px-4 py-5 text-sm text-fdnda-muted">
          {readOnly
            ? `Esta planilla no tiene ${divingPair ? "parejas" : "formaciones"} en esta prueba.`
            : `Usa «Armar ${groupNoun}» y elige a sus integrantes entre los deportistas de tu padrón que cumplen las condiciones.`}
        </p>
      ) : (
        <ul className="divide-y divide-fdnda-border">
          {modalityEntries.map((entry) => {
            const number = numberOf.get(entry.id) ?? 0
            const missing = modality.minAthletes - entry.athleteIds.length
            const names = entry.athleteIds
              .map((id) => {
                const athlete = byId.get(id)
                if (!athlete) return null
                return `${athleteName(athlete)}${entry.reserveIds.includes(id) ? " (reserva)" : ""}`
              })
              .filter(Boolean)
              .join(" · ")
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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

      {isEditingHere ? (
        <div className="border-t border-fdnda-border p-4">
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
              Ningún deportista de tu padrón cumple las condiciones de esta prueba.{" "}
              <Link
                href="/deportistas"
                className="font-semibold text-fdnda-navy underline underline-offset-2"
              >
                Abrir el padrón de deportistas
              </Link>
            </p>
          ) : (
            <>
              {candidates.length >= FILTER_FROM ? (
                <AthleteFilter value={filter} onChange={setFilter} className="mt-3" />
              ) : null}
              <ul className="mt-3 max-h-96 divide-y divide-fdnda-border overflow-y-auto rounded-control border border-fdnda-border bg-white">
                {visibleCandidates.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-fdnda-muted">
                    Nadie coincide con «{filter.trim()}».
                  </li>
                ) : null}
                {visibleCandidates.map((athlete) => {
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
                            {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
                            <span className="num">{birthYearOf(athlete.birthDate)}</span> ·{" "}
                            {SEX_LABELS[athlete.sex]}
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
            </>
          )}
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
    </div>
  )
}
