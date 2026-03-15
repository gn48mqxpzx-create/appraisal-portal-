import { CaseStatus, PrismaClient, type Prisma } from "@prisma/client";
import { evaluateGuardrails } from "./guardrailService";
import { getScopedCaseWhere, normalizeScopedRole } from "./employeeScopeService";
import { resolveUserIdByEmail } from "./userResolutionService";
import { getLatestWsllEligibilityByStaffId } from "./wsllEligibilityService";
import { resolveManagerNamesForCases } from "./employeeDirectoryService";
import {
  getAppraisalClassificationForCase,
  type AppraisalClassification
} from "./appraisalClassificationService";
import { getOrBuildWorkingData, getWorkingDataBatch, workingDataToClassification } from "./employeeWorkingDataService";
import { logSystemAction } from "./dataIntegrityCorrectionService";

const prisma = new PrismaClient();

const SUBMITTABLE_CASE_STATUSES = new Set([
  "DRAFT",
  "REVIEW_REJECTED",
  "RM_OVERRIDE_APPROVED_PENDING_RECOMMENDATION"
] as const);

const REVIEWABLE_CASE_STATUS = "SUBMITTED_FOR_REVIEW" as const;

export type RecommendationType = "LOW" | "MID" | "HIGH" | "CUSTOM";
export type RecommendationInputMode = "TARGET_SALARY" | "INCREASE_AMOUNT" | "INCREASE_PERCENT";
export type ReviewDecision = "APPROVE_AS_SUBMITTED" | "OVERRIDE_AND_APPROVE" | "REJECT";

type SubmittedRecommendationInput = {
  recommendationType: RecommendationType;
  targetSalary: number;
  increaseAmount: number;
  increasePercent: number;
  customInputMode?: RecommendationInputMode | null;
  justification?: string | null;
  submittedBy?: string | null;
};

type ReviewDecisionInput = {
  decision: ReviewDecision;
  reviewerNotes?: string | null;
  reviewedBy?: string | null;
  reviewedByRole?: string | null;
  override?: {
    recommendationType?: RecommendationType | null;
    inputMode: RecommendationInputMode;
    inputValue: number;
  } | null;
};

type ReviewQueueHistoryActionType =
  | "RM_OVERRIDE_APPROVED"
  | "RM_OVERRIDE_REJECTED"
  | "RECOMMENDATION_APPROVED"
  | "RECOMMENDATION_REJECTED";

type ReviewQueueHistoryRecordInput = {
  caseId: string;
  actionType: ReviewQueueHistoryActionType;
  actionBy: string | null;
  actionRole: string | null;
  previousStatus: string;
  newStatus: string;
  comment?: string | null;
};

