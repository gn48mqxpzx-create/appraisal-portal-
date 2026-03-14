/**
 * dataQualityService
 *
 * Detects data anomalies across the employee directory, hierarchy, roles,
 * compensation, and WSLL records. Persists findings as DataQualityIssue rows.
 *
 * Run this service:
 * - After every directory sync
 * - On demand for a specific staff ID
 * - From the Admin Console
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { resolveManagerNamesForCases } from "./employeeDirectoryService";

const prisma = new PrismaClient();

const calculateTenureMonths = (startDate: Date | null): number | null => {
  if (!startDate) {
    return null;
  }

  const now = new Date();
  const months = (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12
    + (now.getUTCMonth() - startDate.getUTCMonth());

  return Number.isFinite(months) && months >= 0 ? months : null;
};

// ── Public types ──────────────────────────────────────────────────────────────

export interface DataQualityIssueRow {
  id: string;
  staffId: string | null;
  employeeName: string | null;
  issueType: string;
  category: string;
  severity: string;
  description: string;
  status: string;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  metadata: any;
}

export interface DataQualityFilters {
  category?: string;
  severity?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface DataQualitySummary {
  openIssues: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  byCategory: Record<string, number>;
}

// ── Issue persistence helper ──────────────────────────────────────────────────

async function upsertIssue(
  staffId: string | null,
  employeeName: string | null,
  issueType: string,
  category: string,
  severity: string,
  description: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const existing = await prisma.dataQualityIssue.findFirst({
      where: {
        staffId: staffId ?? undefined,
        issueType,
        status: { in: ["OPEN", "NEEDS_ADMIN_REVIEW"] }
      }
    });

    if (existing) {
      await prisma.dataQualityIssue.update({
        where: { id: existing.id },
        data: { description, metadata: metadata as Prisma.InputJsonValue, detectedAt: new Date() }
      });
    } else {
      await prisma.dataQualityIssue.create({
        data: { staffId, employeeName, issueType, category, severity, description, metadata: metadata as Prisma.InputJsonValue, status: "OPEN" }
      });
    }
  } catch (err) {
    console.warn(`[dataQualityService] Failed to persist issue ${issueType} for ${staffId}: ${err instanceof Error ? err.message : err}`);
  }
}

async function autoResolveIssue(staffId: string, issueType: string): Promise<void> {
  try {
    await prisma.dataQualityIssue.updateMany({
      where: { staffId, issueType, status: { in: ["OPEN", "NEEDS_ADMIN_REVIEW"] } },
      data: { status: "AUTO_RESOLVED", resolvedAt: new Date() }
    });
  } catch {
    // non-fatal
  }
}

// ── Detection routines ────────────────────────────────────────────────────────

/**
 * Run all anomaly detection checks for the specified staff IDs (or all if empty).
 * Returns the count of new or updated issues found.
 */
