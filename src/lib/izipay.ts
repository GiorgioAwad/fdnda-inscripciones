import crypto from "crypto"

// Adaptado del ticketing FDNDA (flujo Web Core en producción). Se recortó el
// flujo embebido legacy y la API de consultas; queda: creación de sesión,
// verificación de firmas y parseo de respuestas.

const IZIPAY_API_KEY = process.env.IZIPAY_API_KEY || ""
const IZIPAY_HASH_KEY = process.env.IZIPAY_HASH_KEY || ""
const IZIPAY_PUBLIC_KEY =
  process.env.IZIPAY_PUBLIC_KEY || process.env.NEXT_PUBLIC_IZIPAY_PUBLIC_KEY || ""
const IZIPAY_ENDPOINT = process.env.IZIPAY_ENDPOINT || "https://sandbox-api-pw.izipay.pe"
const IZIPAY_CHECKOUT_SCRIPT_URL =
  process.env.IZIPAY_CHECKOUT_SCRIPT_URL ||
  (IZIPAY_ENDPOINT.includes("sandbox")
    ? "https://sandbox-checkout.izipay.pe/payments/v1/js/index.js"
    : "https://checkout.izipay.pe/payments/v1/js/index.js")

export function getPaymentsMode(): "mock" | "izipay" {
  const configured = process.env.PAYMENTS_MODE
  if (configured === "izipay") return "izipay"
  if (configured === "mock" && process.env.NODE_ENV !== "production") return "mock"
  if (process.env.NODE_ENV === "test" && !configured) return "mock"
  throw new Error(
    "PAYMENTS_MODE inválido. Usa izipay en producción o mock solo en desarrollo/pruebas."
  )
}

export interface IzipayWebCoreCheckoutConfig {
  action: "pay"
  merchantCode: string
  transactionId: string
  order: {
    orderNumber: string
    currency: string
    amount: string
    processType: "AT"
    merchantBuyerId: string
    dateTimeTransaction: string
  }
  billing: IzipayBillingInfo
  shipping: IzipayBillingInfo
  render?: {
    typeForm: "pop-up" | "redirect"
    redirectUrls?: {
      onSuccess: string
      onError: string
      onCancel: string
    }
  }
  urlIPN?: string
}

export interface IzipayBillingInfo {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  street: string
  city: string
  state: string
  country: string
  postalCode: string
  documentType: string
  document: string
}

export interface IzipayWebCorePaymentResponse {
  code?: string
  message?: string
  messageUser?: string
  payloadHttp?: string
  signature?: string
  transactionId?: string
  response?: {
    payMethod?: string
    order?: Array<{
      orderNumber?: string
      amount?: string
      currency?: string
      stateMessage?: string
      referenceNumber?: string
      codeAuth?: string
    }>
  }
}

export interface ParsedIzipayPaymentResult {
  code: string
  message?: string
  messageUser?: string
  payloadHttp: string
  signature?: string
  transactionId?: string
  orderNumber?: string
  amount?: number
  currency?: string
  payMethod?: string
  raw: IzipayWebCorePaymentResponse
  payload: IzipayWebCorePaymentResponse
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return crypto.timingSafeEqual(aBuffer, bBuffer)
}

function generateIzipayBase64Signature(payload: string): string {
  return crypto
    .createHmac("sha256", Buffer.from(IZIPAY_HASH_KEY, "utf-8"))
    .update(Buffer.from(payload, "utf-8"))
    .digest("base64")
}

export function isIzipayCommunicationError(code?: string): boolean {
  return code === "021" || code === "COMMUNICATION_ERROR"
}

export function resolveIzipayPublicKey(): string {
  return IZIPAY_PUBLIC_KEY
}

export function getIzipayCheckoutScriptUrl(): string {
  return IZIPAY_CHECKOUT_SCRIPT_URL
}

export function formatIzipayDateTime(date = new Date()): string {
  // Izipay pide epoch en microsegundos.
  return String(Math.floor(date.getTime()) * 1000)
}

// orderNumber Web Core: 5-15 caracteres alfanuméricos derivados del id interno.
export function buildIzipayOrderNumber(orderId: string): string {
  const normalized = orderId.replace(/[^a-zA-Z0-9]/g, "")
  const candidate = normalized.slice(-15)
  return candidate.length >= 5 ? candidate : normalized.padStart(5, "0").slice(-5)
}