type ReviewQueueHistoryQueryOptions = {
  page: number;
  pageSize: number;
  actionType?: string;
  reviewer?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

type WorkflowSummary = {
  caseId: string;
  staffId: string;
  fullName: string;
  companyName: string | null;
  status: string;
  rmOverrideStatus: "NOT_REQUIRED" | "REQUESTED" | "APPROVED";
  currentSalary: number | null;
  successManager: string | null;
  relationshipManager: string | null;
  wsllEligibilityStatus: "PASS" | "MISSING_WSLL" | "WSLL_BELOW_THRESHOLD";
  wsllEligibilityMessage: string | null;
  wsllAverageWsll: number | null;
  submittedRecommendation: {
    recommendationType: string | null;
    targetSalary: number | null;
    increaseAmount: number | null;
    increasePercent: number | null;
    guardrailLevel: string | null;
    guardrailAction: string | null;
    customInputMode: string | null;
    justification: string | null;
    submittedBy: string | null;
    submittedAt: string | null;
  } | null;
  finalRecommendation: {
    recommendationType: string | null;
    targetSalary: number | null;
    increaseAmount: number | null;
    increasePercent: number | null;
    guardrailLevel: string | null;
    reviewDecision: string | null;
    reviewerNotes: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  } | null;
  appraisalClassification: AppraisalClassification | null;
};

const roundCurrency = (value: number) => Number(value.toFixed(2));
const roundPercent = (value: number) => Number(value.toFixed(4));

const toFiniteNumber = (value: unknown, fieldName: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  return parsed;
};

const isRecommendationType = (value: unknown): value is RecommendationType => {
  return typeof value === "string" && ["LOW", "MID", "HIGH", "CUSTOM"].includes(value);
};

const isRecommendationInputMode = (value: unknown): value is RecommendationInputMode => {
  return typeof value === "string" && ["TARGET_SALARY", "INCREASE_AMOUNT", "INCREASE_PERCENT"].includes(value);
};

const isReviewDecision = (value: unknown): value is ReviewDecision => {
  return typeof value === "string" && ["APPROVE_AS_SUBMITTED", "OVERRIDE_AND_APPROVE", "REJECT"].includes(value);
};

const readCurrentSalaryForStaff = async (staffId: string): Promise<number | null> => {
  const workingData = await getOrBuildWorkingData(staffId);
  if (workingData?.currentCompensation !== null && workingData?.currentCompensation !== undefined) {
    return workingData.currentCompensation;
  }

  const employee = await prisma.employeeDirectory.findUnique({
    where: { staffId },
    include: { currentCompensation: true }
  });

  const salary = employee?.currentCompensation?.currentCompensation;
  if (salary === null || salary === undefined) {
    return null;
  }

  return Number(salary);
};

const calculateValuesFromInput = (
  currentSalary: number,
  inputMode: RecommendationInputMode,
  inputValue: number
) => {
  if (currentSalary <= 0) {
    throw new Error("Current salary must be greater than 0 to calculate an override");
  }

  let targetSalary = 0;
  let increaseAmount = 0;
  let increasePercent = 0;

  if (inputMode === "TARGET_SALARY") {
    targetSalary = inputValue;
    increaseAmount = targetSalary - currentSalary;
    increasePercent = currentSalary === 0 ? 0 : (increaseAmount / currentSalary) * 100;
  } else if (inputMode === "INCREASE_AMOUNT") {
    increaseAmount = inputValue;
    targetSalary = currentSalary + increaseAmount;
    increasePercent = currentSalary === 0 ? 0 : (increaseAmount / currentSalary) * 100;
  } else {
    increasePercent = inputValue;
    increaseAmount = currentSalary * (increasePercent / 100);
    targetSalary = currentSalary + increaseAmount;
  }

  if (!Number.isFinite(targetSalary) || targetSalary < 0) {
    throw new Error("Calculated target salary must be a valid non-negative value");
  }

  return {
    targetSalary: roundCurrency(targetSalary),
    increaseAmount: roundCurrency(increaseAmount),
    increasePercent: roundPercent(increasePercent)
  };
};

const ensureSubmittedGuardrailsPass = async (increasePercent: number, increaseAmount: number, justification?: string | null) => {
  const guardrail = await evaluateGuardrails(increasePercent, increaseAmount);

  if (guardrail.guardrailLevel === "Red" || guardrail.guardrailLevel === "Unknown") {
    throw new Error("Recommendation cannot be submitted because guardrail requirements are not satisfied");
  }

  if (guardrail.guardrailLevel === "Yellow" && !(justification || "").trim()) {
    throw new Error("Manager justification is required for Yellow guardrail recommendations");
  }

  return guardrail;
};

const mapWorkflowSummary = async (caseId: string): Promise<WorkflowSummary> => {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      recommendation: true
    }
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  const currentSalary = await readCurrentSalaryForStaff(caseRecord.staffId);
  const wsllEligibility = await getLatestWsllEligibilityByStaffId(caseRecord.staffId);
  const recommendation = caseRecord.recommendation;

  // Use Working Data as canonical source for managers and classification
  const workingData = await getOrBuildWorkingData(caseRecord.staffId);
  let successManager: string | null = null;
  let relationshipManager: string | null = null;
  let appraisalClassification: AppraisalClassification | null = null;

  if (workingData) {
    successManager = workingData.successManagerName;
    relationshipManager = workingData.reportingManagerName;
    appraisalClassification = workingDataToClassification(caseRecord.id, workingData);
  } else {
    // Fallback to live computation if Working Data not yet populated
    const employeeDirectoryRecord = await prisma.employeeDirectory.findUnique({
      where: { staffId: caseRecord.staffId },
      select: { rmName: true }
    });
    const managerNames = await resolveManagerNamesForCases([
      {
        staffId: caseRecord.staffId,
        directSmValue: caseRecord.successManagerStaffId,
        directRmValue: employeeDirectoryRecord?.rmName ?? caseRecord.relationshipManagerStaffId
      }
    ]);
    const resolved = managerNames.get(caseRecord.staffId);
    successManager = resolved?.smName ?? null;
    relationshipManager = resolved?.rmName ?? null;
    appraisalClassification = await getAppraisalClassificationForCase(caseRecord.id);
  }

  return {
    caseId: caseRecord.id,
    staffId: caseRecord.staffId,
    fullName: caseRecord.fullName,
    companyName: workingData?.internalCompanyName ?? workingData?.hubspotCompanyName ?? caseRecord.companyName ?? null,
    status: caseRecord.status,
    rmOverrideStatus: caseRecord.rmOverrideStatus,
    currentSalary,
    successManager,
    relationshipManager,
    wsllEligibilityStatus: wsllEligibility.status,
    wsllEligibilityMessage: wsllEligibility.blockerMessage,
    wsllAverageWsll: wsllEligibility.averageWsll,
    submittedRecommendation: recommendation?.submittedAt
      ? {
          recommendationType: recommendation.submittedRecommendationType,
          targetSalary: recommendation.submittedTargetSalary !== null ? Number(recommendation.submittedTargetSalary) : null,
          increaseAmount: recommendation.submittedIncreaseAmount !== null ? Number(recommendation.submittedIncreaseAmount) : null,
          increasePercent: recommendation.submittedIncreasePercent !== null ? Number(recommendation.submittedIncreasePercent) : null,
          guardrailLevel: recommendation.submittedGuardrailLevel,
          guardrailAction: recommendation.submittedGuardrailAction,
          customInputMode: recommendation.submittedCustomInputMode,
          justification: recommendation.submittedJustification,
          submittedBy: recommendation.submittedBy,
          submittedAt: recommendation.submittedAt?.toISOString() ?? null
        }
      : null,
    finalRecommendation: recommendation?.reviewedAt || recommendation?.reviewDecision
      ? {
          recommendationType: recommendation.finalRecommendationType,
          targetSalary: recommendation.finalTargetSalary !== null ? Number(recommendation.finalTargetSalary) : null,
          increaseAmount: recommendation.finalIncreaseAmount !== null ? Number(recommendation.finalIncreaseAmount) : null,
          increasePercent: recommendation.finalIncreasePercent !== null ? Number(recommendation.finalIncreasePercent) : null,
          guardrailLevel: recommendation.finalGuardrailLevel,
          reviewDecision: recommendation.reviewDecision,
          reviewerNotes: recommendation.reviewerNotes,
          reviewedBy: recommendation.reviewedBy,
          reviewedAt: recommendation.reviewedAt?.toISOString() ?? null
        }
      : null,
    appraisalClassification
  };
};

