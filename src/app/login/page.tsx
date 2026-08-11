import { Suspense } from "react"
import Image from "next/image"
import type { Metadata } from "next"
import { BadgeCheck, CalendarCheck2, UsersRound } from "lucide-react"
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
        <div
          className="absolute -right-28 top-1/2 -z-10 h-96 w-96 -translate-y-1/2 rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div
          className="absolute -right-10 top-1/2 -z-10 h-56 w-56 -translate-y-1/2 rounded-full border border-fdnda-sky/25"
          aria-hidden="true"
        />

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
            <div className="mb-6 flex items-center gap-2" aria-hidden="true">
              <span className="h-1 w-12 bg-fdnda-turquoise" />
              <span className="h-1 w-5 bg-fdnda-red" />
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-fdnda-sky">
              {FEDERATION_NAME}
            </p>
            <h1 className="font-heading max-w-lg text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl xl:text-[3.4rem]">
              La gestión deportiva, en un solo lugar.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-white/75 sm:text-base">
              Gestiona la afiliación de tu club y sus deportistas, y prepara sus
              inscripciones para las competencias oficiales.
            </p>
          </div>

          <div className="hidden grid-cols-1 gap-3 lg:grid xl:grid-cols-3">
            <LoginFeature icon={BadgeCheck} number="01" label="Afiliación" />
            <LoginFeature icon={UsersRound} number="02" label="Deportistas" />
            <LoginFeature icon={CalendarCheck2} number="03" label="Competencias" />
          </div>
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
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-fdnda-turquoise-deep">
            Acceso institucional
          </p>
          <h2
            id="login-title"
            className="font-heading mt-2 text-3xl font-bold tracking-wide text-fdnda-navy"
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

function LoginFeature({
  icon: Icon,
  number,
  label,
}: {
  icon: typeof BadgeCheck
  number: string
  label: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-surface border border-white/15 bg-white/[0.07] px-4 py-3.5 backdrop-blur-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-fdnda-sky/15 text-fdnda-sky">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[0.65rem] font-bold tracking-[0.18em] text-white/50">{number}</p>
        <p className="truncate text-sm font-semibold text-white">{label}</p>
      </div>
    </div>
  )
}
