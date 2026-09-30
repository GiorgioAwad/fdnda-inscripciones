import "dotenv/config"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import bcrypt from "bcryptjs"
import { PrismaClient, type Discipline } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const CONFIRMATION = "PROVISION_FOUNDATION_DELEGATES"

const delegates: Array<{
  clubCode: string
  coordinator: string
  username: string
  discipline: Discipline
  title: string
}> = [
  { clubCode: "AQUALIFE", coordinator: "aqualife", username: "aqualife-clavados", discipline: "DIVING", title: "Clavados" },
  { clubCode: "AQUALIMA", coordinator: "aqualima", username: "aqualima-clavados", discipline: "DIVING", title: "Clavados" },
  { clubCode: "CAMPO-MARTE", coordinator: "campo-marte", username: "campo-marte-waterpolo", discipline: "WATER_POLO", title: "Polo Acuático" },
  { clubCode: "DRAGA-AREQUIPA", coordinator: "draga-arequipa", username: "draga-arequipa-waterpolo", discipline: "WATER_POLO", title: "Polo Acuático" },
  { clubCode: "LIMASYNCHRO", coordinator: "limasynchro", username: "limasynchro-artistica", discipline: "ARTISTIC_SWIMMING", title: "Natación Artística" },
  { clubCode: "NATACION-EXTREM", coordinator: "natacion-extrem", username: "natacion-extrem-waterpolo", discipline: "WATER_POLO", title: "Polo Acuático" },
  { clubCode: "PADRE-JOSE-ASA", coordinator: "padre-jose-asa", username: "padre-jose-asa-waterpolo", discipline: "WATER_POLO", title: "Polo Acuático" },
  { clubCode: "RABER-TRUJILLO", coordinator: "raber-trujillo", username: "raber-trujillo-waterpolo", discipline: "WATER_POLO", title: "Polo Acuático" },
  { clubCode: "REGATAS", coordinator: "regatas", username: "regatas-waterpolo", discipline: "WATER_POLO", title: "Polo Acuático" },
  { clubCode: "TERRAZAS", coordinator: "terrazas", username: "terrazas-artistica", discipline: "ARTISTIC_SWIMMING", title: "Natación Artística" },
]

interface CredentialFile {
  version: number
  generatedAt: string
  warning: string
  credentials: Array<{ club: string; username: string; password: string }>
}

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  if (arg("confirm") !== CONFIRMATION) {
    throw new Error(`Exige --confirm=${CONFIRMATION}.`)
  }
  if (!process.env.IMPORT_DATABASE_URL) {
    throw new Error("Exige IMPORT_DATABASE_URL; DATABASE_URL no se usa para escribir.")
  }
  const fileArgument = arg("credentials-file")
  if (!fileArgument) throw new Error("Exige --credentials-file privado existente.")
  const credentialsPath = resolve(fileArgument)
  if (!existsSync(credentialsPath)) throw new Error("El archivo privado no existe.")

  const original = JSON.parse(readFileSync(credentialsPath, "utf8")) as CredentialFile
  if (original.version !== 1 || !Array.isArray(original.credentials)) {
    throw new Error("El archivo de credenciales no tiene el formato esperado.")
  }
  const usernames = new Set(original.credentials.map((item) => item.username))
  if (usernames.size !== original.credentials.length || delegates.some((item) => usernames.has(item.username))) {
    throw new Error("El archivo ya contiene delegados o nombres de usuario duplicados.")
  }

  const pool = new Pool({ connectionString: process.env.IMPORT_DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  let temporaryPath: string | undefined
  let replacedFile = false
  try {
    const clubs = await prisma.club.findMany({
      where: { code: { in: delegates.map((item) => item.clubCode) } },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        athletes: { where: { isActive: true }, select: { disciplines: true } },
        users: { where: { role: "CLUB" }, select: { username: true, isActive: true, disciplineAccess: true } },
      },
    })
    const byCode = new Map(clubs.map((club) => [club.code, club]))
    for (const delegate of delegates) {
      const club = byCode.get(delegate.clubCode)
      if (!club?.isActive || club.athletes.length === 0) {
        throw new Error(`Club ausente, inactivo o sin padrón: ${delegate.clubCode}`)
      }
      if (club.athletes.some((athlete) =>
        athlete.disciplines.length !== 1 || athlete.disciplines[0] !== delegate.discipline
      )) {
        throw new Error(`El padrón cambió de disciplina: ${delegate.clubCode}`)
      }
      if (!club.users.some((user) =>
        user.username === delegate.coordinator && user.isActive && user.disciplineAccess.length === 0
      )) {
        throw new Error(`Falta el coordinador activo: ${delegate.clubCode}`)
      }
    }
    if (clubs.length !== delegates.length) throw new Error("Faltan clubes del padrón esperado.")
    const conflicts = await prisma.user.findMany({
      where: { username: { in: delegates.map((item) => item.username) } },
      select: { username: true },
    })
    if (conflicts.length) throw new Error("Ya existe al menos un delegado; no se escribió nada.")

    const generated = await Promise.all(delegates.map(async (delegate) => {
      const password = randomBytes(24).toString("base64url")
      return { ...delegate, password, passwordHash: await bcrypt.hash(password, 12) }
    }))
    const next: CredentialFile = {
      ...original,
      generatedAt: new Date().toISOString(),
      credentials: [
        ...original.credentials,
        ...generated.map((item) => ({
          club: byCode.get(item.clubCode)!.name,
          username: item.username,
          password: item.password,
        })),
      ].sort((left, right) =>
        `${left.club}:${left.username}`.localeCompare(`${right.club}:${right.username}`, "es")
      ),
    }
    temporaryPath = `${credentialsPath}.tmp-${process.pid}`
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8", flag: "wx", mode: 0o600,
    })

    await prisma.$transaction(async (tx) => {
      for (const item of generated) {
        const club = byCode.get(item.clubCode)!
        await tx.user.create({
          data: {
            username: item.username,
            name: `Delegado ${club.name} · ${item.title}`,
            passwordHash: item.passwordHash,
            role: "CLUB",
            clubId: club.id,
            disciplineAccess: [item.discipline],
            isActive: true,
            mustChangePassword: true,
          },
        })
      }
      renameSync(temporaryPath!, credentialsPath)
      replacedFile = true
    }, { maxWait: 10_000, timeout: 30_000 })

    console.log(`Delegados creados: ${generated.length}. Credenciales privadas: ${next.credentials.length}.`)
    console.log(generated.map((item) => item.username).join(", "))
  } catch (error) {
    if (replacedFile) {
      writeFileSync(credentialsPath, `${JSON.stringify(original, null, 2)}\n`, {
        encoding: "utf8", mode: 0o600,
      })
    }
    throw error
  } finally {
    if (temporaryPath && existsSync(temporaryPath)) unlinkSync(temporaryPath)
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "No se pudieron crear los delegados.")
  process.exitCode = 1
})
