import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-panel border border-fdnda-sky bg-fdnda-sky/30 text-fdnda-navy"
        aria-hidden="true"
      >
        <Icon className="h-7 w-7" />
      </div>
      <p className="font-heading text-lg font-bold text-fdnda-navy">{title}</p>
      {children ? (
        <div className="max-w-sm text-sm leading-6 text-fdnda-muted">{children}</div>
      ) : null}
    </div>
  )
}
