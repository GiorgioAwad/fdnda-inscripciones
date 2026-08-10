import { ArrowUpCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { disciplineStyle } from "@/lib/disciplines"
import {
  upgradeLabel,
  yearRangeLabel,
  type PlanModality,
} from "@/lib/entry-plan"
import { formatMoney, SEX_RULE_LABELS } from "@/lib/utils"

// Catálogo de pruebas del evento: consulta, no inscripción. Los clubes inscriben
// desde el armador (deportista → pruebas); esta tabla existe para revisar el
// programa completo y para las cuentas de administrador, que no inscriben.
export function ModalityCatalog({ modalities }: { modalities: PlanModality[] }) {
  const byDiscipline = new Map<string, PlanModality[]>()
  for (const modality of modalities) {
    const list = byDiscipline.get(modality.discipline) ?? []
    list.push(modality)
    byDiscipline.set(modality.discipline, list)
  }

  return (
    <div className="space-y-8">
      {[...byDiscipline.entries()].map(([discipline, items]) => {
        const style = disciplineStyle(discipline)
        const Icon = style.icon
        return (
          <section key={discipline}>
            <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-fdnda-border pb-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-control text-white ${style.chip}`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-extrabold tracking-tight text-fdnda-navy">
                  {style.label}
                </h3>
                <p className="text-sm text-fdnda-muted">{items.length} pruebas</p>
              </div>
            </div>
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Prueba</TH>
                    <TH>Categoría</TH>
                    <TH>Sexo</TH>
                    <TH>Elegibilidad</TH>
                    <TH>Integrantes</TH>
                    <TH className="text-right">Precio</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((modality) => (
                    <TR key={modality.id}>
                      <TD className="font-bold text-fdnda-ink">{modality.name}</TD>
                      <TD>{modality.category || "—"}</TD>
                      <TD>{SEX_RULE_LABELS[modality.sexRule]}</TD>
                      <TD className="text-xs leading-5">
                        {yearRangeLabel(modality.birthYearFrom, modality.birthYearTo)}
                        {upgradeLabel(modality) ? (
                          <span className="mt-1 flex items-center gap-1 text-fdnda-turquoise-deep">
                            <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            {upgradeLabel(modality)}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        {modality.minAthletes === modality.maxAthletes
                          ? modality.minAthletes
                          : `${modality.minAthletes}–${modality.maxAthletes}`}
                      </TD>
                      <TD className={`text-right font-extrabold ${style.accent}`}>
                        {formatMoney(modality.price)}
                        {modality.capacity !== null ? (
                          <span className="mt-1 block">
                            <Badge variant="neutral">Cupo {modality.capacity}</Badge>
                          </span>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          </section>
        )
      })}
    </div>
  )
}
