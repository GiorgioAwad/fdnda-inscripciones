"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

// Los formularios de competencia y de pruebas son largos, y el diálogo se
// cierra con Esc, con la X o con un clic en el fondo. Antes cualquiera de los
// tres descartaba todo sin preguntar.
//
// La confirmación va DENTRO del diálogo, en su pie, y no en un ConfirmDialog
// encima: Dialog atrapa el foco escuchando `focusin` en el documento, y dos
// diálogos abiertos a la vez se devolverían el foco el uno al otro sin fin.
// Cerrar el formulario para abrir la confirmación tampoco sirve: Dialog
// desmonta su contenido al cerrarse y se perdería justo lo que se quiere
// conservar.
export function useDiscardGuard(close: () => void) {
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)

  return {
    confirming,
    /** Va en el `onChange` del <form>: el evento de cambio burbujea desde cada campo. */
    markDirty() {
      if (!dirty) setDirty(true)
    },
    /** Para `onClose` del Dialog y el botón «Cancelar». */
    requestClose() {
      if (dirty) setConfirming(true)
      else close()
    },
    keepEditing() {
      setConfirming(false)
    },
    discard() {
      setConfirming(false)
      setDirty(false)
      close()
    },
    /** Tras guardar con éxito: el formulario ya no tiene nada que perder. */
    reset() {
      setConfirming(false)
      setDirty(false)
    },
  }
}

export type DiscardGuard = ReturnType<typeof useDiscardGuard>

/**
 * Pie fijo de los diálogos con formulario. Queda pegado al borde inferior aunque
 * el formulario haga scroll, así la acción principal nunca queda al final de
 * una página larga. Cuando hay cambios sin guardar y se intenta cerrar, el pie
 * se convierte en la confirmación.
 */
export function DialogFormFooter({
  guard,
  discardTitle,
  discardConsequence,
  children,
}: {
  guard: DiscardGuard
  discardTitle: string
  discardConsequence: string
  children: ReactNode
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 -mb-4 mt-2 border-t border-fdnda-border bg-white px-5 py-3">
      {guard.confirming ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm leading-6 text-fdnda-ink">
            <strong className="font-semibold text-fdnda-navy">{discardTitle}</strong>{" "}
            {discardConsequence}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={guard.keepEditing} autoFocus>
              Seguir editando
            </Button>
            <Button variant="destructive" onClick={guard.discard}>
              Descartar cambios
            </Button>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
