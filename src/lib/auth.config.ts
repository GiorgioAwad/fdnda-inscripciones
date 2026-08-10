import type { NextAuthConfig } from "next-auth"
import type { Discipline } from "@prisma/client"

type UserRole = "ADMIN" | "CLUB"

// Ventana de inactividad deslizante. Los delegados de club llenan inscripciones
// con calma, así que la ventana es generosa; el JWT vive como máximo 12 h.
const INACTIVITY_LIMIT_SECONDS = 60 * 60 // 1 hora sin actividad -> logout
const SESSION_MAX_AGE = 12 * 60 * 60
const SESSION_UPDATE_AGE = 60

export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
    updateAge: SESSION_UPDATE_AGE,
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.role = user.role as UserRole
        token.clubId = user.clubId ?? null
        token.clubName = user.clubName ?? null
        token.disciplineAccess = user.disciplineAccess ?? []
        token.sessionVersion = user.sessionVersion ?? 0
        token.mustChangePassword = user.mustChangePassword ?? false
        token.lastActivity = Date.now()
        return token
      }

      if (trigger === "update") {
        token.lastActivity = Date.now()
        return token
      }

      const last =
        typeof token.lastActivity === "number" ? token.lastActivity : Date.now()

      if (Date.now() - last > INACTIVITY_LIMIT_SECONDS * 1000) {
        return null
      }

      token.lastActivity = Date.now()
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as UserRole
        session.user.clubId = (token.clubId as string | null) ?? null
        session.user.clubName = (token.clubName as string | null) ?? null
        session.user.disciplineAccess =
          (token.disciplineAccess as Discipline[] | undefined) ?? []
        session.user.sessionVersion = Number(token.sessionVersion ?? 0)
        session.user.mustChangePassword = Boolean(token.mustChangePassword)
      }
      return session
    },
  },
  providers: [], // Configurados en auth.ts
} satisfies NextAuthConfig