export async function submitRecommendationForReview(caseId: string, input: SubmittedRecommendationInput) {
  if (!isRecommendationType(input.recommendationType)) {
    throw new Error("recommendationType is invalid");
  }

  if (input.recommendationType === "CUSTOM" && input.customInputMode && !isRecommendationInputMode(input.customInputMode)) {
    throw new Error("customInputMode is invalid");
  }

  const targetSalary = toFiniteNumber(input.targetSalary, "targetSalary");
  const increaseAmount = toFiniteNumber(input.increaseAmount, "increaseAmount");
  const increasePercent = toFiniteNumber(input.increasePercent, "increasePercent");

  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: { recommendation: true }
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  if (!SUBMITTABLE_CASE_STATUSES.has(caseRecord.status as (typeof SUBMITTABLE_CASE_STATUSES extends Set<infer T> ? T : never))) {
    throw new Error(`Case cannot be submitted from status ${caseRecord.status}`);
  }

  const classification = await getAppraisalClassificationForCase(caseId);
  if (classification?.rmApprovalRequired && caseRecord.rmOverrideStatus !== "APPROVED") {
    throw new Error("RM override is required before recommendations can be submitted for NO_WSLL classifications.");
  }

  const wsllEligibility = await getLatestWsllEligibilityByStaffId(caseRecord.staffId);

  const guardrail = await ensureSubmittedGuardrailsPass(increasePercent, increaseAmount, input.justification);
  const now = new Date();
  const submittedBy = (input.submittedBy || "").trim() || null;
  const updatedByUserId = await resolveUserIdByEmail(submittedBy);

  await prisma.caseRecommendation.upsert({
    where: { caseId },
    create: {
      caseId,
      recommendedAmount: roundCurrency(increaseAmount),
      recommendedPercent: roundPercent(increasePercent / 100),
      recommendedNewBase: roundCurrency(targetSalary),
      submittedRecommendationType: input.recommendationType,
      submittedTargetSalary: roundCurrency(targetSalary),
      submittedIncreaseAmount: roundCurrency(increaseAmount),
      submittedIncreasePercent: roundPercent(increasePercent),
      submittedGuardrailLevel: guardrail.guardrailLevel,
      submittedGuardrailAction:
        wsllEligibility.status === "PASS"
          ? guardrail.actionRequired
          : `${guardrail.actionRequired} · RM override required before approval`,
      submittedCustomInputMode: input.recommendationType === "CUSTOM" ? input.customInputMode ?? null : null,
      submittedJustification: (input.justification || "").trim() || null,
      submittedBy,
      submittedAt: now,
      finalRecommendationType: null,
      finalTargetSalary: null,
      finalIncreaseAmount: null,
      finalIncreasePercent: null,
      finalGuardrailLevel: null,
      reviewDecision: null,
      reviewerNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      computedAt: now,
      computedBy: submittedBy
    },
    update: {
      recommendedAmount: roundCurrency(increaseAmount),
      recommendedPercent: roundPercent(increasePercent / 100),
      recommendedNewBase: roundCurrency(targetSalary),
      submittedRecommendationType: input.recommendationType,
      submittedTargetSalary: roundCurrency(targetSalary),
      submittedIncreaseAmount: roundCurrency(increaseAmount),
      submittedIncreasePercent: roundPercent(increasePercent),
      submittedGuardrailLevel: guardrail.guardrailLevel,
      submittedGuardrailAction:
        wsllEligibility.status === "PASS"
          ? guardrail.actionRequired
          : `${guardrail.actionRequired} · RM override required before approval`,
      submittedCustomInputMode: input.recommendationType === "CUSTOM" ? input.customInputMode ?? null : null,
      submittedJustification: (input.justification || "").trim() || null,
      submittedBy,
      submittedAt: now,
      finalRecommendationType: null,
      finalTargetSalary: null,
      finalIncreaseAmount: null,
      finalIncreasePercent: null,
      finalGuardrailLevel: null,
      reviewDecision: null,
      reviewerNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      computedAt: now,
      computedBy: submittedBy
    }
  });

  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      previousStatus: caseRecord.status,
      status: "SUBMITTED_FOR_REVIEW",
      updatedBy: updatedByUserId
    }
  });

  await logSystemAction(
    "RECOMMENDATION_SUBMITTED",
    submittedBy ?? "system",
    1,
    "SUCCESS",
    `Case ${caseId} (${caseRecord.staffId}) submitted for review: ${caseRecord.status} -> SUBMITTED_FOR_REVIEW; target=${roundCurrency(targetSalary)} increase=${roundCurrency(increaseAmount)} (${roundPercent(increasePercent)}%).`
  );

  return mapWorkflowSummary(caseId);
}

