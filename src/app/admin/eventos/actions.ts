"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  Prisma,
  type AgeRuleMode,
  type Discipline,
  type PricingMode,
  type SexRule,
} from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import {
  isArtisticLevel,
  levelCategoriesToSpecs,
  parseLevelCategories,
  withLevelPrefix,
} from "@/lib/artistic-levels"
import { DISCIPLINE_VALUES } from "@/lib/disciplines"
import { parseCategorySpecs } from "@/lib/event-categories"
import { DISCIPLINE_PRESETS } from "@/lib/event-presets"
import {
  disciplineConfigFor,
  isAgeRuleConfigurationValid,
} from "@/lib/event-pricing"
import { eventReadiness, readinessModalityFrom } from "@/lib/event-readiness"
import { leagueEntryPrice, parseLeagueTeamCounts } from "@/lib/league"
import { buildModalityRows } from "@/lib/modality-rows"
import { formatDateOnly, plural, slugify } from "@/lib/utils"

// Tope por lote del generador: evita que una matriz enorme (pruebas × categorías
// × sexos) tumbe la pantalla o la transacción.
const MAX_BULK_MODALITIES = 300

export interface ActionResult {
  success: boolean
  error?: string
  eventId?: string
  /** Solo al crear una competencia: cuántas pruebas nacieron con ella. */
  createdModalities?: number
}

function parseFee(value: string | undefined): number | null | "invalid" {
  const text = (value ?? "").trim()
  if (!text) return null
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) return "invalid"
  return amount
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return isNaN(date.getTime()) ? null : date
}

// datetime-local ("2026-08-14T23:59") interpretado SIEMPRE en hora de Lima
// (UTC-5 fijo, Perú no tiene horario de verano). Evita depender del TZ del server.
function parseLimaDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const date = new Date(`${value.slice(0, 16)}:00-05:00`)
  return isNaN(date.getTime()) ? null : date
}

// Un evento pertenece a UNA disciplina: es lo que permite que el formulario
// muestre su configuración propia (cómo cobra, cómo mide las edades, qué pruebas
// tiene). Los eventos legados creados con el formulario multidisciplina
// conservan su arreglo y se editan sin tocar `disciplines`.
const eventSchema = z.object({
  id: z.string().optional(),
  seasonId: z.string().min(1, "Selecciona la temporada de la competencia."),
  name: z
    .string({ error: "Escribe el nombre de la competencia." })
    .trim()
    .min(5, "El nombre de la competencia debe tener al menos 5 caracteres."),
  discipline: z.enum(DISCIPLINE_VALUES, {
    message: "Selecciona la disciplina de la competencia.",
  }),
  chargesEntry: z.boolean(),
  chargesAthleteFee: z.boolean(),
  isLeague: z.boolean(),
  isLevelChampionship: z.boolean(),
  athleteFee: z.string().optional(),
  ageRuleMode: z.enum(["RANGE", "MAX_AGE_ONLY"]),
  venue: z.string().trim().max(120, "La sede admite hasta 120 caracteres.").optional(),
  city: z.string().trim().max(60, "La ciudad admite hasta 60 caracteres.").optional(),
  startDate: z.string(),
  endDate: z.string(),
  registrationDeadline: z.string(),
  description: z
    .string()
    .trim()
    .max(2000, "La descripción admite hasta 2000 caracteres.")
    .optional(),
  // Solo al crear: pruebas iniciales a generar desde el preset de la disciplina.
  presetModalities: z.array(z.string()).optional(),
  presetCategoriesText: z.string().optional(),
  presetPrice: z.string().optional(),
  presetMatchesPerTeam: z.string().optional(),
  presetLeagueTeamCounts: z.string().optional(),
  presetLevelCategories: z.string().optional(),
})

