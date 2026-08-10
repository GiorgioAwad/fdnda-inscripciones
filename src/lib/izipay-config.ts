import {
  buildIzipayOrderNumber,
  formatIzipayDateTime,
  type IzipayWebCoreCheckoutConfig,
} from "./izipay"

// Restricciones oficiales Web Core (developers.izipay.pe/web-core/modalidades/parameters):
// street 5-40, city/state 3-25, firstName/lastName 2-50, email <=50, phone 7-15,
// postalCode 5-10, documentType DNI|CE|PASAPORTE|RUC|OTROS con longitud por tipo.
// Violar una regla = rechazo silencioso de la pasarela ANTES de abrir el checkout.
const IZIPAY_FALLBACK_STREET = "Lima Peru"
const IZIPAY_FALLBACK_EMAIL = process.env.IZIPAY_FALLBACK_EMAIL || "pagos@fdnda.pe"
const IZIPAY_EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export function normalizeIzipayName(value: string, maxLength: number) {
  const normalized = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalized.slice(0, maxLength).trim()
}

export function normalizeIzipayPhone(value: string | null | undefined) {
  const digits = (value || "").replace(/\D/g, "").slice(0, 15)
  return digits.length >= 7 ? digits : "999999999"
}

export function normalizeIzipayEmail(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const email = (candidate || "").trim()
    if (email.length >= 5 && email.length <= 50 && IZIPAY_EMAIL_REGEX.test(email)) {
      return email
    }
  }
  return IZIPAY_FALLBACK_EMAIL
}

// DNI = 8 dígitos, CE 9-12, PASAPORTE 8-12 alfanumérico, OTROS 8-12.
export function resolveIzipayDocument(rawValue: string | null | undefined): {
  documentType: string
  document: string
} {
  const document = (rawValue || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)
  const digitsOnly = /^\d+$/.test(document)

  if (digitsOnly && document.length === 8) return { documentType: "DNI", document }
  if (digitsOnly && document.length === 11) return { documentType: "RUC", document }
  if (digitsOnly && document.length >= 9 && document.length <= 12) {
    return { documentType: "CE", document }
  }
  if (document.length >= 8 && document.length <= 12) {
    return { documentType: "PASAPORTE", document }
  }
  if (document.length > 0 && document.length < 8 && digitsOnly) {
    return { documentType: "OTROS", document: document.padStart(8, "0") }
  }
  return { documentType: "OTROS", document: "00000000" }
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = normalizeIzipayName(fullName, 80)
  if (cleaned.length < 2) {
    return { firstName: "Club", lastName: "FDNDA" }
  }
  const [firstName, ...rest] = cleaned.split(" ")
  const lastName = (rest.join(" ") || firstName).slice(0, 50)
  return {
    firstName: firstName.length >= 2 ? firstName.slice(0, 50) : "Club",
    lastName: lastName.length >= 2 ? lastName : "FDNDA",
  }
}

export interface IzipayOrderForCheckout {
  id: string
  currency: string
  totalAmount: unknown
  club: {
    name: string
    contactName: string | null
    contactPhone: string | null
    contactEmail: string | null
  }
  user: {
    id: string
    name: string
    email: string | null
  }
}

export function buildCheckoutConfig(input: {
  order: IzipayOrderForCheckout
  merchantCode: string
  transactionId: string
  appUrl: string
}): IzipayWebCoreCheckoutConfig {
  const { order } = input
  const buyerName = order.club.contactName || order.user.name || order.club.name
  const { firstName, lastName } = splitName(buyerName)
  const email = normalizeIzipayEmail(order.club.contactEmail, order.user.email)
  const phoneNumber = normalizeIzipayPhone(order.club.contactPhone)
  const { documentType, document } = resolveIzipayDocument(null)
  const amount = Number(order.totalAmount).toFixed(2)

  const billing = {
    firstName,
    lastName,
    email,
    phoneNumber,
    street: IZIPAY_FALLBACK_STREET,
    city: "Lima",
    state: "Lima",
    country: "PE",
    postalCode: "15001",
    documentType,
    document,
  }

  const redirectResultUrl = `${input.appUrl}/api/payments/izipay/redirect-result?orderId=${encodeURIComponent(order.id)}`

  return {
    action: "pay",
    merchantCode: input.merchantCode,
    transactionId: input.transactionId,
    order: {
      orderNumber: buildIzipayOrderNumber(order.id),
      currency: order.currency,
      amount,
      processType: "AT",
      // merchantBuyerId exige 6-100 caracteres.
      merchantBuyerId: order.user.id.padEnd(6, "0").slice(0, 100),
      dateTimeTransaction: formatIzipayDateTime(),
    },
    billing,
    shipping: billing,
    render: {
      // pop-up: el SDK monta un iframe superpuesto y el club nunca sale del
      // portal. El resultado vuelve por callbackResponse -> /validate, no por
      // un POST a redirectUrls; estas se mantienen porque Izipay las sigue
      // usando si decide degradar a redirect.
      typeForm: "pop-up",
      redirectUrls: {
        onSuccess: redirectResultUrl,
        onError: redirectResultUrl,
        onCancel: redirectResultUrl,
      },
    },
    urlIPN: `${input.appUrl}/api/payments/izipay/webhook`,
  }
}

// Chequeo defensivo contra la tabla oficial Web Core. Solo loguea; la
// normalización ya debería garantizar cumplimiento.
export function findIzipayConfigViolations(config: IzipayWebCoreCheckoutConfig): string[] {
  const violations: string[] = []
  const check = (field: string, value: string, min: number, max: number) => {
    if (value.length < min || value.length > max) {
      violations.push(`${field}="${value}" (longitud ${value.length}, esperado ${min}-${max})`)
    }
  }

  check("transactionId", config.transactionId, 5, 40)
  check("merchantCode", config.merchantCode, 7, 15)
  check("order.orderNumber", config.order.orderNumber, 5, 15)
  check("order.amount", config.order.amount, 4, 13)
  if (!/^\d+\.\d{2}$/.test(config.order.amount)) {
    violations.push(`order.amount="${config.order.amount}" (formato esperado NN.NN)`)
  }
  check("order.merchantBuyerId", config.order.merchantBuyerId, 6, 100)

  const billing = config.billing
  check("billing.firstName", billing.firstName, 2, 50)
  check("billing.lastName", billing.lastName, 2, 50)
  check("billing.email", billing.email, 5, 50)
  check("billing.phoneNumber", billing.phoneNumber, 7, 15)
  check("billing.street", billing.street, 5, 40)
  check("billing.city", billing.city, 3, 25)
  check("billing.state", billing.state, 3, 25)
  check("billing.postalCode", billing.postalCode, 5, 10)

  const documentRules: Record<string, [number, number]> = {
    DNI: [8, 8],
    RUC: [11, 11],
    CE: [9, 12],
    PASAPORTE: [8, 12],
    OTROS: [8, 12],
  }
  const documentRule = documentRules[billing.documentType]
  if (!documentRule) {
    violations.push(`billing.documentType="${billing.documentType}" no permitido`)
  } else {
    check("billing.document", billing.document, documentRule[0], documentRule[1])
  }

  return violations
}