export async function reviewRecommendation(caseId: string, input: ReviewDecisionInput) {
  if (!isReviewDecision(input.decision)) {
    throw new Error("decision is invalid");
  }

  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: { recommendation: true }
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  if (caseRecord.status !== REVIEWABLE_CASE_STATUS) {
    throw new Error(`Case must be ${REVIEWABLE_CASE_STATUS} before it can be reviewed`);
  }

  if (!caseRecord.recommendation?.submittedAt) {
    throw new Error("Submitted recommendation not found");
  }

  const appraisalClassification = await getAppraisalClassificationForCase(caseId);
  if (
    appraisalClassification?.rmApprovalRequired &&
    caseRecord.rmOverrideStatus !== "APPROVED" &&
    input.decision === "APPROVE_AS_SUBMITTED"
  ) {
    throw new Error("RM override is required for NO_WSLL classifications. Use OVERRIDE_AND_APPROVE.");
  }

  const now = new Date();
  const reviewerNotes = (input.reviewerNotes || "").trim() || null;
  const reviewedBy = (input.reviewedBy || "").trim() || null;
  const reviewedByRole = (input.reviewedByRole || "").trim() || null;
  const updatedByUserId = await resolveUserIdByEmail(reviewedBy);

  if (input.decision === "REJECT") {
    await prisma.caseRecommendation.update({
      where: { caseId },
      data: {
        reviewDecision: input.decision,
        reviewerNotes,
        reviewedBy,
        reviewedAt: now,
        finalRecommendationType: null,
        finalTargetSalary: null,
        finalIncreaseAmount: null,
        finalIncreasePercent: null,
        finalGuardrailLevel: null
      }
    });

    await prisma.appraisalCase.update({
      where: { id: caseId },
      data: {
        previousStatus: caseRecord.status,
        status: "REVIEW_REJECTED",
        updatedBy: updatedByUserId
      }
    });

    await recordReviewQueueAction({
      caseId,
      actionType: "RECOMMENDATION_REJECTED",
      actionBy: reviewedBy,
      actionRole: reviewedByRole,
      previousStatus: caseRecord.status,
      newStatus: "REVIEW_REJECTED",
      comment: reviewerNotes
    });

    await logSystemAction(
      "RECOMMENDATION_REVIEW_REJECTED",
      reviewedBy ?? "system",
      1,
      "SUCCESS",
      `Case ${caseId} (${caseRecord.staffId}) review decision: ${caseRecord.status} -> REVIEW_REJECTED.${reviewerNotes ? ` Notes: ${reviewerNotes}` : ""}`
    );

    return mapWorkflowSummary(caseId);
  }

  let finalRecommendationType = caseRecord.recommendation.submittedRecommendationType || "MID";
  let finalTargetSalary = Number(caseRecord.recommendation.submittedTargetSalary ?? 0);
  let finalIncreaseAmount = Number(caseRecord.recommendation.submittedIncreaseAmount ?? 0);
  let finalIncreasePercent = Number(caseRecord.recommendation.submittedIncreasePercent ?? 0);
  let finalGuardrailLevel = caseRecord.recommendation.submittedGuardrailLevel || "Unknown";

  if (input.decision === "OVERRIDE_AND_APPROVE") {
    if (!input.override || !isRecommendationInputMode(input.override.inputMode)) {
      throw new Error("Override input is required when approving with override");
    }

    const currentSalary = await readCurrentSalaryForStaff(caseRecord.staffId);
    if (currentSalary === null) {
      throw new Error("Current salary is required before an override can be calculated");
    }

    const calculated = calculateValuesFromInput(
      currentSalary,
      input.override.inputMode,
      toFiniteNumber(input.override.inputValue, "override.inputValue")
    );

    const guardrail = await evaluateGuardrails(calculated.increasePercent, calculated.increaseAmount);

    finalRecommendationType = input.override.recommendationType && isRecommendationType(input.override.recommendationType)
      ? input.override.recommendationType
      : "CUSTOM";
    finalTargetSalary = calculated.targetSalary;
    finalIncreaseAmount = calculated.increaseAmount;
    finalIncreasePercent = calculated.increasePercent;
    finalGuardrailLevel = guardrail.guardrailLevel;
  }

  await prisma.caseRecommendation.update({
    where: { caseId },
    data: {
      recommendedAmount: roundCurrency(finalIncreaseAmount),
      recommendedPercent: roundPercent(finalIncreasePercent / 100),
      recommendedNewBase: roundCurrency(finalTargetSalary),
      reviewDecision: input.decision,
      reviewerNotes,
      reviewedBy,
      reviewedAt: now,
      finalRecommendationType,
      finalTargetSalary: roundCurrency(finalTargetSalary),
      finalIncreaseAmount: roundCurrency(finalIncreaseAmount),
      finalIncreasePercent: roundPercent(finalIncreasePercent),
      finalGuardrailLevel
    }
  });

  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      previousStatus: caseRecord.status,
      status: "AWAITING_CLIENT_APPROVAL" as any,
      updatedBy: updatedByUserId
    }
  });

  await recordReviewQueueAction({
    caseId,
    actionType: "RECOMMENDATION_APPROVED",
    actionBy: reviewedBy,
    actionRole: reviewedByRole,
    previousStatus: caseRecord.status,
    newStatus: "AWAITING_CLIENT_APPROVAL",
    comment: reviewerNotes
  });

  await logSystemAction(
    "RECOMMENDATION_REVIEW_APPROVED",
    reviewedBy ?? "system",
    1,
    "SUCCESS",
    `Case ${caseId} (${caseRecord.staffId}) review decision: ${caseRecord.status} -> AWAITING_CLIENT_APPROVAL; final target=${roundCurrency(finalTargetSalary)} increase=${roundCurrency(finalIncreaseAmount)} (${roundPercent(finalIncreasePercent)}%).`
  );

  return mapWorkflowSummary(caseId);
}

