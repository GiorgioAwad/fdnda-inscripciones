import "dotenv/config"
import { randomBytes } from "node:crypto"
import { closeSync, existsSync, fsyncSync, openSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

// Crea un usuario ADMIN (federación) con una contraseña de un solo uso.
//
// El seed demo también crea un `admin`, pero arrastra clubes y deportistas de
// ejemplo y está bloqueado fuera de bases descartables: no sirve para dejar un
// admin en una base con el padrón real. Este script solo toca la tabla users.
//
//   $env:IMPORT_DATABASE_URL="<url>"
//   npx tsx scripts/provision-admin.ts --confirm=PROVISION_FDNDA_ADMIN \
//     --credentials-out=.private-imports/credenciales-admin.json \
//     [--username=admin] [--name="Administrador FDNDA"] [--email=admin@fdnda.pe]
//     [--no-force-password-change]
//
// Como en import-foundation-data, la escritura va por IMPORT_DATABASE_URL y no
// por DATABASE_URL, para que un .env cargado por descuido no acabe creando un
// administrador en producción. La contraseña se genera aquí, se guarda cifrada
// (bcrypt) y en claro SOLO en el archivo de --credentials-out, que no puede
// caer dentro del repositorio.

const CONFIRMATION = "PROVISION_FDNDA_ADMIN"
const projectRoot = resolve(__dirname, "..")

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

/** Un secreto en claro no puede quedar donde `git add .` lo alcance. */
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

async function main() {
  if (arg("confirm") !== CONFIRMATION) throw new Error(`Exige --confirm=${CONFIRMATION}.`)

  const connectionString = process.env.IMPORT_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "Exige IMPORT_DATABASE_URL. DATABASE_URL no se usa para evitar escrituras accidentales."
    )
  }

  const username = (arg("username") ?? "admin").trim().toLowerCase()
  const name = arg("name") ?? "Administrador FDNDA"
  const email = arg("email")?.trim() || null
  const forcePasswordChange = !process.argv.includes("--no-force-password-change")
  const credentialsOut = arg("credentials-out")
  if (!username) throw new Error("--username no puede estar vacío.")
  if (!credentialsOut) throw new Error("Exige --credentials-out=<ruta privada>.")

  const credentialsPath = safeCredentialsPath(credentialsOut)
  // 'wx' falla si ya existe: no se pisa un archivo de credenciales anterior.
  const credentialsFd = openSync(credentialsPath, "wx", 0o600)
  const pool = new Pool({ connectionString })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  let committed = false

  try {
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) {
      throw new Error(
        `Ya existe el usuario "${username}" (rol ${existing.role}). Este script no rota contraseñas: elige otro --username o rota la credencial aparte.`
      )
    }

    const password = randomBytes(24).toString("base64url")
    const passwordHash = await bcrypt.hash(password, 12)

    const created = await prisma.user.create({
      data: {
        username,
        name,
        email,
        passwordHash,
        role: "ADMIN",
        isActive: true,
        mustChangePassword: forcePasswordChange,
      },
      select: { id: true, username: true, role: true, mustChangePassword: true },
    })

    writeFileSync(
      credentialsFd,
      `${JSON.stringify(
        {
          version: 1,
          generatedAt: new Date().toISOString(),
          warning:
            "Credencial de administrador de entrega única. Transfiérala por un canal seguro y elimine este archivo después.",
          credentials: [{ role: "ADMIN", username: created.username, password }],
        },
        null,
        2
      )}\n`,
      "utf8"
    )
    fsyncSync(credentialsFd)
    committed = true

    console.log(`Administrador creado: ${created.username} (${created.role}).`)
    console.log(
      `  Cambio de clave forzado al primer ingreso: ${created.mustChangePassword ? "sí" : "no"}`
    )
    console.log(`  Credencial guardada en: ${credentialsPath}`)
  } finally {
    closeSync(credentialsFd)
    // Sin usuario creado no debe quedar un archivo con una contraseña que no sirve.
    if (!committed && existsSync(credentialsPath)) unlinkSync(credentialsPath)
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "No se pudo crear el administrador.")
  process.exitCode = 1
})
