"use client"

import { useActionState } from "react"
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

  return (
    <form action={action} className="space-y-5" aria-busy={pending}>
      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-surface border border-fdnda-danger-ring bg-fdnda-danger-soft p-3 text-sm font-semibold text-fdnda-danger"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {state.error}
        </p>
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
      />
      <PasswordField
        id="confirmPassword"
        label="Repite la nueva contraseña"
        autoComplete="new-password"
        disabled={pending}
      />

      <p className="text-xs leading-relaxed text-fdnda-muted">
        Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo. No
        reutilices una contraseña de otro servicio.
      </p>

      <Button type="submit" size="lg" className="h-12 w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        )}
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  )
}

function PasswordField({
  id,
  label,
  autoComplete,
  disabled,
}: {
  id: string
  label: string
  autoComplete: string
  disabled: boolean
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
        className="h-12"
      />
    </div>
  )
}
