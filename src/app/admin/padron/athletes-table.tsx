"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
import {
  Table,
  TableCard,
  TableCards,
  TableContainer,
  TableField,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table"
import {
  DISCIPLINES,
  DISCIPLINE_VALUES,
  type DisciplineValue,
} from "@/lib/disciplines"
import { birthYearOf, SEX_LABELS } from "@/lib/utils"
import { saveAthlete, toggleAthleteActive } from "./actions"

export interface AthleteRow {
  id: string
  firstNames: string
  lastNames: string
  docType: string
  docNumber: string
  birthDateISO: string
  sex: "M" | "F"
  clubId: string
  clubName: string
  isActive: boolean
  categoryLabel: string
  disciplines: DisciplineValue[]
  // Estado de la afiliación en cada disciplina que practica.
  affiliationStates: Array<{ discipline: DisciplineValue; state: string }>
}

export function AthletesTable({
  athletes,
  clubs,
}: {
  athletes: AthleteRow[]
  clubs: Array<{ id: string; name: string; code: string }>
}) {
  const [editing, setEditing] = useState<AthleteRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSave = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveAthlete(formData)
      if (result.success) {
        toast.success("Deportista actualizado")
        setEditing(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      {/* Nueve columnas no caben en un teléfono: en móvil la misma fila se
          presenta apilada, con las acciones al alcance en vez de en la última
          columna a la derecha. */}
      <TableCards>
        {athletes.length === 0 ? (
          <li className="rounded-surface border border-fdnda-border bg-white p-6 text-center text-sm text-fdnda-muted">
            No se encontraron deportistas. Importa el padrón con Excel.
          </li>
        ) : (
          athletes.map((athlete) => (
            <TableCard
              key={athlete.id}
              lanes={athlete.affiliationStates.map((entry) => entry.discipline)}
              title={`${athlete.lastNames}, ${athlete.firstNames}`}
              subtitle={
                <>
                  {athlete.docType} <span className="num">{athlete.docNumber}</span>
                </>
              }
              badges={
                <Badge variant={athlete.isActive ? "success" : "danger"}>
                  {athlete.isActive ? "Activo" : "Inactivo"}
                </Badge>
              }
              actions={
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(athlete)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        const r = await toggleAthleteActive(athlete.id)
                        if (!r.success) toast.error(r.error)
                      })
                    }
                  >
                    {athlete.isActive ? "Desactivar" : "Activar"}
                  </Button>
                </>
              }
            >
              <TableField
                label="Nacimiento"
                value={
                  <span className="num">
                    {athlete.birthDateISO.split("-").reverse().join("/")}
                  </span>
                }
              />
              <TableField label="Sexo" value={SEX_LABELS[athlete.sex]} />
              <TableField label="Categoría" value={athlete.categoryLabel} />
              <TableField label="Club" value={athlete.clubName} />
              <TableField
                wide
                label="Afiliación"
                value={
                  athlete.affiliationStates.length === 0 ? (
                    "Sin disciplinas"
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {athlete.affiliationStates.map((entry) => {
                        const badge =
                          AFFILIATION_STATE_BADGE[entry.state] ??
                          AFFILIATION_STATE_BADGE.SIN_AFILIAR
                        return (
                          <Badge key={entry.discipline} variant={badge.variant}>
                            {DISCIPLINES[entry.discipline].short} · {badge.label}
                          </Badge>
                        )
                      })}
                    </span>
                  )
                }
              />
            </TableCard>
          ))
        )}
      </TableCards>

      <TableContainer className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>Deportista</TH>
              <TH>Documento</TH>
              <TH>Nacimiento</TH>
              <TH>Sexo</TH>
              <TH>Categoría</TH>
              <TH>Club</TH>
              <TH>Afiliación</TH>
              <TH>Estado</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {athletes.length === 0 ? (
              <TR>
                <TD colSpan={9} className="py-10 text-center text-fdnda-muted">
                  No se encontraron deportistas. Importa el padrón con Excel.
                </TD>
              </TR>
            ) : (
              athletes.map((athlete) => (
                <TR key={athlete.id}>
                  <TD className="font-medium text-fdnda-ink">
                    {athlete.lastNames}, {athlete.firstNames}
                  </TD>
                  <TD>
                    <span className="text-xs text-fdnda-muted">{athlete.docType}</span>{" "}
                    <span className="font-mono">{athlete.docNumber}</span>
                  </TD>
                  <TD>
                    {athlete.birthDateISO.split("-").reverse().join("/")}{" "}
                    <span className="text-xs text-fdnda-muted">
                      ({birthYearOf(athlete.birthDateISO)})
                    </span>
                  </TD>
                  <TD>{SEX_LABELS[athlete.sex]}</TD>
                  <TD className="text-xs">{athlete.categoryLabel}</TD>
                  <TD>{athlete.clubName}</TD>
                  <TD>
                    {athlete.affiliationStates.length === 0 ? (
                      <span className="text-xs text-fdnda-muted">
                        Sin disciplinas
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {athlete.affiliationStates.map((entry) => {
                          const badge =
                            AFFILIATION_STATE_BADGE[entry.state] ??
                            AFFILIATION_STATE_BADGE.SIN_AFILIAR
                          return (
                            <Badge key={entry.discipline} variant={badge.variant}>
                              {DISCIPLINES[entry.discipline].short} · {badge.label}
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <Badge variant={athlete.isActive ? "success" : "danger"}>
                      {athlete.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Editar a ${athlete.lastNames}, ${athlete.firstNames}`}
                        onClick={() => setEditing(athlete)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          startTransition(async () => {
                            const r = await toggleAthleteActive(athlete.id)
                            if (!r.success) toast.error(r.error)
                          })
                        }
                      >
                        {athlete.isActive ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableContainer>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar deportista"
      >
        {/* key por deportista: remonta el form para que los defaultValue y los
            checkboxes de disciplina reflejen a quien se está editando. */}
        <form key={editing?.id} action={handleSave} className="space-y-4">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ath-firstNames">Nombres</Label>
              <Input
                id="ath-firstNames"
                name="firstNames"
                required
                defaultValue={editing?.firstNames}
              />
            </div>
            <div>
              <Label htmlFor="ath-lastNames">Apellidos</Label>
              <Input
                id="ath-lastNames"
                name="lastNames"
                required
                defaultValue={editing?.lastNames}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ath-docType">Tipo doc.</Label>
              <Select id="ath-docType" name="docType" defaultValue={editing?.docType}>
                <option value="DNI">DNI</option>
                <option value="CE">CE</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="OTROS">Otros</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="ath-docNumber">Nro. documento</Label>
              <Input
                id="ath-docNumber"
                name="docNumber"
                required
                defaultValue={editing?.docNumber}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ath-birthDate">Fecha de nacimiento</Label>
              <Input
                id="ath-birthDate"
                name="birthDate"
                type="date"
                required
                defaultValue={editing?.birthDateISO}
              />
            </div>
            <div>
              <Label htmlFor="ath-sex">Sexo</Label>
              <Select id="ath-sex" name="sex" defaultValue={editing?.sex}>
                <option value="F">Femenino</option>
                <option value="M">Masculino</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="ath-clubId">Club</Label>
            <Select id="ath-clubId" name="clubId" defaultValue={editing?.clubId}>
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </Select>
          </div>
          <fieldset>
            <legend className="mb-1.5 block text-sm font-semibold text-fdnda-ink">
              Disciplinas
            </legend>
            <div className="flex flex-wrap gap-2">
              {DISCIPLINE_VALUES.map((value) => (
                <label
                  key={value}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-fdnda-border px-3 text-sm font-semibold text-fdnda-ink transition-colors hover:bg-fdnda-sky-soft has-checked:border-fdnda-navy has-checked:bg-fdnda-navy-soft"
                >
                  <input
                    type="checkbox"
                    name="disciplines"
                    value={value}
                    className="h-4 w-4 accent-fdnda-navy"
                    defaultChecked={editing?.disciplines.includes(value) ?? false}
                  />
                  {DISCIPLINES[value].label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-fdnda-muted">
              Quitar una disciplina no borra las afiliaciones ya emitidas de ese año.
            </p>
          </fieldset>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
