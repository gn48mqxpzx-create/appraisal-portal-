export const CANONICAL_WORKFLOW_STAGES = [
  "DRAFT",
  "RM_OVERRIDE_NEEDED",
  "READY_FOR_RECOMMENDATION",
  "AWAITING_RM_REVIEW",
  "CLIENT_APPROVAL_NEEDED",
  "REJECTED",
  "APPROVED",
  "PAYROLL_SUBMITTED"
] as const;

export type CanonicalWorkflowStage = (typeof CANONICAL_WORKFLOW_STAGES)[number];

const STAGE_TO_STATUSES: Record<CanonicalWorkflowStage, string[]> = {
  DRAFT: ["DRAFT"],
  RM_OVERRIDE_NEEDED: ["AWAITING_RM_OVERRIDE_APPROVAL"],
  READY_FOR_RECOMMENDATION: ["RM_OVERRIDE_APPROVED_PENDING_RECOMMENDATION"],
  AWAITING_RM_REVIEW: ["SUBMITTED_FOR_REVIEW", "IN_REVIEW", "SUBMITTED"],
  CLIENT_APPROVAL_NEEDED: ["REVIEW_APPROVED", "AWAITING_CLIENT_APPROVAL", "PENDING_CLIENT_APPROVAL", "CLIENT_PENDING"],
  REJECTED: ["REVIEW_REJECTED", "REJECTED"],
  APPROVED: ["APPROVED", "CLIENT_APPROVED", "SITE_LEAD_APPROVED"],
  PAYROLL_SUBMITTED: ["SUBMITTED_TO_PAYROLL", "PAYROLL_PENDING", "PAYROLL_PROCESSED", "RELEASED_TO_PAYROLL"]
};

const STATUS_TO_STAGE = new Map<string, CanonicalWorkflowStage>(
  Object.entries(STAGE_TO_STATUSES).flatMap(([stage, statuses]) =>
    statuses.map((status) => [status, stage as CanonicalWorkflowStage] as const)
  )
);

export const getCanonicalWorkflowStageFromStatus = (status: string | null | undefined): CanonicalWorkflowStage => {
  if (!status) {
    return "DRAFT";
  }

  const normalized = status.trim().toUpperCase();
  return STATUS_TO_STAGE.get(normalized) ?? "DRAFT";
};

export const getStatusesForCanonicalWorkflowStage = (
  stage: string | null | undefined
): string[] | null => {
  if (!stage) {
    return null;
  }

  const normalized = stage.trim().toUpperCase() as CanonicalWorkflowStage;
  return STAGE_TO_STATUSES[normalized] ?? null;
};
