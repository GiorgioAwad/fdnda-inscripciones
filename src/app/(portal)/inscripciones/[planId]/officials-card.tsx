"use client"

import { useState, useTransition } from "react"
import { Pencil, Plus, Trash2, UserRound } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input, Label, Select } from "@/components/ui/input"
import { disciplineLabel, type DisciplineValue } from "@/lib/disciplines"
import { deleteOfficialAction, saveOfficialAction } from "../officials-actions"
import type { OfficialDisciplineView, OfficialView } from "../types"

// Delegado y entrenadores de cada disciplina: no pagan, solo se registran para
// la acreditación. No dependen de la planilla, así que se guardan al instante
// (sin la cola de autoguardado) y se pueden cambiar hasta el cierre de
// inscripciones aunque la planilla ya esté pagada.

type Role = OfficialView["role"]

const ROLE_SINGULAR: Record<Role, string> = { DELEGATE: "delegado", COACH: "entrenador" }
const ROLE_TITLE: Record<Role, string> = { DELEGATE: "Delegado", COACH: "Entrenadores" }

const DOC_LABELS: Record<OfficialView["docType"], string> = {
  DNI: "DNI",
  CE: "CE",
  PASAPORTE: "Pasaporte",
  OTROS: "Otro",
}

interface Draft {
  discipline: DisciplineValue
  role: Role
  officialId?: string
  firstNames: string
  lastNames: string
  docType: OfficialView["docType"]
  docNumber: string
}

