"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { KeyRound, Pencil, Plus, ShieldCheck, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { DISCIPLINES, DISCIPLINE_VALUES, type DisciplineValue } from "@/lib/disciplines"
import {
  createClubUser,
  resetClubUserPassword,
  saveClub,
  saveClubUserAccess,
  toggleClubActive,
  toggleClubUserActive,
} from "./actions"

export interface ClubRow {
  id: string
  name: string
  code: string
  region: string
  contactName: string
  contactPhone: string
  contactEmail: string
  isActive: boolean
  athleteCount: number
  affiliationState: string
  users: Array<{
    id: string
    username: string
    name: string
    isActive: boolean
    disciplineAccess: DisciplineValue[]
  }>
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  let out = ""
  const bytes = new Uint32Array(10)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += chars[b % chars.length]
  return out
}

export function ClubsManager({ clubs }: { clubs: ClubRow[] }) {
  const [editing, setEditing] = useState<ClubRow | null | "new">(null)
  const [userDialogClub, setUserDialogClub] = useState<ClubRow | null>(null)
  const [resetUser, setResetUser] = useState<{ id: string; username: string } | null>(null)
  const [accessUser, setAccessUser] = useState<ClubRow["users"][number] | null>(null)
  const [suggestedPassword, setSuggestedPassword] = useState("")
  const [isPending, startTransition] = useTransition()

  const openUserDialog = (club: ClubRow) => {
    setSuggestedPassword(generatePassword())
    setUserDialogClub(club)
  }

  const openResetDialog = (user: { id: string; username: string }) => {
    setSuggestedPassword(generatePassword())
    setResetUser(user)
  }

  const handleSaveClub = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveClub(formData)
      if (result.success) {
        toast.success("Club guardado")
        setEditing(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleCreateUser = (formData: FormData) => {
    startTransition(async () => {
      const result = await createClubUser(formData)
      if (result.success) {
        toast.success("Usuario creado. Comparte las credenciales con el club.")
        setUserDialogClub(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleResetPassword = (formData: FormData) => {
    startTransition(async () => {
      const result = await resetClubUserPassword(formData)
      if (result.success) {
        toast.success("Contraseña actualizada")
        setResetUser(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleSaveAccess = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveClubUserAccess(formData)
      if (result.success) {
        toast.success("Alcance disciplinario actualizado")
        setAccessUser(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Nuevo club
        </Button>
      </div>

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>Club</TH>
              <TH>Región</TH>
              <TH>Deportistas</TH>
              <TH>Afiliación</TH>
              <TH>Usuarios</TH>
              <TH>Estado</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {clubs.length === 0 ? (
              <TR>
                <TD colSpan={7} className="py-10 text-center text-fdnda-muted">
                  Aún no hay clubes registrados.
                </TD>
              </TR>
            ) : (
              clubs.map((club) => (
                <TR key={club.id}>
                  <TD>
                    <p className="font-medium text-fdnda-ink">{club.name}</p>
                    <p className="text-xs text-fdnda-muted">{club.code}</p>
                  </TD>
                  <TD>{club.region || "—"}</TD>
                  <TD>{club.athleteCount}</TD>
                  <TD>
                    {(() => {
                      const badge =
                        AFFILIATION_STATE_BADGE[club.affiliationState] ??
                        AFFILIATION_STATE_BADGE.SIN_AFILIAR
                      return <Badge variant={badge.variant}>{badge.label}</Badge>
                    })()}
                  </TD>
                  <TD>
                    {club.users.length === 0 ? (
                      <span className="text-xs text-fdnda-warning">Sin usuario</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {club.users.map((user) => (
                          <div key={user.id} className="flex items-center gap-2">
                            <span className="font-mono text-xs">{user.username}</span>
                            <Badge variant={user.disciplineAccess.length === 0 ? "info" : "neutral"}>
                              {user.disciplineAccess.length === 0
                                ? "Coordinador"
                                : user.disciplineAccess
                                    .map((discipline) => DISCIPLINES[discipline].short)
                                    .join(" · ")}
                            </Badge>
                            {!user.isActive ? (
                              <Badge variant="danger">inactivo</Badge>
                            ) : null}
                            <button
                              type="button"
                              title="Editar disciplinas permitidas"
                              aria-label={`Editar disciplinas de ${user.username}`}
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-fdnda-muted hover:bg-fdnda-sky-soft hover:text-fdnda-navy"
                              onClick={() => setAccessUser(user)}
                            >
                              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title="Cambiar contraseña"
                              aria-label={`Cambiar contraseña de ${user.username}`}
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-fdnda-muted hover:bg-fdnda-sky-soft hover:text-fdnda-navy"
                              onClick={() => openResetDialog(user)}
                            >
                              <KeyRound className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title={user.isActive ? "Desactivar acceso" : "Activar acceso"}
                              disabled={isPending}
                              className="inline-flex min-h-11 items-center rounded-control px-2 text-xs font-semibold text-fdnda-muted underline underline-offset-2 hover:bg-fdnda-sky-soft hover:text-fdnda-navy disabled:cursor-not-allowed disabled:opacity-55"
                              onClick={() =>
                                startTransition(async () => {
                                  const r = await toggleClubUserActive(user.id)
                                  if (!r.success) toast.error(r.error)
                                })
                              }
                            >
                              {user.isActive ? "desactivar" : "activar"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <Badge variant={club.isActive ? "success" : "danger"}>
                      {club.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openUserDialog(club)}
                        title="Crear usuario"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(club)}
                        title="Editar club"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          startTransition(async () => {
                            const r = await toggleClubActive(club.id)
                            if (!r.success) toast.error(r.error)
                          })
                        }
                      >
                        {club.isActive ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableContainer>

      {/* Crear/editar club */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Nuevo club" : "Editar club"}
      >
        <form action={handleSaveClub} className="space-y-4">
          {editing !== "new" && editing ? (
            <input type="hidden" name="id" value={editing.id} />
          ) : null}
          <div>
            <Label htmlFor="club-name">Nombre del club</Label>
            <Input
              id="club-name"
              name="name"
              required
              defaultValue={editing !== "new" ? editing?.name : ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="club-code">Código</Label>
              <Input
                id="club-code"
                name="code"
                required
                placeholder="REGATAS"
                defaultValue={editing !== "new" ? editing?.code : ""}
              />
            </div>
            <div>
              <Label htmlFor="club-region">Región</Label>
              <Input
                id="club-region"
                name="region"
                placeholder="Lima"
                defaultValue={editing !== "new" ? editing?.region : ""}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="club-contactName">Contacto (delegado)</Label>
            <Input
              id="club-contactName"
              name="contactName"
              defaultValue={editing !== "new" ? editing?.contactName : ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="club-contactPhone">Teléfono</Label>
              <Input
                id="club-contactPhone"
                name="contactPhone"
                defaultValue={editing !== "new" ? editing?.contactPhone : ""}
              />
            </div>
            <div>
              <Label htmlFor="club-contactEmail">Email</Label>
              <Input
                id="club-contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={editing !== "new" ? editing?.contactEmail : ""}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Crear usuario de club */}
      <Dialog
        open={userDialogClub !== null}
        onClose={() => setUserDialogClub(null)}
        title={`Nuevo usuario — ${userDialogClub?.name ?? ""}`}
        description="El club usará estas credenciales para inscribir a sus deportistas."
      >
        <form action={handleCreateUser} className="space-y-4">
          <input type="hidden" name="clubId" value={userDialogClub?.id ?? ""} />
          <div>
            <Label htmlFor="user-username">Usuario</Label>
            <Input
              id="user-username"
              name="username"
              required
              placeholder={userDialogClub?.code.toLowerCase()}
              defaultValue={userDialogClub?.code.toLowerCase()}
            />
          </div>
          <div>
            <Label htmlFor="user-name">Nombre del delegado</Label>
            <Input
              id="user-name"
              name="name"
              required
              defaultValue={
                userDialogClub?.contactName || `Delegado ${userDialogClub?.name ?? ""}`
              }
            />
          </div>
          <div>
            <Label htmlFor="user-password">Contraseña</Label>
            <Input
              id="user-password"
              name="password"
              required
              defaultValue={suggestedPassword}
              className="font-mono"
            />
            <p className="mt-1 text-xs text-fdnda-muted">
              Contraseña sugerida generada automáticamente. Cópiala antes de guardar:
              no se volverá a mostrar.
            </p>
          </div>
          <DisciplineAccessFields />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setUserDialogClub(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Crear usuario
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={accessUser !== null}
        onClose={() => setAccessUser(null)}
        title={`Disciplinas — ${accessUser?.username ?? ""}`}
        description="Sin disciplinas marcadas, el usuario será coordinador y verá todo el club."
      >
        <form action={handleSaveAccess} className="space-y-4">
          <input type="hidden" name="userId" value={accessUser?.id ?? ""} />
          <DisciplineAccessFields selected={accessUser?.disciplineAccess} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAccessUser(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>Guardar alcance</Button>
          </div>
        </form>
      </Dialog>

      {/* Reset de contraseña */}
      <Dialog
        open={resetUser !== null}
        onClose={() => setResetUser(null)}
        title={`Nueva contraseña — ${resetUser?.username ?? ""}`}
      >
        <form action={handleResetPassword} className="space-y-4">
          <input type="hidden" name="userId" value={resetUser?.id ?? ""} />
          <div>
            <Label htmlFor="reset-password">Contraseña nueva</Label>
            <Input
              id="reset-password"
              name="password"
              required
              defaultValue={suggestedPassword}
              className="font-mono"
            />
            <p className="mt-1 text-xs text-fdnda-muted">
              Cópiala antes de guardar: no se volverá a mostrar.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setResetUser(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Actualizar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

function DisciplineAccessFields({ selected = [] }: { selected?: DisciplineValue[] }) {
  return (
    <fieldset className="space-y-2 rounded-surface border border-fdnda-border p-4">
      <legend className="px-1 text-sm font-semibold text-fdnda-navy">
        Acceso por disciplina
      </legend>
      {DISCIPLINE_VALUES.map((discipline) => (
        <label key={discipline} className="flex min-h-11 items-center gap-3 text-sm text-fdnda-ink">
          <input
            type="checkbox"
            name="disciplineAccess"
            value={discipline}
            defaultChecked={selected.includes(discipline)}
            className="h-4 w-4 accent-fdnda-navy"
          />
          {DISCIPLINES[discipline].label}
        </label>
      ))}
      <p className="text-xs leading-5 text-fdnda-muted">
        Marca una disciplina para aislar el panel. Déjalas vacías únicamente para un coordinador general.
      </p>
    </fieldset>
  )
}
