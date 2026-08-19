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
  levelCategoriesToSpecs,
  parseLevelCategories,
} from "@/lib/artistic-levels"
import { DISCIPLINE_VALUES, disciplineLabel } from "@/lib/disciplines"
import { parseCategorySpecs } from "@/lib/event-categories"
import { DISCIPLINE_PRESETS } from "@/lib/event-presets"
import {
  disciplineConfigFor,
  isAgeRuleConfigurationValid,
  isPricingConfigurationValid,
} from "@/lib/event-pricing"
import { leagueEntryPrice, parseLeagueTeamCounts } from "@/lib/league"
import { buildModalityRows } from "@/lib/modality-rows"
import { slugify } from "@/lib/utils"

// Tope por lote del generador: evita que una matriz enorme (pruebas × categorías
// × sexos) tumbe la pantalla o la transacción.
const MAX_BULK_MODALITIES = 300

export interface ActionResult {
  success: boolean
  error?: string
  eventId?: string
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
  seasonId: z.string().min(1, "Selecciona una temporada"),
  name: z.string().trim().min(5, "El nombre debe tener al menos 5 caracteres"),
  discipline: z.enum(DISCIPLINE_VALUES, {
    message: "Selecciona la disciplina del evento",
  }),
  chargesEntry: z.boolean(),
  chargesAthleteFee: z.boolean(),
  isLeague: z.boolean(),
  isLevelChampionship: z.boolean(),
  athleteFee: z.string().optional(),
  ageRuleMode: z.enum(["RANGE", "MAX_AGE_ONLY"]),
  venue: z.string().trim().max(120).optional(),
  city: z.string().trim().max(60).optional(),
  startDate: z.string(),
  endDate: z.string(),
  registrationDeadline: z.string(),
  description: z.string().trim().max(2000).optional(),
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
    return { success: false, error: "Cuota por deportista inválida." }
  }
  if (!parsed.data.chargesEntry && !parsed.data.chargesAthleteFee) {
    return {
      success: false,
      error: "El evento debe cobrar al menos un concepto.",
    }
  }
  if (
    parsed.data.chargesAthleteFee &&
    (athleteFee === null || athleteFee <= 0)
  ) {
    return {
      success: false,
      error: "La cuota por deportista debe ser mayor que cero.",
    }
  }
  if (parsed.data.isLeague && discipline !== "WATER_POLO") {
    return {
      success: false,
      error: "Solo un evento de polo acuático puede ser una liga.",
    }
  }
  if (parsed.data.isLevelChampionship && discipline !== "ARTISTIC_SWIMMING") {
    return {
      success: false,
      error:
        "Solo un evento de natación artística puede ser un campeonato de niveles.",
    }
  }

  const startDate = parseDateOnly(parsed.data.startDate)
  const endDate = parseDateOnly(parsed.data.endDate)
  const registrationDeadline = parseLimaDateTime(parsed.data.registrationDeadline)

  if (!startDate || !endDate) {
    return { success: false, error: "Fechas del evento inválidas." }
  }
  if (endDate < startDate) {
    return { success: false, error: "La fecha de fin no puede ser anterior al inicio." }
  }
  if (!registrationDeadline) {
    return { success: false, error: "Fecha límite de inscripción inválida." }
  }

  const season = await prisma.season.findUnique({
    where: { id: parsed.data.seasonId },
    select: { id: true, year: true, startDate: true, endDate: true },
  })
  if (!season) {
    return { success: false, error: "La temporada seleccionada ya no existe." }
  }
  if (season.startDate > startDate || season.endDate < endDate) {
    return {
      success: false,
      error: "La temporada debe cubrir todas las fechas de la competencia.",
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
          "La temporada no puede cambiar porque el evento ya tiene inscripciones en una orden.",
      }
    }
    // Cambiar de disciplina dejaría huérfanas las pruebas ya inscritas.
    if (hasLockedEntries && !existing.disciplines.includes(discipline)) {
      return {
        success: false,
        error:
          "La disciplina no puede cambiar porque el evento ya tiene inscripciones en una orden.",
      }
    }
    if (hasLockedEntries && existing.isLeague !== parsed.data.isLeague) {
      return {
        success: false,
        error:
          "El formato de liga no puede cambiar porque el evento ya tiene inscripciones en una orden.",
      }
    }
    if (
      hasLockedEntries &&
      existing.isLevelChampionship !== parsed.data.isLevelChampionship
    ) {
      return {
        success: false,
        error:
          "El formato de niveles no puede cambiar porque el evento ya tiene inscripciones en una orden.",
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
          "La configuración de la disciplina no puede cambiar porque ya hay inscripciones en una orden.",
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
      const categories = parseCategorySpecs(parsed.data.presetCategoriesText ?? "", {
        ageRuleMode: parsed.data.ageRuleMode,
        seasonYear: season.year,
      })
      if (!categories.ok) return { success: false, error: categories.error }

      // En una liga el admin escribe el precio por partido; la prueba se guarda
      // con el precio final que paga cada equipo.
      const unitPrice = parsed.data.chargesEntry
        ? parseFee(parsed.data.presetPrice)
        : 0
      if (unitPrice === "invalid" || unitPrice === null) {
        return { success: false, error: "Indica el precio de las pruebas." }
      }

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
            "Indica cuántos equipos y cuántos partidos por equipo tiene la fase preliminar.",
        }
      }

      const price = parsed.data.isLeague
        ? leagueEntryPrice({ pricePerMatch: unitPrice, matchesPerTeam: matchesPerTeam! })
        : unitPrice

      if (parsed.data.isLevelChampionship) {
        // `|| "[]"` y no `?? "[]"`: el safeParse convierte un campo ausente en
        // cadena vacía, no en undefined, y JSON.parse("") revienta.
        const levelCategories = parseLevelCategories(
          parsed.data.presetLevelCategories?.trim() || "[]"
        )
        if (levelCategories === null) {
          return { success: false, error: "Categorías por nivel inválidas." }
        }
        const groups = levelCategoriesToSpecs(levelCategories)
        if (groups.length === 0) {
          return {
            success: false,
            error: "Agrega las categorías de al menos un nivel.",
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
            price,
            allowsCategoryUpgrade: false,
            startSortOrder: modalityRows.length,
          })
          modalityRows.push(
            ...levelRows.map((row) => ({ ...row, level: group.level }))
          )
        }
      } else {
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
          error: `La combinación genera ${modalityRows.length} pruebas (máximo ${MAX_BULK_MODALITIES}).`,
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
    return { success: true, eventId: created.id }
  } catch (error) {
    console.error("saveEvent error:", error)
    return { success: false, error: "No se pudo guardar el evento." }
  }
}

