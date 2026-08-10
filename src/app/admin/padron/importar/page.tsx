import Link from "next/link"
import { ArrowLeft, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImportWizard } from "./import-wizard"

export const dynamic = "force-dynamic"

export default function ImportarPadronPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/padron"
            className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-fdnda-muted hover:text-fdnda-turquoise-deep"
          >
            <ArrowLeft className="h-3 w-3" /> Volver al padrón
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight text-fdnda-ink sm:text-2xl">
            Importar padrón
          </h1>
          <p className="mt-0.5 text-sm text-fdnda-muted">
            Sube el Excel, revisa la vista previa y confirma la importación. Los
            documentos existentes se actualizan (incluido su club).
          </p>
        </div>
        <a href="/api/admin/padron/plantilla" download>
          <Button variant="outline">
            <FileSpreadsheet className="h-4 w-4" /> Descargar plantilla
          </Button>
        </a>
      </div>

      <ImportWizard />
    </div>
  )
}
