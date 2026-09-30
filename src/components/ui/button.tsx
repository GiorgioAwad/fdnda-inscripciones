import * as React from "react"
import { cn } from "@/lib/utils"

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive"
type Size = "default" | "sm" | "lg" | "icon"

// Solo los botones sólidos llevan elevación: son los que representan la acción
// principal y deben leerse como un objeto que se puede pulsar. Los demás
// (outline, ghost, secondary) se quedan planos para no competir con ellos.
const variantClasses: Record<Variant, string> = {
  default:
    "border border-fdnda-navy bg-fdnda-navy text-white shadow-raised hover:bg-fdnda-navy/90 " +
    "active:translate-y-px active:bg-fdnda-navy/80 active:shadow-none",
  secondary:
    "border border-fdnda-sky bg-fdnda-sky/45 text-fdnda-navy hover:bg-fdnda-sky/70 " +
    "active:bg-fdnda-sky",
  outline:
    "border border-fdnda-navy/35 bg-white text-fdnda-navy hover:border-fdnda-turquoise " +
    "hover:bg-fdnda-sky/20 active:bg-fdnda-sky/35",
  ghost:
    "border border-transparent text-fdnda-navy hover:bg-fdnda-sky/25 active:bg-fdnda-sky/40",
  destructive:
    "border border-fdnda-red bg-fdnda-red text-white shadow-raised hover:bg-fdnda-red/90 " +
    "active:translate-y-px active:bg-fdnda-red/80 active:shadow-none",
}

const sizeClasses: Record<Size, string> = {
  default: "min-h-11 px-4 py-2.5 text-sm",
  sm: "min-h-11 px-3 py-2 text-sm",
  lg: "min-h-12 px-5 py-3 text-base",
  icon: "h-11 w-11 p-0",
}

// Un enlace que se ve como botón usa estas clases directamente sobre <Link> o
// <a>. Antes se envolvía un <Button> dentro de un <Link>, y eso anida dos
// elementos interactivos (a > button): HTML inválido, doble parada de
// tabulador y un lector de pantalla que anuncia dos controles para un destino.
export function buttonClasses({
  variant = "default",
  size = "default",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold",
    "transition-[background-color,border-color,box-shadow,transform] duration-150 motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-turquoise focus-visible:ring-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55",
    variantClasses[variant],
    sizeClasses[size],
    className
  )
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  loadingText?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      disabled,
      loading = false,
      loadingText,
      variant = "default",
      size = "default",
      type = "button",
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-pulse"
        />
      ) : null}
      {loading && loadingText !== undefined ? loadingText : children}
    </button>
  )
)
Button.displayName = "Button"
