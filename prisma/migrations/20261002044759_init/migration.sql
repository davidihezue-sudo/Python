-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "VehicleAccessLevel" AS ENUM ('OWNER', 'CO_OWNER', 'MAINTENANCE_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DistanceUnit" AS ENUM ('KM', 'MI');

-- CreateEnum
CREATE TYPE "VolumeUnit" AS ENUM ('L', 'GAL_US', 'GAL_UK');

-- CreateEnum
CREATE TYPE "FuelEconomyUnit" AS ENUM ('L_PER_100KM', 'KM_PER_L', 'MPG_US', 'MPG_UK');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'HYBRID', 'PLUGIN_HYBRID', 'ELECTRIC', 'OTHER');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('MANUAL', 'AUTOMATIC', 'CVT', 'DUAL_CLUTCH', 'OTHER');

-- CreateEnum
CREATE TYPE "Drivetrain" AS ENUM ('FWD', 'RWD', 'AWD', 'FOUR_WD');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('OWNED', 'FINANCED', 'LEASED', 'SOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "OdometerSource" AS ENUM ('MANUAL', 'MAINTENANCE', 'FUEL', 'INSPECTION', 'REPAIR', 'IMPORT', 'INTEGRATION', 'PURCHASE');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MILEAGE', 'TIME', 'MILEAGE_OR_TIME', 'MILEAGE_AND_TIME', 'CONDITION', 'INSPECTION', 'ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "RecommendationSource" AS ENUM ('MANUFACTURER', 'SUGGESTED', 'USER_DEFINED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('UP_TO_DATE', 'UPCOMING', 'DUE_SOON', 'DUE_NOW', 'OVERDUE', 'INSPECTION_REQUIRED', 'UNKNOWN_HISTORY');

-- CreateEnum
CREATE TYPE "RecordKind" AS ENUM ('MAINTENANCE', 'REPAIR');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkPerformedBy" AS ENUM ('OWNER_DIY', 'INDEPENDENT_MECHANIC', 'DEALERSHIP', 'SPECIALIST_WORKSHOP', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('DEALERSHIP', 'INDEPENDENT', 'SPECIALIST', 'TIRE_SHOP', 'BODY_SHOP', 'PARTS_SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('NEW', 'INVESTIGATING', 'DIAGNOSED', 'AWAITING_PARTS', 'SCHEDULED', 'IN_REPAIR', 'RESOLVED', 'MONITORING', 'CLOSED');

-- CreateEnum
CREATE TYPE "PartOrigin" AS ENUM ('OEM', 'AFTERMARKET', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PartStatus" AS ENUM ('INSTALLED', 'IN_STORAGE', 'REMOVED', 'REPLACED', 'RETURNED', 'UNDER_WARRANTY');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MAINTENANCE', 'REPAIRS', 'FUEL', 'INSURANCE', 'REGISTRATION', 'TAXES', 'PARKING', 'CAR_WASH', 'TOWING', 'ROADSIDE_ASSISTANCE', 'TIRES', 'ACCESSORIES', 'FINANCING', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'DEBIT', 'CREDIT', 'E_TRANSFER', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('CUSTOM', 'REGISTRATION', 'INSURANCE', 'INSPECTION', 'WARRANTY');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('ACTIVE', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MAINTENANCE_UPCOMING', 'MAINTENANCE_DUE', 'MAINTENANCE_OVERDUE', 'WARRANTY_EXPIRING', 'REGISTRATION_EXPIRING', 'INSURANCE_RENEWAL', 'INSPECTION_DUE', 'REPAIR_OUTSTANDING', 'BUDGET_THRESHOLD', 'CUSTOM_REMINDER', 'DOCUMENT_EXPIRING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('MAINTENANCE_INVOICE', 'REPAIR_RECEIPT', 'PURCHASE', 'INSURANCE', 'WARRANTY', 'REGISTRATION', 'INSPECTION_REPORT', 'DIAGNOSTIC_REPORT', 'PARTS_RECEIPT', 'VEHICLE_PHOTO', 'PART_PHOTO', 'ISSUE_PHOTO', 'INSPECTION_PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('NONE', 'PENDING', 'EXTRACTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "WarrantyType" AS ENUM ('MANUFACTURER', 'POWERTRAIN', 'EXTENDED', 'PART', 'OTHER');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('GENERAL', 'PRE_PURCHASE', 'SAFETY', 'EMISSIONS', 'SEASONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "DtcSource" AS ENUM ('MANUAL', 'OBD_ADAPTER', 'PROVIDER');

-- CreateEnum
CREATE TYPE "DtcStatus" AS ENUM ('ACTIVE', 'CLEARED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('NHTSA_VIN', 'OBD_GATEWAY', 'BMW_CONNECTED_DRIVE', 'OCR', 'AI', 'EMAIL', 'WEB_PUSH');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PLUS', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'LOGGED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
    "imageDocumentId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-CA',
    "disabledAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "lastLoginAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "distanceUnit" "DistanceUnit" NOT NULL DEFAULT 'KM',
    "volumeUnit" "VolumeUnit" NOT NULL DEFAULT 'L',
    "fuelEconomyUnit" "FuelEconomyUnit" NOT NULL DEFAULT 'L_PER_100KM',
    "timezone" TEXT NOT NULL DEFAULT 'America/Edmonton',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyPush" BOOLEAN NOT NULL DEFAULT false,
    "alertKmBefore" INTEGER[] DEFAULT ARRAY[1000, 500]::INTEGER[],
    "alertDaysBefore" INTEGER[] DEFAULT ARRAY[30, 7]::INTEGER[],
    "alertOnDue" BOOLEAN NOT NULL DEFAULT true,
    "alertOnOverdue" BOOLEAN NOT NULL DEFAULT true,
    "upcomingKm" INTEGER NOT NULL DEFAULT 3000,
    "upcomingDays" INTEGER NOT NULL DEFAULT 90,
    "dueSoonKm" INTEGER NOT NULL DEFAULT 1000,
    "dueSoonDays" INTEGER NOT NULL DEFAULT 30,
    "graceKm" INTEGER NOT NULL DEFAULT 500,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "shareHideVin" BOOLEAN NOT NULL DEFAULT true,
    "shareHideCosts" BOOLEAN NOT NULL DEFAULT false,
    "shareHideProviders" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Edmonton',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdInvite" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "vehicleAccess" JSONB NOT NULL DEFAULT '[]',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "acceptedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "trim" TEXT,
    "generation" TEXT,
    "engineType" TEXT,
    "engineDisplacementL" DECIMAL(4,2),
    "engineCode" TEXT,
    "fuelType" "FuelType" NOT NULL DEFAULT 'PETROL',
    "transmission" "Transmission",
    "drivetrain" "Drivetrain",
    "vin" TEXT,
    "registrationNumber" TEXT,
    "colour" TEXT,
    "bodyType" TEXT,
    "market" TEXT,
    "purchaseDate" DATE,
    "purchasePrice" DECIMAL(12,2),
    "purchaseOdometerKm" DECIMAL(10,1),
    "currentOdometerKm" DECIMAL(10,1),
    "currentOdometerAt" DATE,
    "ownershipStatus" "OwnershipStatus" NOT NULL DEFAULT 'OWNED',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "insuranceProvider" TEXT,
    "insurancePolicyNumber" TEXT,
    "insuranceRenewalDate" DATE,
    "registrationExpiryDate" DATE,
    "nextInspectionDate" DATE,
    "photoDocumentId" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "templateKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleSpecification" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "decoder" TEXT,
    "decodedAt" TIMESTAMPTZ,
    "decoded" JSONB,
    "confirmedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extra" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "VehicleSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleOwnership" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE,
    "fromOdometerKm" DECIMAL(10,1),
    "toOdometerKm" DECIMAL(10,1),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleAccess" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "VehicleAccessLevel" NOT NULL DEFAULT 'VIEWER',
    "canViewFinancials" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdometerEntry" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "valueKm" DECIMAL(10,1) NOT NULL,
    "source" "OdometerSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceRecordId" TEXT,
    "fuelEntryId" TEXT,
    "inspectionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "OdometerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaintenanceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "householdId" TEXT,
    "libraryKey" TEXT,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "componentKey" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "intervalKm" DECIMAL(10,1),
    "intervalMonths" INTEGER,
    "intervalDays" INTEGER,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "estCostMin" DECIMAL(12,2),
    "estCostMax" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "instructions" TEXT,
    "sourceType" "RecommendationSource" NOT NULL DEFAULT 'SUGGESTED',
    "sourceNote" TEXT,
    "appliesTo" JSONB NOT NULL DEFAULT '{}',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceScheduleAssignment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "componentKey" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "intervalKm" DECIMAL(10,1),
    "intervalMonths" INTEGER,
    "intervalDays" INTEGER,
    "anchorDate" DATE,
    "oneTimeDueDate" DATE,
    "oneTimeDueKm" DECIMAL(10,1),
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "estCostMin" DECIMAL(12,2),
    "estCostMax" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "instructions" TEXT,
    "sourceType" "RecommendationSource" NOT NULL DEFAULT 'SUGGESTED',
    "sourceNote" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dueSoonKm" INTEGER,
    "dueSoonDays" INTEGER,
    "alertKmBefore" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "alertDaysBefore" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "baselineDate" DATE,
    "baselineKm" DECIMAL(10,1),
    "lastCompletedAt" DATE,
    "lastCompletedKm" DECIMAL(10,1),
    "lastRecordId" TEXT,
    "nextDueDate" DATE,
    "nextDueKm" DECIMAL(10,1),
    "status" "ScheduleStatus" NOT NULL DEFAULT 'UNKNOWN_HISTORY',
    "statusUpdatedAt" TIMESTAMPTZ,
    "lastCondition" TEXT,
    "lastInspectedAt" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "MaintenanceScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "RecordKind" NOT NULL DEFAULT 'MAINTENANCE',
    "status" "RecordStatus" NOT NULL DEFAULT 'COMPLETED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "serviceDate" DATE NOT NULL,
    "odometerKm" DECIMAL(10,1),
    "workPerformedBy" "WorkPerformedBy" NOT NULL DEFAULT 'INDEPENDENT_MECHANIC',
    "providerId" TEXT,
    "mechanicName" TEXT,
    "location" TEXT,
    "laborCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "partsCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "warrantyInfo" TEXT,
    "notes" TEXT,
    "repairIssueId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecordItem" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "categoryId" TEXT,
    "componentKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "partName" TEXT,
    "partManufacturer" TEXT,
    "partNumber" TEXT,
    "partOrigin" "PartOrigin",
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "trackAsPart" BOOLEAN NOT NULL DEFAULT false,
    "warrantyMonths" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaintenanceRecordItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairIssue" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discoveredAt" DATE NOT NULL,
    "odometerKm" DECIMAL(10,1),
    "symptoms" TEXT,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MODERATE',
    "status" "IssueStatus" NOT NULL DEFAULT 'NEW',
    "componentKey" TEXT,
    "categoryId" TEXT,
    "mechanicAssessment" TEXT,
    "estimatedCost" DECIMAL(12,2),
    "actualCost" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "resolution" TEXT,
    "resolvedAt" DATE,
    "providerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "RepairIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticCode" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "repairIssueId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "detectedAt" DATE NOT NULL,
    "odometerKm" DECIMAL(10,1),
    "source" "DtcSource" NOT NULL DEFAULT 'MANUAL',
    "component" TEXT,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MODERATE',
    "status" "DtcStatus" NOT NULL DEFAULT 'ACTIVE',
    "symptoms" TEXT,
    "notes" TEXT,
    "resolution" TEXT,
    "resolvedAt" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "DiagnosticCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL DEFAULT 'GENERAL',
    "date" DATE NOT NULL,
    "odometerKm" DECIMAL(10,1),
    "inspector" TEXT,
    "providerId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "overallCondition" TEXT,
    "nextDueDate" DATE,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "componentKey" TEXT,
    "manufacturer" TEXT,
    "origin" "PartOrigin" NOT NULL DEFAULT 'UNKNOWN',
    "partNumber" TEXT,
    "supplier" TEXT,
    "purchaseDate" DATE,
    "purchasePrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "warrantyStart" DATE,
    "warrantyEnd" DATE,
    "expectedLifeKm" DECIMAL(10,1),
    "expectedLifeMonths" INTEGER,
    "status" "PartStatus" NOT NULL DEFAULT 'IN_STORAGE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalledPart" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL,
    "installedAt" DATE NOT NULL,
    "installedKm" DECIMAL(10,1),
    "installLaborCost" DECIMAL(12,2),
    "removedAt" DATE,
    "removedKm" DECIMAL(10,1),
    "removalReason" TEXT,
    "installRecordId" TEXT,
    "removalRecordId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalledPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "partId" TEXT,
    "type" "WarrantyType" NOT NULL DEFAULT 'MANUFACTURER',
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "endKm" DECIMAL(10,1),
    "coverage" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceProvider" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL DEFAULT 'INDEPENDENT',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "category" "ExpenseCategory" NOT NULL,
    "vendor" TEXT,
    "providerId" TEXT,
    "description" TEXT,
    "paymentMethod" "PaymentMethod",
    "notes" TEXT,
    "maintenanceRecordId" TEXT,
    "repairIssueId" TEXT,
    "fuelEntryId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelEntry" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "odometerKm" DECIMAL(10,1) NOT NULL,
    "quantityL" DECIMAL(10,3) NOT NULL,
    "enteredQuantity" DECIMAL(10,3) NOT NULL,
    "enteredUnit" "VolumeUnit" NOT NULL DEFAULT 'L',
    "pricePerL" DECIMAL(10,4),
    "totalCost" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "fuelType" "FuelType" NOT NULL DEFAULT 'PETROL',
    "station" TEXT,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "missedPrevious" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "FuelEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "period" "BudgetPeriod" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "categories" "ExpenseCategory"[],
    "alertAtPercent" INTEGER[] DEFAULT ARRAY[80, 100]::INTEGER[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "type" "ReminderType" NOT NULL DEFAULT 'CUSTOM',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueDate" DATE,
    "dueKm" DECIMAL(10,1),
    "leadDays" INTEGER[] DEFAULT ARRAY[7, 1]::INTEGER[],
    "leadKm" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "ReminderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "data" JSONB,
    "deliveredInAppAt" TIMESTAMPTZ,
    "emailedAt" TIMESTAMPTZ,
    "emailError" TEXT,
    "pushedAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,
    "dismissedAt" TIMESTAMPTZ,
    "actionedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "title" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "expiresOn" DATE,
    "maintenanceRecordId" TEXT,
    "repairIssueId" TEXT,
    "expenseId" TEXT,
    "partId" TEXT,
    "inspectionId" TEXT,
    "warrantyId" TEXT,
    "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'NONE',
    "ocrResult" JSONB,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "label" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredentialReference" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationCredentialReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiRole" NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "householdId" TEXT,
    "vehicleId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodEnd" TIMESTAMPTZ,
    "externalProvider" TEXT,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    "limitOverrides" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    "stats" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_type_idx" ON "VerificationToken"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "HouseholdMember_userId_idx" ON "HouseholdMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdInvite_tokenHash_key" ON "HouseholdInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "HouseholdInvite_householdId_idx" ON "HouseholdInvite"("householdId");

-- CreateIndex
CREATE INDEX "HouseholdInvite_email_idx" ON "HouseholdInvite"("email");

-- CreateIndex
CREATE INDEX "Vehicle_householdId_deletedAt_idx" ON "Vehicle"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "Vehicle_vin_idx" ON "Vehicle"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSpecification_vehicleId_key" ON "VehicleSpecification"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleOwnership_vehicleId_fromDate_idx" ON "VehicleOwnership"("vehicleId", "fromDate");

-- CreateIndex
CREATE INDEX "VehicleAccess_userId_idx" ON "VehicleAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAccess_vehicleId_userId_key" ON "VehicleAccess"("vehicleId", "userId");

-- CreateIndex
CREATE INDEX "OdometerEntry_vehicleId_date_idx" ON "OdometerEntry"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "OdometerEntry_vehicleId_valueKm_idx" ON "OdometerEntry"("vehicleId", "valueKm");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceCategory_key_key" ON "MaintenanceCategory"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceSchedule_libraryKey_key" ON "MaintenanceSchedule"("libraryKey");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_householdId_idx" ON "MaintenanceSchedule"("householdId");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_categoryId_idx" ON "MaintenanceSchedule"("categoryId");

-- CreateIndex
CREATE INDEX "MaintenanceScheduleAssignment_vehicleId_enabled_idx" ON "MaintenanceScheduleAssignment"("vehicleId", "enabled");

-- CreateIndex
CREATE INDEX "MaintenanceScheduleAssignment_status_idx" ON "MaintenanceScheduleAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceScheduleAssignment_vehicleId_scheduleId_key" ON "MaintenanceScheduleAssignment"("vehicleId", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRecord_idempotencyKey_key" ON "MaintenanceRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_vehicleId_serviceDate_idx" ON "MaintenanceRecord"("vehicleId", "serviceDate");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_vehicleId_kind_status_idx" ON "MaintenanceRecord"("vehicleId", "kind", "status");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_providerId_idx" ON "MaintenanceRecord"("providerId");

-- CreateIndex
CREATE INDEX "MaintenanceRecordItem_recordId_idx" ON "MaintenanceRecordItem"("recordId");

-- CreateIndex
CREATE INDEX "MaintenanceRecordItem_assignmentId_idx" ON "MaintenanceRecordItem"("assignmentId");

-- CreateIndex
CREATE INDEX "RepairIssue_vehicleId_status_idx" ON "RepairIssue"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "DiagnosticCode_vehicleId_detectedAt_idx" ON "DiagnosticCode"("vehicleId", "detectedAt");

-- CreateIndex
CREATE INDEX "DiagnosticCode_code_idx" ON "DiagnosticCode"("code");

-- CreateIndex
CREATE INDEX "Inspection_vehicleId_date_idx" ON "Inspection"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "Part_vehicleId_status_idx" ON "Part"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "Part_vehicleId_componentKey_idx" ON "Part"("vehicleId", "componentKey");

-- CreateIndex
CREATE INDEX "InstalledPart_vehicleId_componentKey_installedAt_idx" ON "InstalledPart"("vehicleId", "componentKey", "installedAt");

-- CreateIndex
CREATE INDEX "InstalledPart_partId_idx" ON "InstalledPart"("partId");

-- CreateIndex
CREATE INDEX "Warranty_vehicleId_endDate_idx" ON "Warranty"("vehicleId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProvider_householdId_name_key" ON "ServiceProvider"("householdId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_fuelEntryId_key" ON "Expense"("fuelEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_idempotencyKey_key" ON "Expense"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Expense_vehicleId_date_idx" ON "Expense"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "Expense_vehicleId_category_idx" ON "Expense"("vehicleId", "category");

-- CreateIndex
CREATE INDEX "Expense_maintenanceRecordId_idx" ON "Expense"("maintenanceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelEntry_idempotencyKey_key" ON "FuelEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FuelEntry_vehicleId_date_idx" ON "FuelEntry"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "Budget_householdId_year_idx" ON "Budget"("householdId", "year");

-- CreateIndex
CREATE INDEX "Reminder_vehicleId_status_idx" ON "Reminder"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_dismissedAt_idx" ON "Notification"("userId", "readAt", "dismissedAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Document_fileKey_key" ON "Document"("fileKey");

-- CreateIndex
CREATE INDEX "Document_householdId_category_idx" ON "Document"("householdId", "category");

-- CreateIndex
CREATE INDEX "Document_vehicleId_createdAt_idx" ON "Document"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "Integration_householdId_provider_idx" ON "Integration"("householdId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredentialReference_integrationId_name_key" ON "IntegrationCredentialReference"("integrationId", "name");

-- CreateIndex
CREATE INDEX "AIConversation_userId_updatedAt_idx" ON "AIConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AIMessage_conversationId_createdAt_idx" ON "AIMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_vehicleId_createdAt_idx" ON "AuditLog"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_householdId_createdAt_idx" ON "AuditLog"("householdId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_householdId_key" ON "Subscription"("householdId");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_toEmail_createdAt_idx" ON "EmailOutbox"("toEmail", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSpecification" ADD CONSTRAINT "VehicleSpecification_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOwnership" ADD CONSTRAINT "VehicleOwnership_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAccess" ADD CONSTRAINT "VehicleAccess_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAccess" ADD CONSTRAINT "VehicleAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdometerEntry" ADD CONSTRAINT "OdometerEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdometerEntry" ADD CONSTRAINT "OdometerEntry_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdometerEntry" ADD CONSTRAINT "OdometerEntry_fuelEntryId_fkey" FOREIGN KEY ("fuelEntryId") REFERENCES "FuelEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaintenanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceScheduleAssignment" ADD CONSTRAINT "MaintenanceScheduleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceScheduleAssignment" ADD CONSTRAINT "MaintenanceScheduleAssignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceScheduleAssignment" ADD CONSTRAINT "MaintenanceScheduleAssignment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaintenanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_repairIssueId_fkey" FOREIGN KEY ("repairIssueId") REFERENCES "RepairIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecordItem" ADD CONSTRAINT "MaintenanceRecordItem_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MaintenanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecordItem" ADD CONSTRAINT "MaintenanceRecordItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "MaintenanceScheduleAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecordItem" ADD CONSTRAINT "MaintenanceRecordItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaintenanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairIssue" ADD CONSTRAINT "RepairIssue_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairIssue" ADD CONSTRAINT "RepairIssue_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticCode" ADD CONSTRAINT "DiagnosticCode_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticCode" ADD CONSTRAINT "DiagnosticCode_repairIssueId_fkey" FOREIGN KEY ("repairIssueId") REFERENCES "RepairIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaintenanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledPart" ADD CONSTRAINT "InstalledPart_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledPart" ADD CONSTRAINT "InstalledPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledPart" ADD CONSTRAINT "InstalledPart_installRecordId_fkey" FOREIGN KEY ("installRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledPart" ADD CONSTRAINT "InstalledPart_removalRecordId_fkey" FOREIGN KEY ("removalRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_repairIssueId_fkey" FOREIGN KEY ("repairIssueId") REFERENCES "RepairIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_fuelEntryId_fkey" FOREIGN KEY ("fuelEntryId") REFERENCES "FuelEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelEntry" ADD CONSTRAINT "FuelEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "MaintenanceScheduleAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_repairIssueId_fkey" FOREIGN KEY ("repairIssueId") REFERENCES "RepairIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredentialReference" ADD CONSTRAINT "IntegrationCredentialReference_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
