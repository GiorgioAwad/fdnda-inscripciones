import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { FEDERATION_NAME } from "@/lib/brand"
import { AdminNav } from "@/components/admin/admin-nav"
import { SignOutButton } from "@/components/sign-out-button"
import { GuideLauncher, GuideProvider } from "@/components/onboarding/guide"
import { GUIDE_META, GUIDE_STEPS } from "@/components/onboarding/guide-steps"
import { countOrdersRequiringPaymentReview } from "@/lib/orders"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user || user.role !== "ADMIN") {
    redirect("/login")
  }

  const ordersToReconcile = await countOrdersRequiringPaymentReview()
  const guide = GUIDE_META.admin

  return (
    <GuideProvider
      title={guide.title}
      steps={GUIDE_STEPS.admin}
      finishLabel={guide.finishLabel}
      finishHref={guide.finishHref}
      autoOpen={!user.onboardedAt}
    >
      <div className="min-h-dvh bg-fdnda-surface text-fdnda-ink print:bg-white">
        <a
          href="#contenido-principal"
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-control bg-white px-4 py-3 text-sm font-semibold text-fdnda-navy-deep shadow-overlay transition-transform focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-fdnda-turquoise"
        >
          Saltar al contenido principal
        </a>

        <AdminNav
          userName={user.name}
          ordersToReconcile={ordersToReconcile}
          guideAction={<GuideLauncher />}
          signOutAction={
            <SignOutButton className="justify-start text-white/85 hover:bg-white/10 hover:text-white" />
          }
        />

        <div className="flex min-h-dvh flex-col lg:pl-64">
          <main
            id="contenido-principal"
            className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
          >
            {children}
          </main>

          <footer className="print-hidden border-t border-fdnda-border bg-white">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 text-xs text-fdnda-muted sm:px-6 lg:px-8">
              <span>{FEDERATION_NAME} · Administración</span>
              <Link
                href="/privacidad"
                className="font-semibold text-fdnda-navy underline underline-offset-2"
              >
                Política de Privacidad
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </GuideProvider>
  )
}
