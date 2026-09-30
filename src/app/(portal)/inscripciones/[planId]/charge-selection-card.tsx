"use client"

import { Card } from "@/components/ui/card"

// Solo aparece cuando la competencia cobra los dos conceptos. Con uno solo no
// hay nada que elegir, y nadie puede optar por no pagar.

export function ChargeSelectionCard({
  paysEntry,
  paysAthleteFee,
  entryDetail,
  athleteFeeDetail,
  disabled,
  onChange,
}: {
  paysEntry: boolean
  paysAthleteFee: boolean
  /** Cuánto cuesta cada formación, ya con formato. */
  entryDetail: string
  /** Cuánto cuesta la cuota de competencia por deportista, ya con formato. */
  athleteFeeDetail: string
  disabled: boolean
  onChange: (next: { paysEntry: boolean; paysAthleteFee: boolean }) => void
}) {
  const ninguno = !paysEntry && !paysAthleteFee

  return (
    <Card className="p-5">
      <h3 className="font-heading text-lg font-bold text-fdnda-navy">
        Qué paga tu club
      </h3>
      <p className="mt-1 text-sm text-fdnda-muted">
        Esta competencia cobra dos conceptos. Marca los que pagará tu club; los
        marcados se suman al total.
      </p>
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={paysEntry}
          disabled={disabled}
          onChange={(event) =>
            onChange({ paysEntry: event.target.checked, paysAthleteFee })
          }
          className="mt-0.5 h-5 w-5 accent-fdnda-navy"
        />
        <span>
          <span className="block font-semibold text-fdnda-ink">Precio por formación</span>
          <span className="block text-xs text-fdnda-muted">{entryDetail}</span>
        </span>
      </label>
      <label className="mt-2 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={paysAthleteFee}
          disabled={disabled}
          onChange={(event) =>
            onChange({ paysEntry, paysAthleteFee: event.target.checked })
          }
          className="mt-0.5 h-5 w-5 accent-fdnda-navy"
        />
        <span>
          <span className="block font-semibold text-fdnda-ink">
            Cuota de competencia por deportista
          </span>
          <span className="block text-xs text-fdnda-muted">{athleteFeeDetail}</span>
        </span>
      </label>
      {ninguno ? (
        <p className="mt-3 rounded-control bg-fdnda-red-soft p-3 text-xs font-semibold text-fdnda-red-deep">
          Marca al menos un concepto: sin ninguno, la planilla no se puede pagar.
        </p>
      ) : null}
    </Card>
  )
}
