import type { Instrumentation } from "next"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionConfiguration } = await import("@/lib/env")
    assertProductionConfiguration()
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

