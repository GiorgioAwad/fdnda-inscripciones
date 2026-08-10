"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { Input, Select } from "@/components/ui/input"

export function PadronFilters({
  clubs,
}: {
  clubs: Array<{ id: string; name: string; code: string }>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

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
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fdnda-muted" />
        <Input
          className="pl-9"
          placeholder="Buscar por nombre o documento…"
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
        className="sm:w-64"
        defaultValue={searchParams.get("club") ?? ""}
        onChange={(e) => apply("club", e.target.value)}
      >
        <option value="">Todos los clubes</option>
        {clubs.map((club) => (
          <option key={club.id} value={club.id}>
            {club.name}
          </option>
        ))}
      </Select>
    </div>
  )
}
