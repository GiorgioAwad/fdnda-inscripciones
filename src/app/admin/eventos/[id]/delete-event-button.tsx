"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { plural } from "@/lib/utils"
import { deleteEvent } from "../actions"

// Solo se muestra cuando la competencia no tiene ninguna inscripción, ni
// siquiera en el carrito de un club. deleteEvent vuelve a contarlas en el
// servidor y rechaza el borrado si apareció alguna mientras tanto.
export function DeleteEventButton({
  eventId,
  eventName,
  modalityCount,
}: {
  eventId: string
  eventName: string
  modalityCount: number
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const confirm = () => {
    startTransition(async () => {
      const result = await deleteEvent(eventId)
      if (result.success) {
        toast.success(`Competencia «${eventName}» eliminada.`)
        setOpen(false)
        router.push("/admin/eventos")
      } else {
        toast.error(
          result.error ?? "No se pudo eliminar la competencia. Vuelve a intentarlo."
        )
        setOpen(false)
      }
    })
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-fdnda-red/50 text-fdnda-red-deep hover:border-fdnda-red hover:bg-fdnda-red-soft"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar competencia
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`¿Eliminar «${eventName}»?`}
        consequence={
          modalityCount > 0
            ? `Se borran la competencia y ${modalityCount === 1 ? "su única prueba" : `sus ${plural(modalityCount, "prueba", "pruebas")}`}. No tiene inscripciones. Esta acción no se puede deshacer.`
            : "Se borra la competencia. No tiene pruebas ni inscripciones. Esta acción no se puede deshacer."
        }
        confirmLabel="Eliminar competencia"
        destructive
        pending={isPending}
        onConfirm={confirm}
      />
    </>
  )
}
