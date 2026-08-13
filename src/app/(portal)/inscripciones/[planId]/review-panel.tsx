"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Loader2, Printer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { disciplineLabel } from "@/lib/disciplines"
import { formatMoney } from "@/lib/utils"
import type { LockedEntryView, PlanView, SerializableValidation } from "../types"

// Revisión y pago. Es un panel dentro de la pantalla de armado, no un paso
// aparte: el club ve el total y las incidencias mientras sigue editando.

export function ReviewPanel({
  validation,
  plan,
  charges,
  lockedEntries,
  checkingOut,
  blocked,
  saving,
  onPrint,
  onCheckout,
}: {
  validation: SerializableValidation | null
  plan: PlanView
  /** Elección vigente del club (estado vivo del wizard, no `plan.paysEntry/paysAthleteFee`). */
  charges: { paysEntry: boolean; paysAthleteFee: boolean }
  lockedEntries: LockedEntryView[]
  checkingOut: boolean
  blocked: boolean
  saving: boolean
  onPrint: () => void
  onCheckout: () => void
}) {
  return (
    <section className="space-y-4" aria-labelledby="review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="review-heading" className="font-heading text-xl font-bold text-fdnda-navy">
            Revisión y pago
          </h2>
          <p className="mt-1 text-sm text-fdnda-muted">
            El servidor revisa afiliación, reglas, duplicados, cupos y precio vigente.
          </p>
        </div>
        <Button variant="outline" onClick={onPrint} disabled={saving || blocked}>
          <Printer className="h-4 w-4" /> Resumen imprimible
        </Button>
      </div>

      {!validation ? (
        <Card className="flex items-center gap-3 p-5 text-sm text-fdnda-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Validando la revisión guardada…
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Nómina" value={validation.summary.rosterAthleteCount} />
            <Metric label="Con pruebas" value={validation.summary.registeredAthleteCount} />
            <Metric label="Formaciones" value={validation.summary.entryCount} />
            <Metric label="Total" value={formatMoney(validation.summary.totalAmount)} />
          </div>

          {validation.summary.byDiscipline.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="border-b border-fdnda-border bg-fdnda-surface px-5 py-3">
                <h3 className="font-heading font-bold text-fdnda-navy">
                  Desglose por disciplina
                </h3>
              </div>
              <ul className="divide-y divide-fdnda-border">
                {validation.summary.byDiscipline.map((row) => {
                  // Lo que realmente se cobra es configuración del evento Y
                  // elección del club: la misma condición que usa el motor de
                  // precios (computePlanPricing). Ramificar solo por
                  // row.chargesEntry/chargesAthleteFee (config del evento) o
                  // solo por los importes puede afirmar un cobro que el club
                  // ya destildó, o negar uno real cuando el precio da 0.
                  const cobraFormacion = row.chargesEntry && charges.paysEntry
                  const cobraCuota = row.chargesAthleteFee && charges.paysAthleteFee
                  return (
                    <li
                      key={row.discipline}
                      className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm"
                    >
                      <span className="font-semibold text-fdnda-ink">
                        {disciplineLabel(row.discipline)}
                        <span className="ml-2 text-xs font-normal text-fdnda-muted">
                          {cobraFormacion && cobraCuota
                            ? `${row.entryCount} formación(es) · ${row.athleteCount} deportista(s) × cuota fija`
                            : cobraCuota
                              ? `${row.athleteCount} deportista(s) × cuota fija · ${row.entryCount} prueba(s) sin cobro aparte`
                              : cobraFormacion
                                ? `${row.entryCount} formación(es) · ${row.athleteCount} deportista(s)`
                                : `${row.entryCount} prueba(s) · ${row.athleteCount} deportista(s) · sin cobro en esta disciplina`}
                        </span>
                      </span>
                      <strong className="text-fdnda-navy">{formatMoney(row.subtotal)}</strong>
                    </li>
                  )
                })}
              </ul>
              {validation.summary.coveredAthleteFees > 0 ? (
                <p className="border-t border-fdnda-border bg-fdnda-success-soft px-5 py-2.5 text-xs font-semibold text-fdnda-success">
                  {validation.summary.coveredAthleteFees} cuota(s) ya pagada(s) en otra
                  orden de esta competencia: no se vuelven a cobrar.
                </p>
              ) : null}
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div
              className={`flex items-center gap-2 border-b px-5 py-4 font-bold ${
                validation.valid
                  ? "border-fdnda-success-ring bg-fdnda-success-soft text-fdnda-success"
                  : "border-fdnda-danger-ring bg-fdnda-danger-soft text-fdnda-danger"
              }`}
            >
              {validation.valid ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
              {validation.valid
                ? "Planilla lista para pagar"
                : "Corrige las incidencias antes de pagar"}
            </div>
            {validation.issues.length > 0 ? (
              <ul className="divide-y divide-fdnda-border">
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className="flex gap-3 px-5 py-3 text-sm">
                    <Badge variant={issue.severity === "ERROR" ? "danger" : "warning"}>
                      {issue.severity === "ERROR" ? "Error" : "Aviso"}
                    </Badge>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-fdnda-muted">No se encontraron incidencias.</p>
            )}
          </Card>

          {lockedEntries.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="border-b border-fdnda-border bg-fdnda-surface px-5 py-4">
                <h3 className="font-heading font-bold text-fdnda-navy">
                  Inscripciones previas de esta competencia
                </h3>
                <p className="mt-1 text-xs text-fdnda-muted">
                  Ya están en una orden pendiente o pagada.
                </p>
              </div>
              <ul className="divide-y divide-fdnda-border">
                {lockedEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                  >
                    <Badge variant={entry.status === "PAID" ? "success" : "warning"}>
                      {entry.status === "PAID" ? "Pagada" : "Pago pendiente"}
                    </Badge>
                    <span className="min-w-0 flex-1 font-semibold text-fdnda-ink">
                      {disciplineLabel(entry.discipline)} · {entry.modalityName}
                      {entry.category ? ` · ${entry.category}` : ""}
                    </span>
                    <span className="text-xs text-fdnda-muted">
                      {entry.athleteIds.length} deportista(s)
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}

      <div className="sticky bottom-4 flex flex-col gap-3 rounded-surface border-2 border-fdnda-navy bg-white p-4 shadow-overlay sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fdnda-muted">
          {validation
            ? `Total a pagar: ${formatMoney(validation.summary.totalAmount)}`
            : "Calculando el total…"}
        </p>
        {plan.activeOrder ? (
          <Link
            href={`/pago/${plan.activeOrder.id}`}
            className="inline-flex min-h-11 items-center justify-center rounded-control bg-fdnda-navy px-5 text-sm font-semibold text-white"
          >
            {plan.status === "PAID" ? "Ver comprobante" : "Continuar pago"}
          </Link>
        ) : (
          <Button
            onClick={onCheckout}
            loading={checkingOut}
            disabled={!validation?.valid || saving || blocked}
          >
            Crear orden y pagar
          </Button>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-fdnda-navy">{value}</p>
    </Card>
  )
}
