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
      <Image
        src="/fdnda-logo.png"
        alt="Logotipo de la FDNDA"
        width={446}
        height={559}
        className="h-12 w-auto shrink-0"
        priority
      />
      <span className="min-w-0">
        <span
          id={titleId}
          className="font-heading block truncate text-base font-bold leading-tight tracking-wide text-fdnda-navy"
        >
          FDNDA
        </span>
        <span className="block truncate text-xs font-semibold text-fdnda-turquoise-deep">
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
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-fdnda-muted">
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
                    active
                      ? "bg-fdnda-navy text-white"
                      : "text-fdnda-ink hover:bg-fdnda-sky/35 hover:text-fdnda-navy"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{link.label}</span>
                  {link.badge ? (
                    <span
                      className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                        active ? "bg-white text-fdnda-navy" : "bg-fdnda-red text-white"
                      )}
                    >
                      {link.badge}
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
  signOutAction,
}: {
  userName: string
  contextLabel?: string
  signOutAction: ReactNode
}) {
  return (
    <div className="border-t border-fdnda-border px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-fdnda-muted">
        {contextLabel ?? "Sesión activa"}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-fdnda-navy">{userName}</p>
      <div className="mt-2 [&_button]:w-full">{signOutAction}</div>
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
  menuLabel = "Abrir menú",
}: {
  groups: SideNavGroup[]
  userName: string
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
      <aside className="print-hidden fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-fdnda-border bg-white lg:flex">
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
          signOutAction={signOutAction}
        />
      </aside>

      <header className="print-hidden sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-fdnda-border bg-white px-4 py-2 lg:hidden">
        <BrandIdentity homeHref={homeHref} subtitle={subtitle} homeLabel={homeLabel} />
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          className="ml-3 inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-fdnda-navy transition-colors hover:bg-fdnda-sky/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
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
            className="absolute inset-0 cursor-default bg-fdnda-navy/55"
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
            className="absolute inset-y-0 left-0 flex w-[min(20rem,calc(100%-3rem))] flex-col bg-white"
          >
            <div className="flex min-h-20 items-center justify-between gap-3 border-b border-fdnda-border px-5 py-3">
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
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-fdnda-navy transition-colors hover:bg-fdnda-sky/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
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
              signOutAction={signOutAction}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
