"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, Search, UserPlus } from "lucide-react"
import { DisciplineIcon } from "@/components/discipline-icon"
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
  const [submitting, setSubmitting] = useState<"one" | "another" | null>(null)
  const [isPending, startTransition] = useTransition()
  const docInputRef = useRef<HTMLInputElement>(null)

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
    })
  }

  // onSubmit con preventDefault en vez de <form action>: React 19 reinicia el
  // formulario al terminar la acción aunque el servidor devuelva un error, y el
  // club perdía todo lo que había escrito.
  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | null
    const another = submitter?.value === "another"
    const formData = new FormData(event.currentTarget)

    setSubmitting(another ? "another" : "one")
    startTransition(async () => {
      const result = await createClubAthlete(formData)
      setSubmitting(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }

      const name = result.fullName ?? "El deportista"
      const added = result.added ?? 0
      if (added > 0) {
        toast.success(
          added === 1
            ? `${name} quedó en el padrón. Su afiliación está en el carrito.`
            : `${name} quedó en el padrón. Sus ${added} afiliaciones están en el carrito.`,
          {
            action: {
              label: "Pagar carrito",
              onClick: () => router.push("/afiliacion/carrito"),
            },
          }
        )
      } else {
        toast.success(
          result.seasonOpen
            ? `${name} quedó en el padrón. La FDNDA aún no fija la cuota de afiliación de sus disciplinas.`
            : `${name} quedó en el padrón. Afílialo cuando la FDNDA abra la temporada.`
        )
      }

      if (another) {
        reset()
        window.requestAnimationFrame(() => docInputRef.current?.focus())
      } else {
        close()
      }
      router.refresh()
    })
  }

  const lookupError = lookup?.status === "INVALID" ? lookup.message : null

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden="true" /> Registrar deportista
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Registrar deportista"
        description="Empieza por el N.º de documento: así sabemos si la persona ya está registrada en la FDNDA."
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="lookup-doc">N.º de documento</Label>
            <div className="flex gap-2">
              <Input
                ref={docInputRef}
                id="lookup-doc"
                value={docNumber}
                inputMode="numeric"
                autoComplete="off"
                placeholder="71234567"
                aria-invalid={lookupError ? true : undefined}
                aria-describedby={lookupError ? "lookup-doc-error" : undefined}
                onChange={(event) => {
                  setDocNumber(event.target.value)
                  setLookup(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    if (docNumber.trim().length >= 4) handleLookup()
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
                Buscar documento
              </Button>
            </div>
            {lookupError ? (
              <p
                id="lookup-doc-error"
                role="alert"
                className="mt-2 flex items-start gap-2 text-sm font-semibold text-fdnda-danger"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {lookupError}
              </p>
            ) : null}
          </div>

          {lookup?.status === "OWN_CLUB" ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-surface bg-fdnda-turquoise-soft px-4 py-3 text-sm text-fdnda-navy ring-1 ring-inset ring-fdnda-turquoise/25"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                <strong>{lookup.fullName}</strong> ya está en el padrón de tu club
                {lookup.disciplines.length > 0 ? ` (${lookup.disciplines.join(", ")})` : ""}.
                Si le falta una afiliación, agrégala en{" "}
                <Link
                  href="/afiliacion?tab=deportistas"
                  onClick={close}
                  className="font-semibold underline underline-offset-2"
                >
                  Deportistas por afiliar
                </Link>
                . Para agregarle otra disciplina o corregir sus datos, solicítalo a la
                FDNDA.
              </p>
            </div>
          ) : null}

          {lookup?.status === "OTHER_CLUB" ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-surface bg-fdnda-red-soft px-4 py-3 text-sm font-semibold text-fdnda-red-deep ring-1 ring-inset ring-fdnda-red/20"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Este documento ya está registrado en otro club. Solo la FDNDA puede
                traspasar a un deportista: solicítale el traspaso.
              </span>
            </p>
          ) : null}

          {lookup?.status === "AVAILABLE" ? (
            <form onSubmit={handleCreate} className="space-y-4 border-t border-fdnda-border pt-4">
              <input type="hidden" name="docNumber" value={lookup.docNumber} />
              <p className="text-sm text-fdnda-muted">
                El documento <strong className="text-fdnda-ink">{lookup.docNumber}</strong>{" "}
                no está registrado. Completa los datos del deportista.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="na-last">Apellidos</Label>
                  <Input id="na-last" name="lastNames" required autoFocus />
                </div>
                <div>
                  <Label htmlFor="na-first">Nombres</Label>
                  <Input id="na-first" name="firstNames" required />
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
                  {/* Sin valor por defecto: el club no puede corregirlo después. */}
                  <Select id="na-sex" name="sex" defaultValue="" required>
                    <option value="" disabled>
                      Elige
                    </option>
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
                        <DisciplineIcon discipline={value} className="h-4 w-4" />
                        {style.label}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-fdnda-muted">
                  Cada disciplina marcada genera su propia cuota de afiliación.
                </p>
              </fieldset>
              <p className="text-xs text-fdnda-muted">
                Revisa la fecha de nacimiento, el sexo y las disciplinas antes de
                registrar: definen en qué pruebas y categorías compite, y después solo
                la FDNDA puede corregirlos.
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
                    rel="noopener noreferrer"
                    className="font-semibold text-fdnda-navy underline"
                  >
                    Política de Privacidad
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </Link>
                  .
                </span>
              </label>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={close} disabled={isPending}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  name="intent"
                  value="another"
                  loading={submitting === "another"}
                  disabled={isPending}
                >
                  Registrar y agregar otro
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="one"
                  loading={submitting === "one"}
                  disabled={isPending}
                >
                  Registrar deportista
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
