-- Safe, additive migration for company normalization + RM override gating.
-- Intentionally uses IF NOT EXISTS / guarded DDL to avoid destructive changes.

BEGIN;

-- 1) Enum for RM override state
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RmOverrideStatus') THEN
    CREATE TYPE "RmOverrideStatus" AS ENUM ('NOT_REQUIRED', 'REQUESTED', 'APPROVED');
  END IF;
END $$;

-- 1b) Add new workflow statuses for routed override and action-required handoff
DO $$
BEGIN
  ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'AWAITING_RM_OVERRIDE_APPROVAL';
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'RM_OVERRIDE_APPROVED_PENDING_RECOMMENDATION';
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CLIENT_APPROVAL';
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 2) New company normalization tables
CREATE TABLE IF NOT EXISTS "internal_companies" (
  "id" TEXT NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "status" TEXT DEFAULT 'ACTIVE',
  "source" TEXT DEFAULT 'HUBSPOT_CONTACT_COMPANY',
  "normalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "internal_companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "internal_companies_normalizedKey_key"
  ON "internal_companies"("normalizedKey");

CREATE INDEX IF NOT EXISTS "internal_companies_canonicalName_idx"
  ON "internal_companies"("canonicalName");

CREATE INDEX IF NOT EXISTS "internal_companies_normalizedKey_idx"
  ON "internal_companies"("normalizedKey");

CREATE TABLE IF NOT EXISTS "company_name_aliases" (
  "id" TEXT NOT NULL,
  "rawName" TEXT NOT NULL,
  "rawNameNormalized" TEXT NOT NULL,
  "internalCompanyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_name_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_name_aliases_rawNameNormalized_key"
  ON "company_name_aliases"("rawNameNormalized");

CREATE INDEX IF NOT EXISTS "company_name_aliases_internalCompanyId_idx"
  ON "company_name_aliases"("internalCompanyId");

CREATE INDEX IF NOT EXISTS "company_name_aliases_rawNameNormalized_idx"
  ON "company_name_aliases"("rawNameNormalized");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_name_aliases_internalCompanyId_fkey'
  ) THEN
    ALTER TABLE "company_name_aliases"
      ADD CONSTRAINT "company_name_aliases_internalCompanyId_fkey"
      FOREIGN KEY ("internalCompanyId") REFERENCES "internal_companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Appraisal case RM override workflow columns
ALTER TABLE "appraisal_cases"
  ADD COLUMN IF NOT EXISTS "rmOverrideStatus" "RmOverrideStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

ALTER TABLE "appraisal_cases"
  ADD COLUMN IF NOT EXISTS "rmOverrideRequestedAt" TIMESTAMP(3);

ALTER TABLE "appraisal_cases"
  ADD COLUMN IF NOT EXISTS "rmOverrideRequestedBy" TEXT;

ALTER TABLE "appraisal_cases"
  ADD COLUMN IF NOT EXISTS "rmOverrideApprovedAt" TIMESTAMP(3);

ALTER TABLE "appraisal_cases"
  ADD COLUMN IF NOT EXISTS "rmOverrideApprovedBy" TEXT;

CREATE INDEX IF NOT EXISTS "appraisal_cases_rmOverrideStatus_idx"
  ON "appraisal_cases"("rmOverrideStatus");

-- 4) EmployeeDirectory company fields
ALTER TABLE "employee_directory"
  ADD COLUMN IF NOT EXISTS "hubspotCompanyName" TEXT;

ALTER TABLE "employee_directory"
  ADD COLUMN IF NOT EXISTS "internalCompanyId" TEXT;

ALTER TABLE "employee_directory"
  ADD COLUMN IF NOT EXISTS "internalCompanyName" TEXT;

ALTER TABLE "employee_directory"
  ADD COLUMN IF NOT EXISTS "companyStatus" TEXT;

ALTER TABLE "employee_directory"
  ADD COLUMN IF NOT EXISTS "companySource" TEXT;

ALTER TABLE "employee_directory"
  ADD COLUMN IF NOT EXISTS "companyNormalizedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "employee_directory_internalCompanyId_idx"
  ON "employee_directory"("internalCompanyId");

CREATE INDEX IF NOT EXISTS "employee_directory_internalCompanyName_idx"
  ON "employee_directory"("internalCompanyName");

-- 5) EmployeeWorkingData company fields
ALTER TABLE "employee_working_data"
  ADD COLUMN IF NOT EXISTS "hubspotCompanyName" TEXT;

ALTER TABLE "employee_working_data"
  ADD COLUMN IF NOT EXISTS "internalCompanyId" TEXT;

ALTER TABLE "employee_working_data"
  ADD COLUMN IF NOT EXISTS "internalCompanyName" TEXT;

ALTER TABLE "employee_working_data"
  ADD COLUMN IF NOT EXISTS "companyStatus" TEXT;

ALTER TABLE "employee_working_data"
  ADD COLUMN IF NOT EXISTS "companySource" TEXT;

ALTER TABLE "employee_working_data"
  ADD COLUMN IF NOT EXISTS "companyNormalizedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "employee_working_data_internalCompanyId_idx"
  ON "employee_working_data"("internalCompanyId");

CREATE INDEX IF NOT EXISTS "employee_working_data_internalCompanyName_idx"
  ON "employee_working_data"("internalCompanyName");

-- 6) Structured role-propagation/system-action run metrics
ALTER TABLE "system_action_logs"
  ADD COLUMN IF NOT EXISTS "recordsRepaired" INTEGER;

ALTER TABLE "system_action_logs"
  ADD COLUMN IF NOT EXISTS "casesRefreshed" INTEGER;

ALTER TABLE "system_action_logs"
  ADD COLUMN IF NOT EXISTS "failuresCount" INTEGER;

COMMIT;
