import { LogOut } from "lucide-react"
import { signOut } from "@/lib/auth"
import { cn } from "@/lib/utils"

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server"
        await signOut({ redirectTo: "/login" })
      }}
    >
      <button
        type="submit"
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-3 py-2 text-sm font-semibold text-fdnda-navy transition-colors",
          "hover:bg-fdnda-sky/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise",
          className
        )}
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Cerrar sesión</span>
      </button>
    </form>
  )
}
