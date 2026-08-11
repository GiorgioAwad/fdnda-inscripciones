"use client"

import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PrintButton() {
  return (
    // print-hidden: sin esto el botón se imprimía a sí mismo en la planilla.
    <div className="print-hidden flex flex-col items-start gap-1">
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir
      </Button>
      {/* La franja de disciplina y las cabeceras de tabla salen en color solo
          si el navegador tiene activada esa opción, y viene apagada. */}
      <p className="max-w-56 text-xs leading-snug text-fdnda-muted">
        Activa «Gráficos de fondo» en el diálogo de impresión para que salgan
        los colores de disciplina.
      </p>
    </div>
  )
}
