import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { FEDERATION_NAME } from "@/lib/brand"
import { AdminNav } from "@/components/admin/admin-nav"
import { SignOutButton } from "@/components/sign-out-button"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user || user.role !== "ADMIN") {
    redirect("/login")
  }

  return (
    <div className="min-h-dvh bg-fdnda-surface text-fdnda-ink">
      <a
        href="#contenido-principal"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-control bg-fdnda-navy px-4 py-3 text-sm font-semibold text-white transition-transform focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-fdnda-turquoise"
      >
        Saltar al contenido principal
      </a>

      <AdminNav
        userName={user.name}
        signOutAction={
          <SignOutButton className="justify-start text-fdnda-ink hover:bg-fdnda-sky/35 hover:text-fdnda-navy" />
        }
      />

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <main
          id="contenido-principal"
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>

        <footer className="border-t border-fdnda-border bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-fdnda-muted sm:px-6 lg:px-8">
            {FEDERATION_NAME} · Administración
          </div>
        </footer>
      </div>
    </div>
  )
}
