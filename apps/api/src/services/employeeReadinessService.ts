/**
 * employeeReadinessService
 *
 * Unified pipeline that evaluates whether an employee is ready for appraisal
 * workflows. Computes tenure, WSLL status, market position, classification, and
 * surfaces anomaly flags — all in one place.
 *
 * Reusable by: Dashboard, Appraisal Cases, Review Queue, Case Detail,
 *              future Client Approval module, and data quality detection.
 */
import { PrismaClient } from "@prisma/client";
import { getLatestWsllEligibilityByStaffIds } from "./wsllEligibilityService";

const prisma = new PrismaClient();

// ── Types ────────────────────────────────────────────────────────────────────

export type WsllStatus = "WITH_WSLL" | "NO_WSLL";
export type WsllReason = "PASS" | "NO_DATA" | "BELOW_THRESHOLD";
export type TenureGroup = "TENURED" | "LESS_THAN_12_MONTHS";
export type MarketPosition = "BELOW_MARKET" | "AT_OR_ABOVE_MARKET";
export type AppraisalCategory = `${WsllStatus} - ${TenureGroup} - ${MarketPosition}`;

export type ReadinessSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface ReadinessFlag {
  code: string;
  category: "IDENTITY" | "HIERARCHY" | "ROLE" | "COMPENSATION" | "WSLL" | "BENCHMARK" | "APPRAISAL";
  severity: ReadinessSeverity;
  message: string;
}

export interface EmployeeReadiness {
  staffId: string;
  fullName: string;

  // Tenure
  tenureMonths: number | null;
  tenureGroup: TenureGroup;

  // WSLL
  wsllStatus: WsllStatus;
  wsllReason: WsllReason;
  wsllAverage: number | null;

  // Market
  currentSalary: number | null;
  benchmarkMidpoint: number | null;
  marketPosition: MarketPosition | null;

  // Classification
  rmApprovalRequired: boolean;
  appraisalCategory: AppraisalCategory | null;

