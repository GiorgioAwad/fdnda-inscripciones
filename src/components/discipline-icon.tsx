import Image from "next/image"
import { disciplineStyle } from "@/lib/disciplines"
import { cn } from "@/lib/utils"

export function DisciplineIcon({
  discipline,
  tone = "brand",
  className,
}: {
  discipline: string
  tone?: "brand" | "light"
  className?: string
}) {
  const { pictogram } = disciplineStyle(discipline)

  return (
    <Image
      src={pictogram.src}
      alt=""
      aria-hidden="true"
      width={pictogram.width}
      height={pictogram.height}
      unoptimized
      className={cn(
        "shrink-0 object-contain",
        tone === "light" && "brightness-0 invert",
        className
      )}
    />
  )
}