export function verifyIzipayWebCoreSignature(
  paymentResponse: Pick<IzipayWebCorePaymentResponse, "code" | "payloadHttp" | "signature">
): boolean {
  if (!paymentResponse.payloadHttp || !paymentResponse.signature || !IZIPAY_HASH_KEY) {
    return false
  }
  const expectedSignature = generateIzipayBase64Signature(paymentResponse.payloadHttp)
  return timingSafeEqualString(paymentResponse.signature, expectedSignature)
}

// Solo conserva los campos necesarios para soporte y conciliación. Nunca se
// persiste el payload completo, que podría incorporar datos del comprador.
export function sanitizeIzipayPaymentResult(result: ParsedIzipayPaymentResult) {
  return {
    code: result.code,
    message: result.message?.slice(0, 300),
    messageUser: result.messageUser?.slice(0, 300),
    transactionId: result.transactionId,
    orderNumber: result.orderNumber,
    amount: result.amount,
    currency: result.currency,
    payMethod: result.payMethod,
  }
}

export function parseIzipayPaymentResponse(
  value: IzipayWebCorePaymentResponse | Record<string, unknown> | string
): ParsedIzipayPaymentResult | null {
  try {
    const raw =
      typeof value === "string"
        ? (JSON.parse(value) as IzipayWebCorePaymentResponse)
        : (value as IzipayWebCorePaymentResponse)

    const payload =
      raw.payloadHttp && raw.payloadHttp.trim()
        ? (JSON.parse(raw.payloadHttp) as IzipayWebCorePaymentResponse)
        : raw

    const firstOrder = payload.response?.order?.[0]

    return {
      code: payload.code || raw.code || "",
      message: payload.message || raw.message,
      messageUser: payload.messageUser || raw.messageUser,
      payloadHttp:
        raw.payloadHttp && raw.payloadHttp.trim()
          ? raw.payloadHttp
          : JSON.stringify(payload),
      signature: raw.signature,
      transactionId: raw.transactionId || payload.transactionId,
      orderNumber: firstOrder?.orderNumber,
      amount: Number(firstOrder?.amount || 0),
      currency: firstOrder?.currency || "PEN",
      payMethod: payload.response?.payMethod,
      raw,
      payload,
    }
  } catch {
    return null
  }
}

// En notificación (IPN) y redirect, code "00" SÍ significa pago aprobado.
// (En la API de consultas no; esa API no se usa en este proyecto.)
export function isIzipayPaymentApproved(result: { code?: string }): boolean {
  return result.code === "00"
}

export interface IzipaySessionResponse {
  success: boolean
  sessionToken?: string
  raw?: unknown
  error?: string
}

export async function createIzipaySession(
  config: IzipayWebCoreCheckoutConfig
): Promise<IzipaySessionResponse> {
  // Timeout: un endpoint degradado de Izipay no debe colgar al comprador.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(`${IZIPAY_ENDPOINT}/security/v1/Token/Generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        transactionId: config.transactionId,
      },
      signal: controller.signal,
      body: JSON.stringify({
        requestSource: "ECOMMERCE",
        publicKey: IZIPAY_API_KEY,
        action: config.action,
        merchantCode: config.merchantCode,
        transactionId: config.transactionId,
        orderNumber: config.order.orderNumber,
        currency: config.order.currency,
        amount: config.order.amount,
        processType: config.order.processType,
        merchantBuyerId: config.order.merchantBuyerId,
        dateTimeTransaction: config.order.dateTimeTransaction,
        billing: config.billing,
        shipping: config.shipping,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      console.error("IZIPAY Token/Generate error", {
        status: response.status,
        transactionId: config.transactionId,
        orderNumber: config.order.orderNumber,
        body: errorText.slice(0, 2000),
      })
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
      }
    }

    const data = (await response.json()) as Record<string, unknown>
    const responseData = (data.response as Record<string, unknown> | undefined) || undefined
    const sessionToken =
      (data.sessionToken as string | undefined) ||
      (responseData?.token as string | undefined) ||
      (data.token as string | undefined)

    return { success: true, sessionToken, raw: data }
  } catch (error) {
    console.error("IZIPAY session creation error:", error)
    return {
      success: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Izipay no respondió a tiempo (timeout de 15s)"
          : (error as Error).message,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
