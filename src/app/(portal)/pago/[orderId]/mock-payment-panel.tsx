"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CreditCard, FlaskConical, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { mockFailAction, mockPayAction } from "./actions"

// Panel de pago SIMULADO (PAYMENTS_MODE=mock). Solo para desarrollo/pruebas:
// en producción se reemplaza por el checkout de Izipay.
export function MockPaymentPanel({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const pay = () => {
    startTransition(async () => {
      const result = await mockPayAction(orderId)
      if (result.success) {
        toast.success("Pago simulado aprobado")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const fail = () => {
    startTransition(async () => {
      const result = await mockFailAction(orderId)
      if (result.success) {
        toast.info("Pago simulado rechazado")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="rounded-surface border-2 border-dashed border-fdnda-red/35 bg-fdnda-red-soft p-5">
      <p className="mb-3 flex items-center gap-2 text-sm font-bold text-fdnda-red-deep">
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        Modo de pagos simulado (desarrollo)
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={pay} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CreditCard className="h-4 w-4" aria-hidden="true" />
          )}
          Pagar (simulado)
        </Button>
        <Button variant="outline" onClick={fail} disabled={isPending}>
          <XCircle className="h-4 w-4" aria-hidden="true" /> Simular fallo
        </Button>
      </div>
    </div>
  )
}
