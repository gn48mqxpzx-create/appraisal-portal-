-- CreateEnum
CREATE TYPE "CycleType" AS ENUM ('ANNUAL', 'ANNIVERSARY', 'ADHOC');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'LOCKED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'BLOCKED', 'APPROVED', 'RELEASED_TO_PAYROLL', 'REMOVED_FROM_SCOPE');

-- CreateEnum
CREATE TYPE "EffectivityStatus" AS ENUM ('PENDING_EFFECTIVITY', 'EFFECTIVE', 'HISTORICAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'RECEIVED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('UPLOAD', 'DRIVE_LINK');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ADDED', 'REMOVED', 'RE_ADDED', 'FIELD_CHANGE');

-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('INTAKE', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RowStatus" AS ENUM ('IMPORTED', 'FLAGGED', 'ERROR');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "UnmappedStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OverrideScope" AS ENUM ('GLOBAL', 'CYCLE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailDomain" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT,
    "fullName" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userId" TEXT,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_domain_whitelist" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_domain_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycles" (
    "id" TEXT NOT NULL,
    "cycleName" TEXT NOT NULL,
    "cycleType" "CycleType" NOT NULL,
    "fiscalYear" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "lockDate" TIMESTAMP(3),
    "payrollReleaseDate" TIMESTAMP(3),
    "status" "CycleStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "importsLocked" BOOLEAN NOT NULL DEFAULT false,
    "importsLockedAt" TIMESTAMP(3),
    "importsLockedBy" TEXT,
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "sealedAt" TIMESTAMP(3),
    "sealedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_cases" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "rawContactType" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "staffRole" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "successManagerStaffId" TEXT,
    "relationshipManagerStaffId" TEXT,
    "managerStaffIdFromIntake" TEXT,
    "resolvedManagerStaffId" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "previousStatus" "CaseStatus",
    "isRemoved" BOOLEAN NOT NULL DEFAULT false,
    "closeDate" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "effectivityDate" TIMESTAMP(3),
    "effectivityStatus" "EffectivityStatus" NOT NULL DEFAULT 'PENDING_EFFECTIVITY',
    "isMissingBenchmark" BOOLEAN NOT NULL DEFAULT false,
    "hasOverride" BOOLEAN NOT NULL DEFAULT false,
    "hasMissingApprovalEvidence" BOOLEAN NOT NULL DEFAULT false,
    "tenureMonths" INTEGER,
    "tenureComputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "appraisal_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_compensation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "currentBaseSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentFixedAllowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentVariableAllowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentRecurringBonuses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentOnetimeBonuses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currentTotalCompensation" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "benchmarkUsed" DECIMAL(12,2),
    "catchupPercentUsed" INTEGER,
    "tenureMonthsUsed" INTEGER,
    "tenureComputedAt" TIMESTAMP(3),
    "varianceAmount" DECIMAL(12,2),
    "variancePercent" DECIMAL(10,4),
    "recommendedIncreaseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "recommendedNewBase" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "recommendedAdjustmentPercent" DECIMAL(10,4),
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideApprovedBy" TEXT,
    "overrideApprovedAt" TIMESTAMP(3),
    "approvedNewBaseSalary" DECIMAL(12,2),
    "approvedFixedAllowances" DECIMAL(12,2),
    "approvedVariableAllowances" DECIMAL(12,2),
    "approvedRecurringBonuses" DECIMAL(12,2),
    "approvedTotalCompensation" DECIMAL(12,2),
    "approvedAmountDifference" DECIMAL(12,2),
    "approvedPercentDifference" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computation_snapshots" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "benchmarkUsed" DECIMAL(12,2) NOT NULL,
    "catchupPercentUsed" INTEGER NOT NULL,
    "tenureMonthsUsed" INTEGER NOT NULL,
    "varianceAmount" DECIMAL(12,2) NOT NULL,
    "variancePercent" DECIMAL(10,4),
    "recommendedIncreaseAmount" DECIMAL(12,2) NOT NULL,
    "recommendedNewBase" DECIMAL(12,2) NOT NULL,
    "recommendedAdjustmentPercent" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_approvals" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "approvalType" TEXT NOT NULL DEFAULT 'EMAIL',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvalDate" TIMESTAMP(3),
    "approvedByName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "case_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_attachments" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "attachmentType" "AttachmentType" NOT NULL,
    "storageKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "checksum" TEXT,
    "driveUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_checklist_items" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "assignedRole" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_movement_logs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_movement_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_batches" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "uploadType" "UploadType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER,
    "removedCount" INTEGER,
    "readdedCount" INTEGER,
    "updatedCount" INTEGER,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "upload_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_row_results" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "RowStatus" NOT NULL,
    "flags" TEXT[],
    "errorMessage" TEXT,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_row_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_type_mappings" (
    "id" TEXT NOT NULL,
    "rawValue" TEXT NOT NULL,
    "mappedValue" TEXT NOT NULL,
    "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_type_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmapped_value_events" (
    "id" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "rawValue" TEXT NOT NULL,
    "firstSeenUploadId" TEXT NOT NULL,
    "lastSeenUploadId" TEXT NOT NULL,
    "occurrencesCount" INTEGER NOT NULL DEFAULT 1,
    "status" "UnmappedStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unmapped_value_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenure_bands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minMonths" INTEGER NOT NULL,
    "maxMonths" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenure_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_benchmarks" (
    "id" TEXT NOT NULL,
    "staffRole" TEXT NOT NULL,
    "tenureBandId" TEXT NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "catchupPercent" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_overrides" (
    "id" TEXT NOT NULL,
    "employeeStaffId" TEXT NOT NULL,
    "managerStaffId" TEXT NOT NULL,
    "scope" "OverrideScope" NOT NULL,
    "cycleId" TEXT,
    "previousManagerStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "manager_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_group_permissions" (
    "id" TEXT NOT NULL,
    "fieldGroupId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_group_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "before" JSONB,
    "after" JSONB,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_queue" (
    "id" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_staffId_key" ON "users"("staffId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_staffId_idx" ON "users"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_accessToken_key" ON "sessions"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_accessToken_idx" ON "sessions"("accessToken");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "otp_codes_email_verified_expiresAt_idx" ON "otp_codes"("email", "verified", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_domain_whitelist_domain_key" ON "email_domain_whitelist"("domain");

-- CreateIndex
CREATE INDEX "cycles_cycleType_status_idx" ON "cycles"("cycleType", "status");

-- CreateIndex
CREATE INDEX "cycles_status_isActive_idx" ON "cycles"("status", "isActive");

-- CreateIndex
CREATE INDEX "cycles_importsLocked_idx" ON "cycles"("importsLocked");

-- CreateIndex
CREATE INDEX "cycles_sealed_idx" ON "cycles"("sealed");

-- CreateIndex
CREATE INDEX "appraisal_cases_cycleId_status_idx" ON "appraisal_cases"("cycleId", "status");

-- CreateIndex
CREATE INDEX "appraisal_cases_staffId_idx" ON "appraisal_cases"("staffId");

-- CreateIndex
CREATE INDEX "appraisal_cases_resolvedManagerStaffId_idx" ON "appraisal_cases"("resolvedManagerStaffId");

-- CreateIndex
CREATE INDEX "appraisal_cases_companyName_idx" ON "appraisal_cases"("companyName");

-- CreateIndex
CREATE INDEX "appraisal_cases_staffRole_idx" ON "appraisal_cases"("staffRole");

-- CreateIndex
CREATE INDEX "appraisal_cases_status_idx" ON "appraisal_cases"("status");

-- CreateIndex
CREATE INDEX "appraisal_cases_isRemoved_idx" ON "appraisal_cases"("isRemoved");

-- CreateIndex
CREATE INDEX "appraisal_cases_isMissingBenchmark_idx" ON "appraisal_cases"("isMissingBenchmark");

-- CreateIndex
CREATE INDEX "appraisal_cases_hasOverride_idx" ON "appraisal_cases"("hasOverride");

-- CreateIndex
CREATE UNIQUE INDEX "appraisal_cases_cycleId_staffId_key" ON "appraisal_cases"("cycleId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "case_compensation_caseId_key" ON "case_compensation"("caseId");

-- CreateIndex
CREATE INDEX "case_compensation_caseId_idx" ON "case_compensation"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "computation_snapshots_caseId_key" ON "computation_snapshots"("caseId");

-- CreateIndex
CREATE INDEX "computation_snapshots_cycleId_idx" ON "computation_snapshots"("cycleId");

-- CreateIndex
CREATE INDEX "computation_snapshots_caseId_idx" ON "computation_snapshots"("caseId");

-- CreateIndex
CREATE INDEX "case_approvals_caseId_idx" ON "case_approvals"("caseId");

-- CreateIndex
CREATE INDEX "case_approvals_status_idx" ON "case_approvals"("status");

-- CreateIndex
CREATE INDEX "approval_attachments_approvalId_idx" ON "approval_attachments"("approvalId");

-- CreateIndex
CREATE INDEX "case_checklist_items_caseId_idx" ON "case_checklist_items"("caseId");

-- CreateIndex
CREATE INDEX "case_checklist_items_assignedRole_completed_idx" ON "case_checklist_items"("assignedRole", "completed");

-- CreateIndex
CREATE UNIQUE INDEX "case_checklist_items_caseId_itemKey_key" ON "case_checklist_items"("caseId", "itemKey");

-- CreateIndex
CREATE INDEX "case_movement_logs_caseId_timestamp_idx" ON "case_movement_logs"("caseId", "timestamp");

-- CreateIndex
CREATE INDEX "upload_batches_cycleId_uploadType_idx" ON "upload_batches"("cycleId", "uploadType");

-- CreateIndex
CREATE INDEX "upload_batches_uploadedAt_idx" ON "upload_batches"("uploadedAt");

-- CreateIndex
CREATE INDEX "upload_row_results_batchId_status_idx" ON "upload_row_results"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_type_mappings_rawValue_key" ON "contact_type_mappings"("rawValue");

-- CreateIndex
CREATE INDEX "contact_type_mappings_rawValue_idx" ON "contact_type_mappings"("rawValue");

-- CreateIndex
CREATE INDEX "contact_type_mappings_status_idx" ON "contact_type_mappings"("status");

-- CreateIndex
CREATE INDEX "unmapped_value_events_status_idx" ON "unmapped_value_events"("status");

-- CreateIndex
CREATE INDEX "unmapped_value_events_fieldName_rawValue_idx" ON "unmapped_value_events"("fieldName", "rawValue");

-- CreateIndex
CREATE UNIQUE INDEX "unmapped_value_events_fieldName_rawValue_key" ON "unmapped_value_events"("fieldName", "rawValue");

-- CreateIndex
CREATE UNIQUE INDEX "tenure_bands_name_key" ON "tenure_bands"("name");

-- CreateIndex
CREATE INDEX "tenure_bands_minMonths_maxMonths_idx" ON "tenure_bands"("minMonths", "maxMonths");

-- CreateIndex
CREATE INDEX "market_benchmarks_staffRole_idx" ON "market_benchmarks"("staffRole");

-- CreateIndex
CREATE INDEX "market_benchmarks_tenureBandId_idx" ON "market_benchmarks"("tenureBandId");

-- CreateIndex
CREATE UNIQUE INDEX "market_benchmarks_staffRole_tenureBandId_key" ON "market_benchmarks"("staffRole", "tenureBandId");

-- CreateIndex
CREATE UNIQUE INDEX "global_settings_key_key" ON "global_settings"("key");

-- CreateIndex
CREATE INDEX "manager_overrides_employeeStaffId_idx" ON "manager_overrides"("employeeStaffId");

-- CreateIndex
CREATE INDEX "manager_overrides_scope_cycleId_idx" ON "manager_overrides"("scope", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "manager_overrides_employeeStaffId_scope_cycleId_key" ON "manager_overrides"("employeeStaffId", "scope", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "field_groups_name_key" ON "field_groups"("name");

-- CreateIndex
CREATE INDEX "field_group_permissions_roleId_idx" ON "field_group_permissions"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "field_group_permissions_fieldGroupId_roleId_key" ON "field_group_permissions"("fieldGroupId", "roleId");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "notification_queue_status_priority_createdAt_idx" ON "notification_queue"("status", "priority", "createdAt");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_cases" ADD CONSTRAINT "appraisal_cases_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_cases" ADD CONSTRAINT "appraisal_cases_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_compensation" ADD CONSTRAINT "case_compensation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computation_snapshots" ADD CONSTRAINT "computation_snapshots_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computation_snapshots" ADD CONSTRAINT "computation_snapshots_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_approvals" ADD CONSTRAINT "case_approvals_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_approvals" ADD CONSTRAINT "case_approvals_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_attachments" ADD CONSTRAINT "approval_attachments_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "case_approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_checklist_items" ADD CONSTRAINT "case_checklist_items_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_checklist_items" ADD CONSTRAINT "case_checklist_items_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_movement_logs" ADD CONSTRAINT "case_movement_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_row_results" ADD CONSTRAINT "upload_row_results_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "upload_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_type_mappings" ADD CONSTRAINT "contact_type_mappings_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmapped_value_events" ADD CONSTRAINT "unmapped_value_events_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_benchmarks" ADD CONSTRAINT "market_benchmarks_tenureBandId_fkey" FOREIGN KEY ("tenureBandId") REFERENCES "tenure_bands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_overrides" ADD CONSTRAINT "manager_overrides_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_overrides" ADD CONSTRAINT "manager_overrides_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_group_permissions" ADD CONSTRAINT "field_group_permissions_fieldGroupId_fkey" FOREIGN KEY ("fieldGroupId") REFERENCES "field_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_group_permissions" ADD CONSTRAINT "field_group_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
