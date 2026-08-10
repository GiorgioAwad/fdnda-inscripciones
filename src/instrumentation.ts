import type { Instrumentation } from "next"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionConfiguration, getDeploymentTier, describeDatabaseTarget } =
      await import("@/lib/env")
    assertProductionConfiguration()

    // Primera línea de log de cada instancia. Deja a la vista el nivel del
    // despliegue junto a la base que va a usar: un staging con pagos de prueba
    // apuntando por error a la base real se detecta aquí y no tras el incidente.
    console.log(
      JSON.stringify({
        level: "info",
        type: "deployment_started",
        tier: getDeploymentTier(),
        paymentsMode: process.env.PAYMENTS_MODE,
        database: describeDatabaseTarget(),
        startedAt: new Date().toISOString(),
      })
    )
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const message = error instanceof Error ? error.message : String(error)
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined
  const event = {
    level: "error",
    type: "request_error",
    message,
    digest,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    occurredAt: new Date().toISOString(),
  }

  console.error(JSON.stringify(event))

  const reportingUrl = process.env.ERROR_REPORTING_WEBHOOK_URL
  if (reportingUrl) {
    try {
      await fetch(reportingUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (reportingError) {
      console.error("No se pudo enviar el error al servicio de observabilidad", {
        error:
          reportingError instanceof Error
            ? reportingError.message
            : String(reportingError),
      })
    }
  }
}

