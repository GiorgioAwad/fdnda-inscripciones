import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/prisma"
import { deleteEventOfficial, saveEventOfficial } from "@/lib/event-officials"
import { validateRegistrationPlan } from "@/lib/plan-validation"
import {
  createOrResumeRegistrationPlan,
  selectRegistrationPlanEvent,
  toggleRegistrationPlanIndividualEntry,
} from "@/lib/registration-plans"

// Delegados y entrenadores: topes por disciplina, cierre de inscripciones,
// una persona por disciplina y el delegado obligatorio que bloquea el pago.

let eventId = ""
let closedEventId = ""
let clubId = ""
let otherClubId = ""
let planId = ""

const person = (docNumber: string, lastNames = "Prueba") => ({
  firstNames: "Ana",
  lastNames,
  docType: "DNI" as const,
  docNumber,
})

beforeAll(async () => {
  // Inscribir exige afiliación en la temporada vigente.
  await prisma.season.updateMany({
    where: { isCurrent: true },
    data: { isCurrent: false },
  })
  const season = await prisma.season.create({
    data: {
      year: 2032,
      name: "Temporada 2032",
      startDate: new Date("2032-01-01T00:00:00.000Z"),
      endDate: new Date("2032-12-31T00:00:00.000Z"),
      isCurrent: true,
    },
  })
  const event = await prisma.event.create({
    data: {
      seasonId: season.id,
      name: "Copa de delegados",
      slug: "copa-delegados",
      disciplines: ["DIVING"],
      startDate: new Date("2032-06-10T00:00:00.000Z"),
      endDate: new Date("2032-06-12T00:00:00.000Z"),
      registrationDeadline: new Date("2032-06-01T23:59:00.000Z"),
      status: "OPEN",
      disciplineConfigs: {
        create: [
          { discipline: "DIVING", maxDelegates: 1, maxCoaches: 2, requiresDelegate: true },
        ],
      },
    },
  })
  eventId = event.id
  const modality = await prisma.eventModality.create({
    data: {
      eventId,
      discipline: "DIVING",
      name: "Plataforma 5 m",
      sexRule: "ANY",
      minAthletes: 1,
      maxAthletes: 1,
      price: 50,
    },
  })
  const closed = await prisma.event.create({
    data: {
      seasonId: season.id,
      name: "Copa cerrada",
      slug: "copa-cerrada-delegados",
      disciplines: ["DIVING"],
      startDate: new Date("2032-07-10T00:00:00.000Z"),
      endDate: new Date("2032-07-12T00:00:00.000Z"),
      registrationDeadline: new Date("2032-07-01T23:59:00.000Z"),
      status: "CLOSED",
    },
  })
  closedEventId = closed.id

  const club = await prisma.club.create({ data: { name: "Club Delegados", code: "C-DEL" } })
  clubId = club.id
  const other = await prisma.club.create({ data: { name: "Club Vecino", code: "C-VEC" } })
  otherClubId = other.id
  const user = await prisma.user.create({
    data: {
      username: "delegado-oficiales",
      name: "Delegado oficiales",
      passwordHash: "integration-test-only",
      role: "CLUB",
      clubId,
    },
  })
  const athlete = await prisma.athlete.create({
    data: {
      firstNames: "Lucía",
      lastNames: "Oficiales",
      docNumber: "DOC-OFICIALES",
      birthDate: new Date("2012-04-02T00:00:00.000Z"),
      sex: "F",
      clubId,
      disciplines: ["DIVING"],
    },
  })
  await prisma.clubAffiliation.create({
    data: {
      clubId,
      seasonId: season.id,
      discipline: "DIVING",
      status: "ACTIVE",
      fee: 100,
      validFrom: season.startDate,
      validTo: season.endDate,
    },
  })
  await prisma.athleteAffiliation.create({
    data: {
      athleteId: athlete.id,
      clubId,
      seasonId: season.id,
      discipline: "DIVING",
      status: "ACTIVE",
      fee: 20,
      validFrom: season.startDate,
      validTo: season.endDate,
    },
  })

  const created = await createOrResumeRegistrationPlan({ clubId, createdById: user.id })
  if (!created.success) throw new Error(created.error)
  const selected = await selectRegistrationPlanEvent({
    planId: created.planId,
    clubId,
    eventId,
    expectedRevision: created.revision,
  })
  if (!selected.success) throw new Error(selected.error)
  const entry = await toggleRegistrationPlanIndividualEntry({
    planId: selected.planId,
    clubId,
    expectedRevision: selected.revision,
    athleteId: athlete.id,
    modalityId: modality.id,
    selected: true,
  })
  if (!entry.success) throw new Error(entry.error)
  planId = entry.planId
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe("delegados y entrenadores de una competencia", () => {
  it("bloquea el pago hasta nombrar al delegado obligatorio", async () => {
    const before = await validateRegistrationPlan({ planId, clubId, mode: "REVIEW" })
    expect(before.valid).toBe(false)
    expect(before.issues.map((row) => row.code)).toContain("DELEGATE_REQUIRED")

    const saved = await saveEventOfficial({
      eventId,
      clubId,
      discipline: "DIVING",
      role: "DELEGATE",
      person: person(" 12345678 "),
    })
    expect(saved).toMatchObject({ success: true, official: { docNumber: "12345678" } })

    const after = await validateRegistrationPlan({ planId, clubId, mode: "REVIEW" })
    expect(after.issues.map((row) => row.code)).not.toContain("DELEGATE_REQUIRED")
    expect(after.valid).toBe(true)
  })

  it("respeta el tope por rol y no repite a una persona en la disciplina", async () => {
    const secondDelegate = await saveEventOfficial({
      eventId,
      clubId,
      discipline: "DIVING",
      role: "DELEGATE",
      person: person("87654321"),
    })
    expect(secondDelegate).toMatchObject({ success: false })

    const sameAsDelegate = await saveEventOfficial({
      eventId,
      clubId,
      discipline: "DIVING",
      role: "COACH",
      person: person("12345678"),
    })
    expect(sameAsDelegate).toMatchObject({
      success: false,
      error: expect.stringMatching(/ya está nombrada/),
    })

    for (const doc of ["11111111", "22222222"]) {
      const coach = await saveEventOfficial({
        eventId,
        clubId,
        discipline: "DIVING",
        role: "COACH",
        person: person(doc),
      })
      expect(coach.success).toBe(true)
    }
    const thirdCoach = await saveEventOfficial({
      eventId,
      clubId,
      discipline: "DIVING",
      role: "COACH",
      person: person("33333333"),
    })
    expect(thirdCoach).toMatchObject({ success: false })

    // Otro club tiene su propio cupo y puede nombrar a la misma persona.
    const otherClub = await saveEventOfficial({
      eventId,
      clubId: otherClubId,
      discipline: "DIVING",
      role: "COACH",
      person: person("11111111"),
    })
    expect(otherClub.success).toBe(true)
  })

  it("corrige y quita solo lo propio, y no toca nada con inscripciones cerradas", async () => {
    const coach = await prisma.eventOfficial.findFirstOrThrow({
      where: { eventId, clubId, role: "COACH", docNumber: "11111111" },
    })
    const corrected = await saveEventOfficial({
      eventId,
      clubId,
      discipline: "DIVING",
      role: "COACH",
      officialId: coach.id,
      person: person("44444444", "Corregida"),
    })
    expect(corrected).toMatchObject({
      success: true,
      official: { id: coach.id, lastNames: "Corregida", docNumber: "44444444" },
    })

    // Otro club no puede borrar a la gente de este.
    await deleteEventOfficial({
      eventId,
      clubId: otherClubId,
      discipline: "DIVING",
      officialId: coach.id,
    })
    expect(await prisma.eventOfficial.count({ where: { id: coach.id } })).toBe(1)

    expect(
      await deleteEventOfficial({ eventId, clubId, discipline: "DIVING", officialId: coach.id })
    ).toEqual({ success: true })
    expect(await prisma.eventOfficial.count({ where: { id: coach.id } })).toBe(0)

    const closed = await saveEventOfficial({
      eventId: closedEventId,
      clubId,
      discipline: "DIVING",
      role: "DELEGATE",
      person: person("55555555"),
    })
    expect(closed).toMatchObject({
      success: false,
      error: expect.stringMatching(/ya cerraron/),
    })
  })
})
