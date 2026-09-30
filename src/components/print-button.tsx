"use client"

import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

// Botón único de impresión (constancias, planillas, reportes). `hint` va debajo
// cuando la hoja tiene color que el navegador no imprime por defecto.
// print-hidden: sin esto el botón se imprimía a sí mismo en la hoja.
export function PrintButton({
  label = "Imprimir constancia",
  hint,
}: {
  label?: string
  hint?: string
}) {
  const button = (
    <Button
      variant="outline"
      onClick={() => window.print()}
      className={hint ? undefined : "print-hidden"}
    >
      <Printer className="h-4 w-4" aria-hidden="true" /> {label}
    </Button>
  )
  if (!hint) return button
  return (
    <div className="print-hidden flex flex-col items-start gap-1">
      {button}
      <p className="max-w-56 text-xs leading-snug text-fdnda-muted">{hint}</p>
    </div>
  )
}
