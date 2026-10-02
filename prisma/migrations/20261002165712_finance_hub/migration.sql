-- CreateEnum
CREATE TYPE "RecordVisibility" AS ENUM ('PERSONAL', 'HOUSEHOLD', 'SELECTED');

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('OWNER', 'MEMBER', 'HOUSEHOLD', 'SPLIT');

-- CreateEnum
CREATE TYPE "ContributionArrangement" AS ENUM ('INDEPENDENT', 'SHARED_EQUAL', 'INCOME_BASED', 'FIXED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FinAccountType" AS ENUM ('CHEQUING', 'SAVINGS', 'HIGH_INTEREST_SAVINGS', 'CREDIT_CARD', 'LINE_OF_CREDIT', 'INVESTMENT', 'MORTGAGE', 'LOAN', 'CASH', 'OTHER_ASSET', 'OTHER_LIABILITY');

-- CreateEnum
CREATE TYPE "FinAccountStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FinTxType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'REIMBURSEMENT', 'ADJUSTMENT', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "FinTxStatus" AS ENUM ('POSTED', 'PLANNED');

-- CreateEnum
CREATE TYPE "FinReconciliation" AS ENUM ('UNRECONCILED', 'CLEARED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'IRREGULAR', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "IncomeKind" AS ENUM ('EMPLOYMENT', 'PART_TIME', 'SELF_EMPLOYMENT', 'BUSINESS', 'CONTRACT', 'FREELANCE', 'RENTAL', 'INVESTMENT', 'GOVERNMENT_BENEFIT', 'OTHER');

-- CreateEnum
CREATE TYPE "IncomeChangeKind" AS ENUM ('SALARY_INCREASE', 'SALARY_DECREASE', 'JOB_CHANGE', 'INTERRUPTION', 'RESUMPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "DebtType" AS ENUM ('CREDIT_CARD', 'PERSONAL_LOAN', 'LINE_OF_CREDIT', 'VEHICLE_LOAN', 'STUDENT_LOAN', 'MORTGAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM ('EMERGENCY_FUND', 'HOME_DOWN_PAYMENT', 'VEHICLE', 'VACATION', 'EDUCATION', 'MAJOR_PURCHASE', 'GENERAL_SAVINGS', 'DEBT_PAYOFF', 'INVESTMENT_CONTRIBUTION', 'NET_WORTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoalTracking" AS ENUM ('CONTRIBUTIONS', 'DEBT_BALANCE', 'NET_WORTH', 'ACCOUNT_BALANCE');

-- CreateEnum
CREATE TYPE "InvestmentKind" AS ENUM ('RRSP', 'TFSA', 'FHSA', 'RESP', 'NON_REGISTERED', 'PENSION', 'EMPLOYER_PLAN', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentEntryKind" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL', 'INCOME', 'FEE');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PROPERTY', 'VEHICLE', 'VALUABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "InsuranceKind" AS ENUM ('VEHICLE', 'HOME', 'TENANT', 'LIFE', 'DISABILITY', 'HEALTH', 'TRAVEL', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxRecordKind" AS ENUM ('EMPLOYMENT_INCOME', 'SELF_EMPLOYMENT_INCOME', 'TAX_DEDUCTED', 'PENSION_CONTRIBUTION', 'RRSP_CONTRIBUTION', 'FHSA_CONTRIBUTION', 'CHARITABLE_DONATION', 'MEDICAL_EXPENSE', 'TUITION', 'EMPLOYMENT_EXPENSE', 'OTHER_DEDUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "FinBudgetPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BudgetScope" AS ENUM ('HOUSEHOLD', 'PERSONAL');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY');

-- AlterEnum
ALTER TYPE "HouseholdRole" ADD VALUE 'READ_ONLY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BILL_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'LOW_BALANCE';
ALTER TYPE "NotificationType" ADD VALUE 'UNUSUAL_SPENDING';
ALTER TYPE "NotificationType" ADD VALUE 'SAVINGS_MILESTONE';
ALTER TYPE "NotificationType" ADD VALUE 'GOAL_BEHIND';
ALTER TYPE "NotificationType" ADD VALUE 'DEBT_PAYMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWAL';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_POLICY_RENEWAL';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "finEntity" TEXT,
ADD COLUMN     "finEntityId" TEXT;

-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "budgetPeriod" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "city" TEXT,
ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'CA',
ADD COLUMN     "dashboardLayout" JSONB,
ADD COLUMN     "dateFormat" TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "goalsPreference" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "numberLocale" TEXT NOT NULL DEFAULT 'en-CA',
ADD COLUMN     "onboardedAt" TIMESTAMPTZ,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "structure" TEXT;

-- AlterTable
ALTER TABLE "HouseholdMember" ADD COLUMN     "avatarColor" TEXT,
ADD COLUMN     "responsibilities" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "householdId" TEXT;

-- CreateTable
CREATE TABLE "MemberPrivacy" (
    "id" TEXT NOT NULL,
    "householdMemberId" TEXT NOT NULL,
    "incomeDefault" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "accountsDefault" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "transactionsDefault" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "savingsDefault" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "debtsDefault" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "otherDefault" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MemberPrivacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinAccount" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "type" "FinAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingDate" DATE NOT NULL,
    "creditLimit" DECIMAL(14,2),
    "accountMask" TEXT,
    "notes" TEXT,
    "status" "FinAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "reconciledThrough" DATE,
    "statementBalance" DECIMAL(14,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "FinAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinCategory" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL DEFAULT 'EXPENSE',
    "color" TEXT,
    "isEssential" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinMerchant" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCategoryId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinMerchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinTransaction" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "payerMemberId" TEXT,
    "allocationMode" "AllocationMode" NOT NULL DEFAULT 'OWNER',
    "allocatedMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "categoryId" TEXT,
    "merchantId" TEXT,
    "type" "FinTxType" NOT NULL,
    "status" "FinTxStatus" NOT NULL DEFAULT 'POSTED',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "postingDate" DATE,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "transferGroupId" TEXT,
    "recurringRuleId" TEXT,
    "incomeSourceId" TEXT,
    "billId" TEXT,
    "subscriptionId" TEXT,
    "insurancePolicyId" TEXT,
    "debtPaymentId" TEXT,
    "vehicleId" TEXT,
    "importBatchId" TEXT,
    "importHash" TEXT,
    "reconciliation" "FinReconciliation" NOT NULL DEFAULT 'UNRECONCILED',
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "FinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAllocation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "memberId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "percent" DECIMAL(7,4),

    CONSTRAINT "TransactionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionRule" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arrangement" "ContributionArrangement" NOT NULL DEFAULT 'SHARED_EQUAL',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "effectiveFrom" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ContributionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeSource" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "IncomeKind" NOT NULL DEFAULT 'EMPLOYMENT',
    "employer" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pensionDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "frequency" "Frequency" NOT NULL DEFAULT 'BIWEEKLY',
    "nextPayDate" DATE,
    "startDate" DATE,
    "endDate" DATE,
    "pausedFrom" DATE,
    "pausedUntil" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "IncomeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeChange" (
    "id" TEXT NOT NULL,
    "incomeSourceId" TEXT NOT NULL,
    "kind" "IncomeChangeKind" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "grossBefore" DECIMAL(14,2),
    "grossAfter" DECIMAL(14,2),
    "netBefore" DECIMAL(14,2),
    "netAfter" DECIMAL(14,2),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "type" "FinTxType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "accountId" TEXT NOT NULL,
    "toAccountId" TEXT,
    "categoryId" TEXT,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "merchantName" TEXT,
    "frequency" "Frequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "lastPostedOn" DATE,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'UTILITY',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "dueDate" DATE NOT NULL,
    "endDate" DATE,
    "accountId" TEXT,
    "categoryId" TEXT,
    "responsibleMemberId" TEXT,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "reminderDays" INTEGER[] DEFAULT ARRAY[3]::INTEGER[],
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "memberId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSubscription" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Streaming',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "nextBillingDate" DATE NOT NULL,
    "accountId" TEXT,
    "categoryId" TEXT,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "cancellationInfo" TEXT,
    "notes" TEXT,
    "priceHistory" JSONB NOT NULL DEFAULT '[]',
    "lastReviewedAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "RecurringSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" "InsuranceKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "policyNumberLast4" TEXT,
    "insuredMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "premium" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "coverageAmount" DECIMAL(14,2),
    "renewalDate" DATE,
    "expiryDate" DATE,
    "beneficiary" TEXT,
    "accountId" TEXT,
    "vehicleId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "lender" TEXT NOT NULL,
    "type" "DebtType" NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "compoundingPerYear" INTEGER NOT NULL DEFAULT 12,
    "minimumPayment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "regularPayment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "nextDueDate" DATE,
    "termMonths" INTEGER,
    "startDate" DATE,
    "maturityDate" DATE,
    "paymentAccountId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interest" DECIMAL(14,2) NOT NULL,
    "fromAccountId" TEXT,
    "memberId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsGoal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "GoalKind" NOT NULL DEFAULT 'GENERAL_SAVINGS',
    "tracking" "GoalTracking" NOT NULL DEFAULT 'CONTRIBUTIONS',
    "targetAmount" DECIMAL(14,2) NOT NULL,
    "startingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "targetDate" DATE,
    "monthlyContribution" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "debtId" TEXT,
    "responsibleMemberId" TEXT,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "assignedMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 2,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "completedAt" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalContribution" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "memberId" TEXT,
    "note" TEXT,
    "transferGroupId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentProfile" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "InvestmentKind" NOT NULL DEFAULT 'NON_REGISTERED',
    "investmentType" TEXT,
    "allocation" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentEntry" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" "InvestmentEntryKind" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "transferGroupId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "InvestmentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentValuation" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "marketValue" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "vehicleId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "currentValue" DECIMAL(14,2) NOT NULL,
    "valuationDate" DATE NOT NULL,
    "valuationSource" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "soldOn" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetValuation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRecord" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'PERSONAL',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "taxYear" INTEGER NOT NULL,
    "kind" "TaxRecordKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "date" DATE,
    "description" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "TaxRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRuleSet" (
    "id" TEXT NOT NULL,
    "householdId" TEXT,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "year" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TaxRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinBudget" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" "FinBudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD',
    "ownerMemberId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "FinBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinBudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "rollover" BOOLEAN NOT NULL DEFAULT false,
    "warnAtPct" INTEGER NOT NULL DEFAULT 85,

    CONSTRAINT "FinBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinScenario" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WHAT_IF',
    "description" TEXT,
    "horizonMonths" INTEGER NOT NULL DEFAULT 12,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FinScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "endDate" DATE,
    "notes" TEXT,
    "ownerMemberId" TEXT,
    "visibility" "RecordVisibility" NOT NULL DEFAULT 'HOUSEHOLD',
    "sharedWithMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "accountId" TEXT,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'COMMITTED',
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "asOf" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinAlertSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "billsDue" BOOLEAN NOT NULL DEFAULT true,
    "overdue" BOOLEAN NOT NULL DEFAULT true,
    "budget" BOOLEAN NOT NULL DEFAULT true,
    "unusual" BOOLEAN NOT NULL DEFAULT true,
    "lowBalance" BOOLEAN NOT NULL DEFAULT true,
    "savings" BOOLEAN NOT NULL DEFAULT true,
    "debtDue" BOOLEAN NOT NULL DEFAULT true,
    "insurance" BOOLEAN NOT NULL DEFAULT true,
    "subscriptions" BOOLEAN NOT NULL DEFAULT true,
    "leadDays" INTEGER NOT NULL DEFAULT 3,
    "budgetThresholdPct" INTEGER NOT NULL DEFAULT 85,
    "lowBalanceThreshold" DECIMAL(14,2) NOT NULL DEFAULT 200,
    "unusualMultiplier" DECIMAL(4,1) NOT NULL DEFAULT 2.5,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'IMMEDIATE',
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FinAlertSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberPrivacy_householdMemberId_key" ON "MemberPrivacy"("householdMemberId");

-- CreateIndex
CREATE INDEX "FinAccount_householdId_deletedAt_idx" ON "FinAccount"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "FinCategory_householdId_idx" ON "FinCategory"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "FinCategory_householdId_kind_parentId_name_key" ON "FinCategory"("householdId", "kind", "parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FinMerchant_householdId_name_key" ON "FinMerchant"("householdId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FinTransaction_idempotencyKey_key" ON "FinTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinTransaction_householdId_date_idx" ON "FinTransaction"("householdId", "date");

-- CreateIndex
CREATE INDEX "FinTransaction_householdId_ownerMemberId_date_idx" ON "FinTransaction"("householdId", "ownerMemberId", "date");

-- CreateIndex
CREATE INDEX "FinTransaction_accountId_date_idx" ON "FinTransaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "FinTransaction_householdId_categoryId_date_idx" ON "FinTransaction"("householdId", "categoryId", "date");

-- CreateIndex
CREATE INDEX "FinTransaction_transferGroupId_idx" ON "FinTransaction"("transferGroupId");

-- CreateIndex
CREATE INDEX "FinTransaction_householdId_importHash_idx" ON "FinTransaction"("householdId", "importHash");

-- CreateIndex
CREATE INDEX "TransactionAllocation_transactionId_idx" ON "TransactionAllocation"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionAllocation_memberId_idx" ON "TransactionAllocation"("memberId");

-- CreateIndex
CREATE INDEX "ContributionRule_householdId_active_idx" ON "ContributionRule"("householdId", "active");

-- CreateIndex
CREATE INDEX "Settlement_householdId_date_idx" ON "Settlement"("householdId", "date");

-- CreateIndex
CREATE INDEX "IncomeSource_householdId_deletedAt_idx" ON "IncomeSource"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "IncomeChange_incomeSourceId_effectiveDate_idx" ON "IncomeChange"("incomeSourceId", "effectiveDate");

-- CreateIndex
CREATE INDEX "RecurringRule_householdId_deletedAt_idx" ON "RecurringRule"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "Bill_householdId_deletedAt_idx" ON "Bill"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "BillPayment_billId_dueDate_idx" ON "BillPayment"("billId", "dueDate");

-- CreateIndex
CREATE INDEX "RecurringSubscription_householdId_deletedAt_idx" ON "RecurringSubscription"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "InsurancePolicy_householdId_deletedAt_idx" ON "InsurancePolicy"("householdId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_accountId_key" ON "Debt"("accountId");

-- CreateIndex
CREATE INDEX "Debt_householdId_deletedAt_idx" ON "Debt"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "DebtPayment_debtId_date_idx" ON "DebtPayment"("debtId", "date");

-- CreateIndex
CREATE INDEX "SavingsGoal_householdId_deletedAt_idx" ON "SavingsGoal"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "GoalContribution_goalId_date_idx" ON "GoalContribution"("goalId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentProfile_accountId_key" ON "InvestmentProfile"("accountId");

-- CreateIndex
CREATE INDEX "InvestmentEntry_profileId_date_idx" ON "InvestmentEntry"("profileId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentValuation_profileId_date_key" ON "InvestmentValuation"("profileId", "date");

-- CreateIndex
CREATE INDEX "Asset_householdId_deletedAt_idx" ON "Asset"("householdId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetValuation_assetId_date_key" ON "AssetValuation"("assetId", "date");

-- CreateIndex
CREATE INDEX "TaxRecord_householdId_taxYear_idx" ON "TaxRecord"("householdId", "taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRuleSet_householdId_country_region_year_key" ON "TaxRuleSet"("householdId", "country", "region", "year");

-- CreateIndex
CREATE INDEX "FinBudget_householdId_startDate_idx" ON "FinBudget"("householdId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinBudgetLine_budgetId_categoryId_key" ON "FinBudgetLine"("budgetId", "categoryId");

-- CreateIndex
CREATE INDEX "FinScenario_householdId_idx" ON "FinScenario"("householdId");

-- CreateIndex
CREATE INDEX "CalendarEvent_householdId_date_idx" ON "CalendarEvent"("householdId", "date");

-- CreateIndex
CREATE INDEX "ImportBatch_householdId_createdAt_idx" ON "ImportBatch"("householdId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_householdId_base_quote_asOf_key" ON "FxRate"("householdId", "base", "quote", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "FinAlertSetting_userId_householdId_key" ON "FinAlertSetting"("userId", "householdId");

-- CreateIndex
CREATE INDEX "Document_householdId_finEntity_finEntityId_idx" ON "Document"("householdId", "finEntity", "finEntityId");

-- AddForeignKey
ALTER TABLE "MemberPrivacy" ADD CONSTRAINT "MemberPrivacy_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinAccount" ADD CONSTRAINT "FinAccount_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCategory" ADD CONSTRAINT "FinCategory_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCategory" ADD CONSTRAINT "FinCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FinCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinMerchant" ADD CONSTRAINT "FinMerchant_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "FinMerchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAllocation" ADD CONSTRAINT "TransactionAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionRule" ADD CONSTRAINT "ContributionRule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeSource" ADD CONSTRAINT "IncomeSource_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeChange" ADD CONSTRAINT "IncomeChange_incomeSourceId_fkey" FOREIGN KEY ("incomeSourceId") REFERENCES "IncomeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSubscription" ADD CONSTRAINT "RecurringSubscription_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentProfile" ADD CONSTRAINT "InvestmentProfile_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentProfile" ADD CONSTRAINT "InvestmentProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentEntry" ADD CONSTRAINT "InvestmentEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "InvestmentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentValuation" ADD CONSTRAINT "InvestmentValuation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "InvestmentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetValuation" ADD CONSTRAINT "AssetValuation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRecord" ADD CONSTRAINT "TaxRecord_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRuleSet" ADD CONSTRAINT "TaxRuleSet_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinBudget" ADD CONSTRAINT "FinBudget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinBudgetLine" ADD CONSTRAINT "FinBudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "FinBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinBudgetLine" ADD CONSTRAINT "FinBudgetLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinScenario" ADD CONSTRAINT "FinScenario_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinAlertSetting" ADD CONSTRAINT "FinAlertSetting_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════ Integrity rules enforced by the database itself ═════════════
-- Ledger sign convention: income-like rows are positive, expenses negative, nothing is zero. Transfers, adjustments and
-- settlements between members may be either sign because they describe movement, not income or spending.
ALTER TABLE "FinTransaction" ADD CONSTRAINT "fin_tx_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "FinTransaction" ADD CONSTRAINT "fin_tx_sign" CHECK (
  ("type" IN ('INCOME', 'REFUND', 'REIMBURSEMENT') AND "amount" > 0)
  OR ("type" = 'EXPENSE' AND "amount" < 0)
  OR "type" IN ('TRANSFER', 'ADJUSTMENT', 'SETTLEMENT')
);
ALTER TABLE "FinTransaction" ADD CONSTRAINT "fin_tx_transfer_group" CHECK ("type" <> 'TRANSFER' OR "transferGroupId" IS NOT NULL);
-- A shared (joint) account has no single owner and must be visible to the household.
ALTER TABLE "FinAccount" ADD CONSTRAINT "fin_account_joint_visibility" CHECK ("ownerMemberId" IS NOT NULL OR "visibility" = 'HOUSEHOLD');
ALTER TABLE "FinAccount" ADD CONSTRAINT "fin_account_limit" CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);
ALTER TABLE "Debt" ADD CONSTRAINT "debt_rate_range" CHECK ("interestRate" >= 0 AND "interestRate" <= 100);
ALTER TABLE "Debt" ADD CONSTRAINT "debt_amounts" CHECK ("originalAmount" >= 0 AND "minimumPayment" >= 0 AND "regularPayment" >= 0);
ALTER TABLE "DebtPayment" ADD CONSTRAINT "debt_payment_split" CHECK ("total" > 0 AND "principal" >= 0 AND "interest" >= 0 AND "principal" + "interest" <= "total");
ALTER TABLE "FinBudget" ADD CONSTRAINT "fin_budget_dates" CHECK ("endDate" >= "startDate");
ALTER TABLE "FinBudgetLine" ADD CONSTRAINT "fin_budget_line_amount" CHECK ("amount" >= 0);
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "goal_target" CHECK ("targetAmount" >= 0 AND "monthlyContribution" >= 0);
ALTER TABLE "GoalContribution" ADD CONSTRAINT "goal_contribution_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "BillPayment" ADD CONSTRAINT "bill_payment_positive" CHECK ("amount" > 0);
ALTER TABLE "IncomeSource" ADD CONSTRAINT "income_amounts" CHECK ("grossAmount" >= 0 AND "netAmount" >= 0);
ALTER TABLE "FxRate" ADD CONSTRAINT "fx_rate_positive" CHECK ("rate" > 0);
ALTER TABLE "Bill" ADD CONSTRAINT "bill_amount" CHECK ("amount" >= 0);
ALTER TABLE "RecurringSubscription" ADD CONSTRAINT "subscription_amount" CHECK ("amount" >= 0);
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "insurance_premium" CHECK ("premium" >= 0);
ALTER TABLE "TransactionAllocation" ADD CONSTRAINT "allocation_positive" CHECK ("amount" > 0);
ALTER TABLE "Settlement" ADD CONSTRAINT "settlement_amount" CHECK ("amount" > 0 AND "fromMemberId" <> "toMemberId");

-- Expense allocation: the allocations of a split transaction must add up to the transaction amount exactly, and only split
-- transactions may have allocations. Checked at commit time so a transaction and its rows can be written together.
CREATE OR REPLACE FUNCTION fin_check_allocation(tx_id text) RETURNS void AS $$
DECLARE t record; s numeric;
BEGIN
  SELECT "allocationMode", "amount", "deletedAt" INTO t FROM "FinTransaction" WHERE "id" = tx_id;
  IF NOT FOUND OR t."deletedAt" IS NOT NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO s FROM "TransactionAllocation" WHERE "transactionId" = tx_id;
  IF t."allocationMode" = 'SPLIT' THEN
    IF s <> abs(t."amount") THEN
      RAISE EXCEPTION 'Allocations (%) must add up to the transaction amount (%)', s, abs(t."amount") USING ERRCODE = '23514';
    END IF;
  ELSIF s <> 0 THEN
    RAISE EXCEPTION 'Only split transactions can have allocations' USING ERRCODE = '23514';
  END IF;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fin_tx_alloc_trigger() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'FinTransaction' THEN PERFORM fin_check_allocation(NEW."id");
  ELSE PERFORM fin_check_allocation(COALESCE(NEW."transactionId", OLD."transactionId")); END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fin_tx_allocation_sum AFTER INSERT OR UPDATE ON "FinTransaction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_tx_alloc_trigger();
CREATE CONSTRAINT TRIGGER fin_alloc_row_sum AFTER INSERT OR UPDATE OR DELETE ON "TransactionAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_tx_alloc_trigger();
