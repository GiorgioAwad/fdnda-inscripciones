import * as XLSX from "xlsx"
import { describe, expect, it } from "vitest"
import { parseFoundationWorkbooks } from "./foundation-import"

function workbook(sheetName: string, rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName)
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

function fixtures(options?: { conflictingDuplicate?: boolean }) {
  const artisticDiving = workbook("Afiliados", [
    ["LAST", "FIRST", "ID_NO", "SEX", "BIRTH", "Club", "Disciplina"],
    ["Ana", "Pérez", 12345678, new Date(2012, 2, 5), "Aquatica Sport Center", "F", "Clavados"],
  ])
  const waterPolo = workbook("Hoja1", [
    ["Nombre", "Paterno", "Materno", "Documento", "Nacimiento", "Sexo", "Club"],
    [
      options?.conflictingDuplicate ? "Otra" : "Ana",
      "Pérez",
      "",
      "12.345.678",
      "2012-03-05",
      "F",
      "Aquatica Sport Center",
    ],
  ])
  return { artisticDiving, waterPolo }
}

describe("parseFoundationWorkbooks", () => {
  it("fusiona filas equivalentes y une disciplinas", () => {
    const result = parseFoundationWorkbooks(fixtures())
    expect(result.stats).toMatchObject({
      artisticDivingRows: 1,
      waterPoloRows: 1,
      uniqueAthletes: 1,
      duplicateRowsMerged: 1,
      clubs: 1,
      excludedRows: 0,
    })
    expect(result.athletes[0].disciplines).toEqual(["DIVING", "WATER_POLO"])
    expect(result.athletes[0].docNumber).toBe("12345678")
    expect(result.clubs[0]).toMatchObject({ code: "AQUATICA", username: "aquatica" })
    expect(result.issues.filter((item) => item.severity === "ERROR")).toHaveLength(0)
  })

  it("bloquea documentos repetidos con identidades incompatibles", () => {
    const result = parseFoundationWorkbooks(fixtures({ conflictingDuplicate: true }))
    expect(result.issues.some((item) => item.severity === "ERROR")).toBe(true)
    expect(result.issues.map((item) => item.message).join(" ")).not.toContain("12345678")
  })

  it("solo excluye filas inválidas cuando se solicita explícitamente", () => {
    const values = fixtures()
    const invalidPolo = workbook("Hoja1", [
      ["Nombre", "Paterno", "Materno", "Documento", "Nacimiento", "Sexo", "Club"],
      ["Luis", "Prueba", "", "87654321", "0001-01-01", "M", "Club de Regatas Lima"],
    ])
    const blocked = parseFoundationWorkbooks({
      artisticDiving: values.artisticDiving,
      waterPolo: invalidPolo,
    })
    expect(blocked.issues.some((item) => item.severity === "ERROR")).toBe(true)

    const quarantined = parseFoundationWorkbooks(
      { artisticDiving: values.artisticDiving, waterPolo: invalidPolo },
      { excludeInvalidRows: true }
    )
    expect(quarantined.stats.uniqueAthletes).toBe(1)
    expect(quarantined.stats.excludedRows).toBe(1)
    expect(quarantined.excludedRows).toEqual([
      { source: "WATER_POLO", rowNumber: 2, pendingFields: ["birthDate"] },
    ])
    expect(quarantined.issues.some((item) => item.severity === "ERROR")).toBe(false)
  })
})
