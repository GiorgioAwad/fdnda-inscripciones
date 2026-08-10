import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { assertProductionConfiguration } from "../src/lib/env"
import { countOrdersRequiringPaymentReview } from "../src/lib/orders"

async function main() {
  assertProductionConfiguration({ force: true })

  const [database, currentSeasons, activeAdmins, invalidOrderItems, paymentReview] =
    await Promise.all([
      prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`,
      prisma.season.count({ where: { isCurrent: true } }),
      prisma.user.count({ where: { role: "ADMIN", isActive: true } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "order_items"
        WHERE num_nonnulls(
          "registrationId",
          "clubAffiliationId",
          "athleteAffiliationId",
          "eventAthleteFeeId"
        ) <> 1
      `,
      countOrdersRequiringPaymentReview(),
    ])

  const problems: string[] = []
  if (currentSeasons !== 1) {
    problems.push(`Debe existir exactamente una temporada vigente; hay ${currentSeasons}`)
  }
  if (activeAdmins < 1) problems.push("No existe un administrador activo")
  if (Number(invalidOrderItems[0]?.count ?? 0) > 0) {
    problems.push("Hay order_items con destinos inconsistentes")
  }
  if (paymentReview > 0) {
    problems.push(`${paymentReview} orden(es) requieren conciliación de pago`)
  }

  if (problems.length > 0) {
    throw new Error(`Preflight bloqueado: ${problems.join("; ")}`)
  }

  console.log(
    JSON.stringify({
      success: true,
      database: database[0]?.database,
      currentSeasons,
      activeAdmins,
      paymentReview,
      checkedAt: new Date().toISOString(),
    })
  )
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
