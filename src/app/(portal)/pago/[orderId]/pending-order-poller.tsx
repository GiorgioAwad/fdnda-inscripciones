"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// La confirmación de Izipay llega por IPN (servidor-a-servidor), no por el
// navegador: al volver de la pasarela la orden puede seguir PENDING unos
// segundos. Sin este refresco el comprador ve «pendiente», asume que falló y
// vuelve a pagar. No pinta nada; solo re-ejecuta el server component.
const POLL_INTERVAL_MS = 5_000

export function PendingOrderPoller({ expiresAt }: { expiresAt: string }) {
  const router = useRouter()

  useEffect(() => {
    const deadline = new Date(expiresAt).getTime()

    const interval = window.setInterval(() => {
      // Pasada la expiración no hay nada que confirmar: la orden se cancela y
      // seguir refrescando solo consume la base de datos.
      if (Number.isFinite(deadline) && Date.now() > deadline) {
        window.clearInterval(interval)
        return
      }
      router.refresh()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [expiresAt, router])

  return null
}
