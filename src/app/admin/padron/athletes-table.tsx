"use client"

import { useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Pencil, SearchX, Upload, Users } from "lucide-react"
import { Button, buttonClasses } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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
import { EmptyState } from "@/components/empty-state"
import {
  DISCIPLINES,
  DISCIPLINE_VALUES,
  type DisciplineValue,
} from "@/lib/disciplines"
import { birthYearOf, SEX_LABELS } from "@/lib/utils"
import { saveAthlete, setAthleteActive } from "./actions"

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

const fullName = (athlete: AthleteRow) => `${athlete.lastNames}, ${athlete.firstNames}`

function PadronEmpty({ filter }: { filter: { q: string; clubName: string | null } | null }) {
  if (filter) {
    const where = filter.clubName ? `en ${filter.clubName}` : "en el padrón"
    return (
      <EmptyState
        icon={SearchX}
        title="Ningún deportista coincide con los filtros"
        action={
          <Link href="/admin/padron" className={buttonClasses({ variant: "outline" })}>
            Quitar filtros
          </Link>
        }
      >
        {filter.q
          ? `No hay deportistas con «${filter.q}» ${where}. Revisa cómo está escrito o busca por N.º de documento.`
          : `${filter.clubName ?? "Este club"} aún no tiene deportistas en el padrón.`}
      </EmptyState>
    )
  }
  return (
    <EmptyState
      icon={Users}
      title="El padrón está vacío"
      action={
        <Link href="/admin/padron/importar" className={buttonClasses()}>
          <Upload className="h-4 w-4" aria-hidden="true" /> Importar padrón
        </Link>
      }
    >
      Importa el Excel con la plantilla o espera a que los clubes registren a sus
      deportistas desde el portal.
    </EmptyState>
  )
}

function AffiliationBadges({ athlete }: { athlete: AthleteRow }) {
  if (athlete.affiliationStates.length === 0) {
    return <span className="text-xs text-fdnda-muted">Sin disciplinas</span>
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {athlete.affiliationStates.map((entry) => {
        const badge =
          AFFILIATION_STATE_BADGE[entry.state] ?? AFFILIATION_STATE_BADGE.SIN_AFILIAR
        return (
          <Badge key={entry.discipline} variant={badge.variant}>
            {DISCIPLINES[entry.discipline].short} · {badge.label}
          </Badge>
        )
      })}
    </span>
  )
}

