"use client"

import * as React from "react"
import { Button } from "./button"
import { Dialog } from "./dialog"

/**
 * Confirmación para operaciones con consecuencias. No existe un «¿Estás
 * seguro?» genérico: el título nombra la acción y el objeto («¿Desactivar
 * Club Regatas?»), `consequence` dice qué cambia para quién, y el botón repite
 * el verbo («Desactivar club»), de modo que se entiende sin leer el resto.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive = false,
  pending = false,
  onConfirm,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  consequence: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
  children?: React.ReactNode
}) {
  return (
    <Dialog open={open} onClose={pending ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm leading-6 text-fdnda-ink">{consequence}</div>
        {children}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
