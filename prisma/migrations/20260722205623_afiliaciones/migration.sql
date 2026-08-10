-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('AFFILIATION', 'REGISTRATION');

-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_registrationId_fkey";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "athleteAffiliationId" TEXT,
ADD COLUMN     "clubAffiliationId" TEXT,
ALTER COLUMN "registrationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "kind" "OrderKind" NOT NULL DEFAULT 'REGISTRATION';

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "clubFee" DECIMAL(10,2) NOT NULL,
    "athleteFee" DECIMAL(10,2) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "name" TEXT NOT NULL,
    "birthYearFrom" INTEGER,
    "birthYearTo" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_affiliations" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "AffiliationStatus" NOT NULL DEFAULT 'PENDING',
    "fee" DECIMAL(10,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "paidAt" TIMESTAMP(3),
    "activeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athlete_affiliations" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "AffiliationStatus" NOT NULL DEFAULT 'PENDING',
    "fee" DECIMAL(10,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "paidAt" TIMESTAMP(3),
    "activeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "athlete_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seasons_year_key" ON "seasons"("year");

-- CreateIndex
CREATE INDEX "seasons_isCurrent_idx" ON "seasons"("isCurrent");

-- CreateIndex
CREATE INDEX "categories_seasonId_idx" ON "categories"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_seasonId_discipline_name_key" ON "categories"("seasonId", "discipline", "name");

-- CreateIndex
CREATE INDEX "club_affiliations_seasonId_status_idx" ON "club_affiliations"("seasonId", "status");

-- CreateIndex
CREATE INDEX "club_affiliations_activeOrderId_idx" ON "club_affiliations"("activeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "club_affiliations_clubId_seasonId_key" ON "club_affiliations"("clubId", "seasonId");

-- CreateIndex
CREATE INDEX "athlete_affiliations_clubId_seasonId_idx" ON "athlete_affiliations"("clubId", "seasonId");

-- CreateIndex
CREATE INDEX "athlete_affiliations_seasonId_status_idx" ON "athlete_affiliations"("seasonId", "status");

-- CreateIndex
CREATE INDEX "athlete_affiliations_activeOrderId_idx" ON "athlete_affiliations"("activeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "athlete_affiliations_athleteId_seasonId_key" ON "athlete_affiliations"("athleteId", "seasonId");

-- CreateIndex
CREATE INDEX "order_items_clubAffiliationId_idx" ON "order_items"("clubAffiliationId");

-- CreateIndex
CREATE INDEX "order_items_athleteAffiliationId_idx" ON "order_items"("athleteAffiliationId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_affiliations" ADD CONSTRAINT "club_affiliations_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_affiliations" ADD CONSTRAINT "club_affiliations_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_affiliations" ADD CONSTRAINT "athlete_affiliations_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_affiliations" ADD CONSTRAINT "athlete_affiliations_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_affiliations" ADD CONSTRAINT "athlete_affiliations_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_clubAffiliationId_fkey" FOREIGN KEY ("clubAffiliationId") REFERENCES "club_affiliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_athleteAffiliationId_fkey" FOREIGN KEY ("athleteAffiliationId") REFERENCES "athlete_affiliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
