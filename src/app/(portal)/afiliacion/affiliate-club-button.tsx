"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BadgePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { addAffiliationsAction } from "./actions"

// La cuota del club es por disciplina: cada tarjeta de /afiliacion trae su botón.
export function AffiliateClubButton({
  year,
  discipline,
}: {
  year: number
  discipline: DisciplineValue
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const label = DISCIPLINES[discipline].label

  const handleClick = () => {
    startTransition(async () => {
      const result = await addAffiliationsAction({ clubDisciplines: [discipline] })
      if (result.success) {
        toast.success(`Cuota ${year} de ${label} agregada al carrito`)
        router.push("/afiliacion/carrito")
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Button onClick={handleClick} loading={isPending} className="w-full sm:w-auto">
      <BadgePlus className="h-4 w-4" aria-hidden="true" />
      Afiliar {year}
    </Button>
  )
}
