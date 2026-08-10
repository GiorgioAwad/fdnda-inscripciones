import { redirect } from "next/navigation"

export default async function LegacyEventBuilderPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/inscripciones/nueva?evento=${encodeURIComponent(slug)}`)
}
