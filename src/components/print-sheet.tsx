import Image from "next/image"
import { LaneBand } from "@/components/ui/lane-band"
import { FEDERATION_NAME, FEDERATION_SHORT } from "@/lib/brand"
import { formatDateTimeLima } from "@/lib/utils"

// Cabecera y pie que solo existen en papel. Lo que este producto emite es
// documentación federativa —planillas, constancias, reportes— y hasta ahora
// salía sin membrete ni forma de firmarla.
//
// Ambas piezas son de servidor y sin JavaScript: se renderizan ocultas
// (`print-only`) y solo aparecen en el diálogo de impresión.

export function PrintSheetHeader({
  title,
  eventName,
  clubName,
  disciplines,
  meta,
}: {
  title: string
  eventName?: string
  clubName?: string
  disciplines?: readonly string[]
  // Pares etiqueta/valor propios de la hoja: sede, fechas, revisión, orden.
  meta?: { label: string; value: string }[]
}) {
  return (
    <header className="print-only relative mb-5 border-b-2 border-fdnda-navy pb-3">
      {disciplines?.length ? <LaneBand disciplines={disciplines} strong /> : null}
      <div className="flex items-start gap-3 pt-3">
        <Image
          src="/fdnda-logo.png"
          alt=""
          width={446}
          height={559}
          className="h-14 w-auto"
        />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-bold uppercase tracking-wide text-fdnda-navy">
            {FEDERATION_NAME}
          </p>
          <p className="font-heading text-xl text-fdnda-navy">{title}</p>
          {eventName ? (
            <p className="text-sm font-semibold text-fdnda-ink">{eventName}</p>
          ) : null}
          {clubName ? <p className="text-sm text-fdnda-ink">{clubName}</p> : null}
        </div>
      </div>
      {meta?.length ? (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fdnda-ink">
          {meta.map((row) => (
            <div key={row.label} className="flex gap-1.5">
              <dt className="font-semibold text-fdnda-muted">{row.label}:</dt>
              <dd className="num">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  )
}

export function PrintSheetFooter({ signatureLabel }: { signatureLabel?: string }) {
  return (
    <footer className="print-only print-sheet-footer text-fdnda-ink">
      <div className="flex items-end justify-between gap-8">
        <div className="flex-1">
          <div className="mt-6 border-t border-fdnda-ink pt-1 text-xs">
            {signatureLabel ?? "Nombre y firma del delegado del club"}
          </div>
        </div>
        <div className="w-40">
          <div className="mt-6 border-t border-fdnda-ink pt-1 text-xs">Documento</div>
        </div>
      </div>
      {/* La numeración automática de páginas solo funciona en los margin boxes
          de @page, que ningún navegador de escritorio implementa. La delegamos
          al pie nativo del diálogo de impresión en vez de prometerla. */}
      <p className="mt-2 text-[8pt] text-fdnda-muted">
        Emitido por el portal de {FEDERATION_SHORT} el{" "}
        {formatDateTimeLima(new Date())}. La numeración de páginas la agrega el
        navegador al imprimir.
      </p>
    </footer>
  )
}
