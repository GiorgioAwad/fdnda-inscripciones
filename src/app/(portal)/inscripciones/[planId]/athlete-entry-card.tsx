"use client"

import { ChevronDown, Lock, Trash2, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ARTISTIC_LEVEL_LABELS,
  groupByLevel,
  stripLevelPrefix,
  type ArtisticLevelValue,
} from "@/lib/artistic-levels"
import { disciplineLabel } from "@/lib/disciplines"
import { athleteEligibilityError } from "@/lib/eligibility"
import { formatMoney, SEX_LABELS } from "@/lib/utils"
import type { AthleteView, ModalityView } from "../types"

// Una fila por deportista de la nómina. Las pruebas individuales se marcan con
// una casilla acá mismo; las de equipo abren el editor de formaciones, porque
// elegir titulares y reservas no cabe en una casilla.

export interface AthleteEntryCardProps {
  athlete: AthleteView
  /** Pruebas individuales del evento, ya filtradas a las de su disciplina. */
  individualModalities: ModalityView[]
  /** Ids de pruebas individuales que este deportista tiene marcadas. */
  selectedModalityIds: Set<string>
  /** Pruebas ya confirmadas en otra orden: marcadas y no editables. */
  lockedModalityIds: Set<string>
  /** Nombre de las formaciones de equipo en las que participa. */
  teamEntryLabels: string[]
  expanded: boolean
  readOnly: boolean
  busy: boolean
  /** Cuota fija que le corresponde, si su disciplina cobra por deportista. */
  athleteFee: { label: string; amount: number; covered: boolean } | null
  onToggleExpand: () => void
  onToggleModality: (modalityId: string, selected: boolean) => void
  onRemove: () => void
}

function athleteName(athlete: AthleteView) {
  return `${athlete.lastNames}, ${athlete.firstNames}`
}

// Bajo un encabezado que ya dice BÁSICO, la fila «Solo Libre · Básico —
// Infantil A — Damas» repite el nivel. Se quita solo del grupo que lo lleva de
// encabezado: en el grupo sin nivel la categoría se muestra tal cual está
// guardada, porque ahí nada más la desambigua.
function modalityLabel(
  modality: ModalityView,
  level: ArtisticLevelValue | null
) {
  const category =
    level === null ? modality.category : stripLevelPrefix(modality.category)
  return [modality.name, category].filter(Boolean).join(" · ")
}

export function AthleteEntryCard({
  athlete,
  individualModalities,
  selectedModalityIds,
  lockedModalityIds,
  teamEntryLabels,
  expanded,
  readOnly,
  busy,
  athleteFee,
  onToggleExpand,
  onToggleModality,
  onRemove,
}: AthleteEntryCardProps) {
  const eligible = individualModalities.filter(
    (modality) =>
      athlete.disciplines.includes(modality.discipline) &&
      athleteEligibilityError(modality, athlete) === null
  )
  const selectedCount =
    eligible.filter((modality) => selectedModalityIds.has(modality.id)).length +
    teamEntryLabels.length

  return (
    <li className="border-b border-fdnda-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-control text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-fdnda-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-fdnda-ink">{athleteName(athlete)}</span>
            <span className="block text-xs text-fdnda-muted">
              {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
              <span className="num">{new Date(athlete.birthDate).getUTCFullYear()}</span> ·{" "}
              {SEX_LABELS[athlete.sex]}
            </span>
          </span>
        </button>
        {selectedCount === 0 ? (
          <Badge variant="neutral">Sin pruebas</Badge>
        ) : (
          <span className="whitespace-nowrap text-sm font-semibold text-fdnda-navy">
            <span className="num">{selectedCount}</span> de{" "}
            <span className="num">{eligible.length + teamEntryLabels.length}</span>{" "}
            prueba(s)
          </span>
        )}
        {!readOnly ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Quitar a ${athleteName(athlete)} de la planilla`}
            onClick={onRemove}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-fdnda-border bg-fdnda-surface px-4 py-3">
          {athleteFee ? (
            <p
              className={`mb-3 rounded-control px-3 py-2 text-xs font-semibold ${
                athleteFee.covered
                  ? "bg-fdnda-success-soft text-fdnda-success"
                  : "bg-fdnda-sky/30 text-fdnda-navy"
              }`}
            >
              {athleteFee.covered
                ? `Cuota de ${athleteFee.label} ya pagada en esta competencia: no se vuelve a cobrar.`
                : `Cuota de ${athleteFee.label}: ${formatMoney(athleteFee.amount)} una sola vez, sin importar cuántas pruebas haga.`}
            </p>
          ) : null}

          {eligible.length === 0 ? (
            <p className="text-sm text-fdnda-muted">
              No hay pruebas individuales para las que sea elegible.
            </p>
          ) : (
            <div className="space-y-3">
              {groupByLevel(eligible).map((group) => (
                <div key={group.level ?? "sin-nivel"}>
                  {group.level ? (
                    <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-fdnda-turquoise-deep">
                      {ARTISTIC_LEVEL_LABELS[group.level]}
                    </h3>
                  ) : null}
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {group.rows.map((modality) => {
                      const locked = lockedModalityIds.has(modality.id)
                      const checked = locked || selectedModalityIds.has(modality.id)
                      return (
                        <li key={modality.id}>
                          <label
                            className={`flex min-h-11 items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors motion-reduce:transition-none ${
                              locked
                                ? "cursor-not-allowed bg-fdnda-sunken text-fdnda-muted"
                                : "cursor-pointer hover:bg-white hover:shadow-raised has-checked:bg-fdnda-navy-soft has-checked:ring-1 has-checked:ring-inset has-checked:ring-fdnda-navy/20"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={locked || readOnly || busy}
                              onChange={(event) =>
                                onToggleModality(modality.id, event.target.checked)
                              }
                              className="h-5 w-5 shrink-0 accent-fdnda-navy"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium text-fdnda-ink">
                                {modalityLabel(modality, group.level)}
                              </span>
                              <span className="block text-xs text-fdnda-muted">
                                {disciplineLabel(modality.discipline)}
                                {modality.chargesEntry
                                  ? ` · ${formatMoney(modality.price)}`
                                  : " · incluida en la cuota"}
                              </span>
                            </span>
                            {locked ? (
                              <Lock className="h-3.5 w-3.5 shrink-0" aria-label="Ya inscrito" />
                            ) : null}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {teamEntryLabels.length > 0 ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fdnda-muted">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              En formaciones de equipo:
              {teamEntryLabels.map((label) => (
                <Badge key={label} variant="accent">
                  {label}
                </Badge>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
