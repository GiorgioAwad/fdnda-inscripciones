"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { updateClubContact } from "./actions"

export function ClubContactForm({
  contactName,
  contactPhone,
  contactEmail,
  canEdit,
}: {
  contactName: string
  contactPhone: string
  contactEmail: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // onSubmit con preventDefault en vez de <form action>: React 19 reinicia el
  // formulario al terminar la acción aunque haya error, y se perdía lo escrito.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await updateClubContact(formData)
      if (result.success) {
        toast.success("Contacto del club guardado")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="cl-name">Nombre de contacto</Label>
          <Input
            id="cl-name"
            name="contactName"
            autoComplete="name"
            defaultValue={contactName}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="cl-phone">Teléfono</Label>
          <Input
            id="cl-phone"
            name="contactPhone"
            type="tel"
            autoComplete="tel"
            defaultValue={contactPhone}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="cl-email">Correo electrónico</Label>
          <Input
            id="cl-email"
            name="contactEmail"
            type="email"
            autoComplete="email"
            defaultValue={contactEmail}
            disabled={!canEdit}
          />
        </div>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" loading={isPending}>
            <Save className="h-4 w-4" aria-hidden="true" /> Guardar contacto
          </Button>
        </div>
      ) : (
        <p className="text-xs text-fdnda-muted">
          Solo el coordinador del club puede editar el contacto: es el mismo para
          todas las disciplinas.
        </p>
      )}
    </form>
  )
}