export async function getCaseWorkflowByStaffId(caseStaffId: string) {
  const caseRecord = await prisma.appraisalCase.findFirst({
    where: { staffId: caseStaffId },
    orderBy: { createdAt: "desc" }
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  return mapWorkflowSummary(caseRecord.id);
}

export async function getCaseWorkflowByCaseId(caseId: string) {
  return mapWorkflowSummary(caseId);
}

export async function getReviewQueue(viewer: { name: string; role: string; email?: string; id?: string }) {
  const scopedRole = normalizeScopedRole(viewer.role);
  if (!scopedRole) {
    return [];
  }

  const reviewStatuses: string[] = ["SUBMITTED_FOR_REVIEW", "AWAITING_RM_OVERRIDE_APPROVAL"];

  const whereClause: Prisma.AppraisalCaseWhereInput | null =
    scopedRole === "REVIEWER"
      ? {
          isRemoved: false,
          OR: reviewStatuses.map((status) => ({ status: status as any }))
        }
      : await (async () => {
          const baseWhere = await getScopedCaseWhere(
            {
              role: viewer.role,
              name: viewer.name,
              email: viewer.email || null,
              id: viewer.id || null
            },
            {
              includeRemoved: false
            } as any
          );

          if (!baseWhere) {
            return null;
          }

          return {
            AND: [
              baseWhere,
              {
                OR: reviewStatuses.map((status) => ({ status: status as any }))
              }
            ]
          } as Prisma.AppraisalCaseWhereInput;
        })();

  if (!whereClause) {
    return [];
  }

  const cases = await prisma.appraisalCase.findMany({
    where: whereClause,
    include: {
      recommendation: true
    },
    orderBy: [
      { updatedAt: "desc" },
      { fullName: "asc" }
    ]
  });

  const staffIds = cases.map((caseItem) => caseItem.staffId);
  const workingDataByStaffId = await getWorkingDataBatch(staffIds);

  return cases
    .filter((caseItem) => String(caseItem.status) === "AWAITING_RM_OVERRIDE_APPROVAL" || caseItem.recommendation?.submittedAt)
    .map((caseItem) => {
      const wd = workingDataByStaffId.get(caseItem.staffId);
      const isRmOverrideTask = String(caseItem.status) === "AWAITING_RM_OVERRIDE_APPROVAL";
      return {
        caseId: caseItem.id,
        staffId: caseItem.staffId,
        employeeName: caseItem.fullName,
        client: wd?.internalCompanyName ?? wd?.hubspotCompanyName ?? caseItem.companyName,
        role: wd?.hubspotRole ?? caseItem.staffRole,
        currentSalary: wd?.currentCompensation ?? null,
        proposedTargetSalary: caseItem.recommendation?.submittedTargetSalary !== null && caseItem.recommendation?.submittedTargetSalary !== undefined
          ? Number(caseItem.recommendation.submittedTargetSalary)
          : null,
        increasePercent: caseItem.recommendation?.submittedIncreasePercent !== null && caseItem.recommendation?.submittedIncreasePercent !== undefined
          ? Number(caseItem.recommendation.submittedIncreasePercent)
          : null,
        guardrailLevel: caseItem.recommendation?.submittedGuardrailLevel ?? null,
        submittedBy: isRmOverrideTask ? caseItem.rmOverrideRequestedBy : (caseItem.recommendation?.submittedBy ?? null),
        submittedDate: isRmOverrideTask
          ? (caseItem.rmOverrideRequestedAt?.toISOString() ?? null)
          : (caseItem.recommendation?.submittedAt?.toISOString() ?? null),
        reasonForReview: isRmOverrideTask ? "RM Override Request" : "Recommendation Review",
        actionType: isRmOverrideTask ? "RM_OVERRIDE_REQUEST" : "RECOMMENDATION_REVIEW",
        rmOverrideStatus: caseItem.rmOverrideStatus,
        appraisalCategory: wd ? workingDataToClassification(caseItem.id, wd).appraisalCategory : null,
        rmApprovalRequired: wd?.rmApprovalRequired ?? false,
        wsllStatus: wd?.wsllStatus ?? null,
        wsllReason: wd?.wsllReason ?? null,
        tenureGroup: wd?.tenureGroup ?? null,
        marketPosition: wd?.marketPosition ?? null
      };
    });
}

export async function recordReviewQueueAction(input: ReviewQueueHistoryRecordInput) {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: input.caseId },
    select: {
      id: true,
      staffId: true,
      fullName: true,
      companyName: true
    }
  });

  if (!caseRecord) {
    return;
  }

  const wd = await getOrBuildWorkingData(caseRecord.staffId);
  const actionTimestamp = new Date();

  await prisma.auditEvent.create({
    data: {
      entityType: "REVIEW_QUEUE_ACTION",
      entityId: caseRecord.id,
      action: input.actionType,
      actorEmail: input.actionBy,
      actorName: input.actionBy,
      before: {
        status: input.previousStatus
      },
      after: {
        status: input.newStatus
      },
      changes: {
        caseId: caseRecord.id,
        employeeName: caseRecord.fullName,
        company: wd?.internalCompanyName ?? wd?.hubspotCompanyName ?? caseRecord.companyName ?? null,
        actionType: input.actionType,
        actionBy: input.actionBy,
        actionRole: input.actionRole,
        actionTimestamp: actionTimestamp.toISOString(),
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        comment: input.comment ?? null
      }
    }
  });
}

