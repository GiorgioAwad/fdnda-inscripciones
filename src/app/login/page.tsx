import { Suspense } from "react"
import Image from "next/image"
import type { Metadata } from "next"
import { FEDERATION_NAME, FEDERATION_SHORT } from "@/lib/brand"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  // El sufijo lo agrega la plantilla del layout raíz ("%s | FDNDA").
  title: "Iniciar sesión",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; passwordChanged?: string }>
}) {
  const { callbackUrl, passwordChanged } = await searchParams

  return (
    <main className="grid min-h-dvh w-full min-w-0 grid-cols-[minmax(0,1fr)] bg-white lg:grid-cols-[minmax(380px,0.9fr)_minmax(520px,1.1fr)]">
      <section className="relative isolate min-w-0 overflow-hidden bg-fdnda-navy px-6 py-8 text-white sm:px-10 lg:min-h-dvh lg:px-12 lg:py-12 xl:px-16">
        <div className="wave-field absolute inset-0 -z-20 opacity-30" aria-hidden="true" />
        {/* Aquí había dos círculos concéntricos que no decían nada del deporte.
            Probé sustituirlos por andariveles cruzando el panel y a media
            opacidad leían como fallos de render, no como sogas: la textura de
            agua ya carga el ambiente y la barra corta de abajo es la firma.
            Un acento basta. */}

        <div className="mx-auto flex h-full w-full max-w-2xl flex-col lg:min-h-[calc(100dvh-6rem)] lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-control bg-white p-1.5 shadow-raised">
              <Image
                src="/fdnda-logo.png"
                alt=""
                width={446}
                height={559}
                className="h-full w-auto"
              />
            </span>
            <div>
              <p className="font-heading text-sm font-bold tracking-[0.12em]">FDNDA</p>
              <p className="text-xs text-fdnda-sky">Portal institucional</p>
            </div>
          </div>

          <div className="max-w-xl py-8 lg:py-12">
            {/* El andarivel de marca, ahora la firma del sistema en vez de dos
                barras sueltas puestas a mano. */}
            <div className="lane-rope mb-6 h-1.5 w-24 rounded-full" aria-hidden="true" />
            <p className="mb-3 text-eyebrow uppercase text-fdnda-sky">
              {FEDERATION_NAME}
            </p>
            <h1 className="font-heading max-w-lg text-4xl leading-[1.05] lg:text-display">
              La gestión deportiva, en un solo lugar.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-white/75 sm:text-base">
              Gestiona la afiliación de tu club y sus deportistas, y prepara sus
              inscripciones para las competencias oficiales.
            </p>
          </div>

          {/* Los tres pasos van numerados porque son de verdad una secuencia:
              un club se afilia, registra su padrón y recién entonces puede
              inscribir. Antes eran tres tarjetas sueltas con icono, y el icono
              se comía el ancho hasta cortar «Competencias». Sin él caben, y
              unidas por una divisoria se leen como el recorrido que son. */}
          <ol className="hidden overflow-hidden rounded-surface border border-white/15 lg:grid lg:grid-cols-3 lg:gap-px lg:bg-white/15">
            <LoginStep number="01" label="Afiliación" />
            <LoginStep number="02" label="Deportistas" />
            <LoginStep number="03" label="Competencias" />
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="login-title"
        className="flex min-w-0 flex-col px-6 py-8 sm:px-10 sm:py-10 lg:min-h-dvh lg:px-16 lg:py-12"
      >
        <div className="mx-auto w-full min-w-0 max-w-md py-4 lg:mt-[clamp(1rem,5vh,3.5rem)] lg:py-0">
          <Image
            src="/fdnda-logo.png"
            alt={`Logotipo oficial de la ${FEDERATION_SHORT}`}
            width={446}
            height={559}
            className="mb-7 h-24 w-auto"
            priority
          />
          <p className="text-eyebrow uppercase text-fdnda-turquoise-deep">
            Acceso institucional
          </p>
          <h2
            id="login-title"
            className="font-heading mt-2 text-3xl text-fdnda-navy"
          >
            Iniciar sesión
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fdnda-muted">
            Ingresa con las credenciales asignadas a tu club.
          </p>
          {passwordChanged === "1" ? (
            <p className="mt-4 rounded-surface border border-fdnda-success-ring bg-fdnda-success-soft p-3 text-sm font-semibold text-fdnda-success">
              Contraseña actualizada. Inicia sesión nuevamente.
            </p>
          ) : null}

          <div className="mt-7">
            <Suspense>
              <LoginForm callbackUrl={callbackUrl} />
            </Suspense>
          </div>
        </div>

        <p className="mx-auto mt-auto w-full max-w-md break-words pt-10 text-xs leading-relaxed text-fdnda-muted">
          ¿Necesitas acceso? Contacta a la federación para obtener el usuario de tu club.
        </p>
      </section>
    </main>
  )
}

function LoginStep({ number, label }: { number: string; label: string }) {
  return (
    <li className="min-w-0 bg-fdnda-navy-deep/60 px-4 py-3.5 backdrop-blur-sm">
      <p className="num text-[0.7rem] font-semibold text-fdnda-sky">{number}</p>
      <p className="font-heading mt-0.5 text-base font-bold text-white">{label}</p>
    </li>
  )
}
