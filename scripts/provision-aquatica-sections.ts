import "dotenv/config"
import { randomBytes } from "node:crypto"
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import bcrypt from "bcryptjs"
import { PrismaClient, type Discipline } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const CONFIRMATION = "SPLIT_AQUATICA_BY_DISCIPLINE"

interface CredentialFile {
  version: number
  generatedAt: string
  warning: string
  credentials: Array<{ club: string; username: string; password: string }>
}

const accounts: Array<{
  username: string
  name: string
  disciplineAccess: Discipline[]
}> = [
  {
    username: "aquatica",
    name: "Coordinador Aquatica Sport Center",
    disciplineAccess: [],
  },
  {
    username: "aquatica-polo",
    name: "Delegado Aquatica · Polo Acuático",
    disciplineAccess: ["WATER_POLO"],
  },
  {
    username: "aquatica-artistica",
    name: "Delegado Aquatica · Natación Artística",
    disciplineAccess: ["ARTISTIC_SWIMMING"],
  },
]

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function password() {
  return randomBytes(24).toString("base64url")
}

function credentialFile(path: string): CredentialFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialFile>
  if (parsed.version !== 1 || !Array.isArray(parsed.credentials)) {
    throw new Error("El archivo de credenciales no tiene el formato esperado.")
  }
  return parsed as CredentialFile
}

async function main() {
  if (arg("confirm") !== CONFIRMATION) {
    throw new Error(`Exige --confirm=${CONFIRMATION}.`)
  }
  if (!process.env.IMPORT_DATABASE_URL) {
    throw new Error("Exige IMPORT_DATABASE_URL; DATABASE_URL no se usa para escribir.")
  }
  const credentialsPath = resolve(arg("credentials-file") ?? "")
  if (!arg("credentials-file") || !existsSync(credentialsPath)) {
    throw new Error("Exige un --credentials-file privado existente.")
  }

  const original = credentialFile(credentialsPath)
  const generated = await Promise.all(
    accounts.map(async (account) => {
      const nextPassword = password()
      return {
        ...account,
        password: nextPassword,
        passwordHash: await bcrypt.hash(nextPassword, 12),
      }
    })
  )
  const next: CredentialFile = {
    ...original,
    generatedAt: new Date().toISOString(),
    credentials: [
      ...original.credentials.filter(
        (item) => !accounts.some((account) => account.username === item.username)
      ),
      ...generated.map((account) => ({
        club: "Aquatica Sport Center",
        username: account.username,
        password: account.password,
      })),
    ].sort((left, right) =>
      `${left.club}:${left.username}`.localeCompare(
        `${right.club}:${right.username}`,
        "es"
      )
    ),
  }

  const temporaryPath = `${credentialsPath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })

  const pool = new Pool({ connectionString: process.env.IMPORT_DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  let replacedFile = false
  try {
    const club = await prisma.club.findUnique({ where: { code: "AQUATICA" } })
    if (!club?.isActive) throw new Error("Aquatica no existe o está inactivo.")

    const conflicts = await prisma.user.findMany({
      where: { username: { in: accounts.map((account) => account.username) } },
      select: { username: true, clubId: true },
    })
    if (conflicts.some((user) => user.clubId !== club.id)) {
      throw new Error("Un usuario propuesto pertenece a otro club; no se escribió nada.")
    }

    await prisma.$transaction(
      async (tx) => {
        for (const account of generated) {
          await tx.user.upsert({
            where: { username: account.username },
            create: {
              username: account.username,
              name: account.name,
              passwordHash: account.passwordHash,
              role: "CLUB",
              clubId: club.id,
              disciplineAccess: account.disciplineAccess,
              isActive: true,
              mustChangePassword: true,
            },
            update: {
              name: account.name,
              passwordHash: account.passwordHash,
              mustChangePassword: true,
              sessionVersion: { increment: 1 },
              clubId: club.id,
              disciplineAccess: account.disciplineAccess,
              isActive: true,
            },
          })
        }
        renameSync(temporaryPath, credentialsPath)
        replacedFile = true
      },
      { maxWait: 10_000, timeout: 30_000 }
    )

    console.log("Aquatica separado en coordinador, Polo y Natación Artística.")
    console.log("La credencial expuesta del coordinador fue rotada.")
    console.log(`Credenciales entregables: ${next.credentials.length} (${credentialsPath})`)
  } catch (error) {
    if (replacedFile) {
      writeFileSync(credentialsPath, `${JSON.stringify(original, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
    }
    throw error
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "No se pudo separar Aquatica.")
  process.exitCode = 1
})
