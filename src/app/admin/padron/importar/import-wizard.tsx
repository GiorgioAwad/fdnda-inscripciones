"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, ArrowRight, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { DISCIPLINES } from "@/lib/disciplines"
import { plural, SEX_LABELS } from "@/lib/utils"
import {
  commitPadronImport,
  previewPadronImport,
  type ImportPreviewRow,
} from "../actions"

// Las mismas reglas que aplica lib/excel.ts al leer el archivo. Antes solo
// estaban en la hoja «Instrucciones» de la plantilla.
const FORMAT_RULES: Array<{ column: string; rule: string }> = [
  { column: "TIPO_DOCUMENTO", rule: "DNI, CE, PASAPORTE u OTROS. Si queda vacío, se toma DNI." },
  { column: "NRO_DOCUMENTO", rule: "De 4 a 20 letras, números o guiones." },
  {
    column: "FECHA_NACIMIENTO",
    rule: "DD/MM/AAAA. También sirve una celda con formato de fecha.",
  },
  { column: "SEXO", rule: "M o F." },
  { column: "CLUB", rule: "El código o el nombre exacto del club (hoja Clubes de la plantilla)." },
  {
    column: "DISCIPLINAS",
    rule: "Una o varias separadas por coma: CLAVADOS, ARTISTICA, POLO. Se cobra una cuota de afiliación por cada una.",
  },
]

