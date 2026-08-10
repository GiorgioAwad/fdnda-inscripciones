import * as React from "react"
import { cn } from "@/lib/utils"

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-control border border-fdnda-border-control bg-white px-3.5 text-sm text-fdnda-ink",
      "placeholder:text-fdnda-muted transition-colors motion-reduce:transition-none",
      "hover:border-fdnda-turquoise/70",
      "focus:border-fdnda-turquoise focus:outline-none focus:ring-2 focus:ring-fdnda-turquoise/25",
      "aria-invalid:border-fdnda-red aria-invalid:ring-2 aria-invalid:ring-fdnda-red/20",
      "read-only:bg-fdnda-surface",
      "disabled:cursor-not-allowed disabled:border-fdnda-border disabled:bg-fdnda-sunken disabled:text-fdnda-muted disabled:opacity-100",
      className
    )}
    {...props}
  />
))
Input.displayName = "Input"

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-28 w-full resize-y rounded-control border border-fdnda-border-control bg-white px-3.5 py-3 text-sm text-fdnda-ink",
      "placeholder:text-fdnda-muted transition-colors motion-reduce:transition-none",
      "hover:border-fdnda-turquoise/70",
      "focus:border-fdnda-turquoise focus:outline-none focus:ring-2 focus:ring-fdnda-turquoise/25",
      "aria-invalid:border-fdnda-red aria-invalid:ring-2 aria-invalid:ring-fdnda-red/20",
      "read-only:bg-fdnda-surface",
      "disabled:cursor-not-allowed disabled:border-fdnda-border disabled:bg-fdnda-sunken disabled:text-fdnda-muted disabled:opacity-100",
      className
    )}
    {...props}
  />
))
Textarea.displayName = "Textarea"

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-11 w-full rounded-control border border-fdnda-border-control bg-white px-3 text-sm text-fdnda-ink",
      "transition-colors motion-reduce:transition-none hover:border-fdnda-turquoise/70",
      "focus:border-fdnda-turquoise focus:outline-none focus:ring-2 focus:ring-fdnda-turquoise/25",
      "aria-invalid:border-fdnda-red aria-invalid:ring-2 aria-invalid:ring-fdnda-red/20",
      "disabled:cursor-not-allowed disabled:border-fdnda-border disabled:bg-fdnda-sunken disabled:text-fdnda-muted disabled:opacity-100",
      className
    )}
    {...props}
  />
))
Select.displayName = "Select"

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-semibold text-fdnda-navy", className)}
      {...props}
    />
  )
}
