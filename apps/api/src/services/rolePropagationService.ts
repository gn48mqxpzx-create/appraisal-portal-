import { PrismaClient, RoleMatchSource, WsllGateStatus, type TenureBandLabel } from "@prisma/client";
import { getWorkingDataBatch, refreshWorkingDataForEmployees } from "./employeeWorkingDataService";

const prisma = new PrismaClient();

const OPEN_CASE_EXCLUDED_STATUSES = ["REMOVED_FROM_SCOPE", "PAYROLL_PROCESSED", "LOCKED"] as const;

const normalizeRoleKey = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const tenureBandFromMonths = (tenureMonths: number | null): TenureBandLabel | null => {
  if (tenureMonths === null || tenureMonths < 0) return null;
  if (tenureMonths < 12) return "T1";
  if (tenureMonths < 24) return "T2";
  if (tenureMonths < 48) return "T3";
  return "T4";
};

const wsllGateStatusFromReason = (reason: string | null | undefined): WsllGateStatus => {
  if (reason === "PASS") return "PASS";
  if (reason === "BELOW_THRESHOLD") return "FAIL";
  return "MISSING";
};

const computeIsMissingBenchmark = (marketMatrixStatus: string | null | undefined): boolean => {
  const normalized = (marketMatrixStatus ?? "").toUpperCase();
  return normalized === "MISSING_ROLE" || normalized === "MISSING_MATRIX";
};

async function refreshOpenCasesForStaffIds(staffIds: string[]): Promise<{ updatedCases: number; refreshedSnapshots: number }> {
  const uniqueStaffIds = [...new Set(staffIds.filter(Boolean))];
  if (uniqueStaffIds.length === 0) {
    return { updatedCases: 0, refreshedSnapshots: 0 };
  }

  const [openCases, workingDataByStaffId] = await Promise.all([
    prisma.appraisalCase.findMany({
      where: {
        staffId: { in: uniqueStaffIds },
        isRemoved: false,
        status: { notIn: [...OPEN_CASE_EXCLUDED_STATUSES] }
      },
      select: {
        id: true,
        staffId: true,
        staffRole: true
      }
    }),
    getWorkingDataBatch(uniqueStaffIds)
  ]);

  if (openCases.length === 0) {
    return { updatedCases: 0, refreshedSnapshots: 0 };
  }

  let updatedCases = 0;
  let refreshedSnapshots = 0;

  for (const openCase of openCases) {
    const wd = workingDataByStaffId.get(openCase.staffId);
    if (!wd) {
      continue;
    }

    const benchmarkMidpoint =
      wd.marketMatrixMin !== null && wd.marketMatrixMax !== null
        ? (wd.marketMatrixMin + wd.marketMatrixMax) / 2
        : null;

    await prisma.appraisalCase.update({
      where: { id: openCase.id },
      data: {
        staffRole: wd.hubspotRole ?? openCase.staffRole,
        isMissingBenchmark: computeIsMissingBenchmark(wd.marketMatrixStatus),
        tenureMonths: wd.tenureMonths,
        tenureComputedAt: new Date()
      }
    });
    updatedCases++;

    await prisma.caseMarketSnapshot.upsert({
      where: { caseId: openCase.id },
      create: {
        caseId: openCase.id,
        tenureMonthsUsed: wd.tenureMonths,
        tenureBandIdUsed: tenureBandFromMonths(wd.tenureMonths),
        benchmarkBaseUsed: benchmarkMidpoint,
        catchupPercentUsed: benchmarkMidpoint !== null ? 75 : null,
        wsllScoreUsed: wd.latestWsllAverage,
        wsllGateStatus: wsllGateStatusFromReason(wd.wsllReason)
      },
      update: {
        tenureMonthsUsed: wd.tenureMonths,
        tenureBandIdUsed: tenureBandFromMonths(wd.tenureMonths),
        benchmarkBaseUsed: benchmarkMidpoint,
        catchupPercentUsed: benchmarkMidpoint !== null ? 75 : null,
        wsllScoreUsed: wd.latestWsllAverage,
        wsllGateStatus: wsllGateStatusFromReason(wd.wsllReason)
      }
    });
    refreshedSnapshots++;
  }

  return { updatedCases, refreshedSnapshots };
}

async function getStaffIdsForSourceRole(sourceRoleName: string): Promise<string[]> {
  const roleKey = normalizeRoleKey(sourceRoleName);
  if (!roleKey) return [];

  const employees = await prisma.employeeDirectory.findMany({
    where: {
      isEmploymentActive: true
    },
    select: { staffId: true, staffRole: true }
  });

  return employees
    .filter((employee) => normalizeRoleKey(employee.staffRole) === roleKey)
    .map((employee) => employee.staffId);
}

export type RolePropagationResult = {
  sourceRoles: number;
  impactedEmployees: number;
  workingDataSaved: number;
  workingDataErrors: number;
  openCasesUpdated: number;
  caseSnapshotsRefreshed: number;
};

export async function propagateRoleApprovalBySourceRole(sourceRoleName: string): Promise<RolePropagationResult> {
  const staffIds = await getStaffIdsForSourceRole(sourceRoleName);
  const refreshResult = await refreshWorkingDataForEmployees(staffIds);
  const caseResult = await refreshOpenCasesForStaffIds(staffIds);

  return {
    sourceRoles: staffIds.length > 0 ? 1 : 0,
    impactedEmployees: staffIds.length,
    workingDataSaved: refreshResult.saved,
    workingDataErrors: refreshResult.errors,
    openCasesUpdated: caseResult.updatedCases,
    caseSnapshotsRefreshed: caseResult.refreshedSnapshots
  };
}

export async function rebuildApprovedRolePropagation(): Promise<RolePropagationResult> {
  const approvedMappings = await prisma.roleAlignmentMapping.findMany({
    where: { matchSource: RoleMatchSource.ADMIN_CONFIRMED },
    select: { sourceRoleName: true }
  });

  const approvedRoleKeys = new Set(
    approvedMappings
      .map((mapping) => normalizeRoleKey(mapping.sourceRoleName))
      .filter(Boolean)
  );

  if (approvedRoleKeys.size === 0) {
    return {
      sourceRoles: 0,
      impactedEmployees: 0,
      workingDataSaved: 0,
      workingDataErrors: 0,
      openCasesUpdated: 0,
      caseSnapshotsRefreshed: 0
    };
  }

  const employees = await prisma.employeeDirectory.findMany({
    where: {
      isEmploymentActive: true
    },
    select: { staffId: true, staffRole: true }
  });

  const impactedStaffIds = employees
    .filter((employee) => approvedRoleKeys.has(normalizeRoleKey(employee.staffRole)))
    .map((employee) => employee.staffId);

  const refreshResult = await refreshWorkingDataForEmployees(impactedStaffIds);
  const caseResult = await refreshOpenCasesForStaffIds(impactedStaffIds);

  return {
    sourceRoles: approvedRoleKeys.size,
    impactedEmployees: impactedStaffIds.length,
    workingDataSaved: refreshResult.saved,
    workingDataErrors: refreshResult.errors,
    openCasesUpdated: caseResult.updatedCases,
    caseSnapshotsRefreshed: caseResult.refreshedSnapshots
  };
}
