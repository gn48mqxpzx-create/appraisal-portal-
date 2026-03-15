import { PrismaClient } from "@prisma/client";
import { getScopedCaseWhere, type ScopedEmployeeUser } from "./employeeScopeService";
import { getWorkingDataBatch } from "./employeeWorkingDataService";
import { getCanonicalWorkflowStageFromStatus, type CanonicalWorkflowStage } from "./workflowStageService";

const prisma = new PrismaClient();

const WSLL_ELIGIBILITY_THRESHOLD = 2.8;

export type CanonicalWsllStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "OVERRIDE_REQUIRED";

export type CanonicalAppraisalDatasetRow = {
  appraisal_case_id: string;
  employee_id: string;
  employee_name: string;
  company: string | null;
  manager_sm: string | null;
  manager_rm: string | null;
  normalized_role: string | null;
  original_role_title: string | null;
  contact_type: string | null;
  wsll_score: number | null;
  wsll_status: CanonicalWsllStatus;
  tenure: string | null;
  tenure_months: number | null;
  workflow_stage: CanonicalWorkflowStage;
  last_action_timestamp: string;
  proposed_adjustment: number | null;
  new_compensation: number | null;
  canonical_workflow_stage: CanonicalWorkflowStage;
  status: string;
  wsll_status_label: CanonicalWsllStatus;
  wsll_gate_status: "PASS" | "MISSING_WSLL" | "WSLL_BELOW_THRESHOLD";
  wsll_blocker_message: string | null;
  rm_override_status: "NOT_REQUIRED" | "REQUESTED" | "APPROVED";
  is_in_review_queue: boolean;
  created_at: string;
  updated_at: string;
};

export type CanonicalDatasetFilterOptions = {
  workflowStage?: string | null;
  normalizedRole?: string | null;
  company?: string | null;
  wsllStatus?: string | null;
};

const normalizeText = (value: string | null | undefined): string => String(value ?? "").trim().toLowerCase();

const toWsllGateStatus = (wsllScore: number | null): "PASS" | "MISSING_WSLL" | "WSLL_BELOW_THRESHOLD" => {
  if (wsllScore === null || wsllScore === undefined) {
    return "MISSING_WSLL";
  }

  return wsllScore >= WSLL_ELIGIBILITY_THRESHOLD ? "PASS" : "WSLL_BELOW_THRESHOLD";
};

const toWsllStatus = (wsllScore: number | null): CanonicalWsllStatus => {
  if (wsllScore === null || wsllScore === undefined) {
    return "OVERRIDE_REQUIRED";
  }

  return wsllScore >= WSLL_ELIGIBILITY_THRESHOLD ? "ELIGIBLE" : "NOT_ELIGIBLE";
};

const toWsllBlockerMessage = (wsllScore: number | null): string | null => {
  if (wsllScore === null || wsllScore === undefined) {
    return "WSLL data is required before a recommendation can be created.";
  }

  if (wsllScore < WSLL_ELIGIBILITY_THRESHOLD) {
    return "Average WSLL is below 2.8.";
  }

  return null;
};

