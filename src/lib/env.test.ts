import { afterEach, describe, expect, it, vi } from "vitest"
import { assertProductionConfiguration } from "./env"

function stubValidProductionEnvironment() {
  const values = {
    DATABASE_URL:
      "postgresql://app:secret@project-pooler.us-east-1.aws.neon.tech/app?sslmode=require",
    DIRECT_DATABASE_URL:
      "postgresql://migrate:secret@project.us-east-1.aws.neon.tech/app?sslmode=require",
    AUTH_SECRET: "a".repeat(40),
    AUTH_TRUST_HOST: "true",
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    PAYMENTS_MODE: "izipay",
    IZIPAY_MERCHANT_CODE: "merchant",
    IZIPAY_API_KEY: "api-key",
    IZIPAY_HASH_KEY: "hash-key",
    IZIPAY_PUBLIC_KEY: "public-key",
    IZIPAY_ENDPOINT: "https://api-pw.izipay.pe",
    NEXT_PUBLIC_APP_URL: "https://inscripcionesfdnda.pe",
    MAINTENANCE_SECRET: "m".repeat(40),
    IP_HASH_SECRET: "i".repeat(40),
    PRIVACY_CONTACT_EMAIL: "sportentries@fdnda.org",
    PERSONAL_DATA_BANK_REGISTRATION_CODE: "RNPDP-EXAMPLE",
  }
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("production configuration", () => {
  it("accepts a complete HTTPS, TLS and fail-closed setup", () => {
    stubValidProductionEnvironment()
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  it("accepts production without a bank registration code while it is pending", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("PERSONAL_DATA_BANK_REGISTRATION_CODE", "")
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  it("rejects sandbox payments and a non-canonical app URL", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("IZIPAY_ENDPOINT", "https://sandbox-api-pw.izipay.pe")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://inscripcionesfdnda.pe/portal?q=1")
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /no sandbox.*ruta, query ni fragmento/
    )
  })

  it("rejects an invalid Server Actions encryption key", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "too-short")
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /Base64 de 32 bytes/
    )
  })

  // El runtime nunca abre DIRECT_DATABASE_URL: solo la leen las migraciones. El
  // hosting web debe poder arrancar conociendo unicamente al rol de aplicacion.
  it("starts without the migration connection string", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("DIRECT_DATABASE_URL", "")
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  it("still validates DIRECT_DATABASE_URL when it is present", () => {
    stubValidProductionEnvironment()
    vi.stubEnv(
      "DIRECT_DATABASE_URL",
      "postgresql://migrate:secret@project.us-east-1.aws.neon.tech/app"
    )
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /DIRECT_DATABASE_URL debe exigir sslmode/
    )
  })

  it("accepts sslmode=verify-full", () => {
    stubValidProductionEnvironment()
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://app:secret@project-pooler.us-east-1.aws.neon.tech/app?sslmode=verify-full"
    )
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  it("rejects sandbox payments even if APP_ENV holds an unknown value", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("APP_ENV", "produccion")
    vi.stubEnv("IZIPAY_ENDPOINT", "https://sandbox-api-pw.izipay.pe")
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /no sandbox/
    )
  })

  it("rejects a connection string without TLS", () => {
    stubValidProductionEnvironment()
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://app:secret@project-pooler.us-east-1.aws.neon.tech/app?sslmode=prefer"
    )
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /DATABASE_URL debe exigir sslmode/
    )
  })
})

describe("staging tier", () => {
  it("accepts the Izipay sandbox", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("IZIPAY_ENDPOINT", "https://sandbox-api-pw.izipay.pe")
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  it("accepts simulated payments without Izipay credentials", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("PAYMENTS_MODE", "mock")
    for (const name of [
      "IZIPAY_MERCHANT_CODE",
      "IZIPAY_API_KEY",
      "IZIPAY_HASH_KEY",
      "IZIPAY_PUBLIC_KEY",
      "IZIPAY_ENDPOINT",
    ]) {
      vi.stubEnv(name, "")
    }
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  it("does not demand the personal data bank registration", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("PERSONAL_DATA_BANK_REGISTRATION_CODE", "")
    expect(() => assertProductionConfiguration({ force: true })).not.toThrow()
  })

  // Lo que se relaja son los requisitos del entorno real, no la seguridad del
  // transporte, la longitud de los secretos ni el aislamiento de la base.
  it("keeps every transport and secret guarantee", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@localhost:5432/app")
    vi.stubEnv("AUTH_SECRET", "corto")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://staging.fdnda.pe")
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /32 caracteres.*localhost.*sslmode.*dominio público HTTPS/
    )
  })

  it("rejects an unsupported payments mode", () => {
    stubValidProductionEnvironment()
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("PAYMENTS_MODE", "gratis")
    expect(() => assertProductionConfiguration({ force: true })).toThrow(
      /PAYMENTS_MODE debe ser izipay o mock/
    )
  })
})
