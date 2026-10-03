-- CreateTable
CREATE TABLE "LegacyPlan" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "trustedMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeBalances" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegacyPlan_householdId_memberId_key" ON "LegacyPlan"("householdId", "memberId");

-- AddForeignKey
ALTER TABLE "LegacyPlan" ADD CONSTRAINT "LegacyPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

