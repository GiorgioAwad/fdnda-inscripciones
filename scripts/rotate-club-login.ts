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
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const CONFIRMATION = "ROTATE_FDNDA_CLUB_LOGIN"

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

interface CredentialFile {
  version: number
  generatedAt: string
  warning: string
  credentials: Array<{ club: string; username: string; password: string }>
}

function parseCredentialFile(path: string): CredentialFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialFile>
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.credentials) ||
    parsed.credentials.some(
      (item) =>
        !item ||
        typeof item.club !== "string" ||
        typeof item.username !== "string" ||
        typeof item.password !== "string"
    )
  ) {
    throw new Error("El archivo de credenciales no tiene el formato esperado.")
  }
  return parsed as CredentialFile
}

async function main() {
  const clubCode = arg("club-code")?.trim().toUpperCase()
  const usernameArg = arg("username")?.trim().toLowerCase()
  const credentialsPath = resolve(arg("credentials-file") ?? "")
  if (arg("confirm") !== CONFIRMATION) throw new Error(`Exige --confirm=${CONFIRMATION}.`)
  if (!clubCode) throw new Error("Exige --club-code.")
  if (!arg("credentials-file") || !existsSync(credentialsPath)) {
    throw new Error("Exige un --credentials-file existente.")
  }
  if (!process.env.IMPORT_DATABASE_URL) throw new Error("Exige IMPORT_DATABASE_URL.")

  const currentFile = parseCredentialFile(credentialsPath)
  const pool = new Pool({ connectionString: process.env.IMPORT_DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const temporaryPath = `${credentialsPath}.tmp-${process.pid}`
  let replacedFile = false

  try {
    const club = await prisma.club.findUnique({
      where: { code: clubCode },
      include: { users: { where: { role: "CLUB" } } },
    })
    if (!club || !club.isActive) throw new Error("Club activo no encontrado.")
    const candidates = usernameArg
      ? club.users.filter((user) => user.username === usernameArg)
      : club.users
    if (candidates.length !== 1) {
      throw new Error("El club no tiene un único usuario CLUB; especifica --username.")
    }
    const user = candidates[0]
    const password = randomBytes(24).toString("base64url")
    const passwordHash = await bcrypt.hash(password, 12)
    const nextFile: CredentialFile = {
      ...currentFile,
      generatedAt: new Date().toISOString(),
      credentials: [
        ...currentFile.credentials.filter((item) => item.username !== user.username),
        { club: club.name, username: user.username, password },
      ].sort((left, right) => left.club.localeCompare(right.club, "es")),
    }
    writeFileSync(temporaryPath, `${JSON.stringify(nextFile, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })

    await prisma.$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            isActive: true,
            mustChangePassword: true,
            sessionVersion: { increment: 1 },
          },
        })
        renameSync(temporaryPath, credentialsPath)
        replacedFile = true
      },
      { maxWait: 10_000, timeout: 30_000 }
    )
    console.log(`Credencial rotada para ${club.code}/${user.username}.`)
    console.log(`Archivo privado actualizado: ${credentialsPath}`)
    console.log(`Credenciales entregables en el archivo: ${nextFile.credentials.length}`)
  } catch (error) {
    if (replacedFile) {
      writeFileSync(credentialsPath, `${JSON.stringify(currentFile, null, 2)}\n`, {
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
  console.error(error instanceof Error ? error.message : "No se pudo rotar la credencial.")
  process.exitCode = 1
})
