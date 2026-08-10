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

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateClubContact(formData)
      if (result.success) {
        toast.success("Datos de contacto actualizados")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="cl-name">Delegado responsable</Label>
          <Input id="cl-name" name="contactName" defaultValue={contactName} disabled={!canEdit} />
        </div>
        <div>
          <Label htmlFor="cl-phone">Teléfono</Label>
          <Input
            id="cl-phone"
            name="contactPhone"
            type="tel"
            defaultValue={contactPhone}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="cl-email">Correo</Label>
          <Input
            id="cl-email"
            name="contactEmail"
            type="email"
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
          El contacto es compartido por todas las secciones y solo puede editarlo el coordinador general.
        </p>
      )}
    </form>
  )
}