export const getCanonicalAppraisalDataset = async ({
  viewer,
  cycleId,
  includeRemoved = false
}: {
  viewer: ScopedEmployeeUser;
  cycleId: string;
  includeRemoved?: boolean;
}): Promise<CanonicalAppraisalDatasetRow[]> => {
  const scopedWhere = await getScopedCaseWhere(viewer, {
    cycleId,
    includeRemoved
  });

  if (!scopedWhere) {
    return [];
  }

  const cases = await prisma.appraisalCase.findMany({
    where: scopedWhere,
    select: {
      id: true,
      staffId: true,
      fullName: true,
      companyName: true,
      staffRole: true,
      contactType: true,
      status: true,
      rmOverrideStatus: true,
      createdAt: true,
      updatedAt: true,
      compCurrent: {
        select: {
          baseSalary: true
        }
      },
      recommendation: {
        select: {
          submittedAt: true,
          recommendedNewBase: true,
          submittedTargetSalary: true,
          submittedIncreaseAmount: true,
          finalTargetSalary: true,
          finalIncreaseAmount: true
        }
      },
      override: {
        select: {
          overrideAmount: true,
          overridePercent: true,
          overrideNewBase: true
        }
      }
    },
    orderBy: [{ updatedAt: "desc" }, { fullName: "asc" }]
  });

  if (cases.length === 0) {
    return [];
  }

  const staffIds = [...new Set(cases.map((item) => item.staffId))];
  const workingDataByStaffId = await getWorkingDataBatch(staffIds);

  return cases.map((caseRecord) => {
    const workingData = workingDataByStaffId.get(caseRecord.staffId);
    const currentBase = workingData?.currentCompensation ?? Number(caseRecord.compCurrent?.baseSalary || 0);

    const submittedTargetSalary =
      caseRecord.recommendation?.submittedTargetSalary !== null && caseRecord.recommendation?.submittedTargetSalary !== undefined
        ? Number(caseRecord.recommendation.submittedTargetSalary)
        : null;
    const finalTargetSalary =
      caseRecord.recommendation?.finalTargetSalary !== null && caseRecord.recommendation?.finalTargetSalary !== undefined
        ? Number(caseRecord.recommendation.finalTargetSalary)
        : null;
    const submittedIncreaseAmount =
      caseRecord.recommendation?.submittedIncreaseAmount !== null && caseRecord.recommendation?.submittedIncreaseAmount !== undefined
        ? Number(caseRecord.recommendation.submittedIncreaseAmount)
        : null;
    const finalIncreaseAmount =
      caseRecord.recommendation?.finalIncreaseAmount !== null && caseRecord.recommendation?.finalIncreaseAmount !== undefined
        ? Number(caseRecord.recommendation.finalIncreaseAmount)
        : null;

    let finalNewBase = finalTargetSalary ?? submittedTargetSalary ?? Number(caseRecord.recommendation?.recommendedNewBase || currentBase);

    if (caseRecord.override) {
      if (caseRecord.override.overrideNewBase !== null) {
        finalNewBase = Number(caseRecord.override.overrideNewBase);
      } else if (caseRecord.override.overrideAmount !== null) {
        finalNewBase = currentBase + Number(caseRecord.override.overrideAmount);
      } else if (caseRecord.override.overridePercent !== null) {
        finalNewBase = currentBase * (1 + Number(caseRecord.override.overridePercent));
      }
    }

    const wsllScore = workingData?.latestWsllAverage ?? null;
    const wsllStatus = toWsllStatus(wsllScore);
    const wsllGateStatus = toWsllGateStatus(wsllScore);
    const workflowStage = getCanonicalWorkflowStageFromStatus(caseRecord.status);
    const normalizedStatus = String(caseRecord.status || "").trim().toUpperCase();
    const isInReviewQueue =
      normalizedStatus === "AWAITING_RM_OVERRIDE_APPROVAL" ||
      (workflowStage === "AWAITING_RM_REVIEW" && Boolean(caseRecord.recommendation?.submittedAt));

    return {
      appraisal_case_id: caseRecord.id,
      employee_id: caseRecord.staffId,
      employee_name: caseRecord.fullName,
      company: workingData?.internalCompanyName ?? workingData?.hubspotCompanyName ?? caseRecord.companyName ?? null,
      manager_sm: workingData?.successManagerName ?? null,
      manager_rm: workingData?.reportingManagerName ?? null,
      normalized_role: workingData?.normalizedRole ?? null,
      original_role_title: workingData?.hubspotRole ?? caseRecord.staffRole ?? null,
      contact_type: caseRecord.contactType,
      wsll_score: wsllScore,
      wsll_status: wsllStatus,
      tenure: workingData?.tenureDisplay ?? null,
      tenure_months: workingData?.tenureMonths ?? null,
      workflow_stage: workflowStage,
      last_action_timestamp: caseRecord.updatedAt.toISOString(),
      proposed_adjustment: finalIncreaseAmount ?? submittedIncreaseAmount,
      new_compensation: finalNewBase,
      canonical_workflow_stage: workflowStage,
      status: caseRecord.status,
      wsll_status_label: wsllStatus,
      wsll_gate_status: wsllGateStatus,
      wsll_blocker_message: toWsllBlockerMessage(wsllScore),
      rm_override_status: caseRecord.rmOverrideStatus,
      is_in_review_queue: isInReviewQueue,
      created_at: caseRecord.createdAt.toISOString(),
      updated_at: caseRecord.updatedAt.toISOString()
    };
  });
};

