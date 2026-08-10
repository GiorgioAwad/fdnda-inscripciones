"use client"

import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PrintButton({ label = "Imprimir constancia" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()} className="print-hidden">
      <Printer className="h-4 w-4" /> {label}
    </Button>
  )
}