export function AthletesTable({
  athletes,
  clubs,
  filter,
}: {
  athletes: AthleteRow[]
  clubs: Array<{ id: string; name: string; code: string; isActive: boolean }>
  // Filtros activos: cambian el estado vacío de «primer uso» a «sin resultados».
  filter: { q: string; clubName: string | null } | null
}) {
  const [editing, setEditing] = useState<AthleteRow | null>(null)
  const [selectedClubId, setSelectedClubId] = useState("")
  const [removing, setRemoving] = useState<AthleteRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const openEdit = (athlete: AthleteRow) => {
    setSelectedClubId(athlete.clubId)
    setEditing(athlete)
  }

  // onSubmit en vez de <form action>: React 19 reinicia el formulario al
  // terminar la acción y con un error del servidor se perdía lo escrito.
  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const name = `${String(formData.get("lastNames") ?? "").trim()}, ${String(
      formData.get("firstNames") ?? ""
    ).trim()}`
    startTransition(async () => {
      const result = await saveAthlete(formData)
      if (result.success) {
        toast.success(`Datos de ${name} guardados`)
        setEditing(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const applyActive = (athlete: AthleteRow, isActive: boolean) => {
    startTransition(async () => {
      const result = await setAthleteActive(athlete.id, isActive)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setRemoving(null)
      toast.success(
        isActive
          ? `${fullName(athlete)} vuelve al padrón`
          : `${fullName(athlete)} quedó de baja`
      )
    })
  }

  const toggleLabel = (athlete: AthleteRow) =>
    athlete.isActive ? "Dar de baja" : "Reactivar"
  const toggleAria = (athlete: AthleteRow) =>
    athlete.isActive ? `Dar de baja a ${fullName(athlete)}` : `Reactivar a ${fullName(athlete)}`
  const onToggle = (athlete: AthleteRow) =>
    athlete.isActive ? setRemoving(athlete) : applyActive(athlete, true)

  const originalClub = editing ? clubs.find((club) => club.id === editing.clubId) : null
  const nextClub = clubs.find((club) => club.id === selectedClubId) ?? null
  const clubChanges = Boolean(editing && nextClub && nextClub.id !== editing.clubId)

  return (
    <>
      {/* Nueve columnas no caben en un teléfono: en móvil la misma fila se
          presenta apilada, con las acciones al alcance en vez de en la última
          columna a la derecha. */}
      <TableCards>
        {athletes.length === 0 ? (
          <li className="rounded-surface border border-fdnda-border bg-white">
            <PadronEmpty filter={filter} />
          </li>
        ) : (
          athletes.map((athlete) => (
            <TableCard
              key={athlete.id}
              lanes={athlete.affiliationStates.map((entry) => entry.discipline)}
              title={fullName(athlete)}
              subtitle={
                <>
                  {athlete.docType} <span className="num">{athlete.docNumber}</span>
                </>
              }
              badges={
                <Badge variant={athlete.isActive ? "success" : "neutral"}>
                  {athlete.isActive ? "En padrón" : "De baja"}
                </Badge>
              }
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Editar a ${fullName(athlete)}`}
                    onClick={() => openEdit(athlete)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    aria-label={toggleAria(athlete)}
                    onClick={() => onToggle(athlete)}
                  >
                    {toggleLabel(athlete)}
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
              <TableField wide label="Afiliación" value={<AffiliationBadges athlete={athlete} />} />
            </TableCard>
          ))
        )}
      </TableCards>

      <TableContainer className="hidden md:block" aria-label="Padrón de deportistas">
        <Table>
          <THead>
            <TR>
              <TH>Deportista</TH>
              <TH>Documento</TH>
              <TH>Nacimiento y sexo</TH>
              <TH>Categoría</TH>
              <TH>Club</TH>
              <TH>Afiliación</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {athletes.length === 0 ? (
              <TR>
                <TD colSpan={7} className="p-0">
                  <PadronEmpty filter={filter} />
                </TD>
              </TR>
            ) : (
              athletes.map((athlete) => (
                <TR key={athlete.id}>
                  {/* «De baja» va junto al nombre y solo cuando aplica: una
                      columna de estado que decía «En padrón» en cada fila era
                      ruido y empujaba las acciones fuera de la vista. */}
                  <TD className="font-medium text-fdnda-ink">
                    {fullName(athlete)}
                    {!athlete.isActive ? (
                      <Badge variant="neutral" className="ml-2">
                        De baja
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="whitespace-nowrap">
                    <span className="text-xs text-fdnda-muted">{athlete.docType}</span>{" "}
                    <span className="num">{athlete.docNumber}</span>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <p>{athlete.birthDateISO.split("-").reverse().join("/")}</p>
                    <p className="text-xs text-fdnda-muted">
                      {birthYearOf(athlete.birthDateISO)} · {SEX_LABELS[athlete.sex]}
                    </p>
                  </TD>
                  <TD className="text-xs">{athlete.categoryLabel}</TD>
                  <TD>{athlete.clubName}</TD>
                  <TD>
                    <AffiliationBadges athlete={athlete} />
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Editar a ${fullName(athlete)}`}
                        onClick={() => openEdit(athlete)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        aria-label={toggleAria(athlete)}
                        onClick={() => onToggle(athlete)}
                      >
                        {toggleLabel(athlete)}
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
        title={editing ? `Editar a ${fullName(editing)}` : "Editar deportista"}
      >
        {/* key por deportista: remonta el form para que los defaultValue y los
            checkboxes de disciplina reflejen a quien se está editando. */}
        <form key={editing?.id} onSubmit={handleSave} className="space-y-4">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ath-lastNames">Apellidos</Label>
              <Input
                id="ath-lastNames"
                name="lastNames"
                required
                defaultValue={editing?.lastNames}
              />
            </div>
            <div>
              <Label htmlFor="ath-firstNames">Nombres</Label>
              <Input
                id="ath-firstNames"
                name="firstNames"
                required
                defaultValue={editing?.firstNames}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ath-docType">Tipo de documento</Label>
              <Select id="ath-docType" name="docType" defaultValue={editing?.docType}>
                <option value="DNI">DNI</option>
                <option value="CE">CE</option>
                <option value="PASAPORTE">Pasaporte</option>
                <option value="OTROS">Otros</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="ath-docNumber">N.º de documento</Label>
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
            <Select
              id="ath-clubId"
              name="clubId"
              value={selectedClubId}
              onChange={(event) => setSelectedClubId(event.target.value)}
              aria-describedby={clubChanges ? "ath-club-change" : undefined}
            >
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.isActive ? club.name : `${club.name} (desactivado)`}
                </option>
              ))}
            </Select>
            {/* El traspaso con motivo e historial todavía no existe: mientras
                tanto, al menos se dice qué va a pasar antes de guardar. */}
            {clubChanges ? (
              <p
                id="ath-club-change"
                className="mt-1.5 rounded-control border border-fdnda-warning-ring bg-fdnda-warning-soft px-3 py-2 text-xs font-semibold text-fdnda-warning"
              >
                Al guardar pasará de {originalClub?.name ?? editing?.clubName} a{" "}
                {nextClub?.name}, sin registrar un motivo.
              </p>
            ) : null}
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
            <Button type="submit" loading={isPending}>
              Guardar datos del deportista
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`¿Dar de baja a ${removing ? fullName(removing) : ""}?`}
        consequence={
          <>
            <p>
              Deja de aparecer en el padrón de su club en el portal y en los conteos de
              afiliación, y no se le podrá afiliar ni inscribir en competencias mientras
              esté de baja.
            </p>
            <p className="mt-2">
              Sus afiliaciones e inscripciones ya pagadas se conservan. Puedes
              reactivarlo cuando quieras.
            </p>
          </>
        }
        confirmLabel="Dar de baja"
        destructive
        pending={isPending}
        onConfirm={() => removing && applyActive(removing, false)}
      />
    </>
  )
}
