"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { PlanStatus, SerializableValidation } from "./types"

// Autoguardado de una planilla. Cada mutación viaja con la revisión que el
// cliente cree vigente y el servidor la incrementa; si alguien editó la misma
// planilla en otra pestaña, la revisión no coincide y todo queda bloqueado hasta
// recargar, en vez de mezclar dos versiones en silencio.
//
// Las mutaciones se encolan y corren de a una: dos casillas marcadas seguidas no
// pueden pisarse la revisión entre sí.
//
// No todo fallo bloquea. Un rechazo de negocio (deportista duplicado, prueba que
// ya no existe, competencia que no se puede cambiar) sale de la transacción
// antes de escribir y sin tocar la revisión: el cliente sigue sincronizado, así
// que basta avisar y que quien encoló la mutación revierta su cambio optimista.
// Solo se bloquea cuando la copia local ya no es confiable: otra pestaña cambió
// la planilla, la planilla dejó de ser editable, la base rechazó por
// concurrencia, o la red cortó sin saber si el cambio llegó.

export type PlanActionResult =
  | {
      success: true
      planId: string
      revision: number
      status?: PlanStatus
      // null cuando la mutación quitó una prueba en vez de crearla.
      registrationId?: string | null
      orderId?: string
      merged?: boolean
    }
  | {
      success: false
      error: string
      code: string
      currentRevision?: number
      existingPlanId?: string
      validation?: SerializableValidation
    }

export interface PlanSyncState {
  planId: string
  revision: number
  status?: PlanStatus
}

export interface PlanAutosave {
  /** Mutaciones en vuelo; > 0 mientras la cola no se vacía. */
  savingCount: number
  /** Motivo por el que la planilla dejó de aceptar cambios, o null. */
  blockedMessage: string | null
  /** Revisión que el cliente considera vigente, sin esperar a un re-render. */
  currentRevision: () => number
  enqueue: (
    work: (expectedRevision: number) => Promise<PlanActionResult>
  ) => Promise<PlanActionResult>
  /** Espera a que la cola se vacíe; lanza si la planilla quedó bloqueada. */
  awaitSaved: () => Promise<void>
  /** Bloquea desde fuera (p. ej. cuando la validación detecta el conflicto). */
  block: (message: string) => void
  /**
   * Aplica a un fallo la misma política que la cola: bloqueo + aviso si la
   * copia local dejó de ser confiable, o solo el aviso si no.
   */
  fail: (result: Extract<PlanActionResult, { success: false }>) => void
}

const CONFLICT_MESSAGE =
  "Tu último cambio no se guardó: esta planilla se modificó en otra pestaña o por otra persona. Recárgala y repite el cambio."
const NOT_EDITABLE_MESSAGE =
  "Tu último cambio no se guardó: esta planilla ya tiene una orden de pago. Recárgala para ver su estado."
const CONCURRENT_MESSAGE =
  "Tu último cambio no se guardó porque otro cambio se estaba guardando a la vez. Recarga la planilla y repítelo."
const NETWORK_MESSAGE =
  "No pudimos confirmar si tu último cambio se guardó: falló la conexión. Recarga la planilla para ver lo que quedó guardado."

// Código solo de cliente: la llamada lanzó (red caída, respuesta ilegible) y no
// hay forma de saber si el servidor aplicó el cambio.
const NETWORK_ERROR = "NETWORK_ERROR"

function blockingMessage(
  result: Extract<PlanActionResult, { success: false }>
): string | null {
  switch (result.code) {
    case "REVISION_CONFLICT":
      return CONFLICT_MESSAGE
    case "PLAN_NOT_EDITABLE":
      return NOT_EDITABLE_MESSAGE
    case "CONCURRENT_CHANGE":
      return CONCURRENT_MESSAGE
    case NETWORK_ERROR:
      return NETWORK_MESSAGE
    default:
      return null
  }
}

export function usePlanAutosave({
  initialRevision,
  onApplied,
}: {
  initialRevision: number
  /** Se invoca tras cada mutación exitosa con el estado que devolvió el servidor. */
  onApplied: (state: PlanSyncState) => void
}): PlanAutosave {
  const [savingCount, setSavingCount] = useState(0)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const revisionRef = useRef(initialRevision)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const blockedRef = useRef<string | null>(null)
  // onApplied suele ser una arrow inline del componente; se guarda en un ref
  // para que enqueue no cambie de identidad en cada render. La sincronización va
  // en un efecto porque escribir refs durante el render rompe con StrictMode y
  // con el renderizado concurrente.
  const onAppliedRef = useRef(onApplied)
  useEffect(() => {
    onAppliedRef.current = onApplied
  })

  const block = useCallback((message: string) => {
    blockedRef.current = message
    setBlockedMessage(message)
  }, [])

  const applyFailure = useCallback(
    (result: Extract<PlanActionResult, { success: false }>) => {
      const blocking = blockingMessage(result)
      if (blocking) {
        block(blocking)
        toast.error(blocking)
        return
      }
      toast.error(result.error)
    },
    [block]
  )

  const enqueue = useCallback(
    (work: (expectedRevision: number) => Promise<PlanActionResult>) => {
      let resolveResult: (value: PlanActionResult) => void = () => undefined
      const resultPromise = new Promise<PlanActionResult>((resolve) => {
        resolveResult = resolve
      })
      setSavingCount((count) => count + 1)
      queueRef.current = queueRef.current
        .then(async () => {
          if (blockedRef.current) {
            const result: PlanActionResult = {
              success: false,
              code: "REVISION_CONFLICT",
              error: blockedRef.current,
            }
            resolveResult(result)
            return
          }
          const result = await work(revisionRef.current)
          if (result.success) {
            revisionRef.current = result.revision
            onAppliedRef.current({
              planId: result.planId,
              revision: result.revision,
              status: result.status,
            })
          } else {
            applyFailure(result)
          }
          resolveResult(result)
        })
        .catch((error: unknown) => {
          // El mensaje de la excepción puede venir en inglés o ser técnico
          // («Failed to fetch»): nunca se muestra tal cual.
          console.error("Autoguardado de la planilla:", error)
          const result: PlanActionResult = {
            success: false,
            code: NETWORK_ERROR,
            error: NETWORK_MESSAGE,
          }
          applyFailure(result)
          resolveResult(result)
        })
        .finally(() => setSavingCount((count) => Math.max(0, count - 1)))
      return resultPromise
    },
    [applyFailure]
  )

  const awaitSaved = useCallback(async () => {
    await queueRef.current
    if (blockedRef.current) throw new Error(blockedRef.current)
  }, [])

  const currentRevision = useCallback(() => revisionRef.current, [])

  return {
    savingCount,
    blockedMessage,
    currentRevision,
    enqueue,
    awaitSaved,
    block,
    fail: applyFailure,
  }
}
