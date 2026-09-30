import { FileSpreadsheet, Upload } from "lucide-react"
import { buttonClasses } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { ImportWizard } from "./import-wizard"

export const dynamic = "force-dynamic"

export default function ImportarPadronPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Upload}
        back={{ href: "/admin/padron", label: "Volver al padrón" }}
        title="Importar padrón"
        description="Sube el Excel, revisa fila por fila qué se crea y qué se actualiza, e importa. Si un N.º de documento ya existe se actualizan sus datos, incluido el club: la vista previa te avisa de cada cambio de club."
        actions={
          <a
            href="/api/admin/padron/plantilla"
            download
            className={buttonClasses({ variant: "outline" })}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Descargar plantilla
          </a>
        }
      />

      <ImportWizard />
    </div>
  )
}
