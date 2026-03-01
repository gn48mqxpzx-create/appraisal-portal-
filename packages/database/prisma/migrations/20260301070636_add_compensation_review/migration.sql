-- CreateEnum
CREATE TYPE "WsllGateStatus" AS ENUM ('PASS', 'FAIL', 'MISSING');

-- CreateEnum
CREATE TYPE "ApprovalWorkflowStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('PDF', 'HUBSPOT_LINK');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('CLIENT_APPROVAL_DRAFTED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('PENDING', 'PROCESSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CaseStatus" ADD VALUE 'SITE_LEAD_PENDING';
ALTER TYPE "CaseStatus" ADD VALUE 'SITE_LEAD_APPROVED';
ALTER TYPE "CaseStatus" ADD VALUE 'CLIENT_PENDING';
ALTER TYPE "CaseStatus" ADD VALUE 'CLIENT_APPROVED';
ALTER TYPE "CaseStatus" ADD VALUE 'PAYROLL_PENDING';
ALTER TYPE "CaseStatus" ADD VALUE 'PAYROLL_PROCESSED';
ALTER TYPE "CaseStatus" ADD VALUE 'LOCKED';

-- CreateTable
CREATE TABLE "wsll_scores" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "wsllScore" DECIMAL(5,2) NOT NULL,
    "wsllDate" TIMESTAMP(3),
    "sourceUploadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wsll_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_comp_current" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedAllowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "variableAllowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "recurringBonuses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "onetimeBonuses" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalComp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "case_comp_current_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_market_snapshot" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "tenureMonthsUsed" INTEGER,
    "tenureBandIdUsed" TEXT,
    "benchmarkBaseUsed" DECIMAL(12,2),
    "catchupPercentUsed" INTEGER,
    "wsllScoreUsed" DECIMAL(5,2),
    "wsllGateStatus" "WsllGateStatus" NOT NULL DEFAULT 'MISSING',
    "isWsllExceptionRequested" BOOLEAN NOT NULL DEFAULT false,
    "wsllExceptionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_market_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_recommendations" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "varianceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "variancePercent" DECIMAL(10,4),
    "recommendedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "recommendedPercent" DECIMAL(10,4),
    "recommendedNewBase" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedBy" TEXT,

    CONSTRAINT "case_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_overrides" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "overrideAmount" DECIMAL(12,2),
    "overridePercent" DECIMAL(10,4),
    "overrideNewBase" DECIMAL(12,2),
    "overrideReason" TEXT NOT NULL,
    "overriddenBy" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_approval_workflow" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "siteLeadStatus" "ApprovalWorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "siteLeadBy" TEXT,
    "siteLeadAt" TIMESTAMP(3),
    "siteLeadComment" TEXT,
    "clientStatus" "ApprovalWorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "clientBy" TEXT,
    "clientAt" TIMESTAMP(3),
    "clientComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_approval_workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_evidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "filePath" TEXT,
    "linkUrl" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_email_events" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" "EmailEventType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_processing" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "effectivityDate" TIMESTAMP(3),
    "payrollStatus" "PayrollStatus" NOT NULL DEFAULT 'PENDING',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_processing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wsll_scores_cycleId_idx" ON "wsll_scores"("cycleId");

-- CreateIndex
CREATE INDEX "wsll_scores_staffId_idx" ON "wsll_scores"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "wsll_scores_cycleId_staffId_key" ON "wsll_scores"("cycleId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "case_comp_current_caseId_key" ON "case_comp_current"("caseId");

-- CreateIndex
CREATE INDEX "case_comp_current_caseId_idx" ON "case_comp_current"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_market_snapshot_caseId_key" ON "case_market_snapshot"("caseId");

-- CreateIndex
CREATE INDEX "case_market_snapshot_caseId_idx" ON "case_market_snapshot"("caseId");

-- CreateIndex
CREATE INDEX "case_market_snapshot_wsllGateStatus_idx" ON "case_market_snapshot"("wsllGateStatus");

-- CreateIndex
CREATE UNIQUE INDEX "case_recommendations_caseId_key" ON "case_recommendations"("caseId");

-- CreateIndex
CREATE INDEX "case_recommendations_caseId_idx" ON "case_recommendations"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_overrides_caseId_key" ON "case_overrides"("caseId");

-- CreateIndex
CREATE INDEX "case_overrides_caseId_idx" ON "case_overrides"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_approval_workflow_caseId_key" ON "case_approval_workflow"("caseId");

-- CreateIndex
CREATE INDEX "case_approval_workflow_caseId_idx" ON "case_approval_workflow"("caseId");

-- CreateIndex
CREATE INDEX "case_approval_workflow_siteLeadStatus_idx" ON "case_approval_workflow"("siteLeadStatus");

-- CreateIndex
CREATE INDEX "case_approval_workflow_clientStatus_idx" ON "case_approval_workflow"("clientStatus");

-- CreateIndex
CREATE INDEX "approval_evidence_caseId_idx" ON "approval_evidence"("caseId");

-- CreateIndex
CREATE INDEX "approval_evidence_type_idx" ON "approval_evidence"("type");

-- CreateIndex
CREATE INDEX "case_email_events_caseId_idx" ON "case_email_events"("caseId");

-- CreateIndex
CREATE INDEX "case_email_events_eventType_idx" ON "case_email_events"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_processing_caseId_key" ON "payroll_processing"("caseId");

-- CreateIndex
CREATE INDEX "payroll_processing_caseId_idx" ON "payroll_processing"("caseId");

-- CreateIndex
CREATE INDEX "payroll_processing_payrollStatus_idx" ON "payroll_processing"("payrollStatus");

-- AddForeignKey
ALTER TABLE "wsll_scores" ADD CONSTRAINT "wsll_scores_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comp_current" ADD CONSTRAINT "case_comp_current_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_market_snapshot" ADD CONSTRAINT "case_market_snapshot_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_recommendations" ADD CONSTRAINT "case_recommendations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_overrides" ADD CONSTRAINT "case_overrides_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_approval_workflow" ADD CONSTRAINT "case_approval_workflow_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_evidence" ADD CONSTRAINT "approval_evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_email_events" ADD CONSTRAINT "case_email_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_processing" ADD CONSTRAINT "payroll_processing_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "appraisal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