export async function saveEvent(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const parsed = eventSchema.safeParse({
    id: String(formData.get("id") ?? "") || undefined,
    seasonId: String(formData.get("seasonId") ?? ""),
    name: formData.get("name"),
    discipline: formData.get("discipline"),
    chargesEntry: formData.get("chargesEntry") === "on",
    chargesAthleteFee: formData.get("chargesAthleteFee") === "on",
    isLeague: formData.get("isLeague") === "on",
    isLevelChampionship: formData.get("isLevelChampionship") === "on",
    athleteFee: String(formData.get("athleteFee") ?? ""),
    ageRuleMode: String(formData.get("ageRuleMode") ?? "RANGE"),
    venue: String(formData.get("venue") ?? ""),
    city: String(formData.get("city") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    registrationDeadline: String(formData.get("registrationDeadline") ?? ""),
    description: String(formData.get("description") ?? ""),
    presetModalities: formData.getAll("presetModalities").map(String),
    presetCategoriesText: String(formData.get("presetCategoriesText") ?? ""),
    presetPrice: String(formData.get("presetPrice") ?? ""),
    presetMatchesPerTeam: String(formData.get("presetMatchesPerTeam") ?? ""),
    presetLeagueTeamCounts: String(formData.get("presetLeagueTeamCounts") ?? ""),
    presetLevelCategories: String(formData.get("presetLevelCategories") ?? ""),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const discipline = parsed.data.discipline as Discipline
  const athleteFee = parseFee(parsed.data.athleteFee)
  if (athleteFee === "invalid") {
    return {
      success: false,
      error:
        "Escribe la cuota de competencia por deportista en soles, por ejemplo 80.00.",
    }
  }
  if (!parsed.data.chargesEntry && !parsed.data.chargesAthleteFee) {
    return {
      success: false,
      error:
        "Marca al menos un concepto de cobro: precio por formación o cuota de competencia por deportista.",
    }
  }
  if (
    parsed.data.chargesAthleteFee &&
    (athleteFee === null || athleteFee <= 0)
  ) {
    return {
      success: false,
      error: "La cuota de competencia por deportista debe ser mayor que S/ 0.",
    }
  }
  if (parsed.data.isLeague && discipline !== "WATER_POLO") {
    return {
      success: false,
      error: "Solo una competencia de Polo Acuático puede ser una liga.",
    }
  }
  if (parsed.data.isLevelChampionship && discipline !== "ARTISTIC_SWIMMING") {
    return {
      success: false,
      error:
        "Solo una competencia de Natación Artística puede ser un campeonato de niveles.",
    }
  }

  const startDate = parseDateOnly(parsed.data.startDate)
  const endDate = parseDateOnly(parsed.data.endDate)
  const registrationDeadline = parseLimaDateTime(parsed.data.registrationDeadline)

  if (!startDate || !endDate) {
    return { success: false, error: "Completa la fecha de inicio y la fecha de fin." }
  }
  if (endDate < startDate) {
    return {
      success: false,
      error: "La fecha de fin no puede ser anterior a la fecha de inicio.",
    }
  }
  if (!registrationDeadline) {
    return {
      success: false,
      error: "Completa el cierre de inscripciones: fecha y hora.",
    }
  }

  const season = await prisma.season.findUnique({
    where: { id: parsed.data.seasonId },
    select: {
      id: true,
      name: true,
      year: true,
      startDate: true,
      endDate: true,
    },
  })
  if (!season) {
    return {
      success: false,
      error: "La temporada elegida ya no existe. Elige otra temporada.",
    }
  }
  if (season.startDate > startDate || season.endDate < endDate) {
    return {
      success: false,
      error: `Las fechas de la competencia deben caer dentro de «${season.name}» (${formatDateOnly(season.startDate)} – ${formatDateOnly(season.endDate)}).`,
    }
  }

  const existing = parsed.data.id
    ? await prisma.event.findUnique({
        where: { id: parsed.data.id },
        select: {
          seasonId: true,
          disciplines: true,
          isLeague: true,
          isLevelChampionship: true,
          modalities: {
            select: {
              discipline: true,
              registrations: {
                where: { status: { in: ["PENDING_PAYMENT", "PAID"] } },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      })
    : null

  const lockedDisciplines = new Set(
    existing?.modalities
      .filter((modality) => modality.registrations.length > 0)
      .map((modality) => modality.discipline) ?? []
  )
  const hasLockedEntries = lockedDisciplines.size > 0

  if (existing) {
    if (
      existing.seasonId &&
      existing.seasonId !== parsed.data.seasonId &&
      hasLockedEntries
    ) {
      return {
        success: false,
        error:
          "La temporada ya no puede cambiar: la competencia tiene inscripciones en órdenes.",
      }
    }
    // Cambiar de disciplina dejaría huérfanas las pruebas ya inscritas.
    if (hasLockedEntries && !existing.disciplines.includes(discipline)) {
      return {
        success: false,
        error:
          "La disciplina ya no puede cambiar: la competencia tiene inscripciones en órdenes.",
      }
    }
    if (hasLockedEntries && existing.isLeague !== parsed.data.isLeague) {
      return {
        success: false,
        error:
          "El formato de liga ya no puede cambiar: la competencia tiene inscripciones en órdenes.",
      }
    }
    if (
      hasLockedEntries &&
      existing.isLevelChampionship !== parsed.data.isLevelChampionship
    ) {
      return {
        success: false,
        error:
          "El formato de niveles ya no puede cambiar: la competencia tiene inscripciones en órdenes.",
      }
    }
  }

  // Los eventos legados multidisciplina conservan su arreglo: reducirlos a una
  // sola disciplina borraría pruebas que pueden tener inscripciones pagadas.
  const isLegacyMultiDiscipline = (existing?.disciplines.length ?? 0) > 1
  const data = {
    seasonId: parsed.data.seasonId,
    name: parsed.data.name,
    ...(isLegacyMultiDiscipline
      ? {}
      : { disciplines: [discipline] as Discipline[] }),
    venue: parsed.data.venue || null,
    city: parsed.data.city || null,
    startDate,
    endDate,
    registrationDeadline,
    isLeague: parsed.data.isLeague,
    isLevelChampionship: parsed.data.isLevelChampionship,
    description: parsed.data.description || null,
  }

  const config = {
    chargesEntry: parsed.data.chargesEntry,
    chargesAthleteFee: parsed.data.chargesAthleteFee,
    athleteFee:
      parsed.data.chargesAthleteFee && athleteFee !== null
        ? new Prisma.Decimal(athleteFee.toFixed(2))
        : null,
    ageRuleMode: parsed.data.ageRuleMode as AgeRuleMode,
    // Se escribe tambien la representacion vieja mientras dure el despliegue:
    // instancias con el codigo anterior siguen leyendo pricingMode, y una
    // config que ellas leyeran mal cobraria de menos o auto-confirmaria una
    // orden en cero. Esta linea se borra junto con la columna, en la Tarea 9.
    pricingMode: (parsed.data.chargesAthleteFee && !parsed.data.chargesEntry
      ? "PER_ATHLETE"
      : "PER_ENTRY") as PricingMode,
  }

  // Cambiar cómo cobra o cómo mide las edades una disciplina que ya vendió
  // inscripciones alteraría lo que un club creyó comprar.
  if (lockedDisciplines.has(discipline)) {
    const current = await prisma.eventDisciplineConfig.findUnique({
      where: {
        eventId_discipline: { eventId: parsed.data.id!, discipline },
      },
    })
    const currentFee = current?.athleteFee?.toString() ?? null
    const nextFee = config.athleteFee?.toString() ?? null
    if (
      (current?.chargesEntry ?? true) !== config.chargesEntry ||
      (current?.chargesAthleteFee ?? false) !== config.chargesAthleteFee ||
      (current?.ageRuleMode ?? "RANGE") !== config.ageRuleMode ||
      currentFee !== nextFee
    ) {
      return {
        success: false,
        error:
          "El cobro y la forma de medir las edades ya no pueden cambiar: la competencia tiene inscripciones en órdenes.",
      }
    }
  }

  try {
    if (parsed.data.id) {
      const eventId = parsed.data.id
      await prisma.$transaction(async (tx) => {
        await tx.event.update({ where: { id: eventId }, data })
        await tx.eventDisciplineConfig.upsert({
          where: { eventId_discipline: { eventId, discipline } },
          create: { eventId, discipline, ...config },
          update: config,
        })
      })
      revalidatePath(`/admin/eventos/${eventId}`)
      revalidatePath("/admin/eventos")
      return { success: true, eventId }
    }

    // Slug único derivado del nombre.
    const base = slugify(data.name) || "evento"
    let slug = base
    for (let i = 2; ; i++) {
      const exists = await prisma.event.findUnique({ where: { slug } })
      if (!exists) break
      slug = `${base}-${i}`
    }

    // Pruebas iniciales: el evento queda listo para abrirse sin pasar por otra
    // pantalla. Si el admin no eligió ninguna, se crea vacío como antes.
    const preset = DISCIPLINE_PRESETS[parsed.data.discipline]
    const chosen = preset.modalities.filter((modality) =>
      (parsed.data.presetModalities ?? []).includes(modality.name)
    )
    let modalityRows: Prisma.EventModalityCreateManyEventInput[] = []
    if (chosen.length > 0) {
      // En una liga el admin escribe el precio por partido; la prueba se guarda
      // con el precio final que paga cada equipo.
      const unitPrice = parsed.data.chargesEntry
        ? parseFee(parsed.data.presetPrice)
        : 0
      if (unitPrice === "invalid" || unitPrice === null) {
        return {
          success: false,
          error: parsed.data.isLeague
            ? "Escribe el precio por partido de las pruebas."
            : "Escribe el precio por formación de las pruebas.",
        }
      }

      // Los dos caminos leen las categorías de campos distintos, así que cada
      // uno interpreta el suyo: el de niveles manda `presetLevelCategories` y
      // no manda `presetCategoriesText`. Leerlo igual haría fallar el guardado
      // con «Esta disciplina exige categorías Sub-N» en un formulario que ni
      // siquiera muestra ese campo.
      if (parsed.data.isLevelChampionship) {
        // `|| "[]"` y no `?? "[]"`: el safeParse convierte un campo ausente en
        // cadena vacía, no en undefined, y JSON.parse("") revienta.
        const levelCategories = parseLevelCategories(
          parsed.data.presetLevelCategories?.trim() || "[]"
        )
        if (levelCategories === null) {
          return {
            success: false,
            error:
              "Revisa las categorías por nivel: cada una necesita nombre y años de nacimiento entre 1950 y 2050, con «Nacidos desde» menor o igual que «Nacidos hasta».",
          }
        }
        const groups = levelCategoriesToSpecs(levelCategories)
        if (groups.length === 0) {
          return {
            success: false,
            error: "Agrega al menos una categoría en algún nivel, o desmarca todas las pruebas.",
          }
        }
        // Un nivel por llamada, con el sortOrder corrido: las pruebas nacen
        // ordenadas básico → intermedio → avanzado sin que ninguna vista tenga
        // que ordenarlas después.
        for (const group of groups) {
          const levelRows = buildModalityRows({
            discipline,
            names: chosen.map((modality) => modality.name),
            categories: group.specs,
            variantsFor: (name) => {
              const modality = chosen.find((row) => row.name === name)!
              return {
                sexRules: modality.sexRules as SexRule[],
                minAthletes: modality.minAthletes,
                maxAthletes: modality.maxAthletes,
              }
            },
            // Un campeonato de niveles es de artística y una liga es de polo:
            // nunca coinciden, así que acá el precio es el que escribió el
            // admin, sin el cálculo por partidos.
            price: unitPrice,
            allowsCategoryUpgrade: false,
            startSortOrder: modalityRows.length,
          })
          modalityRows.push(
            ...levelRows.map((row) => ({ ...row, level: group.level }))
          )
        }
      } else {
        const categories = parseCategorySpecs(parsed.data.presetCategoriesText ?? "", {
          ageRuleMode: parsed.data.ageRuleMode,
          seasonYear: season.year,
        })
        if (!categories.ok) return { success: false, error: categories.error }

        const matchesPerTeam = parsed.data.isLeague
          ? Number(parsed.data.presetMatchesPerTeam)
          : null
        const leagueTeamCounts = parsed.data.isLeague
          ? parseLeagueTeamCounts(parsed.data.presetLeagueTeamCounts ?? "")
          : null
        if (
          parsed.data.isLeague &&
          (!Number.isInteger(matchesPerTeam) ||
            matchesPerTeam! < 1 ||
            matchesPerTeam! > 40 ||
            leagueTeamCounts === null ||
            leagueTeamCounts.length !== categories.categories.length)
        ) {
          return {
            success: false,
            error:
              "Indica los partidos por plantel y los planteles esperados de cada categoría.",
          }
        }

        const price = parsed.data.isLeague
          ? leagueEntryPrice({
              pricePerMatch: unitPrice,
              matchesPerTeam: matchesPerTeam!,
            })
          : unitPrice

        modalityRows = buildModalityRows({
          discipline,
          names: chosen.map((modality) => modality.name),
          categories: categories.categories,
          // Cada prueba del preset trae sus propios sexos y tamaño de formación.
          variantsFor: (name) => {
            const modality = chosen.find((row) => row.name === name)!
            return {
              sexRules: modality.sexRules as SexRule[],
              minAthletes: modality.minAthletes,
              maxAthletes: modality.maxAthletes,
            }
          },
          price,
          ...(parsed.data.isLeague && leagueTeamCounts
            ? {
                leaguePlanFor: (categoryIndex: number, sexRule: SexRule) => ({
                  pricePerMatch: unitPrice,
                  matchesPerTeam: matchesPerTeam!,
                  expectedTeams:
                    leagueTeamCounts[categoryIndex][
                      sexRule === "FEMALE" ? "FEMALE" : "MALE"
                    ],
                }),
              }
            : {}),
          allowsCategoryUpgrade: false,
          startSortOrder: 0,
        })
      }
      if (modalityRows.length > MAX_BULK_MODALITIES) {
        return {
          success: false,
          error: `La combinación genera ${modalityRows.length} pruebas y el máximo es ${MAX_BULK_MODALITIES}. Quita categorías o pruebas.`,
        }
      }
    }

    const created = await prisma.event.create({
      data: {
        ...data,
        disciplines: [discipline],
        slug,
        disciplineConfigs: { create: [{ discipline, ...config }] },
        ...(modalityRows.length > 0
          ? { modalities: { createMany: { data: modalityRows } } }
          : {}),
      },
    })
    revalidatePath("/admin/eventos")
    return {
      success: true,
      eventId: created.id,
      createdModalities: modalityRows.length,
    }
  } catch (error) {
    console.error("saveEvent error:", error)
    return {
      success: false,
      error: "No se pudo guardar la competencia. Vuelve a intentarlo en unos segundos.",
    }
  }
}

export async function setEventStatus(
  eventId: string,
  status: "DRAFT" | "OPEN" | "CLOSED"
): Promise<ActionResult> {
  await requireAdmin()

  if (!["DRAFT", "OPEN", "CLOSED"].includes(status)) {
    return {
      success: false,
      error: "No se reconoce ese estado de la competencia. Recarga la página.",
    }
  }

  if (status === "OPEN") {
    // Las reglas viven en lib/event-readiness: son las mismas que pinta la
    // tarjeta de requisitos del detalle, así que el botón nunca queda
    // habilitado para algo que el servidor rechaza, ni al revés.
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        season: { include: { fees: { select: { discipline: true } } } },
        modalities: true,
        disciplineConfigs: true,
      },
    })
    if (!event) {
      return {
        success: false,
        error: "Esta competencia ya no existe. Vuelve a la lista de competencias.",
      }
    }
    const readiness = eventReadiness({
      registrationDeadline: event.registrationDeadline,
      isLeague: event.isLeague,
      disciplines: event.disciplines,
      disciplineConfigs: event.disciplineConfigs,
      season: event.season
        ? {
            name: event.season.name,
            feeDisciplines: event.season.fees.map((fee) => fee.discipline),
          }
        : null,
      modalities: event.modalities.map(readinessModalityFrom),
    })
    if (!readiness.ready) {
      const [first, ...rest] = readiness.missing
      return {
        success: false,
        error:
          rest.length > 0
            ? `${first.problem} Faltan además ${plural(rest.length, "requisito", "requisitos")}: revisa la lista de requisitos.`
            : first.problem!,
      }
    }
  }

  try {
    await prisma.event.update({ where: { id: eventId }, data: { status } })
  } catch {
    return {
      success: false,
      error: "Esta competencia ya no existe. Vuelve a la lista de competencias.",
    }
  }

  revalidatePath(`/admin/eventos/${eventId}`)
  revalidatePath("/admin/eventos")
  revalidatePath("/eventos")
  return { success: true }
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  await requireAdmin()

  // Cualquier inscripción, incluso una que sigue en el carrito de un club,
  // impide borrar: el borrado arrastra en cascada pruebas e inscripciones.
  const registrations = await prisma.registration.count({
    where: { modality: { eventId } },
  })
  if (registrations > 0) {
    return {
      success: false,
      error: `La competencia tiene ${plural(registrations, "inscripción", "inscripciones")}: cierra las inscripciones en lugar de eliminarla.`,
    }
  }

  try {
    await prisma.event.delete({ where: { id: eventId } })
  } catch (error) {
    console.error("deleteEvent error:", error)
    return {
      success: false,
      error: "No se pudo eliminar la competencia. Vuelve a intentarlo en unos segundos.",
    }
  }
  revalidatePath("/admin/eventos")
  return { success: true }
}

// ==================== MODALIDADES ====================

// Campos que comparten la prueba suelta y el generador en lote. Cada regla
// lleva su mensaje: sin él, zod responde en inglés («Too small: expected…»).
const eventIdField = z.string().min(1, "Falta la competencia de la prueba. Recarga la página.")
const disciplineField = z.enum(DISCIPLINE_VALUES, {
  message: "Elige la disciplina de la prueba.",
})
const sexRuleValues = ["MALE", "FEMALE", "MIXED", "ANY"] as const

function athleteCountField(which: "mínimos" | "máximos") {
  return z.coerce
    .number({ error: `Escribe los integrantes ${which} como un número.` })
    .int(`Los integrantes ${which} deben ser un número entero.`)
    .min(1, `Los integrantes ${which} deben ser al menos 1.`)
    .max(20, "Una formación admite hasta 20 integrantes.")
}

const priceField = z.coerce
  .number({ error: "Escribe el precio por formación en soles, por ejemplo 60.00." })
  .min(0, "El precio por formación no puede ser negativo.")
  .max(100000, "El precio por formación no puede superar S/ 100 000.")

const modalitySchema = z.object({
  id: z.string().optional(),
  eventId: eventIdField,
  discipline: disciplineField,
  name: z
    .string({ error: "Escribe el nombre de la prueba." })
    .trim()
    .min(2, "El nombre de la prueba debe tener al menos 2 caracteres."),
  category: z
    .string()
    .trim()
    .max(80, "La categoría admite hasta 80 caracteres.")
    .optional(),
  sexRule: z.enum(sexRuleValues, { message: "Elige el sexo de la prueba." }),
  birthYearFrom: z.string().optional(),
  birthYearTo: z.string().optional(),
  allowsCategoryUpgrade: z.boolean(),
  /** Nivel del campeonato de niveles de artística. Vacío = sin nivel. */
  level: z.string().optional(),
  minAthletes: athleteCountField("mínimos"),
  maxAthletes: athleteCountField("máximos"),
  // Sin precio por formación (la disciplina cobra solo cuota de competencia por
  // deportista) el diálogo no muestra el campo y envía 0 o el precio que ya
  // tenía la prueba: 0 es un valor válido.
  price: priceField,
  pricePerMatch: z.string().optional(),
  matchesPerTeam: z.string().optional(),
  expectedTeams: z.string().optional(),
  capacity: z.string().optional(),
})

function parseYear(value: string | undefined): number | null | "invalid" {
  const v = (value ?? "").trim()
  if (!v) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1950 || n > 2050) return "invalid"
  return n
}

export async function saveModality(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const parsed = modalitySchema.safeParse({
    id: String(formData.get("id") ?? "") || undefined,
    eventId: formData.get("eventId"),
    discipline: formData.get("discipline"),
    name: formData.get("name"),
    category: String(formData.get("category") ?? ""),
    sexRule: formData.get("sexRule"),
    birthYearFrom: String(formData.get("birthYearFrom") ?? ""),
    birthYearTo: String(formData.get("birthYearTo") ?? ""),
    allowsCategoryUpgrade: formData.get("allowsCategoryUpgrade") === "on",
    level: String(formData.get("level") ?? ""),
    minAthletes: formData.get("minAthletes"),
    maxAthletes: formData.get("maxAthletes"),
    price: formData.get("price"),
    pricePerMatch: String(formData.get("pricePerMatch") ?? ""),
    matchesPerTeam: String(formData.get("matchesPerTeam") ?? ""),
    expectedTeams: String(formData.get("expectedTeams") ?? ""),
    capacity: String(formData.get("capacity") ?? ""),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const birthYearFrom = parseYear(parsed.data.birthYearFrom)
  const birthYearTo = parseYear(parsed.data.birthYearTo)
  if (birthYearFrom === "invalid" || birthYearTo === "invalid") {
    return {
      success: false,
      error: "Escribe los años de nacimiento con 4 dígitos, entre 1950 y 2050 (por ejemplo, 2012).",
    }
  }
  if (birthYearFrom !== null && birthYearTo !== null && birthYearFrom > birthYearTo) {
    return {
      success: false,
      error: "«Nacidos desde» no puede ser un año posterior a «Nacidos hasta».",
    }
  }
  if (parsed.data.minAthletes > parsed.data.maxAthletes) {
    return {
      success: false,
      error: "Los integrantes mínimos no pueden ser más que los máximos.",
    }
  }
  // El año que sube es birthYearTo + 1: sin tope no hay categoría inferior que
  // pueda subir y la casilla no significaría nada.
  if (parsed.data.allowsCategoryUpgrade && birthYearTo === null) {
    return {
      success: false,
      error:
        "«Sube de categoría» necesita el año «Nacidos hasta»: es el tope de la categoría.",
    }
  }


  const event = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    include: {
      season: { include: { categories: true } },
      disciplineConfigs: true,
    },
  })
  if (!event) {
    return {
      success: false,
      error: "Esta competencia ya no existe. Vuelve a la lista de competencias.",
    }
  }
  if (!event.disciplines.includes(parsed.data.discipline as Discipline)) {
    return {
      success: false,
      error: "La disciplina de la prueba no es una disciplina de esta competencia.",
    }
  }
  if (
    parsed.data.allowsCategoryUpgrade &&
    parsed.data.discipline !== "ARTISTIC_SWIMMING"
  ) {
    return {
      success: false,
      error: "«Sube de categoría» solo aplica a Natación Artística.",
    }
  }
  // Las mismas tres guardas del generador masivo: el selector solo se dibuja
  // cuando corresponde, pero el campo se manipula igual desde el navegador.
  const level = parsed.data.level?.trim() ? parsed.data.level.trim() : null
  if (level !== null) {
    if (!isArtisticLevel(level)) {
      return {
        success: false,
        error: "Elige el nivel: Básico, Intermedio o Avanzado.",
      }
    }
    if (parsed.data.discipline !== "ARTISTIC_SWIMMING") {
      return {
        success: false,
        error: "El nivel solo aplica a Natación Artística.",
      }
    }
    if (!event.isLevelChampionship) {
      return {
        success: false,
        error:
          "Esta competencia no es un campeonato de niveles: marca «Es un campeonato de niveles» en sus datos para usar niveles.",
      }
    }
  }

  // «Sub-N»: birthYearFrom es el piso y birthYearTo queda vacío. En Open
  // ambos quedan vacíos para admitir cualquier edad.
  const disciplineConfig = disciplineConfigFor(
    event.disciplineConfigs,
    parsed.data.discipline
  )
  if (
    !isAgeRuleConfigurationValid({ birthYearFrom, birthYearTo }, disciplineConfig)
  ) {
    return {
      success: false,
      error:
        "Esta disciplina usa categorías Sub-N u Open: deja vacío «Nacidos hasta».",
    }
  }

  let categoryUpgradeBirthYear: number | null = null
  if (parsed.data.allowsCategoryUpgrade && birthYearTo !== null) {
    if (!event.season) {
      return {
        success: false,
        error: "Asigna una temporada a la competencia para usar «Sube de categoría».",
      }
    }
    categoryUpgradeBirthYear = birthYearTo + 1
    const adjacent = event.season.categories.some(
      (category) =>
        category.discipline === "ARTISTIC_SWIMMING" &&
        category.birthYearFrom === categoryUpgradeBirthYear &&
        (category.birthYearTo === null ||
          categoryUpgradeBirthYear! <= category.birthYearTo)
    )
    if (!adjacent) {
      return {
        success: false,
        error: `«Sube de categoría» necesita una categoría de la temporada que empiece en ${categoryUpgradeBirthYear} y no existe. Desmarca la opción o crea esa categoría en Temporadas.`,
      }
    }
  }

  const capacityText = (parsed.data.capacity ?? "").trim()
  const capacity = capacityText ? Number(capacityText) : null
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    return {
      success: false,
      error: "El cupo debe ser un número entero mayor que 0. Déjalo vacío para no limitarlo.",
    }
  }

  let price = parsed.data.price
  let leagueFields: {
    pricePerMatch: Prisma.Decimal | null
    matchesPerTeam: number | null
    expectedTeams: number | null
  } = { pricePerMatch: null, matchesPerTeam: null, expectedTeams: null }

  if (event.isLeague) {
    const pricePerMatch = parseFee(parsed.data.pricePerMatch)
    const matchesPerTeam = Number(parsed.data.matchesPerTeam)
    const expectedTeams = Number(parsed.data.expectedTeams)
    if (
      pricePerMatch === "invalid" ||
      pricePerMatch === null ||
      !Number.isInteger(matchesPerTeam) ||
      matchesPerTeam < 1 ||
      matchesPerTeam > 40 ||
      !Number.isInteger(expectedTeams) ||
      expectedTeams < 1 ||
      expectedTeams > 40
    ) {
      return {
        success: false,
        error:
          "Completa el precio por partido, los partidos por plantel (1 a 40) y los planteles esperados (1 a 40).",
      }
    }
    price = leagueEntryPrice({ pricePerMatch, matchesPerTeam })
    leagueFields = {
      pricePerMatch: new Prisma.Decimal(pricePerMatch.toFixed(2)),
      matchesPerTeam,
      expectedTeams,
    }
  }

  // El nivel se guarda dos veces a propósito: en la columna y dentro de
  // `category`, porque la descripción de la orden se arma con `category` (ver
  // lib/registration-snapshots.ts) y sin él dos pruebas homónimas de niveles
  // distintos saldrían idénticas en el comprobante que paga el club.
  // withLevelPrefix quita el prefijo antes de ponerlo, así que reenviar la
  // categoría que ya lo trae no lo duplica y cambiar de nivel lo reemplaza.
  // Sin nivel se guarda lo que escribió el admin, tal cual: una prueba de
  // cualquier otro evento no puede perder texto al pasar por acá.
  const typedCategory = parsed.data.category?.trim() || null
  const category = level === null ? typedCategory : withLevelPrefix(level, typedCategory)

  const data = {
    eventId: parsed.data.eventId,
    discipline: parsed.data.discipline as Discipline,
    name: parsed.data.name,
    category,
    level,
    sexRule: parsed.data.sexRule as SexRule,
    birthYearFrom,
    birthYearTo,
    allowsCategoryUpgrade: parsed.data.allowsCategoryUpgrade,
    categoryUpgradeBirthYear,
    minAthletes: parsed.data.minAthletes,
    maxAthletes: parsed.data.maxAthletes,
    price: new Prisma.Decimal(price.toFixed(2)),
    ...leagueFields,
    capacity,
  }

  try {
    if (parsed.data.id) {
      await prisma.eventModality.update({
        where: { id: parsed.data.id },
        data,
      })
    } else {
      const last = await prisma.eventModality.findFirst({
        where: { eventId: data.eventId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      })
      await prisma.eventModality.create({
        data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
      })
    }
  } catch (error) {
    console.error("saveModality error:", error)
    return {
      success: false,
      error: "No se pudo guardar la prueba. Vuelve a intentarlo en unos segundos.",
    }
  }

  revalidatePath(`/admin/eventos/${parsed.data.eventId}`)
  return { success: true }
}

export async function toggleModalityActive(modalityId: string): Promise<ActionResult> {
  await requireAdmin()

  const modality = await prisma.eventModality.findUnique({ where: { id: modalityId } })
  if (!modality) {
    return {
      success: false,
      error: "Esta prueba ya no existe. Recarga la página.",
    }
  }

  await prisma.eventModality.update({
    where: { id: modalityId },
    data: { isActive: !modality.isActive },
  })

  revalidatePath(`/admin/eventos/${modality.eventId}`)
  return { success: true }
}

export async function deleteModality(modalityId: string): Promise<ActionResult> {
  await requireAdmin()

  const modality = await prisma.eventModality.findUnique({
    where: { id: modalityId },
    include: { _count: { select: { registrations: true } } },
  })
  if (!modality) {
    return {
      success: false,
      error: "Esta prueba ya no existe. Recarga la página.",
    }
  }

  if (modality._count.registrations > 0) {
    return {
      success: false,
      error: `La prueba tiene ${plural(modality._count.registrations, "inscripción", "inscripciones")}: desactívala en lugar de eliminarla.`,
    }
  }

  try {
    await prisma.eventModality.delete({ where: { id: modalityId } })
  } catch (error) {
    console.error("deleteModality error:", error)
    return {
      success: false,
      error: "No se pudo eliminar la prueba. Vuelve a intentarlo en unos segundos.",
    }
  }
  revalidatePath(`/admin/eventos/${modality.eventId}`)
  return { success: true }
}

// ==================== GENERADOR MASIVO ====================

const bulkSchema = z.object({
  eventId: eventIdField,
  discipline: disciplineField,
  namesText: z.string().trim().min(1, "Escribe el nombre de al menos una prueba."),
  categoriesText: z.string().trim(),
  sexRules: z
    .array(z.enum(sexRuleValues))
    .min(1, "Marca al menos un sexo para generar las pruebas."),
  allowsCategoryUpgrade: z.boolean(),
  level: z.string().optional(),
  minAthletes: athleteCountField("mínimos"),
  maxAthletes: athleteCountField("máximos"),
  price: priceField,
  pricePerMatch: z.string().optional(),
  matchesPerTeam: z.string().optional(),
  expectedTeams: z.string().optional(),
})

export interface BulkResult extends ActionResult {
  created?: number
}

// Genera la matriz pruebas × categorías × sexos.
// categoriesText: una por línea con formato "Nombre|añoDesde|añoHasta"
// (los años son opcionales: "Juvenil B||" o simplemente "Juvenil B").
export async function bulkGenerateModalities(formData: FormData): Promise<BulkResult> {
  await requireAdmin()

  const parsed = bulkSchema.safeParse({
    eventId: formData.get("eventId"),
    discipline: formData.get("discipline"),
    namesText: String(formData.get("namesText") ?? ""),
    categoriesText: String(formData.get("categoriesText") ?? ""),
    sexRules: formData.getAll("sexRules").map(String),
    allowsCategoryUpgrade: formData.get("allowsCategoryUpgrade") === "on",
    level: String(formData.get("level") ?? ""),
    minAthletes: formData.get("minAthletes"),
    maxAthletes: formData.get("maxAthletes"),
    price: formData.get("price"),
    pricePerMatch: String(formData.get("pricePerMatch") ?? ""),
    matchesPerTeam: String(formData.get("matchesPerTeam") ?? ""),
    expectedTeams: String(formData.get("expectedTeams") ?? ""),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }
  if (parsed.data.minAthletes > parsed.data.maxAthletes) {
    return {
      success: false,
      error: "Los integrantes mínimos no pueden ser más que los máximos.",
    }
  }

  const event = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    include: {
      season: { include: { categories: true } },
      disciplineConfigs: true,
    },
  })
  if (!event) {
    return {
      success: false,
      error: "Esta competencia ya no existe. Vuelve a la lista de competencias.",
    }
  }
  if (!event.disciplines.includes(parsed.data.discipline as Discipline)) {
    return {
      success: false,
      error: "Esa disciplina no es una disciplina de esta competencia.",
    }
  }
  if (
    parsed.data.allowsCategoryUpgrade &&
    parsed.data.discipline !== "ARTISTIC_SWIMMING"
  ) {
    return {
      success: false,
      error: "«Sube de categoría» solo aplica a Natación Artística.",
    }
  }
  const level = parsed.data.level?.trim() ? parsed.data.level.trim() : null
  if (level !== null) {
    if (!isArtisticLevel(level)) {
      return {
        success: false,
        error: "Elige el nivel: Básico, Intermedio o Avanzado.",
      }
    }
    if (parsed.data.discipline !== "ARTISTIC_SWIMMING") {
      return {
        success: false,
        error: "El nivel solo aplica a Natación Artística.",
      }
    }
    if (!event.isLevelChampionship) {
      return {
        success: false,
        error:
          "Esta competencia no es un campeonato de niveles: marca «Es un campeonato de niveles» en sus datos para usar niveles.",
      }
    }
  }
  if (!event.season) {
    return {
      success: false,
      error: "Asigna una temporada a la competencia antes de generar sus pruebas.",
    }
  }

  let generatedPrice = parsed.data.price
  let leagueFields: {
    pricePerMatch: Prisma.Decimal | null
    matchesPerTeam: number | null
    expectedTeams: number | null
  } = { pricePerMatch: null, matchesPerTeam: null, expectedTeams: null }
  if (event.isLeague) {
    const pricePerMatch = parseFee(parsed.data.pricePerMatch)
    const matchesPerTeam = Number(parsed.data.matchesPerTeam)
    const expectedTeams = Number(parsed.data.expectedTeams)
    if (
      pricePerMatch === "invalid" ||
      pricePerMatch === null ||
      !Number.isInteger(matchesPerTeam) ||
      matchesPerTeam < 1 ||
      matchesPerTeam > 40 ||
      !Number.isInteger(expectedTeams) ||
      expectedTeams < 1 ||
      expectedTeams > 40
    ) {
      return {
        success: false,
        error:
          "Completa el precio por partido, los partidos por plantel (1 a 40) y los planteles esperados (1 a 40).",
      }
    }
    generatedPrice = leagueEntryPrice({ pricePerMatch, matchesPerTeam })
    leagueFields = {
      pricePerMatch: new Prisma.Decimal(pricePerMatch.toFixed(2)),
      matchesPerTeam,
      expectedTeams,
    }
  }

  const names = parsed.data.namesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  // El formato de las categorías depende de cómo mide las edades la disciplina:
  // "Nombre|desde|hasta" en RANGE, "Sub 13" en MAX_AGE_ONLY.
  const config = disciplineConfigFor(
    event.disciplineConfigs,
    parsed.data.discipline
  )
  const parsedCategories = parseCategorySpecs(parsed.data.categoriesText, {
    ageRuleMode: config.ageRuleMode,
    seasonYear: event.season.year,
  })
  if (!parsedCategories.ok) {
    return { success: false, error: parsedCategories.error }
  }
  const categories = parsedCategories.categories

  if (parsed.data.allowsCategoryUpgrade) {
    for (const category of categories) {
      if (category.birthYearTo === null) continue
      const upgradeYear = category.birthYearTo + 1
      const adjacent = event.season.categories.some(
        (candidate) =>
          candidate.discipline === "ARTISTIC_SWIMMING" &&
          candidate.birthYearFrom === upgradeYear &&
          (candidate.birthYearTo === null || upgradeYear <= candidate.birthYearTo)
      )
      if (!adjacent) {
        return {
          success: false,
          error: `«Sube de categoría» necesita una categoría de la temporada que empiece en ${upgradeYear} y no existe. Desmarca la opción o crea esa categoría en Temporadas.`,
        }
      }
    }
  }

  const last = await prisma.eventModality.findFirst({
    where: { eventId: event.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  const rows: Prisma.EventModalityCreateManyInput[] = buildModalityRows({
    discipline: parsed.data.discipline as Discipline,
    names,
    categories,
    variantsFor: () => ({
      sexRules: parsed.data.sexRules as SexRule[],
      minAthletes: parsed.data.minAthletes,
      maxAthletes: parsed.data.maxAthletes,
    }),
    price: generatedPrice,
    allowsCategoryUpgrade: parsed.data.allowsCategoryUpgrade,
    startSortOrder: (last?.sortOrder ?? -1) + 1,
  }).map((row) => ({
    ...row,
    eventId: event.id,
    ...leagueFields,
    level,
    // Igual que al crear el evento: el nivel viaja también dentro de `category`
    // para que la descripción de la orden distinga dos pruebas homónimas.
    category:
      level === null ? row.category : withLevelPrefix(level, row.category ?? null),
  }))

  if (rows.length === 0) {
    return {
      success: false,
      error: "Esta combinación no crea ninguna prueba: escribe al menos un nombre y marca al menos un sexo.",
    }
  }
  if (rows.length > MAX_BULK_MODALITIES) {
    return {
      success: false,
      error: `La combinación genera ${rows.length} pruebas y el máximo por lote es ${MAX_BULK_MODALITIES}. Genéralas en varios lotes.`,
    }
  }

  try {
    await prisma.eventModality.createMany({ data: rows })
  } catch (error) {
    console.error("bulkGenerateModalities error:", error)
    return {
      success: false,
      error: "No se pudieron generar las pruebas. Vuelve a intentarlo en unos segundos.",
    }
  }

  revalidatePath(`/admin/eventos/${event.id}`)
  return { success: true, created: rows.length }
}
