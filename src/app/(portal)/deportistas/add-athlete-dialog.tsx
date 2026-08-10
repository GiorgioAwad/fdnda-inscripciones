"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, Search, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input, Label, Select } from "@/components/ui/input"
import {
  DISCIPLINE_VALUES,
  DISCIPLINES,
  type DisciplineValue,
} from "@/lib/disciplines"
import { createClubAthlete, lookupDocument, type DocumentLookup } from "./actions"

// El alta arranca por el documento: evita duplicados en el padrón nacional y
// deja claro cuándo el deportista es de otro club (traspaso, lo ve la FDNDA).
export function AddAthleteDialog({
  disciplineAccess = [...DISCIPLINE_VALUES],
}: {
  disciplineAccess?: DisciplineValue[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [docNumber, setDocNumber] = useState("")
  const [lookup, setLookup] = useState<DocumentLookup | null>(null)
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setDocNumber("")
    setLookup(null)
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  const handleLookup = () => {
    startTransition(async () => {
      const result = await lookupDocument(docNumber)
      setLookup(result)
      if (result.status === "INVALID") {
        toast.error(result.message)
      }
    })
  }

  const handleCreate = (formData: FormData) => {
    startTransition(async () => {
      const result = await createClubAthlete(formData)
      if (result.success) {
        toast.success("Deportista registrado. Quedó pendiente de afiliación.", {
          action: {
            label: "Ver carrito",
            onClick: () => router.push("/afiliacion/carrito"),
          },
        })
        close()
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden="true" /> Agregar deportista
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Agregar deportista"
        description="Busca primero por documento: si ya está en el padrón nacional, te lo indicamos."
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="lookup-doc">Número de documento</Label>
            <div className="flex gap-2">
              <Input
                id="lookup-doc"
                value={docNumber}
                inputMode="numeric"
                autoComplete="off"
                placeholder="71234567"
                onChange={(event) => {
                  setDocNumber(event.target.value)
                  setLookup(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    handleLookup()
                  }
                }}
              />
              <Button
                variant="outline"
                className="shrink-0"
                onClick={handleLookup}
                loading={isPending && lookup === null}
                disabled={docNumber.trim().length < 4}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Buscar
              </Button>
            </div>
          </div>

          {lookup?.status === "OWN_CLUB" ? (
            <p className="flex items-start gap-2 rounded-surface bg-fdnda-turquoise-soft px-4 py-3 text-sm font-semibold text-fdnda-navy ring-1 ring-inset ring-fdnda-turquoise/25">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {lookup.fullName} ya está en la lista de tu club. Si le falta alguna
                afiliación, la encontrarás en Estado de afiliación → Deportistas.
              </span>
            </p>
          ) : null}

          {lookup?.status === "OTHER_CLUB" ? (
            <p className="flex items-start gap-2 rounded-surface bg-fdnda-red-soft px-4 py-3 text-sm font-semibold text-fdnda-red-deep ring-1 ring-inset ring-fdnda-red/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                El documento ya está registrado. El cambio de club lo realiza la
                federación: solicita el traspaso directamente a la FDNDA.
              </span>
            </p>
          ) : null}

          {lookup?.status === "AVAILABLE" ? (
            <form action={handleCreate} className="space-y-4 border-t border-fdnda-border pt-4">
              <input type="hidden" name="docNumber" value={lookup.docNumber} />
              <p className="text-sm text-fdnda-muted">
                Documento <strong className="text-fdnda-ink">{lookup.docNumber}</strong>{" "}
                disponible. Completa los datos del deportista.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="na-first">Nombres</Label>
                  <Input id="na-first" name="firstNames" required autoFocus />
                </div>
                <div>
                  <Label htmlFor="na-last">Apellidos</Label>
                  <Input id="na-last" name="lastNames" required />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="na-doctype">Tipo de documento</Label>
                  <Select id="na-doctype" name="docType" defaultValue="DNI">
                    <option value="DNI">DNI</option>
                    <option value="CE">Carné de extranjería</option>
                    <option value="PASAPORTE">Pasaporte</option>
                    <option value="OTROS">Otros</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="na-birth">Fecha de nacimiento</Label>
                  <Input id="na-birth" name="birthDate" type="date" required />
                </div>
                <div>
                  <Label htmlFor="na-sex">Sexo</Label>
                  <Select id="na-sex" name="sex" defaultValue="F">
                    <option value="F">Femenino</option>
                    <option value="M">Masculino</option>
                  </Select>
                </div>
              </div>
              <fieldset>
                <legend className="mb-1.5 block text-sm font-semibold text-fdnda-ink">
                  Disciplinas que practica
                </legend>
                <div className="flex flex-wrap gap-2">
                  {disciplineAccess.map((value) => {
                    const style = DISCIPLINES[value]
                    const Icon = style.icon
                    return (
                      <label
                        key={value}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-fdnda-border px-3 text-sm font-semibold text-fdnda-ink transition-colors hover:bg-fdnda-sky-soft has-checked:border-fdnda-navy has-checked:bg-fdnda-navy-soft"
                      >
                        <input
                          type="checkbox"
                          name="disciplines"
                          value={value}
                          defaultChecked={disciplineAccess.length === 1}
                          className="h-4 w-4 accent-fdnda-navy"
                        />
                        <Icon
                          className="h-4 w-4 text-fdnda-turquoise-deep"
                          aria-hidden="true"
                        />
                        {style.label}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-fdnda-muted">
                  Se genera una cuota de afiliación por cada disciplina marcada.
                </p>
              </fieldset>
              <p className="text-xs text-fdnda-muted">
                La fecha de nacimiento define la elegibilidad por año en cada prueba:
                revísala antes de guardar.
              </p>
              <label className="flex items-start gap-2 rounded-surface bg-fdnda-sky-soft px-3 py-3 text-xs text-fdnda-muted">
                <input
                  type="checkbox"
                  name="privacyAccepted"
                  required
                  className="mt-0.5 h-4 w-4 shrink-0 accent-fdnda-navy"
                />
                <span>
                  Confirmo que cuento con autorización para registrar estos datos
                  personales y que informé al deportista o a su representante sobre
                  el tratamiento descrito en la{" "}
                  <Link
                    href="/privacidad"
                    target="_blank"
                    className="font-semibold text-fdnda-navy underline"
                  >
                    Política de Privacidad
                  </Link>
                  .
                </span>
              </label>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={close}>
                  Cancelar
                </Button>
                <Button type="submit" loading={isPending}>
                  Registrar y agregar al carrito
                </Button>
              </div>
            </form>
          ) : null}

          {lookup === null || lookup.status !== "AVAILABLE" ? (
            <div className="flex justify-end pt-1">
              <Button variant="outline" onClick={close}>
                Cerrar
              </Button>
            </div>
          ) : null}
        </div>
      </Dialog>
    </>
  )
}
