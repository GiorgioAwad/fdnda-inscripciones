"use client"

import type { ReactNode } from "react"
import {
  BadgeCheck,
  Building2,
  ClipboardList,
  Home,
  Receipt,
  ShoppingBag,
  Users,
} from "lucide-react"
import { SideNav, type SideNavGroup } from "@/components/side-nav"

// El menú sigue el recorrido real del club: primero afiliar, después competir,
// y al final lo transversal. Las inscripciones usan planillas persistentes; el
// único carrito visible queda dentro del grupo de afiliación que lo alimenta.
export function PortalNav({
  clubName,
  userName,
  roleLabel,
  affiliationCartCount,
  pendingAffiliations,
  guideAction,
  signOutAction,
}: {
  clubName: string
  userName: string
  // «Coordinador del club» o «Delegado de Clavados»: antes todos veían
  // «Delegado», incluido el coordinador que ve el club entero.
  roleLabel: string
  affiliationCartCount: number
  pendingAffiliations: number
  guideAction: ReactNode
  signOutAction: ReactNode
}) {
  const groups: SideNavGroup[] = [
    {
      links: [{ href: "/inicio", label: "Inicio", icon: Home, exact: true }],
    },
    {
      title: "Afiliación",
      links: [
        {
          href: "/afiliacion",
          label: "Estado de afiliación",
          icon: BadgeCheck,
          exact: true,
          badge: pendingAffiliations,
          badgeLabel: "por afiliar",
        },
        { href: "/deportistas", label: "Padrón", icon: Users },
        {
          href: "/afiliacion/carrito",
          label: "Carrito de afiliación",
          icon: ShoppingBag,
          badge: affiliationCartCount,
          badgeLabel: "en el carrito",
        },
      ],
    },
    {
      title: "Competencias",
      links: [{ href: "/inscripciones", label: "Inscripciones", icon: ClipboardList }],
    },
    {
      links: [
        { href: "/pagos", label: "Pagos y constancias", icon: Receipt },
        { href: "/club", label: "Mi club", icon: Building2 },
      ],
    },
  ]

  return (
    <SideNav
      groups={groups}
      userName={userName}
      guideAction={guideAction}
      signOutAction={signOutAction}
      homeHref="/inicio"
      subtitle={clubName}
      homeLabel={`Inicio de ${clubName}`}
      accountLabel={roleLabel}
      menuLabel="Abrir menú del club"
    />
  )
}
