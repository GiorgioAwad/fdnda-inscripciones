import { CalendarDays, MapPin, Users } from "lucide-react"
import { disciplineStyle } from "@/lib/disciplines"
import { entryChargeNoteLabel } from "@/lib/entry-charge-note"
import type { OrderSummaryView as OrderSummary } from "@/lib/order-summary"
import { formatDateOnly, formatMoney, SEX_RULE_LABELS } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

// Comprobante detallado de una orden de inscripción. Es un componente de
// servidor sin JS de cliente para que imprima igual que se ve.

export function OrderSummaryView({
  summary,
  total,
}: {
  summary: OrderSummary
  total: unknown
}) {
  return (
    <div className="space-y-4">
      {summary.event ? (
        <Card className="overflow-hidden">
          <div className="border-b border-fdnda-border bg-fdnda-sky-soft px-5 py-4">
            <h2 className="font-heading text-lg font-bold text-fdnda-navy">
              {summary.event.name}
            </h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-fdnda-muted">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {formatDateOnly(summary.event.startDate)} –{" "}
                {formatDateOnly(summary.event.endDate)}
              </span>
              {summary.event.venue || summary.event.city ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {[summary.event.venue, summary.event.city]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              ) : null}
              {summary.event.seasonName ? (
                <span>{summary.event.seasonName}</span>
              ) : null}
            </div>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-fdnda-border sm:grid-cols-4">
            <Metric label="Deportistas" value={summary.totals.athleteCount} />
            <Metric label="Formaciones" value={summary.totals.entryCount} />
            <Metric label="Cuotas" value={summary.totals.athleteFeeCount} />
            <Metric label="Total" value={formatMoney(total)} />
          </dl>
        </Card>
      ) : null}

      {summary.disciplines.map((discipline) => {
        const style = disciplineStyle(discipline.discipline)
        const Icon = style.icon
        return (
          <Card key={discipline.discipline} className="overflow-hidden break-inside-avoid">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fdnda-border bg-fdnda-surface px-5 py-3">
              <h3 className="inline-flex items-center gap-2 font-heading font-bold text-fdnda-navy">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-control text-white ${style.chip}`}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                {discipline.label}
              </h3>
              <p className="text-sm">
                <span className="text-fdnda-muted">
                  {discipline.athleteCount} deportista(s) ·{" "}
                  {discipline.entryCount} prueba(s) ·{" "}
                </span>
                <strong className="text-fdnda-navy">
                  {formatMoney(discipline.subtotal)}
                </strong>
              </p>
            </div>

            {discipline.athleteFees.length > 0 ? (
              <div className="border-b border-fdnda-border px-5 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                  Cuota por deportista (cubre todo el evento)
                </p>
                <ul className="mt-2 space-y-1.5">
                  {discipline.athleteFees.map((fee) => (
                    <li
                      key={fee.itemId}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    >
                      <span className="text-fdnda-ink">
                        {fee.athleteName}
                        <span className="ml-2 text-xs text-fdnda-muted">
                          {fee.docType} {fee.docNumber} · {fee.birthYear}
                        </span>
                      </span>
                      <strong className="text-fdnda-ink">
                        {formatMoney(fee.amount)}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Un bloque por formación: el deportista (o el dueto/equipo) una
                sola vez, con todas las pruebas que compra debajo. */}
            <ul className="divide-y divide-fdnda-border">
              {discipline.rosters.map((roster) => (
                <li key={roster.key} className="px-5 py-3.5 break-inside-avoid">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <ul className="min-w-0 space-y-0.5">
                      {roster.athletes.map((athlete) => (
                        <li
                          key={athlete.id}
                          className="flex flex-wrap items-center gap-2 text-sm text-fdnda-muted"
                        >
                          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="font-semibold text-fdnda-ink">
                            {athlete.name}
                          </span>
                          <span className="text-xs">
                            {athlete.docType} {athlete.docNumber} · {athlete.birthYear}{" "}
                            · {athlete.sex === "F" ? "Damas" : "Varones"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <strong className="text-sm text-fdnda-ink">
                      {formatMoney(roster.subtotal)}
                    </strong>
                  </div>
                  <ul className="mt-2 space-y-1 border-l-2 border-fdnda-border pl-3">
                    {roster.entries.map((entry) => (
                      <li
                        key={entry.itemId}
                        className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-semibold text-fdnda-ink">
                            {entry.modalityName}
                          </span>
                          {entry.category ? (
                            <span className="text-fdnda-muted"> · {entry.category}</span>
                          ) : null}
                          <span className="ml-2 text-xs text-fdnda-muted">
                            {SEX_RULE_LABELS[entry.sexRule] ?? entry.sexRule}
                          </span>
                          {entry.athletes
                            .filter(
                              (athlete) => athlete.isReserve || athlete.competesUp
                            )
                            .map((athlete) => (
                              <span
                                key={athlete.id}
                                className="ml-2 inline-flex items-center gap-1.5"
                              >
                                {/* En duetos y equipos hay que decir de quién es
                                    el aviso; en las pruebas individuales sobra. */}
                                {roster.athletes.length > 1 ? (
                                  <span className="text-xs text-fdnda-muted">
                                    {athlete.name}
                                  </span>
                                ) : null}
                                {athlete.isReserve ? (
                                  <Badge variant="accent">Reserva</Badge>
                                ) : null}
                                {athlete.competesUp ? (
                                  <Badge variant="warning">Sube de categoría</Badge>
                                ) : null}
                              </span>
                            ))}
                          {entry.note !== "CHARGED" ? (
                            <span className="block text-xs italic text-fdnda-muted">
                              {entryChargeNoteLabel(entry.note)}
                            </span>
                          ) : null}
                        </span>
                        <span className="num text-fdnda-muted">
                          {formatMoney(entry.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
        )
      })}

      {summary.legacyItems.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="border-b border-fdnda-border bg-fdnda-surface px-5 py-3">
            <h3 className="font-heading font-bold text-fdnda-navy">Otros conceptos</h3>
          </div>
          <ul className="divide-y divide-fdnda-border">
            {summary.legacyItems.map((item) => (
              <li
                key={item.itemId}
                className="flex items-start justify-between gap-3 px-5 py-3.5 text-sm"
              >
                <span className="min-w-0 flex-1 text-fdnda-muted">
                  {item.description}
                </span>
                <strong className="shrink-0 text-fdnda-ink">
                  {formatMoney(item.amount)}
                </strong>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex items-center justify-between rounded-surface border-2 border-fdnda-navy bg-white px-5 py-4">
        <span className="text-sm font-bold uppercase tracking-wide text-fdnda-muted">
          Total
        </span>
        <span className="text-2xl font-extrabold tracking-tight text-fdnda-navy">
          {formatMoney(total)}
        </span>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-extrabold text-fdnda-navy">{value}</dd>
    </div>
  )
}
