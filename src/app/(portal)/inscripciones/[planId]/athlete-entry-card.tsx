"use client"

import Link from "next/link"
import { ChevronDown, Lock, Trash2, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ARTISTIC_LEVEL_LABELS, groupByLevel } from "@/lib/artistic-levels"
import { disciplineLabel } from "@/lib/disciplines"
import { athleteEligibilityError } from "@/lib/eligibility"
import { birthYearOf, formatMoney, plural, SEX_LABELS } from "@/lib/utils"
import type { AthleteView, ModalityView } from "../types"
import {
  athleteName,
  modalityLabel,
  uncoveredDisciplines,
  type EntryPriceNote,
} from "./plan-labels"

// Una fila por deportista de la planilla. Las pruebas individuales se marcan con
// una casilla acá mismo; las de equipo abren el editor de formaciones, porque
// elegir titulares y reservas no cabe en una casilla.
//
// Las pruebas en las que NO puede inscribirse no se esconden: van plegadas al
// final con el motivo, para que el club sepa por qué faltan y qué corregir.

export interface AthleteEntryCardProps {
  athlete: AthleteView
  /** Todas las pruebas individuales de la competencia. */
  individualModalities: ModalityView[]
  /** Disciplinas de la competencia (de todas sus pruebas). */
  eventDisciplines: string[]
  /** Ids de pruebas individuales que este deportista tiene marcadas. */
  selectedModalityIds: Set<string>
  /** Pruebas ya inscritas en otra orden: marcadas, no editables, con su estado. */
  lockedModalities: Map<string, string>
  /** Nombre de las formaciones de equipo en las que participa. */
  teamEntryLabels: string[]
  /** La competencia solo ofrece parejas de clavados entre sus pruebas grupales. */
  divingPairsOnly: boolean
  expanded: boolean
  readOnly: boolean
  disabled: boolean
  /** Cuotas de competencia que le corresponden, una por disciplina que las cobra. */
  athleteFees: { label: string; amount: number }[]
  entryPriceNote: EntryPriceNote
  onToggleExpand: () => void
  onToggleModality: (modalityId: string, selected: boolean) => void
  onRemove: () => void
}

function joinLabels(disciplines: string[]) {
  return disciplines.map(disciplineLabel).join(", ")
}