export function OfficialsCard({
  planId,
  disciplines,
  officials,
  editable,
  closedNote,
  onChange,
}: {
  planId: string
  disciplines: OfficialDisciplineView[]
  officials: OfficialView[]
  /** false cuando las inscripciones ya cerraron. */
  editable: boolean
  closedNote: string | null
  onChange: (officials: OfficialView[]) => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OfficialView | null>(null)
  const [pending, startTransition] = useTransition()

  const shown = disciplines.filter((row) => row.maxDelegates > 0 || row.maxCoaches > 0)
  if (shown.length === 0) return null

  function save() {
    if (!draft) return
    const current = draft
    setError(null)
    startTransition(async () => {
      const result = await saveOfficialAction({ planId, ...current })
      if (!result.success) {
        setError(result.error)
        return
      }
      onChange(
        current.officialId
          ? officials.map((row) => (row.id === result.official.id ? result.official : row))
          : [...officials, result.official]
      )
      setDraft(null)
      toast.success(
        current.officialId
          ? "Datos corregidos."
          : `${ROLE_SINGULAR[current.role][0].toUpperCase()}${ROLE_SINGULAR[current.role].slice(1)} nombrado.`
      )
    })
  }

  function remove(official: OfficialView) {
    startTransition(async () => {
      const result = await deleteOfficialAction({
        planId,
        discipline: official.discipline as DisciplineValue,
        officialId: official.id,
      })
      setRemoving(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      onChange(officials.filter((row) => row.id !== official.id))
    })
  }

  return (
    <section
      id="event-officials"
      tabIndex={-1}
      aria-labelledby="officials-heading"
      className="scroll-mt-24 space-y-3 focus:outline-none"
    >
      <div>
        <h2 id="officials-heading" className="font-heading text-lg font-bold text-fdnda-navy">
          Delegado y entrenadores
        </h2>
        <p className="mt-1 text-sm text-fdnda-muted">
          No pagan inscripción: se registran para su acreditación en la competencia.{" "}
          {editable
            ? "Puedes cambiarlos hasta el cierre de inscripciones, aunque la planilla ya esté pagada."
            : (closedNote ?? "Ya no se pueden cambiar.")}
        </p>
      </div>

      {shown.map((config) => {
        const own = officials.filter((row) => row.discipline === config.discipline)
        const delegateMissing =
          config.requiresDelegate && !own.some((row) => row.role === "DELEGATE")
        return (
          <Card key={config.discipline} lanes={[config.discipline]} className="overflow-hidden">
            {shown.length > 1 ? (
              <p className="border-b border-fdnda-border bg-fdnda-surface px-4 py-2 text-xs font-bold uppercase tracking-wide text-fdnda-navy">
                {disciplineLabel(config.discipline)}
              </p>
            ) : null}
            <div className="grid divide-y divide-fdnda-border md:grid-cols-2 md:divide-x md:divide-y-0">
              {(["DELEGATE", "COACH"] as const).map((role) => {
                const max = role === "DELEGATE" ? config.maxDelegates : config.maxCoaches
                if (max === 0) return null
                const people = own.filter((row) => row.role === role)
                const formOpen =
                  draft?.discipline === config.discipline &&
                  draft.role === role &&
                  !draft.officialId
                return (
                  <div key={role} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-fdnda-navy">{ROLE_TITLE[role]}</h3>
                      <span className="text-xs text-fdnda-muted">
                        <span className="num">{people.length}</span> de{" "}
                        <span className="num">{max}</span>
                      </span>
                      {role === "DELEGATE" && config.requiresDelegate ? (
                        <Badge variant={delegateMissing ? "warning" : "success"}>
                          {delegateMissing ? "Obligatorio" : "Listo"}
                        </Badge>
                      ) : null}
                    </div>

                    {people.length === 0 && !formOpen ? (
                      <p className="text-sm text-fdnda-muted">
                        {role === "DELEGATE"
                          ? config.requiresDelegate
                            ? "Nombra al delegado: sin él la planilla no se puede pagar."
                            : "Sin delegado nombrado."
                          : "Sin entrenadores nombrados."}
                      </p>
                    ) : null}

                    <ul className="space-y-1.5">
                      {people.map((person) =>
                        draft?.officialId === person.id ? (
                          <li key={person.id}>
                            <OfficialForm
                              draft={draft}
                              error={error}
                              pending={pending}
                              onChange={setDraft}
                              onSave={save}
                              onCancel={() => {
                                setDraft(null)
                                setError(null)
                              }}
                            />
                          </li>
                        ) : (
                          <li
                            key={person.id}
                            className="flex items-center gap-2 rounded-control bg-fdnda-surface px-3 py-2"
                          >
                            <UserRound className="h-4 w-4 shrink-0 text-fdnda-muted" aria-hidden="true" />
                            <span className="min-w-0 flex-1 text-sm">
                              <span className="block font-semibold text-fdnda-ink">
                                {person.lastNames}, {person.firstNames}
                              </span>
                              <span className="block text-xs text-fdnda-muted">
                                {DOC_LABELS[person.docType]}{" "}
                                <span className="num">{person.docNumber}</span>
                              </span>
                            </span>
                            {editable ? (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Corregir a ${person.lastNames}, ${person.firstNames}`}
                                  disabled={pending}
                                  onClick={() => {
                                    setError(null)
                                    setDraft({
                                      discipline: person.discipline as DisciplineValue,
                                      role: person.role,
                                      officialId: person.id,
                                      firstNames: person.firstNames,
                                      lastNames: person.lastNames,
                                      docType: person.docType,
                                      docNumber: person.docNumber,
                                    })
                                  }}
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Quitar a ${person.lastNames}, ${person.firstNames}`}
                                  disabled={pending}
                                  onClick={() => setRemoving(person)}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </>
                            ) : null}
                          </li>
                        )
                      )}
                    </ul>

                    {formOpen ? (
                      <OfficialForm
                        draft={draft}
                        error={error}
                        pending={pending}
                        onChange={setDraft}
                        onSave={save}
                        onCancel={() => {
                          setDraft(null)
                          setError(null)
                        }}
                      />
                    ) : editable && people.length < max ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setError(null)
                          setDraft({
                            discipline: config.discipline as DisciplineValue,
                            role,
                            firstNames: "",
                            lastNames: "",
                            docType: "DNI",
                            docNumber: "",
                          })
                        }}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" /> Agregar{" "}
                        {ROLE_SINGULAR[role]}
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={
          removing
            ? `¿Quitar a ${removing.lastNames}, ${removing.firstNames} como ${ROLE_SINGULAR[removing.role]}?`
            : ""
        }
        consequence="Deja de figurar en la acreditación de tu club para esta competencia. Puedes volver a nombrarlo mientras sigan abiertas las inscripciones."
        confirmLabel="Quitar"
        destructive
        pending={pending}
        onConfirm={() => {
          if (removing) remove(removing)
        }}
      />
    </section>
  )
}

function OfficialForm({
  draft,
  error,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft
  error: string | null
  pending: boolean
  onChange: (draft: Draft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const prefix = `official-${draft.discipline}-${draft.role}-${draft.officialId ?? "new"}`
  return (
    <form
      className="space-y-3 rounded-control border border-fdnda-border bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-last`}>Apellidos</Label>
          <Input
            id={`${prefix}-last`}
            value={draft.lastNames}
            onChange={(event) => onChange({ ...draft, lastNames: event.target.value })}
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-first`}>Nombres</Label>
          <Input
            id={`${prefix}-first`}
            value={draft.firstNames}
            onChange={(event) => onChange({ ...draft, firstNames: event.target.value })}
            required
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-doctype`}>Tipo de documento</Label>
          <Select
            id={`${prefix}-doctype`}
            value={draft.docType}
            onChange={(event) =>
              onChange({ ...draft, docType: event.target.value as Draft["docType"] })
            }
          >
            <option value="DNI">DNI</option>
            <option value="CE">Carné de extranjería</option>
            <option value="PASAPORTE">Pasaporte</option>
            <option value="OTROS">Otros</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${prefix}-doc`}>N.º de documento</Label>
          <Input
            id={`${prefix}-doc`}
            value={draft.docNumber}
            onChange={(event) => onChange({ ...draft, docNumber: event.target.value })}
            inputMode={draft.docType === "DNI" ? "numeric" : undefined}
            required
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded-control bg-fdnda-red-soft px-3 py-2 text-xs font-semibold text-fdnda-red-deep">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          Guardar
        </Button>
      </div>
    </form>
  )
}
