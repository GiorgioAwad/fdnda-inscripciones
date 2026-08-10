import "dotenv/config"
import { randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import bcrypt from "bcryptjs"
import { PrismaClient, type Discipline } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import {
  clubCodeFor,
  foundationDocumentFingerprint,
  normalizeClubIdentity,
  parseFoundationWorkbooks,
  type FoundationAthlete,
} from "../src/lib/foundation-import"

const APPLY_CONFIRMATION = "IMPORT_FDNDA_MASTERDATA"
const projectRoot = resolve(__dirname, "..")

interface Arguments {
  apply: boolean
  retireDemoFixtures: boolean
  excludeInvalidRows: boolean
  artisticDivingPath: string
  waterPoloPath: string
  credentialsOut?: string
  confirmation?: string
  reportOut: string
}

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function parseArguments(): Arguments {
  const apply = process.argv.includes("--apply")
  if (process.argv.includes("--dry-run") && apply) {
    throw new Error("Usa --dry-run o --apply, no ambos.")
  }
  return {
    apply,
    retireDemoFixtures: process.argv.includes("--retire-demo-fixtures"),
    excludeInvalidRows: process.argv.includes("--exclude-invalid-rows"),
    artisticDivingPath: resolve(
      argumentValue("artistic-diving") ??
        resolve(projectRoot, ".private-imports", "BD ARTISTICA Y CLAVADOS.xlsx")
    ),
    waterPoloPath: resolve(
      argumentValue("water-polo") ??
        resolve(projectRoot, ".private-imports", "BD POLO ACUATICO.xlsx")
    ),
    credentialsOut: argumentValue("credentials-out"),
    confirmation: argumentValue("confirm"),
    reportOut: resolve(
      argumentValue("report-out") ??
        resolve(projectRoot, ".private-imports", "foundation-import-report.json")
    ),
  }
}

function assertInputFile(path: string): void {
  if (!existsSync(path)) throw new Error(`No existe el archivo requerido: ${path}`)
}

function printSummary(result: ReturnType<typeof parseFoundationWorkbooks>): void {
  console.log("\nResumen de validación")
  console.log(`  Artística/clavados: ${result.stats.artisticDivingRows} filas`)
  console.log(`  Polo acuático:      ${result.stats.waterPoloRows} filas`)
  console.log(`  Deportistas únicos: ${result.stats.uniqueAthletes}`)
  console.log(`  Filas fusionadas:   ${result.stats.duplicateRowsMerged}`)
  console.log(`  Clubes únicos:      ${result.stats.clubs}`)
  console.log(`  Filas excluidas:    ${result.stats.excludedRows}`)
  console.log("\nClubes y usuarios propuestos")
  for (const club of result.clubs) {
    console.log(`  ${club.code.padEnd(18)} ${club.username.padEnd(18)} ${club.athleteCount} deportistas`)
  }
  const errors = result.issues.filter((item) => item.severity === "ERROR")
  const warnings = result.issues.filter((item) => item.severity === "WARNING")
  console.log(`\nValidación: ${errors.length} errores, ${warnings.length} advertencias.`)
  for (const item of result.issues) {
    console.log(
      `  [${item.severity}] ${item.source} fila(s) ${item.rowNumbers.join(", ")}: ${item.message}`
    )
  }
}

function safeCredentialsPath(value: string): string {
  const path = isAbsolute(value) ? resolve(value) : resolve(projectRoot, value)
  const insideProject = !relative(projectRoot, path).startsWith("..")
  const privateRoot = resolve(projectRoot, ".private-imports")
  const insidePrivate = !relative(privateRoot, path).startsWith("..")
  if (insideProject && !insidePrivate) {
    throw new Error(
      "El archivo de credenciales no puede guardarse dentro del repositorio. Usa .private-imports/ o una ruta externa segura."
    )
  }
  if (!existsSync(dirname(path))) {
    throw new Error(`No existe la carpeta de salida para credenciales: ${dirname(path)}`)
  }
  return path
}

function oneTimePassword(): string {
  return randomBytes(24).toString("base64url")
}

function uniqueUsername(base: string, used: Set<string>): string {
  let candidate = base.toLowerCase().slice(0, 30)
  let suffix = 2
  while (used.has(candidate)) {
    const marker = `-${suffix}`
    candidate = `${base.toLowerCase().slice(0, 30 - marker.length)}${marker}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

function dateFromISO(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function unionDisciplines(current: Discipline[], imported: FoundationAthlete["disciplines"]): Discipline[] {
  return [...new Set([...current, ...imported])] as Discipline[]
}

function aliasMatchAllowed(code: string, existingName: string, sourceName: string): boolean {
  const key = `${code}:${normalizeClubIdentity(existingName)}:${normalizeClubIdentity(sourceName)}`
  return new Set([
    "REGATAS:CLUB REGATAS LIMA:CLUB DE REGATAS LIMA",
    "TERRAZAS:CLUB TERRAZAS MIRAFLORES:CLUB TENNIS LAS TERRAZAS MIRAF",
  ]).has(key)
}

const DEMO_ATHLETES = [
  ["70000001", "Valeria", "Torres Díaz"],
  ["70000002", "Camila", "Rojas Paredes"],
  ["70000003", "Sebastián", "Guerra Luna"],
  ["70000004", "Diego", "Salas Quispe"],
  ["70000005", "Luciana", "Fernández Cano"],
  ["70000006", "Ariana", "Mendoza Silva"],
  ["70000007", "Mateo", "Castro Vega"],
  ["70000008", "Micaela", "Herrera Ríos"],
  ["71000001", "Rafaela", "Campos Soto"],
  ["71000002", "Emilia", "Vargas Poma"],
  ["71000003", "Thiago", "Nuñez Ramos"],
  ["71000004", "Gael", "Paz Aguilar"],
  ["71000005", "Antonella", "Ibáñez Cruz"],
  ["71000006", "Renata", "Morales Chu"],
  ["71000007", "Joaquín", "Delgado Peña"],
  ["71000008", "Brianna", "Flores Inga"],
] as const

const POLO_DEMO_FIRST_NAMES = ["Adrián", "Bruno", "César", "Dante", "Emilio", "Fabio", "Gonzalo", "Hugo"]
const POLO_DEMO_LAST_NAMES = [
  "Ávila Ponce",
  "Bravo Lira",
  "Cueva Rosas",
  "Durán Neyra",
  "Escobar Tello",
  "Farfán Loza",
  "Gamarra Ruiz",
  "Huamán Vela",
]

function demoAthleteKeys(): Set<string> {
  const values: Array<readonly [string, string, string]> = [...DEMO_ATHLETES]
  for (let clubIndex = 0; clubIndex < 2; clubIndex += 1) {
    for (let index = 0; index < POLO_DEMO_FIRST_NAMES.length; index += 1) {
      values.push([
        `7${2 + clubIndex}00000${index + 1}`,
        POLO_DEMO_FIRST_NAMES[index],
        POLO_DEMO_LAST_NAMES[index],
      ])
    }
  }
  return new Set(
    values.map(
      ([doc, first, last]) =>
        `${doc}:${normalizeClubIdentity(first)}:${normalizeClubIdentity(last)}`
    )
  )
}

async function applyImport(
  args: Arguments,
  result: ReturnType<typeof parseFoundationWorkbooks>
): Promise<void> {
  if (args.confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`--apply exige --confirm=${APPLY_CONFIRMATION}.`)
  }
  const connectionString = process.env.IMPORT_DATABASE_URL
  if (!connectionString) {
    throw new Error("--apply exige IMPORT_DATABASE_URL. DATABASE_URL no se usa para evitar escrituras accidentales.")
  }
  if (!args.credentialsOut) throw new Error("--apply exige --credentials-out=<ruta privada>.")
  const credentialsPath = safeCredentialsPath(args.credentialsOut)
  const credentialsFd = openSync(credentialsPath, "wx", 0o600)
  const pool = new Pool({ connectionString })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  let committed = false

  try {
    const existingClubs = await prisma.club.findMany()
    const allExistingUsers = await prisma.user.findMany()
    const existingUsers = allExistingUsers.filter((user) => user.role === "CLUB")
    const existingAthletes = await prisma.athlete.findMany({
      where: { docNumber: { in: result.athletes.map((athlete) => athlete.docNumber) } },
      select: {
        id: true,
        docNumber: true,
        firstNames: true,
        lastNames: true,
        birthDate: true,
        sex: true,
        clubId: true,
        disciplines: true,
      },
    })
    const existingAthleteByDoc = new Map(existingAthletes.map((athlete) => [athlete.docNumber, athlete]))
    const usedUsernames = new Set(allExistingUsers.map((user) => user.username))

    for (const athlete of result.athletes) {
      const current = existingAthleteByDoc.get(athlete.docNumber)
      if (!current) continue
      const currentBirthDate = [
        current.birthDate.getUTCFullYear(),
        String(current.birthDate.getUTCMonth() + 1).padStart(2, "0"),
        String(current.birthDate.getUTCDate()).padStart(2, "0"),
      ].join("-")
      const identityMatches =
        normalizeClubIdentity(current.firstNames) === normalizeClubIdentity(athlete.firstNames) &&
        normalizeClubIdentity(current.lastNames) === normalizeClubIdentity(athlete.lastNames) &&
        currentBirthDate === athlete.birthDateISO &&
        current.sex === athlete.sex
      if (!identityMatches) {
        throw new Error(
          `Conflicto con un deportista existente (${foundationDocumentFingerprint(athlete.docNumber)}). ` +
            "Coincide el documento pero no la identidad; no se escribió nada."
        )
      }
    }

    const generatedCredentials: Array<{ club: string; username: string; password: string }> = []
    const preparedPasswords = new Map<string, { password: string; hash: string }>()
    for (const club of result.clubs) {
      const existingByCode = existingClubs.find((item) => item.code === club.code)
      const existingByName = existingClubs.find(
        (item) => normalizeClubIdentity(item.name) === normalizeClubIdentity(club.name)
      )
      if (existingByCode && existingByName && existingByCode.id !== existingByName.id) {
        throw new Error(`Conflicto de club para el código ${club.code}; no se escribió nada.`)
      }
      if (
        existingByCode &&
        normalizeClubIdentity(existingByCode.name) !== normalizeClubIdentity(club.name) &&
        !aliasMatchAllowed(club.code, existingByCode.name, club.name)
      ) {
        throw new Error(`El código ${club.code} pertenece a otro club; no se escribió nada.`)
      }
      const existing = existingByCode ?? existingByName
      const clubUsers = existing ? existingUsers.filter((user) => user.clubId === existing.id) : []
      const fixtureUser = clubUsers.find(
        (user) =>
          args.retireDemoFixtures &&
          ((club.code === "REGATAS" && user.username === "regatas") ||
            (club.code === "TERRAZAS" && user.username === "terrazas"))
      )
      if (!clubUsers.length || fixtureUser) {
        const key = fixtureUser?.id ?? `new:${club.code}`
        const password = oneTimePassword()
        preparedPasswords.set(key, { password, hash: await bcrypt.hash(password, 12) })
      }
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const clubIds = new Map<string, string>()
      let clubsCreated = 0
      let usersCreated = 0
      let passwordsRotated = 0

      for (const sourceClub of result.clubs) {
        const existingByCode = existingClubs.find((item) => item.code === sourceClub.code)
        const existingByName = existingClubs.find(
          (item) => normalizeClubIdentity(item.name) === normalizeClubIdentity(sourceClub.name)
        )
        let club = existingByCode ?? existingByName
        if (club) {
          club = await tx.club.update({ where: { id: club.id }, data: { isActive: true } })
        } else {
          club = await tx.club.create({
            data: { name: sourceClub.name, code: clubCodeFor(sourceClub.name), isActive: true },
          })
          clubsCreated += 1
        }
        clubIds.set(normalizeClubIdentity(sourceClub.name), club.id)

        const clubUsers = existingUsers.filter((user) => user.clubId === club.id)
        const fixtureUser = clubUsers.find(
          (user) =>
            args.retireDemoFixtures &&
            ((club.code === "REGATAS" && user.username === "regatas") ||
              (club.code === "TERRAZAS" && user.username === "terrazas"))
        )
        if (fixtureUser) {
          const prepared = preparedPasswords.get(fixtureUser.id)
          if (!prepared) throw new Error("No se pudo preparar la rotación de credenciales.")
          await tx.user.update({
            where: { id: fixtureUser.id },
            data: {
              passwordHash: prepared.hash,
              isActive: true,
              mustChangePassword: true,
              sessionVersion: { increment: 1 },
            },
          })
          generatedCredentials.push({ club: club.name, username: fixtureUser.username, password: prepared.password })
          passwordsRotated += 1
        } else if (clubUsers.length === 0) {
          const prepared = preparedPasswords.get(`new:${sourceClub.code}`)
          if (!prepared) throw new Error("No se pudo preparar la credencial del club.")
          const username = uniqueUsername(sourceClub.username, usedUsernames)
          await tx.user.create({
            data: {
              username,
              name: `Delegado ${club.name}`,
              passwordHash: prepared.hash,
              role: "CLUB",
              clubId: club.id,
              isActive: true,
              mustChangePassword: true,
            },
          })
          generatedCredentials.push({ club: club.name, username, password: prepared.password })
          usersCreated += 1
        } else {
          await tx.user.updateMany({ where: { clubId: club.id, role: "CLUB" }, data: { isActive: true } })
        }
      }

      let athletesCreated = 0
      let athletesUpdated = 0
      for (const athlete of result.athletes) {
        const clubId = clubIds.get(normalizeClubIdentity(athlete.clubName))
        if (!clubId) throw new Error("No se resolvió un club; no se escribió nada.")
        const current = existingAthleteByDoc.get(athlete.docNumber)
        if (current) {
          await tx.athlete.update({
            where: { id: current.id },
            data: {
              firstNames: athlete.firstNames,
              lastNames: athlete.lastNames,
              docType: athlete.docType,
              birthDate: dateFromISO(athlete.birthDateISO),
              sex: athlete.sex,
              clubId,
              disciplines: unionDisciplines(current.disciplines, athlete.disciplines),
              isActive: true,
            },
          })
          athletesUpdated += 1
        } else {
          await tx.athlete.create({
            data: {
              firstNames: athlete.firstNames,
              lastNames: athlete.lastNames,
              docType: athlete.docType,
              docNumber: athlete.docNumber,
              birthDate: dateFromISO(athlete.birthDateISO),
              sex: athlete.sex,
              clubId,
              disciplines: athlete.disciplines,
            },
          })
          athletesCreated += 1
        }
      }

      let demoAthletesRetired = 0
      if (args.retireDemoFixtures) {
        const importedDocs = new Set(result.athletes.map((athlete) => athlete.docNumber))
        const fixtures = demoAthleteKeys()
        const candidates = await tx.athlete.findMany({
          where: { docNumber: { in: [...fixtures].map((key) => key.split(":", 1)[0]) }, isActive: true },
          select: { id: true, docNumber: true, firstNames: true, lastNames: true },
        })
        const matchedIds = candidates
          .filter(
            (athlete) =>
              !importedDocs.has(athlete.docNumber) &&
              fixtures.has(
                `${athlete.docNumber}:${normalizeClubIdentity(athlete.firstNames)}:${normalizeClubIdentity(athlete.lastNames)}`
              )
          )
          .map((athlete) => athlete.id)
        if (matchedIds.length) {
          const retired = await tx.athlete.updateMany({
            where: { id: { in: matchedIds } },
            data: { isActive: false },
          })
          demoAthletesRetired = retired.count
        }
      }

      const credentialPayload = {
        version: 1,
        generatedAt: new Date().toISOString(),
        warning: "Credenciales de entrega única. Transfiéralas por un canal seguro y elimine este archivo después.",
        credentials: generatedCredentials,
      }
      writeFileSync(credentialsFd, `${JSON.stringify(credentialPayload, null, 2)}\n`, "utf8")
      fsyncSync(credentialsFd)

      return {
        clubsCreated,
        usersCreated,
        passwordsRotated,
        athletesCreated,
        athletesUpdated,
        demoAthletesRetired,
        credentialsWritten: generatedCredentials.length,
      }
    }, { maxWait: 10_000, timeout: 120_000 })
    committed = true
    console.log("\nImportación confirmada en la base indicada por IMPORT_DATABASE_URL.")
    console.log(`  Clubes creados: ${outcome.clubsCreated}`)
    console.log(`  Usuarios creados: ${outcome.usersCreated}`)
    console.log(`  Contraseñas demo rotadas: ${outcome.passwordsRotated}`)
    console.log(`  Deportistas creados: ${outcome.athletesCreated}`)
    console.log(`  Deportistas actualizados: ${outcome.athletesUpdated}`)
    console.log(`  Deportistas demo retirados: ${outcome.demoAthletesRetired}`)
    console.log(`  Credenciales nuevas guardadas: ${outcome.credentialsWritten} (${credentialsPath})`)
  } finally {
    closeSync(credentialsFd)
    await prisma.$disconnect()
    await pool.end()
    if (!committed && existsSync(credentialsPath)) unlinkSync(credentialsPath)
  }
}

async function main(): Promise<void> {
  const args = parseArguments()
  assertInputFile(args.artisticDivingPath)
  assertInputFile(args.waterPoloPath)
  const result = parseFoundationWorkbooks(
    {
      artisticDiving: readFileSync(args.artisticDivingPath),
      waterPolo: readFileSync(args.waterPoloPath),
    },
    { excludeInvalidRows: args.excludeInvalidRows }
  )
  printSummary(result)
  writeFileSync(
    args.reportOut,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: args.apply ? "apply-requested" : "dry-run",
        stats: result.stats,
        clubs: result.clubs,
        excludedRows: result.excludedRows,
        issues: result.issues,
      },
      null,
      2
    )}\n`,
    "utf8"
  )
  console.log(`Reporte sanitizado: ${args.reportOut}`)
  if (result.issues.some((item) => item.severity === "ERROR")) {
    throw new Error("La validación tiene errores; no se escribió nada.")
  }
  if (!args.apply) {
    console.log("\nDry-run completado. No se abrió ninguna conexión a base de datos.")
    return
  }
  await applyImport(args, result)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Error inesperado de importación.")
  process.exitCode = 1
})
