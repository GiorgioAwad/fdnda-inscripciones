"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { markGuideSeenAction } from "./actions"

// La guía de bienvenida vive en el layout y no en una página: así se abre en
// cualquier ruta donde aterrice el primer ingreso y se puede reabrir desde el
// menú lateral sin recargar. Los pasos llegan ya renderizados desde el
// servidor (ver guide-steps.tsx).

export interface GuideStepView {
  title: string
  body: ReactNode
  place: { label: string; icon: ReactNode }
  visual: ReactNode
}

interface GuideContextValue {
  openGuide: () => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

export function useGuide(): GuideContextValue {
  const value = useContext(GuideContext)
  if (!value) throw new Error("useGuide fuera de <GuideProvider>")
  return value
}

export function GuideProvider({
  title,
  steps,
  finishLabel,
  finishHref,
  autoOpen,
  children,
}: {
  title: string
  steps: GuideStepView[]
  finishLabel: string
  finishHref: string
  // true solo en el primer ingreso (users.onboardedAt nulo).
  autoOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(autoOpen)
  const [index, setIndex] = useState(0)
  // Se marca como vista una sola vez, al cerrarla por cualquier vía: terminar,
  // omitir, Escape o clic fuera. Reabrirla desde el menú no vuelve a escribir.
  const pendingMark = useRef(autoOpen)
  const router = useRouter()
  const pathname = usePathname()

  const close = useCallback(() => {
    setOpen(false)
    if (pendingMark.current) {
      pendingMark.current = false
      void markGuideSeenAction()
    }
  }, [])

  const openGuide = useCallback(() => {
    setIndex(0)
    setOpen(true)
  }, [])

  const finish = useCallback(() => {
    close()
    if (pathname !== finishHref) router.push(finishHref)
  }, [close, finishHref, pathname, router])

  const last = steps.length - 1
  const step = steps[index]
  const next = index < last ? steps[index + 1] : null

  // Flechas del teclado para recorrerla sin buscar los botones. Solo mientras
  // está abierta; el foco nunca está en un campo de texto dentro de la guía.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, last))
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0))
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, last])

  const context = useMemo(() => ({ openGuide }), [openGuide])

  return (
    <GuideContext.Provider value={context}>
      {children}
      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={`Paso ${index + 1} de ${steps.length} · puedes volver a abrirla desde el menú`}
        className="sm:max-w-3xl"
      >
        <div className="space-y-5">
          <StepLanes steps={steps} index={index} onSelect={setIndex} />

          <div
            key={index}
            className="animate-fade-up grid gap-5 motion-reduce:animate-none sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center"
          >
            {/* El agua es del cromo: el mismo navy con onda que la barra
                lateral enmarca la miniatura, como si fuera la pantalla real. */}
            <div
              aria-hidden="true"
              className="wave-field flex min-h-48 items-center justify-center rounded-surface bg-fdnda-navy-deep p-5"
            >
              {step.visual}
            </div>

            <div aria-live="polite">
              <h3 className="font-heading text-2xl text-fdnda-navy">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-fdnda-ink">{step.body}</p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-chip bg-fdnda-surface px-2.5 py-1.5 text-xs text-fdnda-muted ring-1 ring-inset ring-fdnda-border">
                <span className="text-fdnda-navy" aria-hidden="true">
                  {step.place.icon}
                </span>
                En el menú:
                <span className="font-semibold text-fdnda-navy">{step.place.label}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-fdnda-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={close}>
              Omitir guía
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {index > 0 ? (
                <Button variant="outline" onClick={() => setIndex(index - 1)}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Paso anterior
                </Button>
              ) : null}
              {next ? (
                <Button onClick={() => setIndex(index + 1)}>
                  Siguiente: {next.title}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button onClick={finish}>
                  {finishLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Dialog>
    </GuideContext.Provider>
  )
}

// El progreso se dibuja como andariveles: un carril por paso, lleno en navy
// cuando ya se recorrió y en turquesa el actual. Cada carril es un botón, para
// poder saltar a cualquier paso sin pasar por los anteriores.
function StepLanes({
  steps,
  index,
  onSelect,
}: {
  steps: GuideStepView[]
  index: number
  onSelect: (index: number) => void
}) {
  return (
    <ol
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((item, position) => {
        const current = position === index
        const done = position < index
        return (
          <li key={item.title} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(position)}
              aria-current={current ? "step" : undefined}
              aria-label={`Paso ${position + 1}: ${item.title}${done ? " (visto)" : ""}`}
              className="group block w-full rounded-chip py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                  current
                    ? "bg-fdnda-turquoise"
                    : done
                      ? "bg-fdnda-navy"
                      : "bg-fdnda-border group-hover:bg-fdnda-sky"
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 hidden truncate text-xs sm:block",
                  current ? "font-semibold text-fdnda-navy" : "text-fdnda-muted"
                )}
              >
                {item.title}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// Reabre la guía. `tone="chrome"` va en la barra lateral navy; `tone="page"`
// junto a los primeros pasos de Inicio.
export function GuideLauncher({
  tone = "chrome",
  className,
}: {
  tone?: "chrome" | "page"
  className?: string
}) {
  const { openGuide } = useGuide()
  return (
    <button
      type="button"
      onClick={openGuide}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise",
        tone === "chrome"
          ? "w-full justify-start text-white/85 hover:bg-white/10 hover:text-white"
          : "text-fdnda-navy hover:bg-fdnda-sky/25",
        className
      )}
    >
      <Compass className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
      Ver la guía de inicio
    </button>
  )
}
