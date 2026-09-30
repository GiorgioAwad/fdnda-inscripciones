"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import {
  Copy,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { DISCIPLINES, DISCIPLINE_VALUES, type DisciplineValue } from "@/lib/disciplines"
import { plural } from "@/lib/utils"
import {
  createClubUser,
  resetClubUserPassword,
  saveClub,
  saveClubUserAccess,
  setClubActive,
  setClubUserActive,
} from "./actions"

interface ClubUser {
  id: string
  username: string
  name: string
  isActive: boolean
  disciplineAccess: DisciplineValue[]
}

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
  // Estado de la afiliación del club en cada disciplina de la temporada vigente.
  affiliations: Array<{ discipline: DisciplineValue; state: string }>
  users: ClubUser[]
}

// Lo mínimo para crear un usuario: sirve tanto para una fila de la tabla como
// para el club que se acaba de registrar (que aún no está en la página).
interface ClubTarget {
  id: string
  name: string
  code: string
  contactName: string
}

interface UserTarget {
  id: string
  username: string
  clubName: string
}

interface Credentials {
  clubName: string
  username: string
  password: string
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  let out = ""
  const bytes = new Uint32Array(10)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += chars[b % chars.length]
  return out
}

function accessLabel(access: readonly DisciplineValue[]): string {
  return access.length === 0
    ? "Coordinador del club"
    : `Delegado de ${access.map((discipline) => DISCIPLINES[discipline].short).join(" y ")}`
}

// Acción de texto por usuario de acceso: compacta pero con 36 px de alto y
// rótulo visible.
const USER_ACTION =
  "inline-flex min-h-9 items-center gap-1 rounded-control px-1.5 text-xs font-semibold text-fdnda-navy underline-offset-2 hover:bg-fdnda-sky-soft hover:underline disabled:cursor-not-allowed disabled:opacity-55"

