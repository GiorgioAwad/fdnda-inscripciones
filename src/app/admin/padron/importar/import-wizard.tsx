"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { DISCIPLINES } from "@/lib/disciplines"
import {
  commitPadronImport,
  previewPadronImport,
  type ImportPreviewRow,
} from "../actions"

export function ImportWizard() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<ImportPreviewRow[] | null>(null)
  const [isAnalyzing, startAnalyze] = useTransition()
  const [isCommitting, startCommit] = useTransition()

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? []
  const errorRows = rows?.filter((r) => r.errors.length > 0) ?? []

  const handleAnalyze = (file: File) => {
    setFileName(file.name)
    const formData = new FormData()
    formData.set("file", file)
    startAnalyze(async () => {
      const result = await previewPadronImport(formData)
      if (!result.success || !result.rows) {
        toast.error(result.error ?? "No se pudo analizar el archivo.")
        setRows(null)
        return
      }
      setRows(result.rows)
    })
  }

  const handleCommit = () => {
    if (validRows.length === 0) return
    startCommit(async () => {
      const payload = validRows.map((r) => ({
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
      if (result.success) {
        toast.success(`Importación completada: ${result.created} deportistas procesados.`)
        router.push("/admin/padron")
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Selector de archivo */}
      <div
        role="group"
        aria-label="Seleccionar archivo Excel del padrón"
        className="flex flex-col items-center justify-center gap-3 rounded-surface border-2 border-dashed border-fdnda-turquoise/45 bg-fdnda-sky-soft px-6 py-12 text-center transition-colors hover:border-fdnda-turquoise"
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
        <div>
          <p className="text-sm font-semibold text-fdnda-ink">
            Arrastra tu Excel aquí o
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-fdnda-muted">
            columnas: NOMBRES, APELLIDOS, TIPO_DOCUMENTO, NRO_DOCUMENTO,
            FECHA_NACIMIENTO, SEXO, CLUB, DISCIPLINAS
          </p>
        </div>
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
          {isAnalyzing ? "Analizando…" : "Elegir archivo"}
        </Button>
        {fileName ? <p className="text-xs font-semibold text-fdnda-muted">Archivo: {fileName}</p> : null}
      </div>

      {/* Vista previa */}
      {rows ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 text-fdnda-success">
                <CheckCircle2 className="h-4 w-4" /> {validRows.length} filas válidas
              </span>
              {errorRows.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-fdnda-danger">
                  <AlertTriangle className="h-4 w-4" /> {errorRows.length} con errores
                  (no se importarán)
                </span>
              ) : null}
            </div>
            <Button
              onClick={handleCommit}
              disabled={validRows.length === 0 || isCommitting}
            >
              {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar importación ({validRows.length})
            </Button>
          </div>

          <TableContainer>
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
                {rows.map((row) => (
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
                      <span className="font-mono">{row.docNumber}</span>
                    </TD>
                    <TD>
                      {row.birthDateISO
                        ? row.birthDateISO.split("-").reverse().join("/")
                        : "—"}
                    </TD>
                    <TD>{row.sex}</TD>
                    <TD>{row.clubName ?? row.clubRef ?? "—"}</TD>
                    <TD className="text-xs">
                      {row.disciplines.length > 0
                        ? row.disciplines.map((d) => DISCIPLINES[d].short).join(" · ")
                        : "—"}
                    </TD>
                    <TD>
                      {row.errors.length > 0 ? (
                        <span className="text-xs text-fdnda-danger">
                          {row.errors.join("; ")}
                        </span>
                      ) : row.exists ? (
                        <Badge variant="info">Actualizará</Badge>
                      ) : (
                        <Badge variant="success">Nuevo</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </>
      ) : null}
    </div>
  )
}
