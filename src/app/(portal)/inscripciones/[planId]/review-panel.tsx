"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Loader2, Printer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { disciplineLabel } from "@/lib/disciplines"
import type { PlanValidationIssue } from "@/lib/plan-validation"
import { formatMoney, plural } from "@/lib/utils"
import type { LockedEntryView, PlanView, SerializableValidation } from "../types"

// Revisión y pago de un borrador. Cada incidencia trae su acción para
// resolverla (`issue.action` de plan-validation): el club no tiene que adivinar
// dónde se corrige un error.

function pruebas(count: number) {
  return plural(count, "prueba inscrita", "pruebas inscritas")
}

function deportistas(count: number) {
  return plural(count, "deportista", "deportistas")
}

export function ReviewPanel({
  validation,
  lockedEntries,
  checkingOut,
  blocked,
  saving,
  athleteNameById,
  onPrint,
  onCheckout,
  onFix,
  onRemoveAthlete,
  onReload,
}: {
  validation: SerializableValidation | null
  lockedEntries: LockedEntryView[]
  checkingOut: boolean
  blocked: boolean
  saving: boolean
  /** Nombre «Apellidos, Nombres» de un deportista de la planilla, si está. */
  athleteNameById: (athleteId: string) => string | null
  onPrint: () => void
  onCheckout: () => void
  /** Vuelve a «Deportistas y pruebas», con ese deportista desplegado si se da. */
  onFix: (athleteId?: string) => void
  onRemoveAthlete: (athleteId: string) => void
  onReload: () => void
}) {
  const issues = validation
    ? [...validation.issues].sort(
        (a, b) => Number(a.severity !== "ERROR") - Number(b.severity !== "ERROR")
      )
    : []
  const errorCount = issues.filter((issue) => issue.severity === "ERROR").length

  return (
    <section className="space-y-4" aria-labelledby="review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="review-heading" className="font-heading text-xl font-bold text-fdnda-navy">
            Revisión y pago
          </h2>
          <p className="mt-1 text-sm text-fdnda-muted">
            Comprobamos afiliaciones, edades, cupos, duplicados y precios vigentes
            antes de crear la orden.
          </p>
        </div>
        <Button variant="outline" onClick={onPrint} disabled={saving || blocked}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir resumen
        </Button>
      </div>

      {!validation ? (
        <Card className="flex items-center gap-3 p-5 text-sm text-fdnda-muted" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Revisando tu
          planilla…
        </Card>
      ) : (
        <>
          <p className="text-sm text-fdnda-ink">
            {deportistas(validation.summary.rosterAthleteCount)} ·{" "}
            {validation.summary.registeredAthleteCount} con pruebas ·{" "}
            {pruebas(validation.summary.entryCount)}
          </p>

          {validation.summary.byDiscipline.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="border-b border-fdnda-border bg-fdnda-surface px-5 py-3">
                <h3 className="font-heading font-bold text-fdnda-navy">
                  Desglose por disciplina
                </h3>
              </div>
              <ul className="divide-y divide-fdnda-border">
                {validation.summary.byDiscipline.map((row) => {
                  // Lo que realmente se cobra ya lo resolvió el motor de
                  // precios (computePlanPricing) disciplina por disciplina:
                  // se lee de chargedEntry/chargedAthleteFee en vez de volver
                  // a cruzar la config del evento con la elección del club,
                  // porque esa elección solo aplica donde la disciplina ofrece
                  // elegir.
                  const cobraFormacion = row.chargedEntry
                  const cobraCuota = row.chargedAthleteFee
                  const detail =
                    cobraFormacion && cobraCuota
                      ? `${pruebas(row.entryCount)} · ${deportistas(row.athleteCount)} con cuota de competencia`
                      : cobraCuota
                        ? `${deportistas(row.athleteCount)} con cuota de competencia · ${pruebas(row.entryCount)} sin cobro aparte`
                        : cobraFormacion
                          ? `${pruebas(row.entryCount)} · ${deportistas(row.athleteCount)}`
                          : `${pruebas(row.entryCount)} · ${deportistas(row.athleteCount)} · sin cobro en esta disciplina`
                  return (
                    <li
                      key={row.discipline}
                      className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm"
                    >
                      <span className="font-semibold text-fdnda-ink">
                        {disciplineLabel(row.discipline)}
                        <span className="ml-2 text-xs font-normal text-fdnda-muted">
                          {detail}
                        </span>
                      </span>
                      <strong className="text-fdnda-navy">{formatMoney(row.subtotal)}</strong>
                    </li>
                  )
                })}
              </ul>
              {validation.summary.coveredAthleteFees > 0 ? (
                <p className="border-t border-fdnda-border bg-fdnda-success-soft px-5 py-2.5 text-xs font-semibold text-fdnda-success">
                  {validation.summary.coveredAthleteFees === 1
                    ? "1 cuota de competencia ya pagada en otra orden de esta competencia: no se vuelve a cobrar."
                    : `${validation.summary.coveredAthleteFees} cuotas de competencia ya pagadas en otra orden de esta competencia: no se vuelven a cobrar.`}
                </p>
              ) : null}
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div
              className={`flex items-center gap-2 px-5 py-4 font-bold ${
                issues.length > 0 ? "border-b" : ""
              } ${
                validation.valid
                  ? "border-fdnda-success-ring bg-fdnda-success-soft text-fdnda-success"
                  : "border-fdnda-danger-ring bg-fdnda-danger-soft text-fdnda-danger"
              }`}
            >
              {validation.valid ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              )}
              {validation.valid
                ? "Planilla lista para pagar"
                : `Corrige ${plural(errorCount, "error", "errores")} antes de pagar`}
            </div>
            {issues.length > 0 ? (
              <ul className="divide-y divide-fdnda-border">
                {issues.map((issue, index) => (
                  <li
                    key={`${issue.code}-${index}`}
                    className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm"
                  >
                    <Badge variant={issue.severity === "ERROR" ? "danger" : "warning"}>
                      {issue.severity === "ERROR" ? "Impide pagar" : "Aviso"}
                    </Badge>
                    <span className="min-w-0 flex-1">{issue.message}</span>
                    <IssueAction
                      issue={issue}
                      athleteNameById={athleteNameById}
                      onFix={onFix}
                      onRemoveAthlete={onRemoveAthlete}
                      onReload={onReload}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <PreviousEntriesCard lockedEntries={lockedEntries} />
        </>
      )}

      <div className="sticky bottom-4 flex flex-col gap-3 rounded-surface border-2 border-fdnda-navy bg-white p-4 shadow-overlay sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {validation ? (
            <>
              <p className="font-bold text-fdnda-navy">
                Total a pagar: {formatMoney(validation.summary.totalAmount)}
              </p>
              <p className="text-xs text-fdnda-muted">
                {validation.valid
                  ? "Al crear la orden, la planilla queda bloqueada hasta que pagues o la orden venza."
                  : `Corrige ${plural(errorCount, "error", "errores")} para poder pagar.`}
              </p>
            </>
          ) : (
            <p className="text-fdnda-muted">Calculando el total…</p>
          )}
        </div>
        <Button
          onClick={onCheckout}
          loading={checkingOut}
          disabled={!validation?.valid || saving || blocked}
        >
          Crear orden y pagar
        </Button>
      </div>
    </section>
  )
}

// Botón o enlace que resuelve cada incidencia. Los avisos puramente
// informativos (cuota ya pagada, ascenso de categoría) no llevan acción, y
// CONTACT_FEDERATION tampoco: el mensaje ya dice que hay que avisar a la FDNDA.
function IssueAction({
  issue,
  athleteNameById,
  onFix,
  onRemoveAthlete,
  onReload,
}: {
  issue: PlanValidationIssue
  athleteNameById: (athleteId: string) => string | null
  onFix: (athleteId?: string) => void
  onRemoveAthlete: (athleteId: string) => void
  onReload: () => void
}) {
  if (issue.code === "ATHLETE_FEE_ALREADY_PAID" || issue.code === "CATEGORY_UPGRADE_USED") {
    return null
  }
  const name = issue.athleteId ? athleteNameById(issue.athleteId) : null
  const small = buttonClasses({ variant: "outline", size: "sm" })

  switch (issue.action) {
    case "AFFILIATE":
      return issue.athleteId ? (
        <Link href="/afiliacion?tab=deportistas" className={small}>
          {name ? `Afiliar a ${name}` : "Afiliar deportistas"}
        </Link>
      ) : (
        <Link href="/afiliacion" className={small}>
          Afiliar a mi club
        </Link>
      )
    case "SELECT_ATHLETES":
      return issue.athleteId && name ? (
        <Button size="sm" variant="outline" onClick={() => onRemoveAthlete(issue.athleteId!)}>
          Quitar a {name} de la planilla
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => onFix()}>
          Agregar deportistas
        </Button>
      )
    case "EDIT_ENTRY":
    case "REMOVE_ENTRY":
    case "SELECT_ANOTHER_MODALITY":
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onFix(name ? issue.athleteId : undefined)}
        >
          {issue.code === "ATHLETE_WITHOUT_ENTRY" && name
            ? `Marcar pruebas de ${name}`
            : name
              ? `Corregir pruebas de ${name}`
              : "Corregir en la planilla"}
        </Button>
      )
    case "RELOAD":
      return (
        <Button size="sm" variant="outline" onClick={onReload}>
          Recargar planilla
        </Button>
      )
    case "SELECT_EVENT":
      return (
        <Link href="/inscripciones" className={small}>
          Volver a Inscripciones
        </Link>
      )
    default:
      return null
  }
}

