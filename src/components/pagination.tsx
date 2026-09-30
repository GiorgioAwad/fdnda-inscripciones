import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type QueryValue = string | number | null | undefined

interface PaginationProps {
  pathname: string
  currentPage: number
  totalPages: number
  query?: Record<string, QueryValue>
  pageParam?: string
  className?: string
  // Opcionales: con los dos, la paginación dice qué tramo se está viendo
  // («Mostrando 26–50 de 312»). Sin ellos se comporta como siempre.
  pageSize?: number
  totalItems?: number
}

function visiblePages(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages])
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < totalPages) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

export function Pagination({
  pathname,
  currentPage,
  totalPages,
  query = {},
  pageParam = "page",
  className,
  pageSize,
  totalItems,
}: PaginationProps) {
  if (totalPages <= 1) return null

  const range =
    pageSize && totalItems !== undefined && totalItems > 0
      ? {
          from: (currentPage - 1) * pageSize + 1,
          to: Math.min(currentPage * pageSize, totalItems),
        }
      : null

  const pageHref = (page: number) => ({
    pathname,
    query: {
      ...Object.fromEntries(
        Object.entries(query).filter(([, value]) => value !== null && value !== undefined && value !== "")
      ),
      ...(page > 1 ? { [pageParam]: page } : {}),
    },
  })
  const pages = visiblePages(currentPage, totalPages)

  return (
    <nav
      aria-label="Paginación"
      className={cn("flex flex-wrap items-center justify-center gap-1.5 text-sm", className)}
    >
      {range ? (
        <p className="num w-full text-center text-xs font-semibold text-fdnda-muted">
          Mostrando {range.from}–{range.to} de {totalItems}
        </p>
      ) : null}
      <Link
        href={pageHref(Math.max(1, currentPage - 1))}
        aria-disabled={currentPage === 1}
        tabIndex={currentPage === 1 ? -1 : undefined}
        className={cn(
          "inline-flex min-h-11 items-center gap-1 rounded-control px-3 font-semibold text-fdnda-navy hover:bg-fdnda-sunken",
          currentPage === 1 && "pointer-events-none opacity-45"
        )}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
      </Link>

      {pages.map((page, index) => {
        const previous = pages[index - 1]
        return (
          <span key={page} className="contents">
            {previous !== undefined && page - previous > 1 ? (
              <span className="px-1 text-fdnda-muted" aria-hidden="true">
                …
              </span>
            ) : null}
            <Link
              href={pageHref(page)}
              aria-current={page === currentPage ? "page" : undefined}
              aria-label={`Página ${page}`}
              className={cn(
                "num inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 font-semibold",
                page === currentPage
                  ? "bg-fdnda-turquoise-deep text-white shadow-raised"
                  : "text-fdnda-muted hover:bg-fdnda-sunken hover:text-fdnda-navy"
              )}
            >
              {page}
            </Link>
          </span>
        )
      })}

      <Link
        href={pageHref(Math.min(totalPages, currentPage + 1))}
        aria-disabled={currentPage === totalPages}
        tabIndex={currentPage === totalPages ? -1 : undefined}
        className={cn(
          "inline-flex min-h-11 items-center gap-1 rounded-control px-3 font-semibold text-fdnda-navy hover:bg-fdnda-sunken",
          currentPage === totalPages && "pointer-events-none opacity-45"
        )}
      >
        Siguiente <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </nav>
  )
}