  // Readiness summary
  isAppraisalReady: boolean;
  blockers: string[];
  flags: ReadinessFlag[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcTenureMonths(startDate: Date | null): number | null {
  if (!startDate) return null;
  const now = new Date();
  const total = (now.getFullYear() - startDate.getFullYear()) * 12
    + (now.getMonth() - startDate.getMonth());
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function toTenureGroup(months: number | null): TenureGroup {
  return months !== null && months >= 12 ? "TENURED" : "LESS_THAN_12_MONTHS";
}

function toWsllReason(raw: "PASS" | "MISSING_WSLL" | "WSLL_BELOW_THRESHOLD"): WsllReason {
  if (raw === "PASS") return "PASS";
  if (raw === "WSLL_BELOW_THRESHOLD") return "BELOW_THRESHOLD";
  return "NO_DATA";
}

function toWsllStatus(reason: WsllReason): WsllStatus {
  return reason === "PASS" ? "WITH_WSLL" : "NO_WSLL";
}

// ── Core evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate readiness for a single employee.
 * - tenureMonths computed dynamically from staffStartDate
 * - WSLL pulled from latest WsllRecord
 * - Market position uses CurrentCompensation vs MarketValueMatrix midpoint
 * - Classification (appraisalCategory) derived from wsllStatus × tenureGroup × marketPosition
 */
export async function evaluateEmployeeReadiness(staffId: string): Promise<EmployeeReadiness> {
  const map = await evaluateBatchReadiness([staffId]);
  const result = map.get(staffId);
  if (!result) throw new Error(`No readiness result for staffId: ${staffId}`);
  return result;
}

/**
 * Evaluate readiness for a batch of employees.
 * Returns a Map keyed by staffId.
 */
export async function evaluateBatchReadiness(
  staffIds: string[]
): Promise<Map<string, EmployeeReadiness>> {
  const result = new Map<string, EmployeeReadiness>();
  const unique = [...new Set(staffIds.filter(Boolean))];
  if (unique.length === 0) return result;

  // ── Fetch all data in parallel ────────────────────────────────────────────
  const [employees, compensations, wsllMap, scopeMappings] = await Promise.all([
    prisma.employeeDirectory.findMany({
      where: { staffId: { in: unique } },
      select: { staffId: true, fullName: true, staffStartDate: true, staffRole: true, email: true }
    }),
    prisma.currentCompensation.findMany({
      where: { staffId: { in: unique } },
      select: { staffId: true, currentCompensation: true }
    }),
    getLatestWsllEligibilityByStaffIds(unique),
    prisma.userScopeMapping.findMany({
      where: { staffId: { in: unique } },
      select: { staffId: true, canonicalRole: true, unresolvedHierarchyReason: true }
    })
  ]);

  const empByStaffId = new Map(employees.map((e) => [e.staffId, e]));
  const compByStaffId = new Map(
    compensations.map((c) => [c.staffId, Number(c.currentCompensation)])
  );
  const scopeByStaffId = new Map(scopeMappings.map((s) => [s.staffId!, s]));

  // ── Resolve role mappings for benchmark lookup ────────────────────────────
  const roles = [...new Set(employees.map((e) => e.staffRole).filter(Boolean))];
  const roleMappings = roles.length
    ? await prisma.roleAlignmentMapping.findMany({
        where: { sourceRoleName: { in: roles, mode: "insensitive" } },
        include: { standardizedRole: { include: { matrixRows: true } } }
      })
    : [];

  const benchmarkByRole = new Map<string, number>();
  for (const rm of roleMappings) {
    const rows = rm.standardizedRole?.matrixRows ?? [];
    const all = rows.map((r: any) => (Number(r.minSalary) + Number(r.maxSalary)) / 2);
    if (all.length > 0) {
      const avg = all.reduce((s: number, v: number) => s + v, 0) / all.length;
      benchmarkByRole.set(rm.sourceRoleName.toLowerCase(), avg);
    }
  }

  // ── Evaluate each employee ────────────────────────────────────────────────
  for (const staffId of unique) {
    const emp = empByStaffId.get(staffId);
    const fullName = emp?.fullName ?? staffId;
    const flags: ReadinessFlag[] = [];
    const blockers: string[] = [];

    // ── (1) Identity checks ───────────────────────────────────────────────
    if (!emp) {
      flags.push({ code: "MISSING_DIRECTORY_RECORD", category: "IDENTITY", severity: "HIGH", message: "Employee not found in directory" });
      blockers.push("Employee not found in directory");
    } else if (!emp.email) {
      flags.push({ code: "MISSING_EMAIL", category: "IDENTITY", severity: "MEDIUM", message: "Employee has no email address" });
    }

    // ── (2) Hierarchy checks ──────────────────────────────────────────────
    const scope = scopeByStaffId.get(staffId);
    if (scope?.unresolvedHierarchyReason) {
      flags.push({ code: "HIERARCHY_UNRESOLVED", category: "HIERARCHY", severity: "HIGH", message: scope.unresolvedHierarchyReason });
    }

    // ── (3) Role checks ───────────────────────────────────────────────────
    const staffRole = emp?.staffRole ?? "";
    const hasBenchmark = staffRole && benchmarkByRole.has(staffRole.toLowerCase());
    if (staffRole && !hasBenchmark) {
      flags.push({ code: "ROLE_UNMAPPED", category: "ROLE", severity: "MEDIUM", message: `Role "${staffRole}" has no market matrix mapping` });
    }

    // ── (4) Tenure ────────────────────────────────────────────────────────
    const tenureMonths = calcTenureMonths(emp?.staffStartDate ?? null);
    const tenureGroup = toTenureGroup(tenureMonths);

    if (!emp?.staffStartDate) {
      flags.push({ code: "MISSING_START_DATE", category: "IDENTITY", severity: "MEDIUM", message: "Staff start date missing; tenure cannot be computed" });
    }

    // ── (5) Compensation checks ───────────────────────────────────────────
    const currentSalary = compByStaffId.get(staffId) ?? null;
    if (currentSalary === null) {
      flags.push({ code: "MISSING_COMPENSATION", category: "COMPENSATION", severity: "MEDIUM", message: "Current compensation not recorded" });
      blockers.push("Missing current compensation");
    } else if (currentSalary <= 0) {
      flags.push({ code: "INVALID_COMPENSATION", category: "COMPENSATION", severity: "MEDIUM", message: `Current compensation ${currentSalary} is invalid` });
      blockers.push("Invalid compensation value");
    }

    // ── (6) WSLL checks ───────────────────────────────────────────────────
    const wsllResult = wsllMap.get(staffId);
    const wsllReason = wsllResult ? toWsllReason(wsllResult.status) : "NO_DATA";
    const wsllStatus = toWsllStatus(wsllReason);
    const wsllAverage = wsllResult?.averageWsll ?? null;

    if (wsllStatus === "NO_WSLL") {
      const msg = wsllReason === "BELOW_THRESHOLD"
        ? `WSLL average ${wsllAverage} is below threshold (2.8)`
        : "No WSLL record found";
      flags.push({ code: wsllReason === "BELOW_THRESHOLD" ? "WSLL_BELOW_THRESHOLD" : "WSLL_MISSING", category: "WSLL", severity: "MEDIUM", message: msg });
    }

    // ── (7) Market position ───────────────────────────────────────────────
    const benchmarkMidpoint = hasBenchmark ? benchmarkByRole.get(staffRole.toLowerCase()) ?? null : null;
    let marketPosition: MarketPosition | null = null;
    if (currentSalary !== null && benchmarkMidpoint !== null) {
      marketPosition = currentSalary < benchmarkMidpoint ? "BELOW_MARKET" : "AT_OR_ABOVE_MARKET";
    } else if (!hasBenchmark) {
      flags.push({ code: "BENCHMARK_MISSING", category: "BENCHMARK", severity: "MEDIUM", message: "No benchmark available for market position calculation" });
    }

    // ── (8) Classification ────────────────────────────────────────────────
    const rmApprovalRequired = wsllStatus === "NO_WSLL";
    const appraisalCategory: AppraisalCategory | null = marketPosition
      ? `${wsllStatus} - ${tenureGroup} - ${marketPosition}`
      : null;

    if (!appraisalCategory) {
      flags.push({ code: "CLASSIFICATION_INCOMPLETE", category: "APPRAISAL", severity: "LOW", message: "Classification cannot be fully computed (missing benchmark)" });
    }

    // ── Readiness gate ────────────────────────────────────────────────────
    const isAppraisalReady = blockers.length === 0;

    result.set(staffId, {
      staffId,
      fullName,
      tenureMonths,
      tenureGroup,
      wsllStatus,
      wsllReason,
      wsllAverage,
      currentSalary,
      benchmarkMidpoint,
      marketPosition,
      rmApprovalRequired,
      appraisalCategory,
      isAppraisalReady,
      blockers,
      flags
    });
  }

  return result;
}
