import { NextResponse } from "next/server"
import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

const { auth } = NextAuth(authConfig)

const adminRoutes = ["/admin"]
const clubRoutes = [
  "/inicio",
  "/club",
  "/afiliacion",
  "/deportistas",
  "/eventos",
  "/inscripciones",
  "/carrito",
  "/mis-inscripciones",
  "/pagos",
  "/pago",
]
const authRoutes = ["/login"]
const passwordChangeRoute = "/cambiar-clave"
const CLUB_HOME = "/inicio"

export default auth(async (req) => {
  const { nextUrl } = req
  const session = req.auth
  const pathname = nextUrl.pathname

  if (pathname.startsWith(passwordChangeRoute)) {
    if (!session) return NextResponse.redirect(new URL("/login", nextUrl))
    return NextResponse.next()
  }

  if (session?.user.mustChangePassword) {
    return NextResponse.redirect(new URL(passwordChangeRoute, nextUrl))
  }

  if (authRoutes.some((route) => pathname.startsWith(route))) {
    if (session) {
      const target = session.user.role === "ADMIN" ? "/admin" : CLUB_HOME
      return NextResponse.redirect(new URL(target, nextUrl))
    }
    return NextResponse.next()
  }

  if (adminRoutes.some((route) => pathname.startsWith(route))) {
    if (!session) {
      const loginUrl = new URL("/login", nextUrl)
      loginUrl.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(loginUrl)
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.redirect(new URL(CLUB_HOME, nextUrl))
    }
  }

  if (clubRoutes.some((route) => pathname.startsWith(route))) {
    if (!session) {
      const loginUrl = new URL("/login", nextUrl)
      loginUrl.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(loginUrl)
    }
    // El admin puede navegar el portal de clubes en modo lectura; las acciones
    // de inscripción validan el rol CLUB en el servidor.
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    "/admin/:path*",
    "/inicio/:path*",
    "/club/:path*",
    "/afiliacion/:path*",
    "/deportistas/:path*",
    "/eventos/:path*",
    "/inscripciones/:path*",
    "/carrito/:path*",
    "/mis-inscripciones/:path*",
    "/pagos/:path*",
    "/pago/:path*",
    "/login/:path*",
    "/cambiar-clave/:path*",
  ],
}
