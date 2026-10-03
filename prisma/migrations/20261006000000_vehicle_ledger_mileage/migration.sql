-- AlterTable
ALTER TABLE "FuelEntry" ADD COLUMN     "ledgerTransactionId" TEXT;

-- CreateTable
CREATE TABLE "MileageTrip" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "km" DECIMAL(10,1) NOT NULL,
    "business" BOOLEAN NOT NULL DEFAULT true,
    "purpose" TEXT,
    "fromPlace" TEXT,
    "toPlace" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "MileageTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MileageTrip_vehicleId_date_idx" ON "MileageTrip"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "FuelEntry_ledgerTransactionId_idx" ON "FuelEntry"("ledgerTransactionId");

-- AddForeignKey
ALTER TABLE "FuelEntry" ADD CONSTRAINT "FuelEntry_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "FinTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

