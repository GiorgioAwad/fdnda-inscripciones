import { describe, expect, it } from "vitest"
import {
  parseRegistrationItemSnapshot,
  registrationOrderItemView,
  type RegistrationItemSnapshot,
} from "./registration-snapshots"

const snapshot: RegistrationItemSnapshot = {
  version: 1,
  capturedAt: "2026-08-03T18:00:00.000Z",
  plan: { id: "plan-1", revision: 7 },
  club: { id: "club-1", name: "Club histórico", code: "HIS" },
  event: {
    id: "event-1",
    name: "Nacional 2026",
    slug: "nacional-2026",
    venue: "VIDENA",
    city: "Lima",
    startDate: "2026-08-20T00:00:00.000Z",
    endDate: "2026-08-22T00:00:00.000Z",
    registrationDeadline: "2026-08-10T23:59:59.000Z",
    season: { id: "season-1", year: 2026, name: "Temporada 2026" },
  },
  modality: {
    id: "modality-1",
    discipline: "ARTISTIC_SWIMMING",
    name: "Dueto libre",
    category: "Juvenil",
    sexRule: "FEMALE",
    birthYearFrom: 2010,
    birthYearTo: 2012,
    allowsCategoryUpgrade: true,
    categoryUpgradeBirthYear: 2013,
    minAthletes: 2,
    maxAthletes: 2,
    price: "150.00",
    capacity: 20,
  },
  registration: {
    id: "registration-1",
    athletes: [
      {
        id: "athlete-1",
        firstNames: "Ana",
        lastNames: "Pérez",
        docType: "DNI",
        docNumber: "70000001",
        birthDate: "2012-05-10T00:00:00.000Z",
        sex: "F",
        disciplines: ["ARTISTIC_SWIMMING"],
        isReserve: false,
      },
      {
        id: "athlete-2",
        firstNames: "Beatriz",
        lastNames: "Soto",
        docType: "DNI",
        docNumber: "70000002",
        birthDate: "2013-02-01T00:00:00.000Z",
        sex: "F",
        disciplines: ["ARTISTIC_SWIMMING"],
        isReserve: true,
      },
    ],
  },
}

describe("snapshot de inscripción", () => {
  it("describe la inscripción desde el snapshot, no desde la descripción viva", () => {
    const view = registrationOrderItemView({
      description: "Nombre modificado",
      unitPrice: "150.00",
      registrationSnapshot: snapshot,
    })

    expect(view.description).toContain("Nacional 2026")
    expect(view.description).toContain("Ana Pérez")
    expect(view.description).toContain("Beatriz Soto (reserva)")
    expect(view.description).not.toContain("Nombre modificado")
  })

  // El snapshot es la verdad sobre QUÉ se compró; el OrderItem lo es sobre
  // CUÁNTO se cobró, porque es lo que suma order.totalAmount. Mientras el precio
  // sea por formación ambos coinciden, pero cuando la disciplina cobra una cuota
  // fija por deportista la formación queda en 0 y la prueba conserva su precio
  // de lista: leer modality.price ahí duplicaría la recaudación.
  it("toma el importe del ítem de la orden, que es lo que suma el total", () => {
    const view = registrationOrderItemView({
      description: "Clavados — Trampolín 3m (incluida en la cuota por deportista)",
      unitPrice: "0.00",
      registrationSnapshot: snapshot,
    })

    expect(view.unitPrice).toBe(0)
    expect(view.snapshot?.modality.price).toBe("150.00")
  })

  it("usa el fallback legado si no existe un snapshot válido", () => {
    expect(
      registrationOrderItemView({
        description: "Ítem legado",
        unitPrice: "80.00",
        registrationSnapshot: { version: 99 },
      })
    ).toEqual({
      description: "Ítem legado",
      unitPrice: 80,
      snapshot: null,
    })
  })

  it("rechaza snapshots incompletos", () => {
    expect(
      parseRegistrationItemSnapshot({ ...snapshot, registration: { athletes: [] } })
    ).toBeNull()
  })

  it("rechaza campos nullable ausentes en vez de aceptarlos como undefined", () => {
    const eventWithoutVenue = { ...snapshot.event } as Record<string, unknown>
    delete eventWithoutVenue.venue

    expect(
      parseRegistrationItemSnapshot({ ...snapshot, event: eventWithoutVenue })
    ).toBeNull()
  })

  it.each([
    {
      label: "precio no numérico",
      value: {
        ...snapshot,
        modality: { ...snapshot.modality, price: "no-es-un-monto" },
      },
    },
    {
      label: "fecha inválida",
      value: {
        ...snapshot,
        event: { ...snapshot.event, startDate: "fecha-inválida" },
      },
    },
    {
      label: "disciplina de deportista no textual",
      value: {
        ...snapshot,
        registration: {
          ...snapshot.registration,
          athletes: [
            {
              ...snapshot.registration.athletes[0],
              disciplines: [42],
            },
          ],
        },
      },
    },
  ])("rechaza $label", ({ value }) => {
    expect(parseRegistrationItemSnapshot(value)).toBeNull()
  })
})
