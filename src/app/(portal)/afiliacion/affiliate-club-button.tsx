"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BadgePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { addAffiliationsAction } from "./actions"

// La cuota del club es por disciplina. El botón agrega una o varias cuotas al
// carrito y se queda en la página: antes redirigía al carrito tras cada clic,
// y un club con tres disciplinas tenía que ir y volver tres veces.
export function AffiliateClubButton({
  year,
  disciplines,
  label,
  variant = "default",
  className,
}: {
  year: number
  disciplines: DisciplineValue[]
  label: string
  variant?: "default" | "outline"
  className?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    startTransition(async () => {
      const result = await addAffiliationsAction({ clubDisciplines: disciplines })
      if (result.success) {
        toast.success(
          disciplines.length === 1
            ? `Cuota de afiliación ${year} del club en ${DISCIPLINES[disciplines[0]].label} agregada al carrito`
            : `${disciplines.length} cuotas de afiliación ${year} del club agregadas al carrito`,
          {
            action: {
              label: "Pagar carrito",
              onClick: () => router.push("/afiliacion/carrito"),
            },
          }
        )
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Button
      onClick={handleClick}
      loading={isPending}
      variant={variant}
      className={className ?? "w-full sm:w-auto"}
    >
      <BadgePlus className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  )
}
