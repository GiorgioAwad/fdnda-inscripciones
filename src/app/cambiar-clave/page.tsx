import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { LockKeyhole } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { SignOutButton } from "@/components/sign-out-button"
import { PasswordChangeForm } from "./password-change-form"

export const metadata: Metadata = { title: "Cambiar contraseña" }

export default async function PasswordChangePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return (
    <main className="flex min-h-dvh items-center justify-center bg-fdnda-sunken px-5 py-10">
      <section className="w-full max-w-md rounded-surface border border-fdnda-border bg-white p-6 shadow-floating sm:p-8">
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-control bg-fdnda-sky-soft text-fdnda-navy">
          <LockKeyhole className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="font-heading text-2xl font-bold text-fdnda-navy">
          Cambia tu contraseña
        </h1>
        <p className="mb-7 mt-2 text-sm leading-relaxed text-fdnda-muted">
          {user.mustChangePassword
            ? "Tu contraseña actual es temporal. Cámbiala para entrar al portal."
            : "Elige una contraseña nueva para tu usuario de acceso."}
        </p>
        <PasswordChangeForm />
        <div className="mt-5 flex justify-center border-t border-fdnda-border pt-4">
          <SignOutButton />
        </div>
      </section>
    </main>
  )
}
