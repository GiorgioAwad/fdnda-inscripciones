"use client"

import { startTransition, useActionState } from "react"
import { CircleAlert, Loader2, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import {
  changePasswordAction,
  type PasswordChangeState,
} from "./actions"

export function PasswordChangeForm() {
  const [state, action, pending] = useActionState<PasswordChangeState, FormData>(
    changePasswordAction,
    {}
  )
  const messages = state.errors ?? (state.error ? [state.error] : [])

  // onSubmit con preventDefault en vez de <form action>: React 19 reinicia el
  // formulario al terminar la acción aunque haya error, y se perdían las tres
  // contraseñas por una sola regla incumplida.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => action(formData))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-busy={pending}>
      {messages.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-surface border border-fdnda-danger-ring bg-fdnda-danger-soft p-3 text-sm font-semibold text-fdnda-danger"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {messages.length === 1 ? (
            <p>{messages[0]}</p>
          ) : (
            <div>
              <p>Corrige lo siguiente:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 font-medium">
                {messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      <PasswordField
        id="currentPassword"
        label="Contraseña temporal o actual"
        autoComplete="current-password"
        disabled={pending}
      />
      <PasswordField
        id="newPassword"
        label="Nueva contraseña"
        autoComplete="new-password"
        disabled={pending}
        describedBy="password-rules"
      />
      <PasswordField
        id="confirmPassword"
        label="Repite la nueva contraseña"
        autoComplete="new-password"
        disabled={pending}
      />

      <div id="password-rules" className="text-xs leading-relaxed text-fdnda-muted">
        <p>La nueva contraseña debe:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>tener al menos 12 caracteres;</li>
          <li>incluir una mayúscula, una minúscula, un número y un símbolo;</li>
          <li>ser distinta de la actual.</li>
        </ul>
        <p className="mt-1">No reutilices una contraseña que uses en otro servicio.</p>
      </div>

      <p className="text-sm text-fdnda-muted">
        Al cambiarla cerraremos tu sesión y entrarás de nuevo con la nueva contraseña.
      </p>

      <Button type="submit" size="lg" className="h-12 w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        )}
        {pending ? "Cambiando contraseña…" : "Cambiar contraseña y volver a entrar"}
      </Button>
    </form>
  )
}

function PasswordField({
  id,
  label,
  autoComplete,
  disabled,
  describedBy,
}: {
  id: string
  label: string
  autoComplete: string
  disabled: boolean
  describedBy?: string
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        required
        disabled={disabled}
        aria-describedby={describedBy}
        className="h-12"
      />
    </div>
  )
}
