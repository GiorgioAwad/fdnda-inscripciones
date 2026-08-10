"use client"

import { useActionState, useState } from "react"
import { CircleAlert, Eye, EyeOff, Loader2, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { loginAction, type LoginState } from "./actions"

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [showPassword, setShowPassword] = useState(false)
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  )
  const hasError = Boolean(state.error)

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />

      <div className="flex min-h-11 items-center" aria-live="polite">
        {state.error ? (
          <p
            id="login-error"
            role="alert"
            className="flex w-full items-start gap-2 rounded-surface border border-fdnda-danger-ring/70 bg-fdnda-danger-soft px-3.5 py-2.5 text-sm font-semibold text-fdnda-danger"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {state.error}
          </p>
        ) : (
          <p id="login-help" className="text-xs text-fdnda-muted">
            Los campos marcados con <span className="font-bold text-fdnda-red">*</span> son
            obligatorios.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="username" className="text-fdnda-navy">
          Usuario <span className="text-fdnda-red" aria-hidden="true">*</span>
          <span className="sr-only"> (obligatorio)</span>
        </Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          placeholder="Usuario de tu club"
          required
          autoFocus
          disabled={pending}
          aria-invalid={hasError}
          aria-describedby={hasError ? "login-error" : "login-help"}
          className="h-12 rounded-control border-fdnda-border-control shadow-none focus:border-fdnda-turquoise focus:ring-fdnda-turquoise/20"
        />
      </div>

      <div>
        <Label htmlFor="password" className="text-fdnda-navy">
          Contraseña <span className="text-fdnda-red" aria-hidden="true">*</span>
          <span className="sr-only"> (obligatorio)</span>
        </Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Ingresa tu contraseña"
            required
            disabled={pending}
            aria-invalid={hasError}
            aria-describedby={hasError ? "login-error" : "login-help"}
            className="h-12 rounded-control border-fdnda-border-control pr-12 shadow-none focus:border-fdnda-turquoise focus:ring-fdnda-turquoise/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-control text-fdnda-muted transition-colors hover:text-fdnda-navy focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-fdnda-turquoise"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Eye className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        className="h-12 w-full rounded-control bg-fdnda-navy text-white shadow-none hover:bg-fdnda-navy/90 focus-visible:outline-fdnda-turquoise"
        size="lg"
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <LogIn className="h-5 w-5" aria-hidden="true" />
        )}
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  )
}
