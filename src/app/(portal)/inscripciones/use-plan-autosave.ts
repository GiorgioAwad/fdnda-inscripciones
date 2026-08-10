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
  /** Aplica el mismo bloqueo + aviso que una mutación fallida de la cola. */
  fail: (result: Extract<PlanActionResult, { success: false }>) => void
}

const CONFLICT_MESSAGE =
  "Esta planilla cambió en otra pestaña. Recárgala para continuar sin perder cambios."

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
      const message =
        result.code === "REVISION_CONFLICT" ? CONFLICT_MESSAGE : result.error
      block(message)
      toast.error(message)
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
          const result: PlanActionResult = {
            success: false,
            code: "UNEXPECTED_ERROR",
            error:
              error instanceof Error
                ? error.message
                : "No se pudo guardar el cambio.",
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
