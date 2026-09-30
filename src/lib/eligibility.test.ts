import { describe, expect, it } from "vitest"
import {
  athleteEligibilityError,
  competesUpACategory,
  validateEntryComposition,
} from "./eligibility"

const athlete = {
  id: "athlete-1",
  firstNames: "Ana",
  lastNames: "Nadadora",
  birthDate: "2013-04-01T00:00:00.000Z",
  sex: "F" as const,
}

describe("elegibilidad deportiva", () => {
  it("incluye ambos extremos del rango de nacimiento", () => {
    const modality = {
      name: "Solo",
      sexRule: "FEMALE" as const,
      birthYearFrom: 2010,
      birthYearTo: 2013,
      minAthletes: 1,
      maxAthletes: 1,
    }
    expect(athleteEligibilityError(modality, athlete)).toBeNull()
    expect(
      athleteEligibilityError(modality, {
        ...athlete,
        birthDate: "2010-12-31T00:00:00.000Z",
      })
    ).toBeNull()
  })

  it("rechaza años por ambos lados del rango", () => {
    const modality = {
      name: "Solo",
      sexRule: "ANY" as const,
      birthYearFrom: 2010,
      birthYearTo: 2013,
      minAthletes: 1,
      maxAthletes: 1,
    }

    expect(
      athleteEligibilityError(modality, {
        ...athlete,
        birthDate: "2009-12-31T00:00:00.000Z",
      })
    ).toBe("Nació en 2009; esta prueba es para nacidos entre 2010 y 2013.")
    expect(
      athleteEligibilityError(modality, {
        ...athlete,
        birthDate: "2014-01-01T00:00:00.000Z",
      })
    ).toBe("Nació en 2014; esta prueba es para nacidos entre 2010 y 2013.")
  })

  it("aplica sexo femenino, masculino y libre", () => {
    const base = {
      name: "Prueba individual",
      birthYearFrom: null,
      birthYearTo: null,
      minAthletes: 1,
      maxAthletes: 1,
    }
    const male = { ...athlete, id: "athlete-2", sex: "M" as const }

    expect(
      athleteEligibilityError({ ...base, sexRule: "FEMALE" }, male)
    ).toBe("Esta prueba es solo para damas.")
    expect(
      athleteEligibilityError({ ...base, sexRule: "MALE" }, athlete)
    ).toBe("Esta prueba es solo para varones.")
    expect(athleteEligibilityError({ ...base, sexRule: "ANY" }, male)).toBeNull()
  })

  it("admite exactamente el año explícito de ascenso", () => {
    const modality = {
      name: "Solo Juvenil",
      sexRule: "FEMALE" as const,
      birthYearFrom: 2010,
      birthYearTo: 2012,
      upgradeYear: 2013,
      minAthletes: 1,
      maxAthletes: 1,
    }
    expect(competesUpACategory(modality, athlete)).toBe(true)
    expect(athleteEligibilityError(modality, athlete)).toBeNull()
    expect(
      athleteEligibilityError(modality, { ...athlete, birthDate: "2014-01-01" })
    ).not.toBeNull()
  })

  it("valida cantidad y composición mixta", () => {
    const modality = {
      name: "Dueto mixto",
      sexRule: "MIXED" as const,
      birthYearFrom: null,
      birthYearTo: null,
      minAthletes: 2,
      maxAthletes: 2,
    }
    expect(validateEntryComposition(modality, [athlete])).toEqual([
      "Esta prueba requiere 2 integrantes; marcaste 1.",
      "Una prueba mixta requiere al menos un varón y una dama.",
    ])
    expect(
      validateEntryComposition(modality, [
        athlete,
        { ...athlete, id: "athlete-2", firstNames: "Luis", sex: "M" },
      ])
    ).toEqual([])
  })

  it("valida por separado el mínimo y el máximo de integrantes", () => {
    const modality = {
      name: "Equipo",
      sexRule: "ANY" as const,
      birthYearFrom: null,
      birthYearTo: null,
      minAthletes: 2,
      maxAthletes: 3,
    }
    const athletes = [
      athlete,
      { ...athlete, id: "athlete-2" },
      { ...athlete, id: "athlete-3" },
      { ...athlete, id: "athlete-4" },
    ]

    expect(validateEntryComposition(modality, athletes.slice(0, 1))[0]).toBe(
      "Esta prueba requiere de 2 a 3 integrantes; marcaste 1."
    )
    expect(validateEntryComposition(modality, athletes.slice(0, 3))).toEqual([])
    expect(validateEntryComposition(modality, athletes)[0]).toBe(
      "Esta prueba requiere de 2 a 3 integrantes; marcaste 4."
    )
  })

  it("detecta un deportista repetido dentro de una formación", () => {
    const modality = {
      name: "Equipo",
      sexRule: "ANY" as const,
      birthYearFrom: null,
      birthYearTo: null,
      minAthletes: 2,
      maxAthletes: 4,
    }
    expect(validateEntryComposition(modality, [athlete, athlete])).toContain(
      "Nadadora, Ana aparece dos veces en la formación."
    )
  })
})
