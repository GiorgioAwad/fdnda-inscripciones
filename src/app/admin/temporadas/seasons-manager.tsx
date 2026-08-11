"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input, Label, Select } from "@/components/ui/input"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { DISCIPLINE_VALUES, DISCIPLINES, disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly, formatMoney } from "@/lib/utils"
import { deleteCategory, saveCategory, saveSeason, setCurrentSeason } from "./actions"

export interface SeasonFeeView {
  discipline: string
  clubFee: number
  athleteFee: number
}

export interface SeasonView {
  id: string
  year: number
  name: string
  startDateISO: string
  endDateISO: string
  // Una fila por disciplina afiliable; sin fila = no se afilia esa temporada.
  fees: SeasonFeeView[]
  isCurrent: boolean
  clubAffiliations: number
  athleteAffiliations: number
}

export interface CategoryView {
  id: string
  seasonId: string
  discipline: string
  name: string
  birthYearFrom: number | null
  birthYearTo: number | null
  sortOrder: number
}

function yearRangeLabel(from: number | null, to: number | null): string {
  if (from === null && to === null) return "Todos los años"
  if (from !== null && to !== null) return `${from}–${to}`
  if (from !== null) return `desde ${from}`
  return `hasta ${to}`
}

function SeasonDialog({
  season,
  open,
  onClose,
}: {
  season?: SeasonView
  open: boolean
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const nextYear = new Date().getFullYear() + 1

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveSeason(formData)
      if (result.success) {
        toast.success(season ? "Temporada actualizada" : "Temporada creada")
        onClose()
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={season ? `Editar ${season.name}` : "Nueva temporada"}
      description="Cada disciplina se afilia y se cobra aparte. La cuota queda congelada en cada afiliación que se genere: cambiarla aquí no altera las ya emitidas."
    >
      <form action={handleSubmit} className="space-y-4">
        {season ? <input type="hidden" name="id" value={season.id} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="se-year">Año</Label>
            <Input
              id="se-year"
              name="year"
              type="number"
              required
              min={2000}
              max={2100}
              defaultValue={season?.year ?? nextYear}
            />
          </div>
          <div>
            <Label htmlFor="se-name">Nombre</Label>
            <Input
              id="se-name"
              name="name"
              required
              placeholder={`Temporada ${nextYear}`}
              defaultValue={season?.name ?? `Temporada ${nextYear}`}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="se-start">Vigencia desde</Label>
            <Input
              id="se-start"
              name="startDate"
              type="date"
              required
              defaultValue={season?.startDateISO ?? `${nextYear}-01-01`}
            />
          </div>
          <div>
            <Label htmlFor="se-end">Vigencia hasta</Label>
            <Input
              id="se-end"
              name="endDate"
              type="date"
              required
              defaultValue={season?.endDateISO ?? `${nextYear}-12-31`}
            />
          </div>
        </div>
        <fieldset className="space-y-3 rounded-surface border border-fdnda-border p-4">
          <legend className="px-1 text-sm font-bold text-fdnda-ink">
            Cuotas por disciplina (S/)
          </legend>
          <p className="text-xs text-fdnda-muted">
            Deja las dos casillas en blanco para que esa disciplina no se afilie esta
            temporada.
          </p>
          {DISCIPLINE_VALUES.map((discipline) => {
            const fee = season?.fees.find((row) => row.discipline === discipline)
            const style = DISCIPLINES[discipline]
            const Icon = style.icon

            return (
              <div
                key={discipline}
                className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-fdnda-ink">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white ${style.chip}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {style.label}
                </p>
                <div>
                  <Label htmlFor={`se-club-${discipline}`}>Club</Label>
                  <Input
                    id={`se-club-${discipline}`}
                    name={`clubFee.${discipline}`}
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="—"
                    defaultValue={fee?.clubFee ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor={`se-athlete-${discipline}`}>Deportista</Label>
                  <Input
                    id={`se-athlete-${discipline}`}
                    name={`athleteFee.${discipline}`}
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="—"
                    defaultValue={fee?.athleteFee ?? ""}
                  />
                </div>
              </div>
            )
          })}
        </fieldset>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            {season ? "Guardar" : "Crear temporada"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function CategoryDialog({
  seasonId,
  category,
  open,
  onClose,
}: {
  seasonId: string
  category?: CategoryView
  open: boolean
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveCategory(formData)
      if (result.success) {
        toast.success(category ? "Categoría actualizada" : "Categoría creada")
        onClose()
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={category ? `Editar ${category.name}` : "Nueva categoría"}
      description="Es una etiqueta por año de nacimiento. No limita las inscripciones: cada prueba define su propio rango."
    >
      <form action={handleSubmit} className="space-y-4">
        <input type="hidden" name="seasonId" value={seasonId} />
        {category ? <input type="hidden" name="id" value={category.id} /> : null}
        <div>
          <Label htmlFor="ca-discipline">Disciplina</Label>
          <Select
            id="ca-discipline"
            name="discipline"
            defaultValue={category?.discipline ?? "DIVING"}
          >
            {DISCIPLINE_VALUES.map((value) => (
              <option key={value} value={value}>
                {DISCIPLINES[value].label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ca-name">Nombre</Label>
          <Input
            id="ca-name"
            name="name"
            required
            placeholder="Juvenil"
            defaultValue={category?.name}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="ca-from">Año desde</Label>
            <Input
              id="ca-from"
              name="birthYearFrom"
              type="number"
              min={1900}
              max={2100}
              placeholder="2010"
              defaultValue={category?.birthYearFrom ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ca-to">Año hasta</Label>
            <Input
              id="ca-to"
              name="birthYearTo"
              type="number"
              min={1900}
              max={2100}
              placeholder="2012"
              defaultValue={category?.birthYearTo ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="ca-order">Orden</Label>
            <Input
              id="ca-order"
              name="sortOrder"
              type="number"
              min={0}
              max={999}
              defaultValue={category?.sortOrder ?? 0}
            />
          </div>
        </div>
        <p className="text-xs text-fdnda-muted">
          Deja un año en blanco para no limitar ese extremo (por ejemplo, Mayores
          &ldquo;hasta 2009&rdquo;).
        </p>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            {category ? "Guardar" : "Crear categoría"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function SeasonsManager({
  seasons,
  categories,
}: {
  seasons: SeasonView[]
  categories: CategoryView[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [newSeasonOpen, setNewSeasonOpen] = useState(false)
  const [editingSeason, setEditingSeason] = useState<SeasonView | null>(null)
  const [categorySeasonId, setCategorySeasonId] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<CategoryView | null>(null)

  const currentSeason = seasons.find((season) => season.isCurrent) ?? null
  const currentCategories = currentSeason
    ? categories.filter((category) => category.seasonId === currentSeason.id)
    : []

  const handleSetCurrent = (season: SeasonView) => {
    startTransition(async () => {
      const result = await setCurrentSeason(season.id)
      if (result.success) {
        toast.success(`${season.name} es ahora la temporada vigente`)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleDeleteCategory = (category: CategoryView) => {
    startTransition(async () => {
      const result = await deleteCategory(category.id)
      if (result.success) {
        toast.success("Categoría eliminada")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-7">
      <div className="flex justify-end">
        <Button onClick={() => setNewSeasonOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nueva temporada
        </Button>
      </div>

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>Temporada</TH>
              <TH>Vigencia</TH>
              <TH>Cuotas por disciplina</TH>
              <TH className="text-right">Afiliaciones</TH>
              <TH>Estado</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {seasons.map((season) => (
              <TR key={season.id}>
                <TD className="font-bold text-fdnda-ink">{season.name}</TD>
                <TD className="text-xs">
                  {formatDateOnly(season.startDateISO)} – {formatDateOnly(season.endDateISO)}
                </TD>
                <TD className="text-xs">
                  {season.fees.length === 0 ? (
                    <span className="text-fdnda-muted">Sin cuotas fijadas</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {season.fees.map((fee) => (
                        <li key={fee.discipline}>
                          <span className="font-semibold text-fdnda-ink">
                            {disciplineLabel(fee.discipline)}
                          </span>{" "}
                          · club {formatMoney(fee.clubFee)} · deportista{" "}
                          {formatMoney(fee.athleteFee)}
                        </li>
                      ))}
                    </ul>
                  )}
                </TD>
                <TD className="num text-right">
                  {season.clubAffiliations} clubes · {season.athleteAffiliations} deportistas
                </TD>
                <TD>
                  {season.isCurrent ? (
                    <Badge variant="success">Vigente</Badge>
                  ) : (
                    <Badge variant="neutral">Archivada</Badge>
                  )}
                </TD>
                <TD>
                  <div className="flex justify-end gap-2">
                    {season.isCurrent ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleSetCurrent(season)}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Marcar vigente
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Editar ${season.name}`}
                      onClick={() => setEditingSeason(season)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>

      {currentSeason ? (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-fdnda-border bg-fdnda-navy py-4">
            <CardTitle className="text-white">
              Categorías de {currentSeason.name}
            </CardTitle>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingCategory(null)
                setCategorySeasonId(currentSeason.id)
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Categoría
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {currentCategories.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fdnda-muted">
                Sin categorías todavía. Se usan solo como etiqueta en el padrón y en
                el panel de los clubes.
              </p>
            ) : (
              <Table>
                <THead className="bg-white">
                  <TR>
                    <TH>Disciplina</TH>
                    <TH>Categoría</TH>
                    <TH>Años de nacimiento</TH>
                    <TH className="text-right">Acciones</TH>
                  </TR>
                </THead>
                <TBody>
                  {currentCategories.map((category) => (
                    <TR key={category.id}>
                      <TD>{disciplineLabel(category.discipline)}</TD>
                      <TD className="font-bold text-fdnda-ink">{category.name}</TD>
                      <TD>
                        {yearRangeLabel(category.birthYearFrom, category.birthYearTo)}
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Editar ${category.name}`}
                            onClick={() => {
                              setEditingCategory(category)
                              setCategorySeasonId(currentSeason.id)
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Eliminar ${category.name}`}
                            disabled={isPending}
                            onClick={() => handleDeleteCategory(category)}
                          >
                            <Trash2 className="h-4 w-4 text-fdnda-red" aria-hidden="true" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <SeasonDialog open={newSeasonOpen} onClose={() => setNewSeasonOpen(false)} />
      {editingSeason ? (
        <SeasonDialog
          season={editingSeason}
          open
          onClose={() => setEditingSeason(null)}
        />
      ) : null}
      {categorySeasonId ? (
        <CategoryDialog
          seasonId={categorySeasonId}
          category={editingCategory ?? undefined}
          open
          onClose={() => {
            setCategorySeasonId(null)
            setEditingCategory(null)
          }}
        />
      ) : null}
    </div>
  )
}
