"use client"

import type { ReactNode } from "react"
import {
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  Receipt,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react"
import { SideNav, type SideNavGroup } from "@/components/side-nav"

const groups: SideNavGroup[] = [
  {
    links: [{ href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Registro",
    links: [
      { href: "/admin/clubes", label: "Clubes", icon: UsersRound },
      { href: "/admin/padron", label: "Padrón", icon: Users },
    ],
  },
  {
    title: "Afiliaciones",
    links: [
      { href: "/admin/temporadas", label: "Temporadas", icon: CalendarRange },
      { href: "/admin/afiliaciones", label: "Panel de afiliaciones", icon: ShieldCheck },
    ],
  },
  {
    title: "Competencias",
    links: [{ href: "/admin/eventos", label: "Eventos", icon: CalendarDays }],
  },
  {
    title: "Pagos",
    links: [{ href: "/admin/ordenes", label: "Órdenes", icon: Receipt }],
  },
]

export function AdminNav({
  userName,
  signOutAction,
}: {
  userName: string
  signOutAction: ReactNode
}) {
  return (
    <SideNav
      groups={groups}
      userName={userName}
      signOutAction={signOutAction}
      homeHref="/admin"
      subtitle="Panel administrativo"
      homeLabel="Ir al resumen administrativo"
      menuLabel="Abrir menú administrativo"
    />
  )
}