export function ClubsManager({
  clubs,
  seasonYear,
}: {
  clubs: ClubRow[]
  seasonYear: number | null
}) {
  const [clubForm, setClubForm] = useState<ClubRow | "new" | null>(null)
  const [userFor, setUserFor] = useState<ClubTarget | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [accessUser, setAccessUser] = useState<(UserTarget & { access: string }) | null>(null)
  const [resetUser, setResetUser] = useState<(UserTarget & { password: string }) | null>(null)
  const [deactivating, setDeactivating] = useState<ClubRow | null>(null)
  const [blocking, setBlocking] = useState<UserTarget | null>(null)
  const [suggestedPassword, setSuggestedPassword] = useState("")
  const [isPending, startTransition] = useTransition()

  const openUserDialog = (club: ClubTarget) => {
    setSuggestedPassword(generatePassword())
    setUserFor(club)
  }

  // onSubmit en vez de <form action>: React 19 reinicia el formulario al
  // terminar la acción, y con un error del servidor se perdía lo escrito.
  const handleSaveClub = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const isNew = clubForm === "new"
    startTransition(async () => {
      const result = await saveClub(formData)
      if (!result.success || !result.club) {
        toast.error(result.error ?? "No se pudieron guardar los datos del club. Inténtalo de nuevo.")
        return
      }
      setClubForm(null)
      if (isNew) {
        // Sin usuario de acceso el club no puede entrar al portal: el paso
        // siguiente se abre solo en vez de esconderse en un icono de la fila.
        toast.success(`${result.club.name} registrado. Crea ahora su usuario de acceso.`)
        openUserDialog(result.club)
      } else {
        toast.success(`Datos de ${result.club.name} guardados`)
      }
    })
  }

  const handleCreateUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const clubName = userFor?.name ?? ""
    const password = String(formData.get("password") ?? "")
    startTransition(async () => {
      const result = await createClubUser(formData)
      if (!result.success || !result.username) {
        toast.error(result.error ?? "No se pudo crear el usuario de acceso. Inténtalo de nuevo.")
        return
      }
      setUserFor(null)
      setCredentials({ clubName, username: result.username, password })
    })
  }

  const handleSaveAccess = () => {
    if (!accessUser) return
    const formData = new FormData()
    formData.set("userId", accessUser.id)
    formData.set("disciplineAccess", accessUser.access)
    startTransition(async () => {
      const result = await saveClubUserAccess(formData)
      if (result.success) {
        toast.success(`Disciplinas de ${accessUser.username} cambiadas. Su sesión se cerró.`)
        setAccessUser(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleResetPassword = () => {
    if (!resetUser) return
    const formData = new FormData()
    formData.set("userId", resetUser.id)
    formData.set("password", resetUser.password)
    startTransition(async () => {
      const result = await resetClubUserPassword(formData)
      if (result.success) {
        setCredentials({
          clubName: resetUser.clubName,
          username: resetUser.username,
          password: resetUser.password,
        })
        setResetUser(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  const applyClubActive = (club: ClubRow, isActive: boolean) => {
    startTransition(async () => {
      const result = await setClubActive(club.id, isActive)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDeactivating(null)
      toast.success(
        isActive
          ? `${club.name} habilitado: sus usuarios con acceso activo ya pueden entrar.`
          : `${club.name} desactivado: sus usuarios ya no pueden entrar.`
      )
    })
  }

  const applyUserActive = (user: UserTarget, isActive: boolean) => {
    startTransition(async () => {
      const result = await setClubUserActive(user.id, isActive)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setBlocking(null)
      toast.success(
        isActive
          ? `Acceso de ${user.username} restablecido`
          : `Acceso de ${user.username} bloqueado. Su sesión se cerró.`
      )
    })
  }

  const copyCredentials = async () => {
    if (!credentials) return
    try {
      await navigator.clipboard.writeText(
        `Usuario: ${credentials.username}\nContraseña: ${credentials.password}`
      )
      toast.success("Usuario y contraseña copiados")
    } catch {
      toast.error("No se pudo copiar. Selecciona el texto y cópialo a mano.")
    }
  }

  const editing = clubForm !== null && clubForm !== "new" ? clubForm : null
  const activeUsersOf = (club: ClubRow) => club.users.filter((user) => user.isActive).length

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setClubForm("new")}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Registrar club
        </Button>
      </div>

      {clubs.length === 0 ? (
        <div className="rounded-surface border border-fdnda-border bg-white shadow-raised">
          <EmptyState
            icon={UsersRound}
            title="Aún no hay clubes"
            action={
              <Button onClick={() => setClubForm("new")}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Registrar el primer club
              </Button>
            }
          >
            Registra cada club con su código y luego crea su usuario de acceso: con
            él entra al portal para registrar deportistas, afiliarse e inscribir en
            competencias.
          </EmptyState>
        </div>
      ) : (
        <TableContainer aria-label="Clubes registrados">
          <Table>
            <THead>
              <TR>
                <TH>Club</TH>
                <TH className="text-right">Deportistas</TH>
                <TH>{seasonYear ? `Afiliación ${seasonYear}` : "Afiliación"}</TH>
                <TH>Usuarios de acceso</TH>
                <TH className="text-right">Acciones</TH>
              </TR>
            </THead>
            <TBody>
              {clubs.map((club) => (
                <TR key={club.id}>
                  {/* Región y estado viajan con el nombre: eran dos columnas
                      casi siempre iguales («—», «Habilitado») que a 1280 px
                      dejaban las acciones fuera de la vista. */}
                  <TD>
                    <p className="font-medium text-fdnda-ink">{club.name}</p>
                    <p className="text-xs text-fdnda-muted">
                      {[club.code, club.region].filter(Boolean).join(" · ")}
                    </p>
                    {!club.isActive ? (
                      <Badge variant="danger" className="mt-1">
                        Desactivado
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="text-right">{club.athleteCount}</TD>
                  <TD>
                    {seasonYear === null ? (
                      <span className="text-xs text-fdnda-muted">Sin temporada vigente</span>
                    ) : club.affiliations.length === 0 ? (
                      <span className="text-xs text-fdnda-muted">
                        Sin cuotas fijadas en la temporada
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {club.affiliations.map((entry) => {
                          const badge =
                            AFFILIATION_STATE_BADGE[entry.state] ??
                            AFFILIATION_STATE_BADGE.SIN_AFILIAR
                          return (
                            <Badge key={entry.discipline} variant={badge.variant}>
                              {DISCIPLINES[entry.discipline].short} · {badge.label}
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                    {/* Crear un usuario es una acción sobre los usuarios, no
                        sobre el club: vive en su celda y libera la columna de
                        acciones, que a 1280 px quedaba cortada. */}
                    <button
                      type="button"
                      aria-label={`Crear usuario de acceso para ${club.name}`}
                      className={`${USER_ACTION} mt-1`}
                      onClick={() => openUserDialog(club)}
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Crear usuario de acceso
                    </button>
                  </TD>
                  <TD>
                    {club.users.length === 0 ? (
                      <p className="text-xs font-semibold text-fdnda-warning">
                        Sin usuario de acceso: no puede entrar al portal
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {club.users.map((user) => {
                          const target = {
                            id: user.id,
                            username: user.username,
                            clubName: club.name,
                          }
                          return (
                            <div key={user.id} className="min-w-52">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="num text-xs">{user.username}</span>
                                <Badge
                                  variant={user.disciplineAccess.length === 0 ? "info" : "neutral"}
                                >
                                  {accessLabel(user.disciplineAccess)}
                                </Badge>
                                {!user.isActive ? (
                                  <Badge variant="danger">Acceso bloqueado</Badge>
                                ) : null}
                              </div>
                              {/* Acciones con texto visible: antes eran un escudo
                                  y una llave sin rótulo, y había que adivinar. */}
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-1">
                                <button
                                  type="button"
                                  aria-label={`Cambiar las disciplinas que ve ${user.username}`}
                                  className={USER_ACTION}
                                  onClick={() =>
                                    setAccessUser({
                                      ...target,
                                      access: user.disciplineAccess[0] ?? "",
                                    })
                                  }
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                  Alcance
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Cambiar la contraseña de ${user.username}`}
                                  className={USER_ACTION}
                                  onClick={() =>
                                    setResetUser({ ...target, password: generatePassword() })
                                  }
                                >
                                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                                  Contraseña
                                </button>
                                <button
                                  type="button"
                                  disabled={isPending}
                                  aria-label={
                                    user.isActive
                                      ? `Bloquear acceso de ${user.username}`
                                      : `Restablecer acceso de ${user.username}`
                                  }
                                  className={USER_ACTION}
                                  onClick={() =>
                                    user.isActive
                                      ? setBlocking(target)
                                      : applyUserActive(target, true)
                                  }
                                >
                                  {user.isActive ? "Bloquear acceso" : "Restablecer acceso"}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Editar ${club.name}`}
                        onClick={() => setClubForm(club)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        aria-label={
                          club.isActive ? `Desactivar ${club.name}` : `Habilitar ${club.name}`
                        }
                        onClick={() =>
                          club.isActive ? setDeactivating(club) : applyClubActive(club, true)
                        }
                      >
                        {club.isActive ? "Desactivar" : "Habilitar"}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {/* Registrar / editar club */}
      <Dialog
        open={clubForm !== null}
        onClose={() => setClubForm(null)}
        title={editing ? `Editar ${editing.name}` : "Registrar club"}
      >
        <form key={editing?.id ?? "new"} onSubmit={handleSaveClub} className="space-y-4">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div>
            <Label htmlFor="club-name">Nombre del club</Label>
            <Input id="club-name" name="name" required defaultValue={editing?.name ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="club-code">Código</Label>
              <Input
                id="club-code"
                name="code"
                required
                placeholder="REGATAS"
                aria-describedby="club-code-help"
                defaultValue={editing?.code ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="club-region">Región</Label>
              <Input
                id="club-region"
                name="region"
                placeholder="Lima"
                defaultValue={editing?.region ?? ""}
              />
            </div>
          </div>
          <p id="club-code-help" className="-mt-2 text-xs text-fdnda-muted">
            El código va en la columna CLUB de la plantilla del padrón y se propone como
            usuario de acceso.
          </p>
          <div>
            <Label htmlFor="club-contactName">Persona de contacto</Label>
            <Input
              id="club-contactName"
              name="contactName"
              defaultValue={editing?.contactName ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="club-contactPhone">Teléfono</Label>
              <Input
                id="club-contactPhone"
                name="contactPhone"
                type="tel"
                defaultValue={editing?.contactPhone ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="club-contactEmail">Correo electrónico</Label>
              <Input
                id="club-contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={editing?.contactEmail ?? ""}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setClubForm(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isPending}>
              {editing ? "Guardar datos del club" : "Registrar club"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Crear usuario de acceso */}
      <Dialog
        open={userFor !== null}
        onClose={() => setUserFor(null)}
        title={`Crear usuario de acceso — ${userFor?.name ?? ""}`}
        description="Con este usuario el club entra al portal para registrar deportistas, afiliarse e inscribir en competencias."
      >
        <form key={userFor?.id} onSubmit={handleCreateUser} className="space-y-4">
          <input type="hidden" name="clubId" value={userFor?.id ?? ""} />
          <div>
            <Label htmlFor="user-username">Usuario</Label>
            <Input
              id="user-username"
              name="username"
              required
              defaultValue={userFor?.code.toLowerCase()}
            />
          </div>
          <div>
            <Label htmlFor="user-name">Nombre de quien lo usará</Label>
            <Input
              id="user-name"
              name="name"
              required
              defaultValue={userFor?.contactName ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="user-password">Contraseña</Label>
            <Input
              id="user-password"
              name="password"
              required
              minLength={8}
              aria-describedby="user-password-help"
              defaultValue={suggestedPassword}
              className="num"
            />
            <p id="user-password-help" className="mt-1 text-xs text-fdnda-muted">
              Generada al azar. Al crear el usuario la verás una vez más para copiarla;
              en su primer ingreso tendrá que cambiarla.
            </p>
          </div>
          <DisciplineAccessFields name="disciplineAccess" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setUserFor(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isPending}>
              Crear usuario de acceso
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Usuario y contraseña, una sola vez */}
      <Dialog
        open={credentials !== null}
        onClose={() => setCredentials(null)}
        title={`Usuario de acceso de ${credentials?.clubName ?? ""}`}
        description="Copia estos datos y envíalos al club. La contraseña no se vuelve a mostrar; en su próximo ingreso tendrá que cambiarla."
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-control border border-fdnda-border bg-fdnda-surface p-4 text-sm">
            <dt className="font-semibold text-fdnda-muted">Usuario</dt>
            <dd className="num select-all break-all text-fdnda-ink">{credentials?.username}</dd>
            <dt className="font-semibold text-fdnda-muted">Contraseña</dt>
            <dd className="num select-all break-all text-fdnda-ink">{credentials?.password}</dd>
          </dl>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCredentials(null)}>
              Cerrar
            </Button>
            <Button onClick={copyCredentials}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Copiar usuario y contraseña
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Cambiar disciplinas que ve un usuario */}
      <ConfirmDialog
        open={accessUser !== null}
        onClose={() => setAccessUser(null)}
        title={`¿Cambiar las disciplinas que ve ${accessUser?.username ?? ""}?`}
        consequence="Al guardar se cierra su sesión y tendrá que volver a entrar. Desde ese momento solo verá lo que elijas aquí."
        confirmLabel="Cambiar disciplinas"
        pending={isPending}
        onConfirm={handleSaveAccess}
      >
        <DisciplineAccessFields
          name="disciplineAccess-edit"
          value={accessUser?.access ?? ""}
          onChange={(access) =>
            setAccessUser((current) => (current ? { ...current, access } : current))
          }
        />
      </ConfirmDialog>

      {/* Cambiar contraseña */}
      <ConfirmDialog
        open={resetUser !== null}
        onClose={() => setResetUser(null)}
        title={`¿Cambiar la contraseña de ${resetUser?.username ?? ""}?`}
        consequence="Se cierra su sesión actual y en su próximo ingreso tendrá que cambiar esta contraseña por una propia."
        confirmLabel="Cambiar contraseña"
        pending={isPending}
        onConfirm={handleResetPassword}
      >
        <div>
          <Label htmlFor="reset-password">Contraseña nueva</Label>
          <Input
            id="reset-password"
            required
            minLength={8}
            value={resetUser?.password ?? ""}
            onChange={(event) => {
              const password = event.target.value
              setResetUser((current) => (current ? { ...current, password } : current))
            }}
            className="num"
          />
          <p className="mt-1 text-xs text-fdnda-muted">
            Generada al azar. Después de cambiarla la verás una vez más para copiarla.
          </p>
        </div>
      </ConfirmDialog>

      {/* Desactivar club */}
      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title={`¿Desactivar ${deactivating?.name ?? ""}?`}
        consequence={
          deactivating ? (
            <>
              <p>
                {activeUsersOf(deactivating) === 0
                  ? "No tiene usuarios con acceso activo, así que nadie pierde su sesión."
                  : `${plural(
                      activeUsersOf(deactivating),
                      "usuario de acceso pierde",
                      "usuarios de acceso pierden"
                    )} la sesión ahora y no ${
                      activeUsersOf(deactivating) === 1 ? "podrá" : "podrán"
                    } entrar al portal hasta que habilites el club otra vez.`}
              </p>
              <p className="mt-2">
                Sus deportistas, afiliaciones y órdenes se conservan.
              </p>
            </>
          ) : null
        }
        confirmLabel="Desactivar club"
        destructive
        pending={isPending}
        onConfirm={() => deactivating && applyClubActive(deactivating, false)}
      />

      {/* Bloquear acceso de un usuario */}
      <ConfirmDialog
        open={blocking !== null}
        onClose={() => setBlocking(null)}
        title={`¿Bloquear el acceso de ${blocking?.username ?? ""}?`}
        consequence={`Su sesión se cierra ahora y no podrá entrar al portal hasta que restablezcas su acceso. Los datos de ${blocking?.clubName ?? "su club"} no cambian.`}
        confirmLabel="Bloquear acceso"
        destructive
        pending={isPending}
        onConfirm={() => blocking && applyUserActive(blocking, false)}
      />
    </div>
  )
}

// Una sola opción: el servidor acepta como máximo una disciplina por usuario.
// Con casillas se podían marcar varias y el error llegaba recién al guardar.
function DisciplineAccessFields({
  name,
  value,
  onChange,
}: {
  name: string
  value?: string
  onChange?: (value: string) => void
}) {
  const options = [
    { value: "", label: "Todo el club", hint: "Coordinador del club" },
    ...DISCIPLINE_VALUES.map((discipline) => ({
      value: discipline,
      label: `Solo ${DISCIPLINES[discipline].label}`,
      hint: `Delegado de ${DISCIPLINES[discipline].label}`,
    })),
  ]

  return (
    <fieldset className="space-y-1 rounded-surface border border-fdnda-border p-4">
      <legend className="px-1 text-sm font-semibold text-fdnda-navy">
        ¿Qué puede ver este usuario?
      </legend>
      {options.map((option) => (
        <label
          key={option.value || "all"}
          className="flex min-h-11 items-center gap-3 text-sm text-fdnda-ink"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            // El formulario de alta envía el valor; la confirmación de cambio lo
            // controla desde su estado.
            {...(onChange
              ? {
                  checked: (value ?? "") === option.value,
                  onChange: () => onChange(option.value),
                }
              : { defaultChecked: option.value === "" })}
            className="h-4 w-4 accent-fdnda-navy"
          />
          <span>
            <span className="font-semibold">{option.label}</span>{" "}
            <span className="text-fdnda-muted">({option.hint})</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
