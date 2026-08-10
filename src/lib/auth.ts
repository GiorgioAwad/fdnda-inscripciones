import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import type { Discipline } from "@prisma/client"
import { prisma } from "./prisma"
import { authConfig } from "./auth.config"
import { getRequestIpHash, writeAuditLog } from "./security"

type UserRole = "ADMIN" | "CLUB"

declare module "next-auth" {
  interface User {
    id?: string
    role: UserRole
    clubId: string | null
    clubName: string | null
    disciplineAccess: Discipline[]
    sessionVersion: number
    mustChangePassword: boolean
  }
  interface Session {
    user: {
      id: string
      name: string
      email?: string | null
      role: UserRole
      clubId: string | null
      clubName: string | null
      disciplineAccess: Discipline[]
      sessionVersion: number
      mustChangePassword: boolean
    }
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }

        const username = (credentials.username as string).trim().toLowerCase()
        const password = credentials.password as string
        const ipHash = await getRequestIpHash()

        const user = await prisma.user.findUnique({
          where: { username },
          include: { club: { select: { id: true, name: true, isActive: true } } },
        })

        if (!user || !user.isActive) {
          await writeAuditLog({
            action: "auth.login_failed",
            success: false,
            ipHash,
            metadata: { reason: "invalid_credentials" },
          })
          return null
        }

        // Un usuario de club con club desactivado no puede entrar.
        if (user.role === "CLUB" && user.club && !user.club.isActive) {
          await writeAuditLog({
            actorId: user.id,
            actorRole: user.role,
            action: "auth.login_failed",
            success: false,
            ipHash,
            metadata: { reason: "inactive_club" },
          })
          return null
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash)
        if (!passwordMatch) {
          await writeAuditLog({
            actorId: user.id,
            actorRole: user.role,
            action: "auth.login_failed",
            success: false,
            ipHash,
            metadata: { reason: "invalid_credentials" },
          })
          return null
        }

        await writeAuditLog({
          actorId: user.id,
          actorRole: user.role,
          action: "auth.login_succeeded",
          ipHash,
        })

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clubId: user.club?.id ?? null,
          clubName: user.club?.name ?? null,
          disciplineAccess: user.disciplineAccess,
          sessionVersion: user.sessionVersion,
          mustChangePassword: user.mustChangePassword,
        }
      },
    }),
  ],
})

export async function getCurrentUser() {
  const session = await auth()
  if (!session?.user) return undefined

  // Rol, activación y versión de sesión se releen en cada request. Esto
  // revoca inmediatamente JWT de clubes y administradores.
  const liveUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      isActive: true,
      sessionVersion: true,
      mustChangePassword: true,
      clubId: true,
      disciplineAccess: true,
      club: { select: { name: true, isActive: true } },
    },
  })
  if (
    !liveUser?.isActive ||
    liveUser.role !== session.user.role ||
    liveUser.sessionVersion !== session.user.sessionVersion
  ) {
    return undefined
  }
  if (liveUser.role === "CLUB" && (!liveUser.clubId || !liveUser.club?.isActive)) {
    return undefined
  }
  return {
    ...session.user,
    clubId: liveUser.clubId,
    clubName: liveUser.club?.name ?? null,
    disciplineAccess: liveUser.disciplineAccess,
    sessionVersion: liveUser.sessionVersion,
    mustChangePassword: liveUser.mustChangePassword,
  }
}

export async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== "ADMIN" || user.mustChangePassword) {
    throw new Error("No autorizado")
  }
  return user
}

// Devuelve el usuario de club autenticado junto con su clubId (no nulo).
export async function requireClubUser() {
  const user = await getCurrentUser()
  if (!user || user.role !== "CLUB" || !user.clubId || user.mustChangePassword) {
    throw new Error("No autorizado")
  }
  return { ...user, clubId: user.clubId }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}
