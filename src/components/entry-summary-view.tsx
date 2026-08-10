import { AlertTriangle, ArrowUpCircle, CheckCircle2, XCircle } from "lucide-react"
import { Badge, REGISTRATION_STATUS_BADGE } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { disciplineStyle } from "@/lib/disciplines"
import {
  athleteName,
  isTeamModality,
  modalityLabel,
  modalityRules,
  upgradeLabel,
  type EntrySummary,
} from "@/lib/entry-plan"
import { formatMoney, SEX_LABELS } from "@/lib/utils"

// Hoja de resumen y validación de las entries de un club en un evento. Es el
// paso previo a pagar: el club revisa deportista por deportista y prueba por
// prueba antes de que la inscripción se convierta en una orden. La usan el
// armador de inscripciones (en vivo) y la hoja imprimible, con los mismos datos.

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-surface border border-fdnda-border bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-fdnda-muted">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-fdnda-navy">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-fdnda-muted">{hint}</p> : null}
    </div>
  )
}

export function EntrySummaryView({
  summary,
  showStatus = true,
}: {
  summary: EntrySummary
  // En el armador todo lo editable está "en carrito"; en la hoja imprimible
  // conviven inscripciones pagadas, por pagar y en carrito.
  showStatus?: boolean
}) {
  const { errors, warnings } = summary

  if (summary.entryCount === 0) {
    return (
      <p className="rounded-surface border border-dashed border-fdnda-border-control bg-fdnda-surface px-4 py-8 text-center text-sm text-fdnda-muted">
        Todavía no hay ninguna inscripción en este evento.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Deportistas" value={String(summary.athleteCount)} />
        <Tile
          label="Inscripciones"
          value={String(summary.entryCount)}
          hint={
            summary.editableCount !== summary.entryCount
              ? `${summary.editableCount} editable(s)`
              : undefined
          }
        />
        <Tile
          label="Total"
          value={formatMoney(summary.total)}
          hint={
            summary.payable !== summary.total
              ? `${formatMoney(summary.payable)} por pagar`
              : undefined
          }
        />
      </div>

      {errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-surface border border-fdnda-red/25 bg-fdnda-red-soft px-4 py-3"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-fdnda-red-deep">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {errors.length} problema(s) que impiden enviar la planilla
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-fdnda-red-deep">
            {errors.map((issue, i) => (
              <li key={i}>• {issue.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-surface border border-fdnda-turquoise/25 bg-fdnda-turquoise-soft px-4 py-3 text-sm font-semibold text-fdnda-navy">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-fdnda-turquoise-deep"
            aria-hidden="true"
          />
          <span>
            Todas las inscripciones cumplen las reglas de sus pruebas (edad, sexo,
            número de integrantes y afiliación vigente).
          </span>
        </div>
      )}

      {warnings.length > 0 ? (
        <div className="rounded-surface border border-fdnda-warning-ring/70 bg-fdnda-warning-soft px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-fdnda-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {warnings.length} aviso(s) para revisar
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-fdnda-warning">
            {warnings.map((issue, i) => (
              <li key={i}>• {issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section>
        <h3 className="mb-2 font-heading text-base font-bold text-fdnda-navy">
          Por deportista
        </h3>
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Deportista</TH>
                <TH>Documento</TH>
                <TH>Año / Sexo</TH>
                <TH>Categoría</TH>
                <TH>Pruebas</TH>
                <TH className="text-right">N.º</TH>
              </TR>
            </THead>
            <TBody>
              {summary.byAthlete.map(({ athlete, entries }) => (
                <TR key={athlete.id}>
                  <TD className="font-bold text-fdnda-ink">{athleteName(athlete)}</TD>
                  <TD className="whitespace-nowrap text-xs">
                    {athlete.docType} {athlete.docNumber}
                  </TD>
                  <TD className="whitespace-nowrap text-xs">
                    {athlete.birthYear} · {SEX_LABELS[athlete.sex]}
                  </TD>
                  <TD className="text-xs">
                    {Object.entries(athlete.categoryByDiscipline)
                      .map(([discipline, name]) => `${disciplineStyle(discipline).short}: ${name}`)
                      .join(" · ") || "—"}
                  </TD>
                  <TD>
                    <ul className="space-y-1">
                      {entries.map((ref) => (
                        <li
                          key={`${ref.entryKey}:${ref.modality.id}`}
                          className="flex flex-wrap items-center gap-1.5 text-xs"
                        >
                          <span className="font-semibold text-fdnda-ink">
                            {modalityLabel(ref.modality)}
                          </span>
                          {ref.isReserve ? <Badge variant="neutral">Reserva</Badge> : null}
                          {ref.upgraded ? (
                            <Badge variant="warning">
                              <ArrowUpCircle
                                className="mr-1 h-3 w-3"
                                aria-hidden="true"
                              />
                              Sube de categoría
                            </Badge>
                          ) : null}
                          {showStatus && ref.status !== "IN_CART" ? (
                            <Badge variant={REGISTRATION_STATUS_BADGE[ref.status].variant}>
                              {REGISTRATION_STATUS_BADGE[ref.status].label}
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </TD>
                  <TD className="text-right font-bold tabular-nums">{entries.length}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </section>

      <section>
        <h3 className="mb-2 font-heading text-base font-bold text-fdnda-navy">
          Por prueba
        </h3>
        <div className="space-y-5">
          {summary.byDiscipline.map((group) => {
            const style = disciplineStyle(group.discipline)
            const Icon = style.icon
            return (
              <div key={group.discipline}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-control text-white ${style.chip}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h4 className="font-bold text-fdnda-navy">{group.label}</h4>
                  <span className="text-xs text-fdnda-muted">
                    {group.entryCount} inscripción(es) · {formatMoney(group.subtotal)}
                  </span>
                </div>
                <TableContainer>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Prueba</TH>
                        <TH>Reglas</TH>
                        <TH>Integrantes</TH>
                        <TH className="text-right">Precio</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {group.modalities.map(({ modality, entries }) =>
                        entries.map((row, index) => (
                          <TR key={row.entry.key}>
                            <TD className="align-top font-bold text-fdnda-ink">
                              {modalityLabel(modality)}
                              {isTeamModality(modality) && entries.length > 1 ? (
                                <span className="ml-1 text-xs font-medium text-fdnda-muted">
                                  #{index + 1}
                                </span>
                              ) : null}
                              {showStatus && row.entry.status !== "IN_CART" ? (
                                <span className="ml-2">
                                  <Badge
                                    variant={
                                      REGISTRATION_STATUS_BADGE[row.entry.status].variant
                                    }
                                  >
                                    {REGISTRATION_STATUS_BADGE[row.entry.status].label}
                                  </Badge>
                                </span>
                              ) : null}
                            </TD>
                            <TD className="align-top text-xs leading-5">
                              {modalityRules(modality)}
                              {upgradeLabel(modality) ? (
                                <span className="mt-1 block text-fdnda-turquoise-deep">
                                  {upgradeLabel(modality)}
                                </span>
                              ) : null}
                            </TD>
                            <TD className="align-top">
                              <ul className="space-y-1 text-xs">
                                {row.athletes.map((athlete) => (
                                  <li
                                    key={athlete.id}
                                    className="flex flex-wrap items-center gap-1.5"
                                  >
                                    <span className="font-semibold text-fdnda-ink">
                                      {athleteName(athlete)}
                                    </span>
                                    <span className="text-fdnda-muted">
                                      {athlete.birthYear}
                                    </span>
                                    {row.reserves.some((r) => r.id === athlete.id) ? (
                                      <Badge variant="neutral">Reserva</Badge>
                                    ) : null}
                                    {row.upgraded.some((u) => u.id === athlete.id) ? (
                                      <Badge variant="warning">
                                        <ArrowUpCircle
                                          className="mr-1 h-3 w-3"
                                          aria-hidden="true"
                                        />
                                        Sube
                                      </Badge>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                              {row.issues.length > 0 ? (
                                <ul className="mt-1.5 space-y-0.5 text-xs font-semibold text-fdnda-red-deep">
                                  {row.issues.map((issue, i) => (
                                    <li key={i}>• {issue.message}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </TD>
                            <TD className="align-top text-right font-bold tabular-nums">
                              {formatMoney(modality.price)}
                            </TD>
                          </TR>
                        ))
                      )}
                    </TBody>
                  </Table>
                </TableContainer>
              </div>
            )
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border-2 border-fdnda-navy bg-white px-5 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
            Total del evento
          </p>
          <p className="text-2xl font-extrabold tabular-nums tracking-tight text-fdnda-navy">
            {formatMoney(summary.total)}
          </p>
        </div>
        {summary.payable !== summary.total ? (
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
              Pendiente de pago
            </p>
            <p className="text-xl font-extrabold tabular-nums text-fdnda-red-deep">
              {formatMoney(summary.payable)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
