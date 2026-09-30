"use client"

import type { ReactNode } from "react"
import {
  CalendarDays,
  CalendarRange,
  Home,
  Receipt,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react"
import { SideNav, type SideNavGroup } from "@/components/side-nav"

// El orden es el de la puesta en marcha de una temporada: primero la
// temporada y sus cuotas, después los clubes y su padrón, al final las
// competencias y el cobro. Antes Clubes y Padrón iban antes que Temporadas,
// y sin temporada vigente ningún club puede afiliarse.
export function AdminNav({
  userName,
  ordersToReconcile,
  guideAction,
  signOutAction,
}: {
  userName: string
  ordersToReconcile: number
  guideAction: ReactNode
  signOutAction: ReactNode
}) {
  const groups: SideNavGroup[] = [
    {
      links: [{ href: "/admin", label: "Inicio", icon: Home, exact: true }],
    },
    {
      title: "Temporada",
      links: [
        { href: "/admin/temporadas", label: "Temporadas y cuotas", icon: CalendarRange },
        { href: "/admin/afiliaciones", label: "Afiliaciones", icon: ShieldCheck },
      ],
    },
    {
      title: "Registro",
      links: [
        { href: "/admin/clubes", label: "Clubes", icon: UsersRound },
        { href: "/admin/padron", label: "Padrón", icon: Users },
      ],
    },
    {
      title: "Competencias y pagos",
      links: [
        { href: "/admin/eventos", label: "Competencias", icon: CalendarDays },
        {
          href: "/admin/ordenes",
          label: "Órdenes de pago",
          icon: Receipt,
          badge: ordersToReconcile,
          badgeLabel: "por conciliar",
        },
      ],
    },
  ]

  return (
    <SideNav
      groups={groups}
      userName={userName}
      guideAction={guideAction}
      signOutAction={signOutAction}
      homeHref="/admin"
      subtitle="Administración"
      homeLabel="Inicio de la administración"
      accountLabel="Administrador de la FDNDA"
      menuLabel="Abrir menú de administración"
    />
  )
}
