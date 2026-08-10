import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getPaymentsMode,
  sanitizeIzipayPaymentResult,
  verifyIzipayWebCoreSignature,
} from "./izipay"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("configuración segura de pagos", () => {
  it("rechaza mock en producción", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PAYMENTS_MODE", "mock")
    expect(() => getPaymentsMode()).toThrow(/PAYMENTS_MODE inválido/)
  })

  it("rechaza una configuración ausente en producción", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PAYMENTS_MODE", "")
    expect(() => getPaymentsMode()).toThrow(/PAYMENTS_MODE inválido/)
  })

  it("permite mock únicamente fuera de producción", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("PAYMENTS_MODE", "mock")
    expect(getPaymentsMode()).toBe("mock")
  })
})

describe("callbacks Izipay", () => {
  it("nunca considera válida una respuesta sin firma", () => {
    expect(
      verifyIzipayWebCoreSignature({
        code: "00",
        payloadHttp: JSON.stringify({ code: "00" }),
        signature: "",
      })
    ).toBe(false)
  })

  it("tampoco omite firma en errores de comunicación", () => {
    expect(
      verifyIzipayWebCoreSignature({
        code: "021",
        payloadHttp: "",
        signature: "",
      })
    ).toBe(false)
  })

  it("minimiza lo que se persiste de la pasarela", () => {
    const sanitized = sanitizeIzipayPaymentResult({
      code: "00",
      payloadHttp: "sensitive-signed-payload",
      transactionId: "tx-1",
      orderNumber: "order-1",
      amount: 10,
      currency: "PEN",
      raw: { code: "00" },
      payload: { code: "00", response: { order: [{ orderNumber: "order-1" }] } },
    })
    expect(sanitized).not.toHaveProperty("payloadHttp")
    expect(sanitized).not.toHaveProperty("raw")
    expect(sanitized).not.toHaveProperty("payload")
  })
})

