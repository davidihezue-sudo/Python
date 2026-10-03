-- AlterTable
ALTER TABLE "FinAlertSetting" ADD COLUMN     "lastMonthlyReview" TEXT,
ADD COLUMN     "monthlyReview" BOOLEAN NOT NULL DEFAULT false;