export async function setEventStatus(
  eventId: string,
  status: "DRAFT" | "OPEN" | "CLOSED"
): Promise<ActionResult> {
  await requireAdmin()

  if (!["DRAFT", "OPEN", "CLOSED"].includes(status)) {
    return { success: false, error: "Estado inválido." }
  }

  if (status === "OPEN") {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        season: { include: { fees: true } },
        modalities: { where: { isActive: true } },
        disciplineConfigs: true,
      },
    })
    if (!event) return { success: false, error: "Evento no encontrado." }
    if (!event.seasonId || !event.season) {
      return { success: false, error: "Asigna una temporada antes de abrir." }
    }
    if (event.registrationDeadline <= new Date()) {
      return { success: false, error: "El cierre de inscripciones ya venció." }
    }
    if (event.modalities.length === 0) {
      return { success: false, error: "Agrega al menos una prueba activa antes de abrir." }
    }

    const badLeagueModality = event.isLeague
      ? event.modalities.find(
          (modality) =>
            modality.pricePerMatch === null ||
            modality.matchesPerTeam === null ||
            modality.matchesPerTeam < 1 ||
            modality.matchesPerTeam > 40 ||
            modality.expectedTeams === null ||
            modality.expectedTeams < 1 ||
            modality.expectedTeams > 40 ||
            Number(modality.price) !==
              leagueEntryPrice({
                pricePerMatch: Number(modality.pricePerMatch),
                matchesPerTeam: modality.matchesPerTeam,
              })
        )
      : null
    if (badLeagueModality) {
      return {
        success: false,
        error: `Completa el precio por partido y el fixture de «${badLeagueModality.name}» antes de abrir.`,
      }
    }

    // Una disciplina que cobra cuota fija sin monto no puede vender nada.
    const misconfigured = event.disciplines.find(
      (discipline) =>
        !isPricingConfigurationValid(
          disciplineConfigFor(event.disciplineConfigs, discipline)
        )
    )
    if (misconfigured) {
      return {
        success: false,
        error: `La cuota fija por deportista de ${disciplineLabel(misconfigured)} debe ser mayor que cero.`,
      }
    }

    // En «Sub-N» la prueba solo puede tener piso de año, o quedar sin ambos
    // límites cuando es Open. Un tope superior excluiría a los más jóvenes.
    const badAgeRule = event.modalities.find(
      (modality) =>
        !isAgeRuleConfigurationValid(
          modality,
          disciplineConfigFor(event.disciplineConfigs, modality.discipline)
        )
    )
    if (badAgeRule) {
      return {
        success: false,
        error: `«${badAgeRule.name}» usa categorías Sub-N/Open: deja vacío el año 'hasta'.`,
      }
    }

    const fees = new Set(event.season.fees.map((fee) => fee.discipline))
    const invalid = event.modalities.find(
      (modality) =>
        !event.disciplines.includes(modality.discipline) ||
        !fees.has(modality.discipline) ||
        (modality.allowsCategoryUpgrade &&
          (modality.discipline !== "ARTISTIC_SWIMMING" ||
            modality.categoryUpgradeBirthYear === null))
    )
    if (invalid) {
      return {
        success: false,
        error:
          "Hay pruebas cuya disciplina, cuota o regla de categoría no coincide con la temporada.",
      }
    }
  }

  try {
    await prisma.event.update({ where: { id: eventId }, data: { status } })
  } catch {
    return { success: false, error: "Evento no encontrado." }
  }

  revalidatePath(`/admin/eventos/${eventId}`)
  revalidatePath("/admin/eventos")
  revalidatePath("/eventos")
  return { success: true }
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  await requireAdmin()

  const registrations = await prisma.registration.count({
    where: { modality: { eventId } },
  })
  if (registrations > 0) {
    return {
      success: false,
      error: "El evento ya tiene inscripciones; ciérralo en lugar de eliminarlo.",
    }
  }

  await prisma.event.delete({ where: { id: eventId } })
  revalidatePath("/admin/eventos")
  return { success: true }
}

