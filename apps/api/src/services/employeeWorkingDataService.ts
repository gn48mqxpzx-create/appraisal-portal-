/**
 * employeeWorkingDataService
 *
 * Single source of truth for per-employee computed data.
 * All modules must read from EmployeeWorkingData instead of independently
 * re-deriving tenure, role mapping, WSLL status, manager names, and market
 * classification from the raw source tables.
 *
 * Refresh triggers:
 *  - After directory sync (for changed/new employees)
 *  - After current compensation import (for affected staff IDs)
 *  - After WSLL upload (for affected staff IDs)
 *  - After role library approval (for affected mapped roles)
 *  - On demand from Admin Console
 */
import { PrismaClient, TenureBandLabel, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ── Tenure helpers ────────────────────────────────────────────────────────────

function computeTenureMonths(startDate: Date | null): number | null {
  if (!startDate) return null;
  const now = new Date();
  const months =
    (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - startDate.getUTCMonth());
  return Number.isFinite(months) && months >= 0 ? months : null;
}

function computeTenureDisplay(months: number | null): string | null {
  if (months === null) return null;
  if (months < 1) return "Less than 1 month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"}, ${rem} month${rem === 1 ? "" : "s"}`;
}

function computeTenureGroup(months: number | null): "TENURED" | "LESS_THAN_12_MONTHS" {
  return months !== null && months >= 12 ? "TENURED" : "LESS_THAN_12_MONTHS";
}

function computeTenureBand(months: number | null): TenureBandLabel | null {
  if (months === null) return null;
  if (months < 12) return TenureBandLabel.T1;
  if (months < 24) return TenureBandLabel.T2;
  if (months < 48) return TenureBandLabel.T3;
  return TenureBandLabel.T4;
}

// ── Exported types ────────────────────────────────────────────────────────────

export type WorkingDataRecord = {
  staffId: string;
  hubspotContactId: string | null;
  email: string | null;
  fullName: string;
  contactType: string | null;
  isActiveForAppraisal: boolean;
  startDate: Date | null;
  tenureMonths: number | null;
  tenureDisplay: string | null;
  tenureGroup: "TENURED" | "LESS_THAN_12_MONTHS";
  successManagerName: string | null;
  reportingManagerName: string | null;
  hubspotRole: string | null;
  normalizedRole: string | null;
  normalizedRoleStatus: "MAPPED" | "UNMAPPED" | "WEAK_MATCH" | null;
  standardizedRoleId: string | null;
  currentCompensation: number | null;
  compensationCurrency: string | null;
  marketMatrixMin: number | null;
  marketMatrixMax: number | null;
  marketMatrixStatus:
    | "READY"
    | "MISSING_ROLE"
    | "MISSING_MATRIX"
    | "MISSING_COMP"
    | null;
  latestWsllAverage: number | null;
  wsllStatus: "WITH_WSLL" | "NO_WSLL" | null;
  wsllReason: "PASS" | "NO_DATA" | "BELOW_THRESHOLD" | null;
  rmApprovalRequired: boolean;
  marketPosition: "BELOW_MARKET" | "AT_OR_ABOVE_MARKET" | null;
  appraisalCategory: string | null;
  lastSyncedAt: Date;
  lastEvaluatedAt: Date;
};

// ── Core build function ───────────────────────────────────────────────────────

/**
 * Compute all Working Data fields for one employee.
 * Reads from: EmployeeDirectory, CurrentCompensation, WsllRecord,
 *             RoleAlignmentMapping, MarketValueMatrix.
 * Does NOT write — call upsertWorkingData to persist.
 */
async function buildWorkingDataForEmployee(
  staffId: string
): Promise<WorkingDataRecord | null> {
  const employee = await prisma.employeeDirectory.findUnique({
    where: { staffId },
    include: { currentCompensation: true }
  });

  if (!employee) return null;

  // ── Tenure ────────────────────────────────────────────────────────────────
  const tenureMonths = computeTenureMonths(employee.staffStartDate ?? null);
  const tenureDisplay = computeTenureDisplay(tenureMonths);
  const tenureGroup = computeTenureGroup(tenureMonths);
  const tenureBand = computeTenureBand(tenureMonths);

  // ── Manager name resolution ───────────────────────────────────────────────
  // reportingManagerName: rmName is stored as display name in EmployeeDirectory
  const reportingManagerName = employee.rmName?.trim() || null;

  // successManagerName: smName is HubSpot owner ID → resolve to display name
  let successManagerName: string | null = null;
  if (employee.smName?.trim()) {
    const smRecord = await prisma.employeeDirectory.findFirst({
      where: { smOwnerId: employee.smName.trim(), employeeType: "SM" },
      select: { fullName: true }
    });
    successManagerName = smRecord?.fullName ?? employee.smName.trim();
  }

  // ── Role mapping ─────────────────────────────────────────────────────────
  const hubspotRole = employee.staffRole?.trim() || null;
  let normalizedRole: string | null = null;
  let normalizedRoleStatus: "MAPPED" | "UNMAPPED" | "WEAK_MATCH" | null = null;
  let standardizedRoleId: string | null = null;

  if (hubspotRole) {
    const mapping = await prisma.roleAlignmentMapping.findFirst({
      where: { sourceRoleName: { equals: hubspotRole, mode: "insensitive" } },
      include: { standardizedRole: true }
    });

    if (mapping) {
      normalizedRole =
        mapping.standardizedRole?.roleName ?? mapping.mappedRoleName ?? null;
      standardizedRoleId = mapping.standardizedRoleId ?? null;
      const confidence =
        mapping.confidenceScore !== null ? Number(mapping.confidenceScore) : 1;
      normalizedRoleStatus = confidence < 0.7 ? "WEAK_MATCH" : "MAPPED";
    } else {
      normalizedRoleStatus = "UNMAPPED";
    }
  }

  // ── Compensation ─────────────────────────────────────────────────────────
  const comp = employee.currentCompensation;
  const currentCompensation = comp
    ? Number(comp.currentCompensation)
    : null;
  const compensationCurrency = comp?.currency ?? null;

  // ── Market matrix ─────────────────────────────────────────────────────────
  let marketMatrixMin: number | null = null;
  let marketMatrixMax: number | null = null;
  let marketMatrixStatus:
    | "READY"
    | "MISSING_ROLE"
    | "MISSING_MATRIX"
    | "MISSING_COMP"
    | null = null;

  if (normalizedRoleStatus === "UNMAPPED" || !normalizedRole) {
    marketMatrixStatus = "MISSING_ROLE";
  } else if (!tenureBand) {
    marketMatrixStatus = "MISSING_MATRIX";
  } else {
    const matrixRow = await prisma.marketValueMatrix.findFirst({
      where: {
        tenureBand,
        OR: [
          ...(standardizedRoleId ? [{ standardizedRoleId }] : []),
          {
            roleName: { equals: normalizedRole, mode: "insensitive" }
          }
        ]
      }
    });

    if (matrixRow) {
      marketMatrixMin = Number(matrixRow.minSalary);
      marketMatrixMax = Number(matrixRow.maxSalary);
      marketMatrixStatus = currentCompensation ? "READY" : "MISSING_COMP";
    } else {
      marketMatrixStatus = "MISSING_MATRIX";
    }
  }

  // ── WSLL ──────────────────────────────────────────────────────────────────
  const wsllRecord = await prisma.wsllRecord.findFirst({
    where: { staffId },
    orderBy: [{ wsllDate: "desc" }, { uploadedAt: "desc" }],
    select: { wsllScore: true, rawRowJson: true }
  });

  let latestWsllAverage: number | null = null;
  if (wsllRecord) {
    // Try to read pre-computed average from rawRowJson first
    const fromRaw =
      wsllRecord.rawRowJson &&
      typeof wsllRecord.rawRowJson === "object" &&
      !Array.isArray(wsllRecord.rawRowJson)
        ? (wsllRecord.rawRowJson as Record<string, unknown>).averageWsll
        : null;
    latestWsllAverage =
      typeof fromRaw === "number" && Number.isFinite(fromRaw)
        ? Number(fromRaw.toFixed(2))
        : Number.isFinite(wsllRecord.wsllScore)
        ? Number(wsllRecord.wsllScore.toFixed(2))
        : null;
  }

  const WSLL_THRESHOLD = 2.8;
  let wsllStatus: "WITH_WSLL" | "NO_WSLL" | null = null;
  let wsllReason: "PASS" | "NO_DATA" | "BELOW_THRESHOLD" | null = null;
  let rmApprovalRequired = false;

  if (latestWsllAverage === null) {
    wsllStatus = "NO_WSLL";
    wsllReason = "NO_DATA";
    rmApprovalRequired = true;
  } else if (latestWsllAverage < WSLL_THRESHOLD) {
    wsllStatus = "NO_WSLL";
    wsllReason = "BELOW_THRESHOLD";
    rmApprovalRequired = true;
  } else {
    wsllStatus = "WITH_WSLL";
    wsllReason = "PASS";
    rmApprovalRequired = false;
  }

  // ── Market position ───────────────────────────────────────────────────────
  let marketPosition: "BELOW_MARKET" | "AT_OR_ABOVE_MARKET" | null = null;
  if (marketMatrixMin !== null && marketMatrixMax !== null && currentCompensation !== null) {
    const midpoint = (marketMatrixMin + marketMatrixMax) / 2;
    marketPosition =
      currentCompensation < midpoint ? "BELOW_MARKET" : "AT_OR_ABOVE_MARKET";
  }

  // ── Appraisal category ────────────────────────────────────────────────────
  let appraisalCategory: string | null = null;
  if (wsllStatus && marketPosition) {
    appraisalCategory = `${wsllStatus} - ${tenureGroup} - ${marketPosition}`;
  }

  const now = new Date();
  return {
    staffId,
    hubspotContactId: employee.hubspotContactId,
    email: employee.email || null,
    fullName: employee.fullName,
    contactType: employee.contactType || null,
    isActiveForAppraisal: employee.isEmploymentActive,
    startDate: employee.staffStartDate ?? null,
    tenureMonths,
    tenureDisplay,
    tenureGroup,
    successManagerName,
    reportingManagerName,
    hubspotRole,
    normalizedRole,
    normalizedRoleStatus,
    standardizedRoleId,
    currentCompensation,
    compensationCurrency,
    marketMatrixMin,
    marketMatrixMax,
    marketMatrixStatus,
    latestWsllAverage,
    wsllStatus,
    wsllReason,
    rmApprovalRequired,
    marketPosition,
    appraisalCategory,
    lastSyncedAt: now,
    lastEvaluatedAt: now
  };
}

// ── Upsert a single Working Data record ──────────────────────────────────────

async function upsertWorkingData(data: WorkingDataRecord): Promise<void> {
  await prisma.employeeWorkingData.upsert({
    where: { staffId: data.staffId },
    create: {
      staffId: data.staffId,
      hubspotContactId: data.hubspotContactId,
      email: data.email,
      fullName: data.fullName,
      contactType: data.contactType,
      isActiveForAppraisal: data.isActiveForAppraisal,
      startDate: data.startDate,
      tenureMonths: data.tenureMonths,
      tenureDisplay: data.tenureDisplay,
      tenureGroup: data.tenureGroup,
      successManagerName: data.successManagerName,
      reportingManagerName: data.reportingManagerName,
      hubspotRole: data.hubspotRole,
      normalizedRole: data.normalizedRole,
      normalizedRoleStatus: data.normalizedRoleStatus,
      standardizedRoleId: data.standardizedRoleId,
      currentCompensation: data.currentCompensation,
      compensationCurrency: data.compensationCurrency,
      marketMatrixMin: data.marketMatrixMin,
      marketMatrixMax: data.marketMatrixMax,
      marketMatrixStatus: data.marketMatrixStatus,
      latestWsllAverage: data.latestWsllAverage,
      wsllStatus: data.wsllStatus,
      wsllReason: data.wsllReason,
      rmApprovalRequired: data.rmApprovalRequired,
      marketPosition: data.marketPosition,
      appraisalCategory: data.appraisalCategory,
      lastSyncedAt: data.lastSyncedAt,
      lastEvaluatedAt: data.lastEvaluatedAt
    },
    update: {
      hubspotContactId: data.hubspotContactId,
      email: data.email,
      fullName: data.fullName,
      contactType: data.contactType,
      isActiveForAppraisal: data.isActiveForAppraisal,
      startDate: data.startDate,
      tenureMonths: data.tenureMonths,
      tenureDisplay: data.tenureDisplay,
      tenureGroup: data.tenureGroup,
      successManagerName: data.successManagerName,
      reportingManagerName: data.reportingManagerName,
      hubspotRole: data.hubspotRole,
      normalizedRole: data.normalizedRole,
      normalizedRoleStatus: data.normalizedRoleStatus,
      standardizedRoleId: data.standardizedRoleId,
      currentCompensation: data.currentCompensation,
      compensationCurrency: data.compensationCurrency,
      marketMatrixMin: data.marketMatrixMin,
      marketMatrixMax: data.marketMatrixMax,
      marketMatrixStatus: data.marketMatrixStatus,
      latestWsllAverage: data.latestWsllAverage,
      wsllStatus: data.wsllStatus,
      wsllReason: data.wsllReason,
      rmApprovalRequired: data.rmApprovalRequired,
      marketPosition: data.marketPosition,
      appraisalCategory: data.appraisalCategory,
      lastSyncedAt: data.lastSyncedAt,
      lastEvaluatedAt: data.lastEvaluatedAt
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Refresh Working Data for a batch of staff IDs (e.g., after sync).
 * Silently skips staff IDs not found in EmployeeDirectory.
 * Returns a count of saved records.
 */
export async function refreshWorkingDataForEmployees(
  staffIds: string[]
): Promise<{ saved: number; errors: number }> {
  const unique = [...new Set(staffIds.filter(Boolean))];
  let saved = 0;
  let errors = 0;

  for (const staffId of unique) {
    try {
      const data = await buildWorkingDataForEmployee(staffId);
      if (data) {
        await upsertWorkingData(data);
        saved++;
      }
    } catch (err) {
      console.warn(
        `[employeeWorkingDataService] Failed to refresh ${staffId}: ${
          err instanceof Error ? err.message : err
        }`
      );
      errors++;
    }
  }

  console.log(
    `[employeeWorkingDataService] Refreshed ${saved} records (${errors} errors) for ${unique.length} staff IDs`
  );
  return { saved, errors };
}

/**
 * Rebuild Working Data for all active employees.
 * Called from Admin Console or after a full role library approval.
 */
export async function refreshAllWorkingData(): Promise<{
  saved: number;
  errors: number;
}> {
  const employees = await prisma.employeeDirectory.findMany({
    where: { isEmploymentActive: true },
    select: { staffId: true }
  });

  const staffIds = employees.map((e) => e.staffId);
  console.log(
    `[employeeWorkingDataService] Full refresh for ${staffIds.length} active employees`
  );
  return refreshWorkingDataForEmployees(staffIds);
}

/**
 * Read the canonical Working Data for a single employee.
 * Returns null if no Working Data record exists yet.
 */
export async function getWorkingData(
  staffId: string
): Promise<WorkingDataRecord | null> {
  const row = await prisma.employeeWorkingData.findUnique({
    where: { staffId }
  });
  if (!row) return null;

  return {
    staffId: row.staffId,
    hubspotContactId: row.hubspotContactId,
    email: row.email,
    fullName: row.fullName,
    contactType: row.contactType,
    isActiveForAppraisal: row.isActiveForAppraisal,
    startDate: row.startDate ?? null,
    tenureMonths: row.tenureMonths,
    tenureDisplay: row.tenureDisplay,
    tenureGroup: (row.tenureGroup as "TENURED" | "LESS_THAN_12_MONTHS") ?? "LESS_THAN_12_MONTHS",
    successManagerName: row.successManagerName,
    reportingManagerName: row.reportingManagerName,
    hubspotRole: row.hubspotRole,
    normalizedRole: row.normalizedRole,
    normalizedRoleStatus: (row.normalizedRoleStatus as "MAPPED" | "UNMAPPED" | "WEAK_MATCH") ?? null,
    standardizedRoleId: row.standardizedRoleId,
    currentCompensation: row.currentCompensation ? Number(row.currentCompensation) : null,
    compensationCurrency: row.compensationCurrency,
    marketMatrixMin: row.marketMatrixMin ? Number(row.marketMatrixMin) : null,
    marketMatrixMax: row.marketMatrixMax ? Number(row.marketMatrixMax) : null,
    marketMatrixStatus: (row.marketMatrixStatus as
      | "READY"
      | "MISSING_ROLE"
      | "MISSING_MATRIX"
      | "MISSING_COMP") ?? null,
    latestWsllAverage: row.latestWsllAverage ? Number(row.latestWsllAverage) : null,
    wsllStatus: (row.wsllStatus as "WITH_WSLL" | "NO_WSLL") ?? null,
    wsllReason: (row.wsllReason as "PASS" | "NO_DATA" | "BELOW_THRESHOLD") ?? null,
    rmApprovalRequired: row.rmApprovalRequired,
    marketPosition: (row.marketPosition as "BELOW_MARKET" | "AT_OR_ABOVE_MARKET") ?? null,
    appraisalCategory: row.appraisalCategory,
    lastSyncedAt: row.lastSyncedAt,
    lastEvaluatedAt: row.lastEvaluatedAt
  };
}

/**
 * Get Working Data for multiple staff IDs in one query.
 * Returns a Map keyed by staffId.
 */
export async function getWorkingDataBatch(
  staffIds: string[]
): Promise<Map<string, WorkingDataRecord>> {
  const unique = [...new Set(staffIds.filter(Boolean))];
  const rows = await prisma.employeeWorkingData.findMany({
    where: { staffId: { in: unique } }
  });

  const map = new Map<string, WorkingDataRecord>();
  for (const row of rows) {
    map.set(row.staffId, {
      staffId: row.staffId,
      hubspotContactId: row.hubspotContactId,
      email: row.email,
      fullName: row.fullName,
      contactType: row.contactType,
      isActiveForAppraisal: row.isActiveForAppraisal,
      startDate: row.startDate ?? null,
      tenureMonths: row.tenureMonths,
      tenureDisplay: row.tenureDisplay,
      tenureGroup: (row.tenureGroup as "TENURED" | "LESS_THAN_12_MONTHS") ?? "LESS_THAN_12_MONTHS",
      successManagerName: row.successManagerName,
      reportingManagerName: row.reportingManagerName,
      hubspotRole: row.hubspotRole,
      normalizedRole: row.normalizedRole,
      normalizedRoleStatus: (row.normalizedRoleStatus as "MAPPED" | "UNMAPPED" | "WEAK_MATCH") ?? null,
      standardizedRoleId: row.standardizedRoleId,
      currentCompensation: row.currentCompensation ? Number(row.currentCompensation) : null,
      compensationCurrency: row.compensationCurrency,
      marketMatrixMin: row.marketMatrixMin ? Number(row.marketMatrixMin) : null,
      marketMatrixMax: row.marketMatrixMax ? Number(row.marketMatrixMax) : null,
      marketMatrixStatus: (row.marketMatrixStatus as
        | "READY"
        | "MISSING_ROLE"
        | "MISSING_MATRIX"
        | "MISSING_COMP") ?? null,
      latestWsllAverage: row.latestWsllAverage ? Number(row.latestWsllAverage) : null,
      wsllStatus: (row.wsllStatus as "WITH_WSLL" | "NO_WSLL") ?? null,
      wsllReason: (row.wsllReason as "PASS" | "NO_DATA" | "BELOW_THRESHOLD") ?? null,
      rmApprovalRequired: row.rmApprovalRequired,
      marketPosition: (row.marketPosition as "BELOW_MARKET" | "AT_OR_ABOVE_MARKET") ?? null,
      appraisalCategory: row.appraisalCategory,
      lastSyncedAt: row.lastSyncedAt,
      lastEvaluatedAt: row.lastEvaluatedAt
    });
  }
  return map;
}

/**
 * Get Working Data or compute it live (on cache miss).
 * Use this in request handlers so they always get data even before first refresh.
 */
export async function getOrBuildWorkingData(
  staffId: string
): Promise<WorkingDataRecord | null> {
  const cached = await getWorkingData(staffId);
  if (cached) return cached;

  // Cache miss: build and persist immediately
  const data = await buildWorkingDataForEmployee(staffId);
  if (data) {
    await upsertWorkingData(data);
  }
  return data;
}

/**
 * Force-rebuild and return fresh Working Data for one employee.
 * Use after a compensation import or WSLL upload that affects this employee.
 */
export async function rebuildWorkingDataForEmployee(
  staffId: string
): Promise<WorkingDataRecord | null> {
  const data = await buildWorkingDataForEmployee(staffId);
  if (data) {
    await upsertWorkingData(data);
  }
  return data;
}

/**
 * Mark an employee's Working Data as inactive without full rebuild.
 */
export async function markWorkingDataInactive(staffId: string): Promise<void> {
  await prisma.employeeWorkingData
    .update({
      where: { staffId },
      data: { isActiveForAppraisal: false, lastSyncedAt: new Date() }
    })
    .catch(() => {
      // Record may not exist yet — that's fine
    });
}

// ── Appraisal classification helper ──────────────────────────────────────────

/**
 * Convert a WorkingData record to the AppraisalClassification shape
 * expected by existing consumers (avoids touching all call sites immediately).
 */
export function workingDataToClassification(
  caseId: string,
  wd: WorkingDataRecord
) {
  const wsllStatus: "WITH_WSLL" | "NO_WSLL" = wd.wsllStatus ?? "NO_WSLL";
  const wsllReason: "PASS" | "NO_DATA" | "BELOW_THRESHOLD" =
    wd.wsllReason ?? "NO_DATA";
  const tenureGroup: "TENURED" | "LESS_THAN_12_MONTHS" = wd.tenureGroup;
  const marketPosition: "BELOW_MARKET" | "AT_OR_ABOVE_MARKET" =
    wd.marketPosition ?? "AT_OR_ABOVE_MARKET";
  const appraisalCategory =
    wd.appraisalCategory ??
    `${wsllStatus} - ${tenureGroup} - ${marketPosition}`;

  return {
    caseId,
    staffId: wd.staffId,
    wsllStatus,
    wsllReason,
    wsllAverage: wd.latestWsllAverage,
    tenureMonths: wd.tenureMonths,
    tenureGroup,
    marketPosition,
    benchmarkReference:
      wd.marketMatrixMin !== null && wd.marketMatrixMax !== null
        ? Number(((wd.marketMatrixMin + wd.marketMatrixMax) / 2).toFixed(2))
        : null,
    currentSalary: wd.currentCompensation,
    rmApprovalRequired: wd.rmApprovalRequired,
    appraisalCategory: appraisalCategory as `${typeof wsllStatus} - ${typeof tenureGroup} - ${typeof marketPosition}`
  };
}
