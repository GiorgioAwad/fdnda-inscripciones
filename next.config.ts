import type { NextConfig } from "next"

const isProduction = process.env.NODE_ENV === "production"
const tunnelHost = process.env.DEV_TUNNEL_HOST
const canonicalHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_APP_URL
      ? new URL(process.env.NEXT_PUBLIC_APP_URL).host
      : undefined
  } catch {
    return undefined
  }
})()

const developmentOrigins = [
  "localhost:3000",
  "127.0.0.1:3000",
  "*.ngrok-free.dev",
  "*.ngrok-free.app",
  "*.ngrok.io",
  ...(tunnelHost ? [tunnelHost] : []),
]

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://*.izipay.pe",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://*.izipay.pe`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.izipay.pe",
  "font-src 'self' data:",
  "connect-src 'self' https://*.izipay.pe",
  "frame-src https://*.izipay.pe",
  "upgrade-insecure-requests",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
]

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: developmentOrigins,
  experimental: {
    serverActions: {
      allowedOrigins: isProduction
        ? canonicalHost
          ? [canonicalHost]
          : []
        : developmentOrigins,
      // La importación limita el archivo a 4 MB; queda por debajo del tope de
      // 4.5 MB de Vercel Functions y evita el default de 1 MB de Server Actions.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/club/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ]
  },
}

export default nextConfig