export async function runDataQualityChecks(staffIds?: string[]): Promise<number> {
  console.log("[dataQualityService] Running data quality checks...");
  let detected = 0;

  // Load employees
  const employees = await prisma.employeeDirectory.findMany({
    where: staffIds?.length ? { staffId: { in: staffIds } } : {},
    select: {
      staffId: true,
      fullName: true,
      email: true,
      hubspotContactId: true,
      staffRole: true,
      smName: true,
      rmName: true,
      staffStartDate: true,
      isEmploymentActive: true
    }
  });

  const allStaffIds = employees.map((e) => e.staffId);
  const workingDataRows = allStaffIds.length
    ? await prisma.employeeWorkingData.findMany({
        where: { staffId: { in: allStaffIds } },
        select: {
          staffId: true,
          normalizedRole: true,
          normalizedRoleStatus: true,
          marketMatrixStatus: true,
          successManagerName: true,
          reportingManagerName: true,
          currentCompensation: true,
          tenureMonths: true
        }
      })
    : [];
  const workingDataByStaffId = new Map(workingDataRows.map((row) => [row.staffId, row]));

  // ── 1. Identity checks ────────────────────────────────────────────────────
  // Duplicate emails
  const emailGroups = new Map<string, typeof employees>();
  for (const emp of employees) {
    if (!emp.email) continue;
    const key = emp.email.toLowerCase().trim();
    if (!emailGroups.has(key)) emailGroups.set(key, []);
    emailGroups.get(key)!.push(emp);
  }
  for (const [email, group] of emailGroups) {
    if (group.length > 1) {
      for (const emp of group) {
        await upsertIssue(emp.staffId, emp.fullName, "DUPLICATE_EMAIL", "IDENTITY", "HIGH",
          `Email ${email} is shared by ${group.length} employees: ${group.map((e) => e.staffId).join(", ")}`,
          {
            email,
            duplicates: group.map((e) => e.staffId),
            suggestedFix: "Review employee identities in HubSpot and keep one canonical email per staff member."
          }
        );
        detected++;
      }
    } else {
      // Auto-resolve if no longer duplicated
      await autoResolveIssue(group[0].staffId, "DUPLICATE_EMAIL");
    }
  }

  // Duplicate HubSpot IDs
  const hsIdGroups = new Map<string, typeof employees>();
  for (const emp of employees) {
    if (!emp.hubspotContactId) continue;
    if (!hsIdGroups.has(emp.hubspotContactId)) hsIdGroups.set(emp.hubspotContactId, []);
    hsIdGroups.get(emp.hubspotContactId)!.push(emp);
  }
  for (const [hsId, group] of hsIdGroups) {
    if (group.length > 1) {
      for (const emp of group) {
        await upsertIssue(emp.staffId, emp.fullName, "DUPLICATE_HUBSPOT_ID", "IDENTITY", "HIGH",
          `HubSpot Contact ID ${hsId} is shared by ${group.length} employees`,
          {
            hubspotContactId: hsId,
            duplicates: group.map((e) => e.staffId),
            suggestedFix: "Run Directory Sync. Duplicate records are merged automatically using newest HubSpot data."
          }
        );
        detected++;
      }
    } else {
      await autoResolveIssue(group[0].staffId, "DUPLICATE_HUBSPOT_ID");
    }
  }

  // Missing email
  for (const emp of employees) {
    if (!emp.email?.trim()) {
      await upsertIssue(emp.staffId, emp.fullName, "MISSING_EMAIL", "IDENTITY", "MEDIUM",
        `Employee ${emp.fullName} has no email address`, {}
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "MISSING_EMAIL");
    }
  }

  // ── 2. Hierarchy checks ───────────────────────────────────────────────────
  const scopeMappings = await prisma.userScopeMapping.findMany({
    where: staffIds?.length ? { staffId: { in: allStaffIds } } : {},
    select: { staffId: true, unresolvedHierarchyReason: true, canonicalRole: true }
  });
  const scopeByStaffId = new Map(scopeMappings.map((s) => [s.staffId!, s]));

  // Check employees with no scope mapping
  for (const emp of employees) {
    const scope = scopeByStaffId.get(emp.staffId);
    if (scope?.unresolvedHierarchyReason) {
      await upsertIssue(emp.staffId, emp.fullName, "HIERARCHY_UNRESOLVED", "HIERARCHY", "HIGH",
        scope.unresolvedHierarchyReason, { canonicalRole: scope.canonicalRole }
      );
      detected++;
    } else if (scope) {
      await autoResolveIssue(emp.staffId, "HIERARCHY_UNRESOLVED");
    }

    const wd = workingDataByStaffId.get(emp.staffId);

    // Missing SM (canonical from Working Data first)
    if (!wd?.successManagerName?.trim() && !emp.smName?.trim()) {
      await upsertIssue(emp.staffId, emp.fullName, "MISSING_SM", "HIERARCHY", "MEDIUM",
        `Employee ${emp.fullName} has no Success Manager assigned`,
        { suggestedFix: "Update Success Manager in HubSpot and run Directory Sync." }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "MISSING_SM");
    }

    // Missing RM (canonical from Working Data first)
    if (!wd?.reportingManagerName?.trim() && !emp.rmName?.trim()) {
      await upsertIssue(emp.staffId, emp.fullName, "MISSING_RM", "HIERARCHY", "LOW",
        `Employee ${emp.fullName} has no Relationship Manager assigned`,
        { suggestedFix: "Update Relationship Manager in HubSpot and run Directory Sync." }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "MISSING_RM");
    }
  }

  // ── 3. Role checks ────────────────────────────────────────────────────────
  const roles = [...new Set(employees.map((e) => e.staffRole).filter(Boolean))];
  const roleMappings = roles.length
    ? await prisma.roleAlignmentMapping.findMany({
        where: { sourceRoleName: { in: roles, mode: "insensitive" } },
        select: { sourceRoleName: true, confidenceScore: true, matchSource: true }
      })
    : [];

  const mappedRoles = new Set(roleMappings.map((r) => r.sourceRoleName.toLowerCase()));
  const weakRoles = new Set(
    roleMappings
      .filter((r) => r.confidenceScore !== null && Number(r.confidenceScore) < 0.7)
      .map((r) => r.sourceRoleName.toLowerCase())
  );

  for (const emp of employees) {
    const roleKey = (emp.staffRole ?? "").toLowerCase();
    const wd = workingDataByStaffId.get(emp.staffId);
    if (!roleKey) {
      await upsertIssue(emp.staffId, emp.fullName, "MISSING_ROLE", "ROLE", "MEDIUM",
        `Employee ${emp.fullName} has no staff role`, {}
      );
      detected++;
      continue;
    }
    if (!mappedRoles.has(roleKey)) {
      await upsertIssue(emp.staffId, emp.fullName, "ROLE_UNMAPPED", "ROLE", "MEDIUM",
        `Role "${emp.staffRole}" has no approved role mapping`,
        {
          staffRole: emp.staffRole,
          suggestedFix: "Map this role in Role Library and save market matrix rows for all tenure bands."
        }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "ROLE_UNMAPPED");

      if (!wd?.normalizedRole?.trim()) {
        await upsertIssue(
          emp.staffId,
          emp.fullName,
          "APPROVED_ROLE_MISSING_NORMALIZED_ROLE",
          "ROLE",
          "HIGH",
          `Approved role mapping exists for "${emp.staffRole}" but Working Data normalized role is missing`,
          {
            staffRole: emp.staffRole,
            suggestedFix: "Rebuild Working Data to reapply approved Role Library mappings."
          }
        );
        detected++;
      } else {
        await autoResolveIssue(emp.staffId, "APPROVED_ROLE_MISSING_NORMALIZED_ROLE");
      }

      const normalizedRoleName = wd?.normalizedRole ?? null;
      if ((wd?.normalizedRoleStatus ?? "").toUpperCase() === "MAPPED" && (wd?.marketMatrixStatus ?? "").toUpperCase() === "MISSING_MATRIX") {
        await upsertIssue(
          emp.staffId,
          emp.fullName,
          "ROLE_MAPPED_MISSING_MARKET_MATRIX",
          "ROLE",
          "HIGH",
          `Role "${normalizedRoleName ?? "Unknown"}" is mapped but has no Market Matrix row for current tenure band`,
          {
            normalizedRole: normalizedRoleName,
            suggestedFix: "Add or update Market Matrix rows for this normalized role."
          }
        );
        detected++;
      } else {
        await autoResolveIssue(emp.staffId, "ROLE_MAPPED_MISSING_MARKET_MATRIX");
      }

      if (weakRoles.has(roleKey)) {
        await upsertIssue(emp.staffId, emp.fullName, "ROLE_WEAK_MATCH", "ROLE", "LOW",
          `Role "${emp.staffRole}" matched with low confidence`, { staffRole: emp.staffRole }
        );
        detected++;
      } else {
        await autoResolveIssue(emp.staffId, "ROLE_WEAK_MATCH");
      }
    }
  }

  // ── 4. Compensation checks ────────────────────────────────────────────────
  const compensations = await prisma.currentCompensation.findMany({
    where: allStaffIds.length ? { staffId: { in: allStaffIds } } : {},
    select: { staffId: true, currentCompensation: true, currency: true }
  });
  const compByStaffId = new Map(compensations.map((c) => [c.staffId, c]));

  for (const emp of employees) {
    const comp = compByStaffId.get(emp.staffId);
    const wd = workingDataByStaffId.get(emp.staffId);
    if (!comp) {
      await upsertIssue(emp.staffId, emp.fullName, "MISSING_COMPENSATION", "COMPENSATION", "MEDIUM",
        `No current compensation record for ${emp.fullName}`,
        { suggestedFix: "Upload Current Compensation CSV for this employee." }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "MISSING_COMPENSATION");
      const amount = Number(comp.currentCompensation);
      if (!isFinite(amount) || amount <= 0) {
        await upsertIssue(emp.staffId, emp.fullName, "INVALID_COMPENSATION", "COMPENSATION", "MEDIUM",
          `Compensation amount ${comp.currentCompensation} is invalid`, { value: comp.currentCompensation }
        );
        detected++;
      } else {
        await autoResolveIssue(emp.staffId, "INVALID_COMPENSATION");
      }
    }

    if ((wd?.marketMatrixStatus ?? "").toUpperCase() !== "READY") {
      await upsertIssue(
        emp.staffId,
        emp.fullName,
        "BROKEN_BENCHMARK_READINESS",
        "APPRAISAL",
        "MEDIUM",
        `Benchmark is not ready in Working Data (${wd?.marketMatrixStatus ?? "NO_WORKING_DATA"})`,
        {
          marketMatrixStatus: wd?.marketMatrixStatus ?? null,
          normalizedRoleStatus: wd?.normalizedRoleStatus ?? null,
          suggestedFix: "Ensure role mapping, market matrix, and compensation are complete, then rebuild Working Data."
        }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "BROKEN_BENCHMARK_READINESS");
    }
  }

  // ── 5. WSLL checks ────────────────────────────────────────────────────────
  const wsllRecords = await prisma.wsllRecord.findMany({
    where: allStaffIds.length ? { staffId: { in: allStaffIds } } : {},
    select: { staffId: true, wsllScore: true },
    orderBy: { wsllDate: "desc" },
    distinct: ["staffId"]
  });
  const wsllByStaffId = new Map(wsllRecords.map((w) => [w.staffId, Number(w.wsllScore)]));

  for (const emp of employees) {
    const score = wsllByStaffId.get(emp.staffId);
    const tenureMonths = calculateTenureMonths(emp.staffStartDate ?? null);
    const isTenured = tenureMonths !== null && tenureMonths >= 12;
    await autoResolveIssue(emp.staffId, "WSLL_MISSING");

    if (score === undefined && isTenured) {
      await upsertIssue(emp.staffId, emp.fullName, "NO_WSLL_AFTER_12_MONTHS", "WSLL", "MEDIUM",
        `No WSLL record found after 12+ months tenure for ${emp.fullName}`,
        { suggestedFix: "Upload WSLL data or confirm RM override path for this employee." }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "NO_WSLL_AFTER_12_MONTHS");
    }

    if (score !== undefined) {
      if (score < 0 || score > 5) {
        await upsertIssue(emp.staffId, emp.fullName, "WSLL_INVALID_RANGE", "WSLL", "MEDIUM",
          `WSLL score ${score} is outside valid range (0–5)`, { score }
        );
        detected++;
      } else {
        await autoResolveIssue(emp.staffId, "WSLL_INVALID_RANGE");
      }
    }
  }

  // ── 7. Manager mismatch checks (Working Data vs resolved display) ─────────
  const managerResolution = await resolveManagerNamesForCases(
    employees.map((emp) => ({
      staffId: emp.staffId,
      directSmValue: emp.smName,
      directRmValue: emp.rmName
    }))
  );

  for (const emp of employees) {
    const wd = workingDataByStaffId.get(emp.staffId);
    const resolved = managerResolution.get(emp.staffId);

    const wdSm = (wd?.successManagerName ?? "").trim().toLowerCase();
    const wdRm = (wd?.reportingManagerName ?? "").trim().toLowerCase();
    const resolvedSm = (resolved?.smName ?? "").trim().toLowerCase();
    const resolvedRm = (resolved?.rmName ?? "").trim().toLowerCase();

    const smMismatch = Boolean(wdSm && resolvedSm && wdSm !== resolvedSm);
    const rmMismatch = Boolean(wdRm && resolvedRm && wdRm !== resolvedRm);

    if (smMismatch || rmMismatch) {
      await upsertIssue(
        emp.staffId,
        emp.fullName,
        "MANAGER_MISMATCH_WORKING_DATA",
        "HIERARCHY",
        "HIGH",
        "Manager values differ between canonical Working Data and resolved display values",
        {
          workingDataSuccessManager: wd?.successManagerName ?? null,
          workingDataReportingManager: wd?.reportingManagerName ?? null,
          resolvedSuccessManager: resolved?.smName ?? null,
          resolvedReportingManager: resolved?.rmName ?? null,
          suggestedFix: "Rebuild Working Data and ensure case/profile views use canonical manager values."
        }
      );
      detected++;
    } else {
      await autoResolveIssue(emp.staffId, "MANAGER_MISMATCH_WORKING_DATA");
    }
  }

  // ── 6. Appraisal checks ───────────────────────────────────────────────────
  const caseRows = await prisma.appraisalCase.findMany({
    where: {
      staffId: { in: allStaffIds },
      isRemoved: false,
      status: { notIn: ["REMOVED_FROM_SCOPE", "PAYROLL_PROCESSED", "LOCKED"] }
    },
    select: {
      staffId: true,
      fullName: true,
      status: true,
      successManagerStaffId: true,
      relationshipManagerStaffId: true
    }
  });

  const employeeByStaffId = new Map(employees.map((emp) => [emp.staffId, emp]));
  const inactiveStaffIds = new Set(
    employees
      .filter((e) => !e.isEmploymentActive)
      .map((e) => e.staffId)
  );

  for (const cas of caseRows) {
    if (inactiveStaffIds.has(cas.staffId)) {
      await upsertIssue(cas.staffId, cas.fullName, "INACTIVE_EMPLOYEE_ACTIVE_CASE", "APPRAISAL", "HIGH",
        `Employee ${cas.fullName} is employment-inactive but has an active case (${cas.status})`,
        { status: cas.status }
      );
      detected++;
    }

    const employee = employeeByStaffId.get(cas.staffId);
    if (!employee) {
      continue;
    }

    const caseSm = (cas.successManagerStaffId ?? "").trim().toLowerCase();
    const caseRm = (cas.relationshipManagerStaffId ?? "").trim().toLowerCase();
    const dirSm = (employee.smName ?? "").trim().toLowerCase();
    const dirRm = (employee.rmName ?? "").trim().toLowerCase();

    const hasSmConflict = Boolean(caseSm && dirSm && caseSm !== dirSm);
    const hasRmConflict = Boolean(caseRm && dirRm && caseRm !== dirRm);

    if (hasSmConflict || hasRmConflict) {
      await upsertIssue(
        cas.staffId,
        cas.fullName,
        "CONFLICTING_MANAGER_RECORDS",
        "HIERARCHY",
        "HIGH",
        `Case manager values differ from Employee Directory for ${cas.fullName}`,
        {
          caseSuccessManager: cas.successManagerStaffId,
          caseRelationshipManager: cas.relationshipManagerStaffId,
          directorySuccessManager: employee.smName,
          directoryRelationshipManager: employee.rmName,
          suggestedFix: "Use Employee Directory manager fields as source of truth and refresh case manager mappings."
        }
      );
      detected++;
    } else {
      await autoResolveIssue(cas.staffId, "CONFLICTING_MANAGER_RECORDS");
    }
  }

  console.log(`[dataQualityService] Checks complete. ${detected} issue(s) detected or updated.`);
  return detected;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Paginated list of DataQualityIssue rows with optional filters */
export async function listDataQualityIssues(filters: DataQualityFilters = {}): Promise<{
  issues: DataQualityIssueRow[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filters.category) where.category = filters.category;
  if (filters.severity) where.severity = filters.severity;
  if (filters.status) where.status = filters.status;

  const [issues, total] = await Promise.all([
    prisma.dataQualityIssue.findMany({
      where,
      orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
      skip,
      take: limit
    }),
    prisma.dataQualityIssue.count({ where })
  ]);

  return { issues, total, page, limit };
}

/** Aggregate counts for the Data Quality dashboard panel */
export async function getDataQualitySummary(): Promise<DataQualitySummary> {
  const openIssues = await prisma.dataQualityIssue.findMany({
    where: { status: { in: ["OPEN", "NEEDS_ADMIN_REVIEW"] } },
    select: { severity: true, category: true }
  });

  const byCategory: Record<string, number> = {};
  let high = 0, medium = 0, low = 0;

  for (const issue of openIssues) {
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
    if (issue.severity === "HIGH") high++;
    else if (issue.severity === "MEDIUM") medium++;
    else low++;
  }

  return {
    openIssues: openIssues.length,
    highSeverity: high,
    mediumSeverity: medium,
    lowSeverity: low,
    byCategory
  };
}

/** Update the status of a single DataQualityIssue */
export async function updateIssueStatus(
  issueId: string,
  status: "OPEN" | "AUTO_RESOLVED" | "NEEDS_ADMIN_REVIEW" | "RESOLVED",
  resolvedBy?: string
): Promise<void> {
  await prisma.dataQualityIssue.update({
    where: { id: issueId },
    data: {
      status,
      resolvedAt: status === "RESOLVED" || status === "AUTO_RESOLVED" ? new Date() : undefined,
      resolvedBy: resolvedBy ?? undefined
    }
  });
}
