import { NextResponse } from "next/server"
import { getIzipayCheckoutScriptUrl, getPaymentsMode } from "@/lib/izipay"

export const runtime = "nodejs"

// Proxy first-party del SDK de Izipay. Los bloqueadores de anuncios bloquean
// checkout.izipay.pe por dominio: el <script> nunca carga, window.Izipay no
// existe y el comprador se queda en el spinner sin explicación. Servido desde
// nuestro propio origen, pasa. El cliente lo intenta primero y cae al CDN si
// esta ruta falla (lección del ticketing).

const SDK_FETCH_TIMEOUT_MS = 10_000
const MAX_SDK_SIZE_BYTES = 512_000

export async function GET() {
  if (getPaymentsMode() !== "izipay") {
    return new NextResponse("Not found", { status: 404 })
  }

  const upstreamUrl = getIzipayCheckoutScriptUrl()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SDK_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(upstreamUrl, {
      headers: { Accept: "application/javascript,text/javascript,*/*;q=0.1" },
      next: { revalidate: 3600 },
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error("[checkout/runtime] upstream no OK", {
        upstreamUrl,
        status: response.status,
      })
      return new NextResponse("Upstream IZIPAY SDK error", { status: 502 })
    }

    const source = await response.text()

    // Un proxy que devuelve una página de error como si fuera JavaScript deja al
    // navegador con un SyntaxError críptico; preferimos fallar aquí y que el
    // cliente use el CDN.
    if (
      source.length === 0 ||
      source.length > MAX_SDK_SIZE_BYTES ||
      !source.includes("Izipay")
    ) {
      console.error("[checkout/runtime] respuesta upstream inválida", {
        upstreamUrl,
        length: source.length,
      })
      return new NextResponse("Invalid IZIPAY SDK response", { status: 502 })
    }

    return new NextResponse(source, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("[checkout/runtime] error al obtener el SDK", {
      upstreamUrl,
      error: (error as Error).message,
    })
    return new NextResponse("IZIPAY SDK unavailable", { status: 502 })
  } finally {
    clearTimeout(timeoutId)
  }
}
