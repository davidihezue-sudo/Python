-- CreateEnum
CREATE TYPE "WishStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'PURCHASED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HouseholdRole" ADD VALUE 'CHILD';
ALTER TYPE "HouseholdRole" ADD VALUE 'ACCOUNTANT';

-- AlterTable
ALTER TABLE "HouseholdInvite" ADD COLUMN     "accessExpiresAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "HouseholdMember" ADD COLUMN     "accessExpiresAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "WishItem" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "requestedByMemberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "estimatedCost" DECIMAL(14,2) NOT NULL,
    "url" TEXT,
    "note" TEXT,
    "status" "WishStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByMemberId" TEXT,
    "decidedAt" TIMESTAMPTZ,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "WishItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinComment" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "FinComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastUsedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WishItem_householdId_status_idx" ON "WishItem"("householdId", "status");

-- CreateIndex
CREATE INDEX "FinComment_householdId_entity_entityId_idx" ON "FinComment"("householdId", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_householdId_idx" ON "ApiToken"("userId", "householdId");

-- AddForeignKey
ALTER TABLE "WishItem" ADD CONSTRAINT "WishItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinComment" ADD CONSTRAINT "FinComment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

