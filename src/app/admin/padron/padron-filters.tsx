"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { Input, Select } from "@/components/ui/input"

export function PadronFilters({
  clubs,
}: {
  clubs: Array<{ id: string; name: string; code: string; isActive: boolean }>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hasFilters = Boolean(searchParams.get("q") || searchParams.get("club"))
  const searchRef = useRef<HTMLInputElement>(null)
  const clubRef = useRef<HTMLSelectElement>(null)

  // Los campos no son controlados: si la URL cambia por un enlace («Quitar
  // filtros»), se alinean con ella. La búsqueda no se toca mientras se escribe.
  useEffect(() => {
    if (searchRef.current && document.activeElement !== searchRef.current) {
      searchRef.current.value = searchParams.get("q") ?? ""
    }
    if (clubRef.current) clubRef.current.value = searchParams.get("club") ?? ""
  }, [searchParams])

  const apply = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete("page")
    router.replace(`/admin/padron?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fdnda-muted"
          aria-hidden="true"
        />
        <Input
          ref={searchRef}
          className="pl-9"
          type="search"
          aria-label="Buscar deportista por apellidos, nombres o N.º de documento"
          placeholder="Buscar por apellidos, nombres o N.º de documento…"
          defaultValue={searchParams.get("q") ?? ""}
          onChange={(e) => {
            const value = e.target.value
            // Debounce simple para no navegar en cada tecla.
            window.clearTimeout((window as unknown as { __padronT?: number }).__padronT)
            ;(window as unknown as { __padronT?: number }).__padronT =
              window.setTimeout(() => apply("q", value.trim()), 350)
          }}
        />
      </div>
      <Select
        ref={clubRef}
        className="sm:w-64"
        aria-label="Filtrar por club"
        defaultValue={searchParams.get("club") ?? ""}
        onChange={(e) => apply("club", e.target.value)}
      >
        <option value="">Todos los clubes</option>
        {clubs.map((club) => (
          <option key={club.id} value={club.id}>
            {club.isActive ? club.name : `${club.name} (desactivado)`}
          </option>
        ))}
      </Select>
      {hasFilters ? (
        <Link
          href="/admin/padron"
          className="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-semibold text-fdnda-navy underline underline-offset-2 hover:bg-fdnda-sky-soft"
        >
          Quitar filtros
        </Link>
      ) : null}
    </div>
  )
}