function PreviousEntriesCard({ lockedEntries }: { lockedEntries: LockedEntryView[] }) {
  if (lockedEntries.length === 0) return null
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-fdnda-border bg-fdnda-surface px-5 py-4">
        <h3 className="font-heading font-bold text-fdnda-navy">
          Inscripciones previas de esta competencia
        </h3>
        <p className="mt-1 text-xs text-fdnda-muted">
          Pruebas de tu club que ya están en una orden pendiente o pagada.
        </p>
      </div>
      <ul className="divide-y divide-fdnda-border">
        {lockedEntries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <Badge variant={entry.status === "PAID" ? "success" : "warning"}>
              {entry.status === "PAID" ? "Pagada" : "Pago pendiente"}
            </Badge>
            <span className="min-w-0 flex-1 font-semibold text-fdnda-ink">
              {disciplineLabel(entry.discipline)} · {entry.modalityName}
              {entry.category ? ` · ${entry.category}` : ""}
            </span>
            <span className="text-xs text-fdnda-muted">
              {deportistas(entry.athleteIds.length)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// Una planilla con orden no se vuelve a validar: su orden ya fijó pruebas e
// importes. Acá solo se dice en qué está y cuál es el siguiente paso.
export function OrderPanel({
  plan,
  lockedEntries,
  onPrint,
}: {
  plan: PlanView
  lockedEntries: LockedEntryView[]
  onPrint: () => void
}) {
  const order = plan.activeOrder
  const title =
    plan.status === "PAID"
      ? "Planilla pagada"
      : plan.status === "AWAITING_PAYMENT"
        ? "Orden pendiente de pago"
        : "Planilla reemplazada"
  return (
    <section className="space-y-4" aria-labelledby="review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="review-heading" className="font-heading text-xl font-bold text-fdnda-navy">
            {title}
          </h2>
          <p className="mt-1 text-sm text-fdnda-muted">
            {order
              ? `Orden ${order.code} · Total ${formatMoney(order.totalAmount)}`
              : "Esta planilla no tiene una orden activa."}
          </p>
        </div>
        {plan.status !== "ABANDONED" ? (
          <Button variant="outline" onClick={onPrint}>
            <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir resumen
          </Button>
        ) : null}
      </div>
      <Card className="flex flex-col gap-3 p-5 text-sm text-fdnda-ink sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl">
          {plan.status === "PAID"
            ? "Las pruebas y los importes quedaron fijados al pagar. La constancia tiene el detalle."
            : plan.status === "AWAITING_PAYMENT"
              ? "Las pruebas y los importes quedaron fijados al crear la orden. Si la orden vence sin pagarse, la planilla vuelve a borrador."
              : "Esta planilla fue reemplazada por otra de la misma competencia y ya no se usa."}
        </p>
        {order ? (
          <Link href={`/pago/${order.id}`} className={buttonClasses({ className: "shrink-0" })}>
            {order.status === "PAID" ? "Ver constancia" : "Pagar orden"}
          </Link>
        ) : (
          <Link
            href="/inscripciones"
            className={buttonClasses({ variant: "outline", className: "shrink-0" })}
          >
            Volver a Inscripciones
          </Link>
        )}
      </Card>
      <PreviousEntriesCard lockedEntries={lockedEntries} />
    </section>
  )
}
