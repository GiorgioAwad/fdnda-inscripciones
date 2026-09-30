import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Política de Privacidad",
}

export default function PrivacyPage() {
  const contactEmail =
    process.env.PRIVACY_CONTACT_EMAIL || "sportentries@fdnda.org"
  // Sin código configurado no se publica un «pendiente»: la frase se omite.
  const bankCode = process.env.PERSONAL_DATA_BANK_REGISTRATION_CODE

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      {/* La raíz lleva al portal que corresponda (o al login sin sesión). */}
      <Link
        href="/"
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-sm font-bold text-fdnda-muted underline-offset-4 hover:text-fdnda-navy hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al portal
      </Link>
      <article className="space-y-6 rounded-surface border border-fdnda-border bg-white p-6 shadow-raised sm:p-8">
        <div>
          <h1 className="text-3xl font-bold text-fdnda-navy">
            Política de Privacidad
          </h1>
          <p className="mt-2 text-sm text-fdnda-muted">
            Versión vigente: 10 de agosto de 2026
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-fdnda-navy">Responsable</h2>
          <p className="text-sm leading-6 text-fdnda-ink">
            La Federación Deportiva Nacional de Deportes Acuáticos (FDNDA) es
            responsable del banco de datos de afiliaciones e inscripciones.
            {bankCode ? (
              <>
                {" "}
                Código de registro: <strong>{bankCode}</strong>.
              </>
            ) : null}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-fdnda-navy">
            Datos y finalidades
          </h2>
          <p className="text-sm leading-6 text-fdnda-ink">
            Tratamos datos identificativos, de contacto, documento, fecha de
            nacimiento, sexo, club, disciplina, afiliaciones, inscripciones y pagos
            para verificar elegibilidad, administrar competencias, cobrar cuotas,
            emitir constancias, prevenir fraude y cumplir obligaciones legales.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-fdnda-navy">
            Menores y autorización
          </h2>
          <p className="text-sm leading-6 text-fdnda-ink">
            Cuando el deportista sea menor de edad, el club declara contar con la
            autorización de quien ejerce la patria potestad o tutela y haberle
            informado sobre este tratamiento. El club debe conservar evidencia de
            dicha autorización.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-fdnda-navy">
            Proveedores y transferencias
          </h2>
          <p className="text-sm leading-6 text-fdnda-ink">
            Podemos encargar infraestructura, base de datos, seguridad, correo y
            procesamiento de pagos a proveedores sujetos a contratos de
            confidencialidad y protección de datos. Solo compartimos la información
            necesaria para prestar esos servicios o cuando una autoridad competente
            lo exija.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-fdnda-navy">
            Conservación y seguridad
          </h2>
          <p className="text-sm leading-6 text-fdnda-ink">
            Conservamos los datos mientras sean necesarios para la afiliación, el
            historial deportivo, la atención de reclamos y los plazos legales
            aplicables. Aplicamos control de acceso, cifrado en tránsito, copias de
            seguridad, auditoría y minimización de datos.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-fdnda-navy">Tus derechos</h2>
          <p className="text-sm leading-6 text-fdnda-ink">
            Puedes solicitar información, acceso, actualización, rectificación,
            cancelación u oposición escribiendo a{" "}
            <a className="font-semibold text-fdnda-navy underline" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
            . La solicitud debe permitir verificar la identidad del titular o su
            representante.
          </p>
        </section>
      </article>
    </main>
  )
}