// ==================== MODALIDADES ====================

const modalitySchema = z.object({
  id: z.string().optional(),
  eventId: z.string().min(1),
  discipline: z.enum(DISCIPLINE_VALUES),
  name: z.string().trim().min(2, "Nombre de la prueba requerido"),
  category: z.string().trim().max(80).optional(),
  sexRule: z.enum(["MALE", "FEMALE", "MIXED", "ANY"]),
  birthYearFrom: z.string().optional(),
  birthYearTo: z.string().optional(),
  allowsCategoryUpgrade: z.boolean(),
  minAthletes: z.coerce.number().int().min(1).max(20),
  maxAthletes: z.coerce.number().int().min(1).max(20),
  price: z.coerce.number().min(0).max(100000),
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
    return { success: false, error: "Años de nacimiento inválidos (ej. 2012)." }
  }
  if (birthYearFrom !== null && birthYearTo !== null && birthYearFrom > birthYearTo) {
    return { success: false, error: "El año 'desde' no puede ser mayor que 'hasta'." }
  }
  if (parsed.data.minAthletes > parsed.data.maxAthletes) {
    return { success: false, error: "Mín. de deportistas no puede superar el máx." }
  }
  // El año que sube es birthYearTo + 1: sin tope no hay categoría inferior que
  // pueda subir y la casilla no significaría nada.
  if (parsed.data.allowsCategoryUpgrade && birthYearTo === null) {
    return {
      success: false,
      error:
        "«Sube de categoría» necesita un año de nacimiento 'hasta': es el tope de la categoría.",
    }
  }


  const event = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    include: {
      season: { include: { categories: true } },
      disciplineConfigs: true,
    },
  })
  if (!event) return { success: false, error: "Evento no encontrado." }
  if (!event.disciplines.includes(parsed.data.discipline as Discipline)) {
    return {
      success: false,
      error: "La disciplina de la prueba no está habilitada en este evento.",
    }
  }
  if (
    parsed.data.allowsCategoryUpgrade &&
    parsed.data.discipline !== "ARTISTIC_SWIMMING"
  ) {
    return {
      success: false,
      error: "«Sube de categoría» solo aplica a natación artística.",
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
        "Esta disciplina usa categorías Sub-N/Open: deja vacío el año de nacimiento 'hasta'.",
    }
  }

  let categoryUpgradeBirthYear: number | null = null
  if (parsed.data.allowsCategoryUpgrade && birthYearTo !== null) {
    if (!event.season) {
      return {
        success: false,
        error: "Asigna una temporada al evento para configurar el ascenso.",
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
        error: `La temporada no define una categoría inferior contigua para el año ${categoryUpgradeBirthYear}.`,
      }
    }
  }

  const capacityText = (parsed.data.capacity ?? "").trim()
  const capacity = capacityText ? Number(capacityText) : null
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    return { success: false, error: "Cupo inválido." }
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
          "Indica el precio por partido, los partidos por equipo y los equipos esperados.",
      }
    }
    price = leagueEntryPrice({ pricePerMatch, matchesPerTeam })
    leagueFields = {
      pricePerMatch: new Prisma.Decimal(pricePerMatch.toFixed(2)),
      matchesPerTeam,
      expectedTeams,
    }
  }

  const data = {
    eventId: parsed.data.eventId,
    discipline: parsed.data.discipline as Discipline,
    name: parsed.data.name,
    category: parsed.data.category || null,
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
    return { success: false, error: "No se pudo guardar la prueba." }
  }

  revalidatePath(`/admin/eventos/${parsed.data.eventId}`)
  return { success: true }
}

