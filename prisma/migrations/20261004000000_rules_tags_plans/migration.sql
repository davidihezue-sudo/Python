-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('MINE', 'HOUSEHOLD');

-- AlterTable
ALTER TABLE "FinTransaction" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "FinRule" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerMemberId" TEXT NOT NULL,
    "scope" "RuleScope" NOT NULL DEFAULT 'MINE',
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FinRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaydayPlan" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerMemberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "incomeSourceId" TEXT,
    "lines" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunOn" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PaydayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisteredRoom" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "InvestmentKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "openingRoom" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RegisteredRoom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinRule_householdId_active_idx" ON "FinRule"("householdId", "active");

-- CreateIndex
CREATE INDEX "SavedView_householdId_memberId_kind_idx" ON "SavedView"("householdId", "memberId", "kind");

-- CreateIndex
CREATE INDEX "PaydayPlan_householdId_ownerMemberId_idx" ON "PaydayPlan"("householdId", "ownerMemberId");

-- CreateIndex
CREATE INDEX "RegisteredRoom_householdId_idx" ON "RegisteredRoom"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredRoom_memberId_kind_year_key" ON "RegisteredRoom"("memberId", "kind", "year");

-- CreateIndex
CREATE INDEX "FinTransaction_tags_idx" ON "FinTransaction" USING GIN ("tags");

-- AddForeignKey
ALTER TABLE "FinRule" ADD CONSTRAINT "FinRule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaydayPlan" ADD CONSTRAINT "PaydayPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredRoom" ADD CONSTRAINT "RegisteredRoom_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

