import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import Link from "next/link";
import { FEDERATION_SHORT } from "@/lib/brand";
import "./globals.css";

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
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-fdnda-surface text-fdnda-ink">
        {children}
        <footer className="border-t border-fdnda-border bg-white px-4 py-4 text-center text-xs text-fdnda-muted">
          <Link href="/privacidad" className="font-semibold text-fdnda-navy underline">
            Política de Privacidad
          </Link>
        </footer>
        <Toaster richColors closeButton position="top-center" />
      </body>
    </html>
  );
}
