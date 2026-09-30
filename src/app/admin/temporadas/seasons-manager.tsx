"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarRange, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react"
import { DisciplineIcon } from "@/components/discipline-icon"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { Input, Label, Select } from "@/components/ui/input"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { DISCIPLINE_VALUES, DISCIPLINES, disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly, formatMoney, plural } from "@/lib/utils"
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

// «Archivada» se ponía a toda temporada no vigente, también a la del año
// siguiente recién creada. Se deriva del año frente a la vigente (o, sin
// vigente, frente al año en curso).
function seasonStatus(
  season: SeasonView,
  current: SeasonView | null
): { label: string; variant: BadgeVariant } {
  if (season.isCurrent) return { label: "Vigente", variant: "success" }
  const upcoming = current
    ? season.year > current.year
    : season.year >= new Date().getFullYear()
  return upcoming
    ? { label: "Próxima", variant: "info" }
    : { label: "Anterior", variant: "neutral" }
}

function SeasonDialog({
  season,
  open,
  onClose,
  offerMakeCurrent,
}: {
  season?: SeasonView
  open: boolean
  onClose: () => void
  // Sin temporada vigente, crear una y dejarla inerte obligaba a descubrir
  // después el botón para hacerla vigente.
  offerMakeCurrent: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const nextYear = new Date().getFullYear() + 1
  const affiliations = season ? season.clubAffiliations + season.athleteAffiliations : 0

  // onSubmit en vez de <form action>: React 19 reinicia el formulario al
  // terminar la acción y con un error se perdían las cuotas escritas.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get("name") ?? "").trim()
    startTransition(async () => {
      const result = await saveSeason(formData)
      if (result.success) {
        toast.success(
          season
            ? `Cambios de ${name} guardados`
            : result.isCurrent
              ? `${name} creada y vigente`
              : `${name} creada`
        )
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
      title={season ? `Editar ${season.name}` : "Crear temporada"}
      description="Cada disciplina se afilia y se cobra aparte. Cambiar una cuota aquí no altera las afiliaciones ya emitidas: guardan la cuota con la que se generaron."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
            Cuotas de afiliación por disciplina (S/)
          </legend>
          <p className="text-xs text-fdnda-muted">
            Deja las dos casillas en blanco para que esa disciplina no se afilie esta
            temporada.
          </p>
          {affiliations > 0 ? (
            <p className="rounded-control border border-fdnda-warning-ring bg-fdnda-warning-soft px-3 py-2 text-xs font-semibold text-fdnda-warning">
              Esta temporada ya tiene {plural(affiliations, "afiliación", "afiliaciones")}.
              Si dejas en blanco una disciplina, deja de ofrecerse a los clubes; las
              afiliaciones ya emitidas no se borran.
            </p>
          ) : null}
          {DISCIPLINE_VALUES.map((discipline) => {
            const fee = season?.fees.find((row) => row.discipline === discipline)
            const style = DISCIPLINES[discipline]

            return (
              <div
                key={discipline}
                className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem]"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-fdnda-ink">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-white ${style.chip}`}
                  >
                    <DisciplineIcon
                      discipline={discipline}
                      tone="light"
                      className="h-4 w-4"
                    />
                  </span>
                  {style.label}
                </p>
                <div>
                  <Label htmlFor={`se-club-${discipline}`}>Cuota del club</Label>
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
                  <Label htmlFor={`se-athlete-${discipline}`}>Por deportista</Label>
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
        {!season && offerMakeCurrent ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-fdnda-border p-3 text-sm text-fdnda-ink">
            <input
              type="checkbox"
              name="makeCurrent"
              defaultChecked
              className="mt-0.5 h-4 w-4 accent-fdnda-navy"
            />
            <span>
              <span className="font-semibold">Hacerla vigente al crearla</span>
              <span className="block text-xs text-fdnda-muted">
                No hay otra vigente: sin una, los clubes no pueden afiliarse.
              </span>
            </span>
          </label>
        ) : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            {season ? `Guardar cambios de ${season.name}` : "Crear temporada"}
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get("name") ?? "").trim()
    startTransition(async () => {
      const result = await saveCategory(formData)
      if (result.success) {
        toast.success(category ? `Categoría ${name} guardada` : `Categoría ${name} creada`)
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
      title={category ? `Editar ${category.name}` : "Crear categoría"}
      description="Es una etiqueta por año de nacimiento. No limita las inscripciones: cada prueba define su propio rango."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label htmlFor="ca-order">Posición en listas</Label>
            <Input
              id="ca-order"
              name="sortOrder"
              type="number"
              min={0}
              max={999}
              aria-describedby="ca-order-help"
              defaultValue={category?.sortOrder ?? 0}
            />
          </div>
        </div>
        <p id="ca-order-help" className="text-xs text-fdnda-muted">
          Deja un año en blanco para no limitar ese extremo (por ejemplo, Mayores
          &ldquo;hasta 2009&rdquo;). En la posición, el número menor aparece primero.
        </p>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={isPending}>
            {category ? "Guardar categoría" : "Crear categoría"}
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
  const [promoting, setPromoting] = useState<SeasonView | null>(null)
  const [categorySeasonId, setCategorySeasonId] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<CategoryView | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<CategoryView | null>(null)

  const currentSeason = seasons.find((season) => season.isCurrent) ?? null
  const currentCategories = currentSeason
    ? categories.filter((category) => category.seasonId === currentSeason.id)
    : []

  const handleSetCurrent = (season: SeasonView) => {
    startTransition(async () => {
      const result = await setCurrentSeason(season.id)
      if (result.success) {
        toast.success(`${season.name} es ahora la temporada vigente`)
        setPromoting(null)
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
        toast.success(`Categoría ${category.name} eliminada`)
        setDeletingCategory(null)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const promotingHasCategories = promoting
    ? categories.some((category) => category.seasonId === promoting.id)
    : true

  return (
    <div className="space-y-7">
      {seasons.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarRange}
            title="Todavía no hay temporadas"
            action={
              <Button onClick={() => setNewSeasonOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Crear la primera temporada
              </Button>
            }
          >
            Define su vigencia y, por disciplina, la cuota de afiliación del club y por
            deportista. Mientras no haya una temporada vigente, los clubes no pueden
            afiliarse.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setNewSeasonOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Crear temporada
            </Button>
          </div>

          <TableContainer aria-label="Temporadas">
            <Table>
              <THead>
                <TR>
                  <TH>Temporada</TH>
                  <TH>Vigencia</TH>
                  <TH>Cuotas de afiliación por disciplina</TH>
                  <TH className="text-right">Afiliaciones emitidas</TH>
                  <TH>Estado</TH>
                  <TH className="text-right">Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {seasons.map((season) => {
                  const status = seasonStatus(season, currentSeason)
                  return (
                    <TR key={season.id}>
                      <TD className="font-bold text-fdnda-ink">{season.name}</TD>
                      <TD className="text-xs">
                        {formatDateOnly(season.startDateISO)} –{" "}
                        {formatDateOnly(season.endDateISO)}
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
                                · club {formatMoney(fee.clubFee)} · por deportista{" "}
                                {formatMoney(fee.athleteFee)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TD>
                      <TD className="num text-right text-xs">
                        {plural(season.clubAffiliations, "de club", "de club")} ·{" "}
                        {plural(season.athleteAffiliations, "de deportista", "de deportistas")}
                      </TD>
                      <TD>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          {season.isCurrent ? null : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isPending}
                              aria-label={`Hacer vigente ${season.name}`}
                              onClick={() => setPromoting(season)}
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              Hacer vigente
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
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>
        </>
      )}

      {currentSeason ? (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-fdnda-border bg-fdnda-navy py-4">
            <h2 className="font-heading text-lg font-bold tracking-tight text-white">
              Categorías de {currentSeason.name}
            </h2>
            {/* Sobre la cabecera navy, «secondary» (celeste translúcido) se
                leía deshabilitado: el blanco de «outline» sí contrasta. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingCategory(null)
                setCategorySeasonId(currentSeason.id)
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Crear categoría
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {currentCategories.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fdnda-muted">
                Todavía no hay categorías. Son etiquetas por año de nacimiento que el
                padrón y el portal muestran junto a cada deportista; no limitan las
                inscripciones.
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
                            aria-label={`Editar la categoría ${category.name} de ${disciplineLabel(category.discipline)}`}
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
                            aria-label={`Eliminar la categoría ${category.name} de ${disciplineLabel(category.discipline)}`}
                            disabled={isPending}
                            onClick={() => setDeletingCategory(category)}
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
      ) : seasons.length > 0 ? (
        <p className="text-sm text-fdnda-muted">
          Las categorías se definen para la temporada vigente. Haz vigente una temporada
          para crearlas.
        </p>
      ) : null}

      <SeasonDialog
        open={newSeasonOpen}
        onClose={() => setNewSeasonOpen(false)}
        offerMakeCurrent={currentSeason === null}
      />
      {editingSeason ? (
        <SeasonDialog
          season={editingSeason}
          open
          onClose={() => setEditingSeason(null)}
          offerMakeCurrent={false}
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

      <ConfirmDialog
        open={promoting !== null}
        onClose={() => setPromoting(null)}
        title={`¿Hacer vigente ${promoting?.name ?? ""}?`}
        consequence={
          promoting ? (
            <>
              <p>
                {currentSeason
                  ? `${currentSeason.name} dejará de estar vigente. Desde ahora el panel de afiliaciones, el padrón y el portal de los clubes usarán las cuotas y categorías de ${promoting.name}. Las afiliaciones de ${currentSeason.name} se conservan.`
                  : `Desde ahora los clubes podrán afiliarse a ${promoting.name} con sus cuotas, y el panel de afiliaciones, el padrón y el portal usarán sus categorías.`}
              </p>
              {promotingHasCategories ? null : (
                <p className="mt-2">
                  {promoting.name} todavía no tiene categorías: el padrón mostrará
                  «—» en la columna Categoría hasta que las crees.
                </p>
              )}
            </>
          ) : null
        }
        confirmLabel={`Hacer vigente ${promoting?.name ?? ""}`}
        pending={isPending}
        onConfirm={() => promoting && handleSetCurrent(promoting)}
      />

      <ConfirmDialog
        open={deletingCategory !== null}
        onClose={() => setDeletingCategory(null)}
        title={`¿Eliminar la categoría ${deletingCategory?.name ?? ""}${
          deletingCategory ? ` de ${disciplineLabel(deletingCategory.discipline)}` : ""
        }?`}
        consequence="El padrón y el portal de los clubes dejarán de mostrar esa etiqueta. No cambia ninguna inscripción: cada prueba define su propio rango de edades."
        confirmLabel="Eliminar categoría"
        destructive
        pending={isPending}
        onConfirm={() => deletingCategory && handleDeleteCategory(deletingCategory)}
      />
    </div>
  )
}