export function ImportWizard() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<ImportPreviewRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isAnalyzing, startAnalyze] = useTransition()
  const [isCommitting, startCommit] = useTransition()

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? []
  const errorRows = rows?.filter((r) => r.errors.length > 0) ?? []
  const newCount = validRows.filter((r) => !r.exists).length
  const updateCount = validRows.length - newCount
  const clubChangeCount = validRows.filter((r) => r.clubChange).length
  const visibleRows = onlyErrors ? errorRows : (rows ?? [])

  const handleAnalyze = (file: File) => {
    setFileName(file.name)
    setProblem(null)
    setOnlyErrors(false)
    const formData = new FormData()
    formData.set("file", file)
    startAnalyze(async () => {
      const result = await previewPadronImport(formData)
      if (!result.success || !result.rows) {
        // Aviso fijo, no un toast: hay que poder leerlo mientras se corrige
        // el archivo.
        setProblem(result.error ?? "No se pudo leer el archivo. Vuelve a subirlo.")
        setRows(null)
        return
      }
      setRows(result.rows)
    })
  }

  const handleCommit = () => {
    if (validRows.length === 0) return
    setProblem(null)
    startCommit(async () => {
      const payload = validRows.map((r) => ({
        rowNumber: r.rowNumber,
        firstNames: r.firstNames,
        lastNames: r.lastNames,
        docType: r.docType,
        docNumber: r.docNumber,
        birthDateISO: r.birthDateISO,
        sex: r.sex,
        clubId: r.clubId,
        disciplines: r.disciplines,
      }))
      const result = await commitPadronImport(JSON.stringify(payload))
      setConfirmOpen(false)
      if (result.success) {
        toast.success(
          `Padrón importado: ${plural(
            result.created ?? 0,
            "deportista nuevo",
            "deportistas nuevos"
          )} y ${plural(result.updated ?? 0, "actualizado", "actualizados")}.`
        )
        router.push("/admin/padron")
      } else {
        setProblem(result.error ?? "No se pudo importar el padrón. Vuelve a analizar el archivo.")
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Selector de archivo */}
      <div
        role="group"
        aria-label="Elegir el Excel del padrón"
        className="flex flex-col items-center justify-center gap-3 rounded-surface border-2 border-dashed border-fdnda-turquoise/45 bg-fdnda-sky-soft px-6 py-10 text-center transition-colors hover:border-fdnda-turquoise"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) handleAnalyze(file)
        }}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-control bg-fdnda-navy text-white">
          <Upload className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold text-fdnda-ink">
          Arrastra aquí el Excel del padrón o elígelo desde tu equipo.
        </p>
        <input
          ref={fileInputRef}
          aria-label="Archivo Excel del padrón"
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleAnalyze(file)
            e.target.value = ""
          }}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {isAnalyzing ? "Analizando el archivo…" : "Elegir archivo Excel"}
        </Button>
        {fileName ? (
          <p className="text-xs font-semibold text-fdnda-muted">Archivo: {fileName}</p>
        ) : null}
      </div>

      {problem ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-fdnda-danger-ring bg-fdnda-danger-soft p-4 text-sm font-semibold text-fdnda-danger"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{problem}</p>
        </div>
      ) : null}

      {/* Reglas de formato */}
      {rows === null ? (
        <section
          aria-labelledby="import-format-title"
          className="rounded-surface border border-fdnda-border bg-white p-5 shadow-raised"
        >
          <h2
            id="import-format-title"
            className="font-heading text-lg font-bold text-fdnda-navy"
          >
            Cómo debe venir cada columna
          </h2>
          <p className="mt-1 text-sm text-fdnda-muted">
            También hacen falta NOMBRES y APELLIDOS. Máximo 5000 filas y 4 MB por
            archivo.
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            {FORMAT_RULES.map((item) => (
              <div key={item.column} className="contents">
                <dt className="num font-semibold text-fdnda-navy">{item.column}</dt>
                <dd className="text-fdnda-ink">{item.rule}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/* Vista previa */}
      {rows ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-sm" role="status">
              <p className="font-semibold text-fdnda-ink">
                {plural(newCount, "deportista nuevo", "deportistas nuevos")} ·{" "}
                {plural(updateCount, "se actualizará", "se actualizarán")}
                {errorRows.length > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-fdnda-danger">
                      {plural(errorRows.length, "fila con errores", "filas con errores")} (no
                      se importarán)
                    </span>
                  </>
                ) : null}
              </p>
              {clubChangeCount > 0 ? (
                <p className="font-semibold text-fdnda-warning">
                  {clubChangeCount === 1
                    ? "1 deportista cambiará de club al importar."
                    : `${clubChangeCount} deportistas cambiarán de club al importar.`}
                </p>
              ) : null}
            </div>
            <Button
              onClick={() => (clubChangeCount > 0 ? setConfirmOpen(true) : handleCommit())}
              disabled={validRows.length === 0}
              loading={isCommitting}
            >
              Importar {plural(validRows.length, "deportista", "deportistas")}
            </Button>
          </div>

          {errorRows.length > 0 ? (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-fdnda-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-fdnda-navy"
                checked={onlyErrors}
                onChange={(event) => setOnlyErrors(event.target.checked)}
              />
              Mostrar solo filas con errores ({errorRows.length})
            </label>
          ) : null}

          <TableContainer aria-label="Vista previa de la importación">
            <Table>
              <THead>
                <TR>
                  <TH>Fila</TH>
                  <TH>Deportista</TH>
                  <TH>Documento</TH>
                  <TH>Nacimiento</TH>
                  <TH>Sexo</TH>
                  <TH>Club</TH>
                  <TH>Disciplinas</TH>
                  <TH>Resultado</TH>
                </TR>
              </THead>
              <TBody>
                {visibleRows.map((row) => (
                  <TR
                    key={row.rowNumber}
                    className={row.errors.length > 0 ? "bg-fdnda-danger-soft/60" : undefined}
                  >
                    <TD className="text-xs text-fdnda-muted">{row.rowNumber}</TD>
                    <TD className="font-medium text-fdnda-ink">
                      {row.lastNames}, {row.firstNames}
                    </TD>
                    <TD>
                      <span className="text-xs text-fdnda-muted">{row.docType}</span>{" "}
                      <span className="num">{row.docNumber}</span>
                    </TD>
                    <TD>
                      {row.birthDateISO
                        ? row.birthDateISO.split("-").reverse().join("/")
                        : "—"}
                    </TD>
                    <TD>{row.errors.length > 0 ? row.sex : SEX_LABELS[row.sex]}</TD>
                    <TD>{row.clubName ?? row.clubRef ?? "—"}</TD>
                    <TD className="text-xs">
                      {row.disciplines.length > 0
                        ? row.disciplines.map((d) => DISCIPLINES[d].short).join(" · ")
                        : "—"}
                    </TD>
                    <TD>
                      {row.errors.length > 0 ? (
                        <span className="text-xs font-semibold text-fdnda-danger">
                          No se importará: {row.errors.join("; ")}
                        </span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          {row.exists ? (
                            <Badge variant="info">Actualizará</Badge>
                          ) : (
                            <Badge variant="success">Nuevo</Badge>
                          )}
                          {row.clubChange ? (
                            <span className="inline-flex flex-wrap items-center gap-1 text-xs font-semibold text-fdnda-warning">
                              Cambia de club: {row.currentClubName}
                              <ArrowRight className="h-3 w-3" aria-hidden="true" />
                              <span className="sr-only">a</span>
                              {row.clubName}
                            </span>
                          ) : null}
                          {row.clubInactive ? (
                            <span className="text-xs text-fdnda-muted">
                              {row.clubName} está desactivado
                            </span>
                          ) : null}
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`¿Importar ${plural(validRows.length, "deportista", "deportistas")}?`}
        consequence={
          <>
            <p>
              {clubChangeCount === 1
                ? "1 deportista pasará a otro club en cuanto importes, sin registrar un motivo."
                : `${clubChangeCount} deportistas pasarán a otro club en cuanto importes, sin registrar un motivo.`}{" "}
              Revisa esas filas en la vista previa («Cambia de club») antes de seguir.
            </p>
            <p className="mt-2">
              En total se registrarán{" "}
              {plural(newCount, "deportista nuevo", "deportistas nuevos")} y se
              actualizarán los datos de {plural(updateCount, "deportista", "deportistas")}.
            </p>
          </>
        }
        confirmLabel={`Importar ${plural(validRows.length, "deportista", "deportistas")}`}
        pending={isCommitting}
        onConfirm={handleCommit}
      />
    </div>
  )
}
