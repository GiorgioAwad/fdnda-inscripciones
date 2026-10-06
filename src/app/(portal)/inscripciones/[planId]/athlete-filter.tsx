"use client"

import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { AthleteView } from "../types"

// Filtro local de la lista de elegibles de una prueba. No consulta al servidor:
// el padrón ya está cargado, solo acorta una lista larga.

/** Desde cuántos deportistas conviene filtrar en vez de recorrer la lista. */
export const FILTER_FROM = 8

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

export function matchesAthleteFilter(athlete: AthleteView, filter: string) {
  const terms = normalize(filter).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalize(
    `${athlete.lastNames} ${athlete.firstNames} ${athlete.docNumber}`
  )
  return terms.every((term) => haystack.includes(term))
}

export function AthleteFilter({
  value,
  onChange,
  className = "",
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">Filtrar deportistas por nombre o documento</span>
      <Search
        className="pointer-events-none absolute left-3 top-3.5 z-10 h-4 w-4 text-fdnda-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filtrar por nombre o documento"
        className="pl-10"
      />
    </label>
  )
}