export async function toggleModalityActive(modalityId: string): Promise<ActionResult> {
  await requireAdmin()

  const modality = await prisma.eventModality.findUnique({ where: { id: modalityId } })
  if (!modality) return { success: false, error: "Prueba no encontrada." }

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
  if (!modality) return { success: false, error: "Prueba no encontrada." }

  if (modality._count.registrations > 0) {
    return {
      success: false,
      error: "La prueba tiene inscripciones; desactívala en lugar de eliminarla.",
    }
  }

  await prisma.eventModality.delete({ where: { id: modalityId } })
  revalidatePath(`/admin/eventos/${modality.eventId}`)
  return { success: true }
}

// ==================== GENERADOR MASIVO ====================

const bulkSchema = z.object({
  eventId: z.string().min(1),
  discipline: z.enum(DISCIPLINE_VALUES),
  namesText: z.string().trim().min(1, "Ingresa al menos una prueba"),
  categoriesText: z.string().trim(),
  sexRules: z.array(z.enum(["MALE", "FEMALE", "MIXED", "ANY"])).min(1, "Selecciona al menos un sexo"),
  allowsCategoryUpgrade: z.boolean(),
  minAthletes: z.coerce.number().int().min(1).max(20),
  maxAthletes: z.coerce.number().int().min(1).max(20),
  price: z.coerce.number().min(0).max(100000),
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
    return { success: false, error: "Mín. de deportistas no puede superar el máx." }
  }

  const event = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    include: {
      season: { include: { categories: true } },
      disciplineConfigs: true,
    },
  })
  if (!event) return { success: false, error: "Evento no encontrado." }
  if (!event.disciplines.includes(parsed.data.discipline as Discipline)) {
    return {
      success: false,
      error: "La disciplina no está habilitada en este evento.",
    }
  }
  if (
    parsed.data.allowsCategoryUpgrade &&
    parsed.data.discipline !== "ARTISTIC_SWIMMING"
  ) {
    return {
      success: false,
      error: "«Sube de categoría» solo aplica a natación artística.",
    }
  }
  if (!event.season) {
    return {
      success: false,
      error: "Asigna una temporada al evento antes de generar sus pruebas.",
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
          "Indica el precio por partido, los partidos por equipo y los equipos esperados.",
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
          error: `La temporada no define una categoría inferior contigua para el año ${upgradeYear}.`,
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
  }).map((row) => ({ ...row, eventId: event.id, ...leagueFields }))

  if (rows.length === 0) {
    return { success: false, error: "La combinación no genera ninguna prueba." }
  }
  if (rows.length > MAX_BULK_MODALITIES) {
    return {
      success: false,
      error: `La combinación genera ${rows.length} pruebas (máximo ${MAX_BULK_MODALITIES} por lote).`,
    }
  }

  await prisma.eventModality.createMany({ data: rows })

  revalidatePath(`/admin/eventos/${event.id}`)
  return { success: true, created: rows.length }
}