export async function getReviewQueueHistory(
  viewer: { name: string; role: string; email?: string; id?: string },
  options: ReviewQueueHistoryQueryOptions
) {
  const scopedRole = normalizeScopedRole(viewer.role);
  if (!scopedRole) {
    return {
      items: [],
      total: 0
    };
  }

  const whereClause: Prisma.AuditEventWhereInput = {
    entityType: "REVIEW_QUEUE_ACTION"
  };

  if (options.actionType) {
    whereClause.action = options.actionType;
  }

  if (options.reviewer) {
    whereClause.actorEmail = {
      contains: options.reviewer,
      mode: "insensitive"
    };
  }

  if (options.dateFrom || options.dateTo) {
    whereClause.createdAt = {
      ...(options.dateFrom ? { gte: options.dateFrom } : {}),
      ...(options.dateTo ? { lte: options.dateTo } : {})
    };
  }

  if (scopedRole !== "SITE_LEAD" && scopedRole !== "REVIEWER") {
    const scopedWhere = await getScopedCaseWhere(
      {
        role: viewer.role,
        name: viewer.name,
        email: viewer.email || null,
        id: viewer.id || null
      },
      {
        includeRemoved: false
      } as any
    );

    if (!scopedWhere) {
      return {
        items: [],
        total: 0
      };
    }

    const scopedCaseIds = await prisma.appraisalCase.findMany({
      where: scopedWhere,
      select: { id: true }
    });

    if (scopedCaseIds.length === 0) {
      return {
        items: [],
        total: 0
      };
    }

    whereClause.entityId = {
      in: scopedCaseIds.map((item) => item.id)
    };
  }

  const skip = (options.page - 1) * options.pageSize;

  const [total, events] = await prisma.$transaction([
    prisma.auditEvent.count({ where: whereClause }),
    prisma.auditEvent.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take: options.pageSize,
      select: {
        id: true,
        entityId: true,
        action: true,
        actorEmail: true,
        createdAt: true,
        changes: true
      }
    })
  ]);

  const items = events.map((event) => {
    const changes = event.changes && typeof event.changes === "object" && !Array.isArray(event.changes)
      ? (event.changes as Record<string, unknown>)
      : {};

    return {
      id: event.id,
      caseId: String(changes.caseId ?? event.entityId),
      employeeName: String(changes.employeeName ?? "—"),
      company: changes.company ? String(changes.company) : null,
      actionType: String(changes.actionType ?? event.action),
      actionBy: String(changes.actionBy ?? event.actorEmail ?? "system"),
      actionRole: changes.actionRole ? String(changes.actionRole) : null,
      actionTimestamp: String(changes.actionTimestamp ?? event.createdAt.toISOString()),
      previousStatus: String(changes.previousStatus ?? "—"),
      newStatus: String(changes.newStatus ?? "—"),
      comment: changes.comment ? String(changes.comment) : null
    };
  });

  return {
    items,
    total
  };
}

export async function submitCaseToPayroll(caseId: string, submittedBy?: string | null) {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId }
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  if (caseRecord.status !== "CLIENT_APPROVED") {
    throw new Error("Case must be CLIENT_APPROVED before submitting to payroll");
  }

  await prisma.payrollProcessing.upsert({
    where: { caseId },
    create: {
      caseId,
      payrollStatus: "PENDING"
    },
    update: {}
  });

  const updatedByUserId = await resolveUserIdByEmail(submittedBy);

  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      previousStatus: caseRecord.status,
      status: "SUBMITTED_TO_PAYROLL",
      updatedBy: updatedByUserId
    }
  });

  return mapWorkflowSummary(caseId);
}