export const filterCanonicalAppraisalDataset = (
  rows: CanonicalAppraisalDatasetRow[],
  filters: CanonicalDatasetFilterOptions
): CanonicalAppraisalDatasetRow[] => {
  const normalizedWorkflowStage = String(filters.workflowStage || "").trim().toUpperCase();
  const normalizedRole = normalizeText(filters.normalizedRole);
  const normalizedCompany = normalizeText(filters.company);
  const normalizedWsllStatus = String(filters.wsllStatus || "").trim().toUpperCase();

  return rows.filter((row) => {
    if (normalizedWorkflowStage && normalizedWorkflowStage !== "ALL" && row.workflow_stage !== normalizedWorkflowStage) {
      return false;
    }

    if (normalizedRole && normalizedRole !== "all") {
      if (normalizeText(row.normalized_role) !== normalizedRole) {
        return false;
      }
    }

    if (normalizedCompany && !normalizeText(row.company).includes(normalizedCompany)) {
      return false;
    }

    if (normalizedWsllStatus && normalizedWsllStatus !== "ALL") {
      if (row.wsll_status !== normalizedWsllStatus) {
        return false;
      }
    }

    return true;
  });
};

export const getDistinctNormalizedRoles = (rows: CanonicalAppraisalDatasetRow[]): string[] => {
  return [...new Set(rows.map((row) => String(row.normalized_role || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
};

export const getCanonicalDatasetMetrics = (rows: CanonicalAppraisalDatasetRow[]) => {
  const workflowCounts: Record<CanonicalWorkflowStage, number> = {
    DRAFT: 0,
    RM_OVERRIDE_NEEDED: 0,
    READY_FOR_RECOMMENDATION: 0,
    AWAITING_RM_REVIEW: 0,
    CLIENT_APPROVAL_NEEDED: 0,
    REJECTED: 0,
    APPROVED: 0,
    PAYROLL_SUBMITTED: 0
  };

  for (const row of rows) {
    workflowCounts[row.workflow_stage] += 1;
  }

  const uniqueEmployees = new Map<string, CanonicalAppraisalDatasetRow>();
  for (const row of rows) {
    if (!uniqueEmployees.has(row.employee_id)) {
      uniqueEmployees.set(row.employee_id, row);
    }
  }

  const uniqueRows = [...uniqueEmployees.values()];
  const coverage = {
    totalVas: uniqueRows.length,
    eligible: uniqueRows.filter((row) => row.wsll_status === "ELIGIBLE").length,
    notEligible: uniqueRows.filter((row) => row.wsll_status === "NOT_ELIGIBLE").length,
    overrideRequired: uniqueRows.filter((row) => row.wsll_status === "OVERRIDE_REQUIRED").length
  };

  return {
    workflowCounts,
    coverage,
    reviewQueuePending: rows.filter((row) => row.is_in_review_queue).length,
    totalCases: rows.length
  };
};

export const toCaseListItem = (row: CanonicalAppraisalDatasetRow) => {
  const classification = {
    appraisalCategory: null,
    wsllStatus: null,
    tenureGroup: null,
    marketPosition: null,
    rmApprovalRequired: row.wsll_status === "OVERRIDE_REQUIRED"
  };

  return {
    id: row.appraisal_case_id,
    staff_id: row.employee_id,
    full_name: row.employee_name,
    company: row.company,
    staff_role: row.original_role_title,
    normalized_role: row.normalized_role,
    contact_type: row.contact_type,
    success_manager: row.manager_sm,
    relationship_manager: row.manager_rm,
    status: row.status,
    canonical_workflow_stage: row.workflow_stage,
    created_at: row.created_at,
    updated_at: row.updated_at,
    wsll_gate_status: row.wsll_gate_status,
    wsll_status_label: row.wsll_status,
    wsll_average: row.wsll_score,
    wsll_blocker_message: row.wsll_blocker_message,
    rm_override_status: row.rm_override_status,
    appraisal_classification: classification,
    proposed_increase_amount: row.proposed_adjustment,
    final_new_base: row.new_compensation,
    tenure: row.tenure,
    tenure_months: row.tenure_months,
    last_action_timestamp: row.last_action_timestamp,
    original_role_title: row.original_role_title,
    workflow_stage: row.workflow_stage,
    appraisal_case_id: row.appraisal_case_id
  };
};
