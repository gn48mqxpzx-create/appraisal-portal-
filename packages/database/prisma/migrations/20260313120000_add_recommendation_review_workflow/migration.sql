ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED_FOR_REVIEW';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'REVIEW_APPROVED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REJECTED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'PENDING_CLIENT_APPROVAL';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED_TO_PAYROLL';

ALTER TABLE "case_recommendations"
ADD COLUMN "submittedRecommendationType" TEXT,
ADD COLUMN "submittedTargetSalary" DECIMAL(12, 2),
ADD COLUMN "submittedIncreaseAmount" DECIMAL(12, 2),
ADD COLUMN "submittedIncreasePercent" DECIMAL(10, 4),
ADD COLUMN "submittedGuardrailLevel" TEXT,
ADD COLUMN "submittedGuardrailAction" TEXT,
ADD COLUMN "submittedCustomInputMode" TEXT,
ADD COLUMN "submittedJustification" TEXT,
ADD COLUMN "submittedBy" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "finalRecommendationType" TEXT,
ADD COLUMN "finalTargetSalary" DECIMAL(12, 2),
ADD COLUMN "finalIncreaseAmount" DECIMAL(12, 2),
ADD COLUMN "finalIncreasePercent" DECIMAL(10, 4),
ADD COLUMN "finalGuardrailLevel" TEXT,
ADD COLUMN "reviewDecision" TEXT,
ADD COLUMN "reviewerNotes" TEXT,
ADD COLUMN "reviewedBy" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);