"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Barra lateral con drawer en móvil, compartida por el panel admin y el portal
// del club. Cada consumidor pasa sus grupos de enlaces.

export interface SideNavLink {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
  badge?: number
  // Qué cuenta el globo, para lectores de pantalla: «3 por afiliar». Sin esto
  // se anunciaba un número suelto después del nombre del enlace.
  badgeLabel?: string
}

export interface SideNavGroup {
  // Sin título = grupo suelto arriba de todo (p. ej. "Inicio").
  title?: string
  links: SideNavLink[]
}

function BrandIdentity({
  homeHref,
  subtitle,
  homeLabel,
  titleId,
}: {
  homeHref: string
  subtitle: string
  homeLabel: string
  titleId?: string
}) {
  return (
    <Link
      href={homeHref}
      className="flex min-w-0 items-center gap-3 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fdnda-turquoise"
      aria-label={homeLabel}
    >
      {/* El escudo necesita su placa blanca: el cromo es navy y el logotipo
          lleva azul propio, así que sobre el fondo se perdería. */}
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-white p-1.5 shadow-raised">
        <Image
          src="/fdnda-logo.png"
          alt="Logotipo de la FDNDA"
          width={446}
          height={559}
          className="h-full w-auto"
          priority
        />
      </span>
      <span className="min-w-0">
        <span
          id={titleId}
          className="font-heading block truncate text-base font-bold leading-tight tracking-[0.08em] text-white"
        >
          FDNDA
        </span>
        <span className="block truncate text-xs font-semibold text-fdnda-sky">
          {subtitle}
        </span>
      </span>
    </Link>
  )
}

function NavLinks({
  groups,
  onNavigate,
}: {
  groups: SideNavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-4">
      {groups.map((group, index) => (
        <div key={group.title ?? `group-${index}`}>
          {group.title ? (
            <p className="mb-1.5 px-3 text-eyebrow uppercase text-fdnda-sky/70">
              {group.title}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            {group.links.map((link) => {
              const active = link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(`${link.href}/`)
              const Icon = link.icon

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-control px-3.5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise",
                    // Sobre cromo oscuro la relación se invierte: el elemento
                    // activo es el claro, no el oscuro.
                    active
                      ? "bg-white text-fdnda-navy-deep shadow-raised"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{link.label}</span>
                  {link.badge ? (
                    <span
                      className={cn(
                        "num flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                        active ? "bg-fdnda-navy text-white" : "bg-fdnda-red text-white"
                      )}
                    >
                      {link.badge}
                      {link.badgeLabel ? (
                        <span className="sr-only"> {link.badgeLabel}</span>
                      ) : null}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function AccountArea({
  userName,
  contextLabel,
  guideAction,
  signOutAction,
}: {
  userName: string
  contextLabel?: string
  guideAction?: ReactNode
  signOutAction: ReactNode
}) {
  return (
    <div className="border-t border-white/15 px-4 py-4">
      <p className="truncate text-sm font-semibold text-white">{userName}</p>
      {contextLabel ? (
        <p className="truncate text-xs text-fdnda-sky">{contextLabel}</p>
      ) : null}
      <div className="mt-2 flex flex-col gap-0.5 [&_button]:w-full">
        {guideAction}
        {signOutAction}
      </div>
    </div>
  )
}

export function SideNav({
  groups,
  userName,
  signOutAction,
  homeHref,
  subtitle,
  homeLabel,
  accountLabel,
  guideAction,
  menuLabel = "Abrir menú",
}: {
  groups: SideNavGroup[]
  userName: string
  guideAction?: ReactNode
  signOutAction: ReactNode
  homeHref: string
  subtitle: string
  homeLabel: string
  accountLabel?: string
  menuLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(false)
  const drawerId = "mobile-navigation"
  const drawerTitleId = "mobile-navigation-title"

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        menuButtonRef.current?.focus()
      }
      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        return
      }

      if (event.key !== "Tab") return

      const focusableElements = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )

      if (!focusableElements?.length) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return (
    <>
      <aside className="wave-field-soft print-hidden fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-fdnda-navy bg-fdnda-navy-deep lg:flex">
        <div className="px-5 py-5">
          <BrandIdentity
            homeHref={homeHref}
            subtitle={subtitle}
            homeLabel={homeLabel}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-5">
          <NavLinks groups={groups} />
        </div>
        <AccountArea
          userName={userName}
          contextLabel={accountLabel}
          guideAction={guideAction}
          signOutAction={signOutAction}
        />
      </aside>

      <header className="wave-field-soft print-hidden sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-fdnda-navy bg-fdnda-navy-deep px-4 py-2 lg:hidden">
        <BrandIdentity homeHref={homeHref} subtitle={subtitle} homeLabel={homeLabel} />
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          className="ml-3 inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
          aria-label={menuLabel}
          aria-expanded={open}
          aria-controls={drawerId}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          <span>Menú</span>
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-fdnda-navy-deep/70"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
            tabIndex={-1}
          />
          <div
            ref={drawerRef}
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="wave-field-soft absolute inset-y-0 left-0 flex w-[min(20rem,calc(100%-3rem))] flex-col bg-fdnda-navy-deep shadow-overlay"
          >
            <div className="flex min-h-20 items-center justify-between gap-3 border-b border-white/15 px-5 py-3">
              <BrandIdentity
                homeHref={homeHref}
                subtitle={subtitle}
                homeLabel={homeLabel}
                titleId={drawerTitleId}
              />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
            </div>
            <AccountArea
              userName={userName}
              contextLabel={accountLabel}
              guideAction={guideAction}
              signOutAction={signOutAction}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