export function AthleteEntryCard({
  athlete,
  individualModalities,
  eventDisciplines,
  selectedModalityIds,
  lockedModalities,
  teamEntryLabels,
  divingPairsOnly,
  expanded,
  readOnly,
  disabled,
  athleteFees,
  entryPriceNote,
  onToggleExpand,
  onToggleModality,
  onRemove,
}: AthleteEntryCardProps) {
  const name = athleteName(athlete)
  const detailId = `athlete-${athlete.id}-detail`
  const practised = individualModalities.filter((modality) =>
    athlete.disciplines.includes(modality.discipline)
  )
  const eligible: ModalityView[] = []
  const unavailable: { modality: ModalityView; reason: string }[] = []
  for (const modality of practised) {
    const reason = athleteEligibilityError(modality, athlete)
    if (reason === null) eligible.push(modality)
    else unavailable.push({ modality, reason })
  }
  const individualDisciplines = [
    ...new Set(individualModalities.map((row) => row.discipline)),
  ]
  const notPractised = individualDisciplines.filter(
    (discipline) => !athlete.disciplines.includes(discipline)
  )
  const uncovered = uncoveredDisciplines(athlete, eventDisciplines)
  const selectedCount =
    eligible.filter((modality) => selectedModalityIds.has(modality.id)).length +
    teamEntryLabels.length

  return (
    <li
      id={`athlete-${athlete.id}`}
      className="scroll-mt-24 border-b border-fdnda-border last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-controls={detailId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-control text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-fdnda-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-fdnda-ink">{name}</span>
            <span className="block text-xs text-fdnda-muted">
              {athlete.docType} <span className="num">{athlete.docNumber}</span> ·{" "}
              <span className="num">{birthYearOf(athlete.birthDate)}</span> ·{" "}
              {SEX_LABELS[athlete.sex]}
            </span>
          </span>
        </button>
        {uncovered.map((discipline) => (
          <Badge key={discipline} variant="warning">
            Sin afiliar en {disciplineLabel(discipline)}
          </Badge>
        ))}
        {selectedCount === 0 ? (
          <Badge variant="neutral">Sin pruebas marcadas</Badge>
        ) : (
          <span className="whitespace-nowrap text-sm font-semibold text-fdnda-navy">
            {plural(selectedCount, "prueba marcada", "pruebas marcadas")}
          </span>
        )}
        {!readOnly ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Quitar a ${name} de la planilla`}
            onClick={onRemove}
            disabled={disabled}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div
          id={detailId}
          className="space-y-3 border-t border-fdnda-border bg-fdnda-surface px-4 py-3"
        >
          {uncovered.length > 0 ? (
            <p className="rounded-control bg-fdnda-warning-soft px-3 py-2 text-xs font-semibold text-fdnda-ink">
              {name} no tiene una afiliación de {joinLabels(uncovered)} que cubra
              esta competencia: sus pruebas de {joinLabels(uncovered)} no se podrán
              pagar hasta afiliarlo.{" "}
              <Link
                href="/afiliacion?tab=deportistas"
                className="font-bold text-fdnda-navy underline underline-offset-2"
              >
                Afiliar a {name}
              </Link>
            </p>
          ) : null}

          {athleteFees.map((fee) => (
            <p
              key={fee.label}
              className="rounded-control bg-fdnda-sky/30 px-3 py-2 text-xs font-semibold text-fdnda-navy"
            >
              Cuota de competencia de {fee.label}: {formatMoney(fee.amount)} por
              deportista. Se cobra una vez si participa en al menos una prueba de{" "}
              {fee.label}, aunque haga varias. Si ya la pagaste en otra orden de
              esta competencia, no se vuelve a cobrar.
            </p>
          ))}

          {individualModalities.length === 0 ? (
            <p className="text-sm text-fdnda-muted">
              {divingPairsOnly
                ? "Esta competencia solo tiene pruebas sincronizadas: inscríbelo en una pareja de clavados."
                : "Esta competencia no tiene pruebas individuales: inscríbelo en una formación de las pruebas de equipo."}
            </p>
          ) : eligible.length === 0 && practised.length > 0 ? (
            <p className="text-sm text-fdnda-muted">
              Ninguna prueba individual corresponde a su año de nacimiento (
              {birthYearOf(athlete.birthDate)}) y sexo. El motivo de cada una está
              abajo.
            </p>
          ) : eligible.length > 0 ? (
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
                      const lockedStatus = lockedModalities.get(modality.id)
                      const locked = lockedStatus !== undefined
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
                              disabled={locked || readOnly || disabled}
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
                                {locked
                                  ? `Ya inscrita en otra orden · ${lockedStatus === "PAID" ? "pagada" : "pago pendiente"}`
                                  : `${disciplineLabel(modality.discipline)} · ${entryPriceNote(modality)}`}
                              </span>
                            </span>
                            {locked ? (
                              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            ) : null}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {notPractised.length > 0 ? (
            <p className="text-sm text-fdnda-muted">
              No tiene {joinLabels(notPractised)} registrada en el padrón, así que no
              puede inscribirse en esas pruebas.{" "}
              <Link
                href="/deportistas"
                className="font-semibold text-fdnda-navy underline underline-offset-2"
              >
                Abrir el padrón de deportistas
              </Link>
            </p>
          ) : null}

          {unavailable.length > 0 ? (
            <details className="rounded-control border border-fdnda-border bg-white">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-fdnda-navy">
                {plural(unavailable.length, "prueba no disponible", "pruebas no disponibles")}{" "}
                para {name}
              </summary>
              <ul className="divide-y divide-fdnda-border border-t border-fdnda-border">
                {unavailable.map(({ modality, reason }) => (
                  <li key={modality.id} className="px-3 py-2 text-sm">
                    <span className="block font-medium text-fdnda-ink">
                      {modalityLabel(modality)}
                    </span>
                    <span className="block text-xs text-fdnda-muted">{reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {teamEntryLabels.length > 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-fdnda-muted">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {divingPairsOnly ? "En parejas:" : "En formaciones:"}
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
