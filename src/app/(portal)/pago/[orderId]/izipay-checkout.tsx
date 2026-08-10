"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CreditCard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { IzipayWebCoreCheckoutConfig } from "@/lib/izipay"

interface IzipayPaymentResponse {
  code?: string
  message?: string
  messageUser?: string
  payloadHttp?: string
  signature?: string
  transactionId?: string
}

declare global {
  interface Window {
    Izipay?: new (options: { config: IzipayWebCoreCheckoutConfig }) => {
      LoadForm: (options: {
        authorization: string
        keyRSA: string
        callbackResponse?: (
          response: IzipayPaymentResponse
        ) => void | Promise<void>
      }) => void
    }
  }
}

const SDK_LOAD_TIMEOUT_MS = 8_000
// Proxy de mismo origen: los bloqueadores de anuncios bloquean el CDN de Izipay
// por dominio y sin esto el checkout simplemente no abre.
const FIRST_PARTY_SDK_PATH = "/api/checkout/runtime"

const GENERIC_ERROR =
  "Izipay no pudo procesar el pago en este momento. Vuelve a intentarlo; si persiste, prueba con otra tarjeta u otro navegador."

const REPLACEMENT_CHAR_CODE = 0xfffd

// Caracteres de control o de reemplazo delatan un blob binario/mal decodificado.
function hasUnprintableChars(message: string): boolean {
  for (const char of message) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code === REPLACEMENT_CHAR_CODE) return true
  }
  return false
}

// El SDK a veces devuelve como «mensaje» un payload técnico (JSON, HTML o un
// blob firmado). Eso nunca debe llegar a la pantalla del club.
function sanitizeMessage(raw: string | undefined | null): string {
  const message = (raw || "").trim()
  if (!message) return GENERIC_ERROR

  const looksTechnical =
    message.length > 160 ||
    /^[{[<]/.test(message) ||
    message.includes("payloadHttp") ||
    message.includes("<html") ||
    /[A-Za-z0-9+/=_-]{40,}/.test(message) ||
    hasUnprintableChars(message)

  if (looksTechnical) {
    console.error("Izipay devolvió un mensaje no legible:", message)
    return GENERIC_ERROR
  }

  return message
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.Izipay) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.async = true
    const timer = window.setTimeout(
      () => reject(new Error("timeout")),
      SDK_LOAD_TIMEOUT_MS
    )
    script.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error("script error"))
    }
    document.head.appendChild(script)
  })
}

// Intenta el proxy propio y cae al CDN de Izipay. Si ambos fallan, el mensaje
// acumula el motivo de cada intento para poder diagnosticar desde un reporte.
async function loadIzipaySdk(cdnSrc: string): Promise<void> {
  if (typeof window.Izipay === "function") return

  const failures: string[] = []
  for (const src of Array.from(new Set([FIRST_PARTY_SDK_PATH, cdnSrc]))) {
    try {
      await loadScript(src)
      if (typeof window.Izipay === "function") return
      failures.push(`${src}: cargó sin definir window.Izipay`)
    } catch (error) {
      failures.push(`${src}: ${(error as Error).message}`)
    }
  }

  throw new Error(
    `No pudimos cargar el módulo de pago. Desactiva bloqueadores de anuncios o prueba en modo incógnito. (${failures.join(" | ")})`
  )
}

export function IzipayCheckout({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El SDK puede invocar el callback más de una vez (p. ej. al cerrarse el
  // iframe tras confirmar); solo la primera respuesta firmada debe confirmar.
  const handledRef = useRef(false)

  // Resultado del pop-up. Llega por el callback del SDK, no por navegación.
  const handlePaymentResult = async (result: IzipayPaymentResponse) => {
    // Sin payloadHttp+signature no es un resultado de pago: es el SDK avisando
    // que rechazó el config, o el club que cerró el pop-up. No se confirma nada
    // y se deja reintentar.
    const isSigned = Boolean(result.payloadHttp && result.signature)
    if (!isSigned) {
      const raw = (result.messageUser || result.message || "").trim()
      setLoading(false)
      if (raw && raw.toUpperCase() !== "OK") {
        setError(sanitizeMessage(raw))
      }
      return
    }

    if (handledRef.current) return
    handledRef.current = true

    try {
      const response = await fetch("/api/payments/izipay/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentResult: result }),
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || "No se pudo validar el pago con Izipay")
      }

      if (data.data?.status === "PAID") {
        // La página se re-renderiza como constancia de pago.
        router.refresh()
        return
      }

      // Rechazada o aún pendiente: la orden sigue viva, se puede reintentar.
      handledRef.current = false
      setLoading(false)
      setError(
        sanitizeMessage(
          data.data?.message ||
            "El pago no se completó. Puedes intentarlo de nuevo con otra tarjeta."
        )
      )
    } catch (err) {
      // No sabemos si Izipay cobró: el IPN es el respaldo y el auto-refresco de
      // la página mostrará el estado real. No se invita a pagar otra vez.
      handledRef.current = false
      setLoading(false)
      setError(
        `${sanitizeMessage((err as Error).message)} Si el cobro se realizó, esta página se actualizará sola en unos segundos.`
      )
    }
  }

  const startPayment = async () => {
    setLoading(true)
    setError(null)
    handledRef.current = false

    try {
      const response = await fetch("/api/payments/izipay/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || "No se pudo iniciar el pago.")
      }

      if (data.data.alreadyPaid) {
        router.refresh()
        return
      }

      await loadIzipaySdk(data.data.scriptUrl)

      if (!window.Izipay) {
        throw new Error("El módulo de pago no está disponible en este navegador.")
      }

      // El SDK monta un iframe superpuesto (no abre una ventana), así que no lo
      // frena el bloqueador de pop-ups del navegador.
      const checkout = new window.Izipay({ config: data.data.config })
      checkout.LoadForm({
        authorization: data.data.authorization,
        keyRSA: data.data.keyRSA,
        callbackResponse: (paymentResult) => handlePaymentResult(paymentResult),
      })
    } catch (err) {
      setLoading(false)
      setError(err instanceof Error ? err.message : "Error al iniciar el pago.")
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm text-fdnda-muted">
          El pago se abre sobre esta misma página, en el módulo seguro de Izipay
          (tarjeta, Yape y otros métodos). No cierres la ventana hasta terminar.
        </p>
        {error ? (
          <p className="rounded-surface bg-fdnda-danger-soft px-3 py-2 text-sm text-fdnda-danger">{error}</p>
        ) : null}
        <Button size="lg" className="w-full" onClick={startPayment} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CreditCard className="h-4 w-4" />
          )}
          {loading ? "Abriendo el módulo de pago…" : "Pagar con Izipay"}
        </Button>
      </CardContent>
    </Card>
  )
}
