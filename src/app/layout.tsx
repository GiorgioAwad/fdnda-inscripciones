import type { Metadata, Viewport } from "next";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Condensed,
} from "next/font/google";
import { Toaster } from "sonner";
import { FEDERATION_SHORT } from "@/lib/brand";
import "./globals.css";

// Superfamilia IBM Plex en tres roles. `next/font/google` descarga en tiempo de
// build y sirve los .woff2 desde /_next/static/media/, así que no hay ninguna
// petición a Google en runtime: es lo que hace compatible esto con la CSP
// `font-src 'self' data:` de next.config.ts. Si algún día el build tuviera que
// ser hermético, la salida es next/font/local con los .woff2 versionados —
// mismos nombres de variable, cambio confinado a este archivo.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-plex-sans",
});

// Condensed y Mono no tienen corte variable: el peso es obligatorio.
// La condensada gana ~11% de ancho, que es exactamente lo que necesitan las
// cabeceras de las tablas de 9 y 10 columnas del padrón y de las pruebas.
const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-plex-condensed",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: {
    default: `${FEDERATION_SHORT} Afiliaciones e Inscripciones`,
    template: `%s | ${FEDERATION_SHORT}`,
  },
  description: `Plataforma oficial de afiliaciones e inscripciones de la ${FEDERATION_SHORT}.`,
  icons: {
    icon: "/fdnda-logo.png",
    apple: "/fdnda-logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning solo silencia los atributos de ESTE elemento, no
    // los de sus hijos: las extensiones del navegador (gestores de contraseñas,
    // antivirus, traductores) suelen inyectar marcas en <html> antes de que
    // React hidrate, y eso disparaba un falso error de hidratación. Los
    // desajustes reales dentro de la app se siguen reportando igual.
    <html
      lang="es"
      data-scroll-behavior="smooth"
      className={`h-full antialiased ${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-fdnda-surface text-fdnda-ink">
        {/* Sin pie aquí: los layouts de zona (portal y admin) pintan el suyo, y
            este añadía un segundo pie apilado en toda ruta autenticada. El
            enlace a la política vive ahora en esos dos pies. */}
        {children}
        <Toaster richColors closeButton position="top-center" />
      </body>
    </html>
  );
}
