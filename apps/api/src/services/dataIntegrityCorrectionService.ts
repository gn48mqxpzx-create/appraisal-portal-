/**
 * dataIntegrityCorrectionService
 *
 * Handles direct correction actions from the Data Integrity Console:
 * - Apply corrections to Working Data and Employee Directory
 * - Rebuild working data for a single employee
 * - Close open cases for an employee
 * - Provide smart role suggestions for mismatched roles
 * - Log all correction actions to SystemActionLog for persistent history
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { refreshWorkingDataForEmployees } from "./employeeWorkingDataService";
import { runDataQualityChecks } from "./dataQualityService";

const prisma = new PrismaClient();
const systemActionLog = prisma as unknown as {
  systemActionLog: {
    create: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<{
      id: string;
      actionType: string;
      startedAt: Date;
      completedAt: Date | null;
      runBy: string;
      affectedRecords: number;
      recordsRepaired?: number | null;
      casesRefreshed?: number | null;
      failuresCount?: number | null;
      status: string;
      summaryMessage: string | null;
    }[]>;
  };
};

// ── String similarity ─────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  const an = a.trim().toLowerCase();
  const bn = b.trim().toLowerCase();
  if (!an || !bn) return 0;
  const dist = levenshtein(an, bn);
  return 1 - dist / Math.max(an.length, bn.length);
}

// ── Role suggestions ──────────────────────────────────────────────────────────

export interface RoleSuggestion {
  sourceRoleName: string;
  normalizedRoleName: string | null;
  similarity: number;
}

export async function getRoleSuggestions(rawRole: string): Promise<RoleSuggestion[]> {
  if (!rawRole?.trim()) return [];

  const mappings = await prisma.roleAlignmentMapping.findMany({
    where: { matchSource: "ADMIN_CONFIRMED" },
    select: {
      sourceRoleName: true,
      mappedRoleName: true,
      standardizedRole: { select: { roleName: true } }
    },
    take: 500
  });

  return mappings
    .map((m) => ({
      sourceRoleName: m.sourceRoleName,
      normalizedRoleName: m.standardizedRole?.roleName ?? m.mappedRoleName ?? null,
      similarity: stringSimilarity(rawRole, m.sourceRoleName)
    }))
    .filter((r) => r.similarity >= 0.35)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

// ── System action log ─────────────────────────────────────────────────────────

export async function logSystemAction(
  actionType: string,
  runBy: string,
  affectedRecords: number,
  status: string,
  summaryMessage?: string,
  details?: {
    recordsRepaired?: number;
    casesRefreshed?: number;
    failuresCount?: number;
  }
): Promise<void> {
  try {
    await systemActionLog.systemActionLog.create({
      data: {
        actionType,
        runBy,
        affectedRecords,
        recordsRepaired: details?.recordsRepaired ?? null,
        casesRefreshed: details?.casesRefreshed ?? null,
        failuresCount: details?.failuresCount ?? null,
        status,
        summaryMessage: summaryMessage ?? null,
        completedAt: new Date()
      }
    });
  } catch (err) {
    console.warn("[dataIntegrity] Failed to persist system action log:", err instanceof Error ? err.message : err);
  }
}

export async function getActionHistory(limit = 25): Promise<{
  id: string;
  actionType: string;
  startedAt: Date;
  completedAt: Date | null;
  runBy: string;
  affectedRecords: number;
  recordsRepaired?: number | null;
  casesRefreshed?: number | null;
  failuresCount?: number | null;
  status: string;
  summaryMessage: string | null;
}[]> {
  return systemActionLog.systemActionLog.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(100, Math.max(1, limit))
  });
}

// ── Correction types ──────────────────────────────────────────────────────────

export interface CorrectionPayload {
  staffId?: string;
  fullName?: string;
  hubspotRole?: string;
  normalizedRole?: string;
  successManagerName?: string;
  reportingManagerName?: string;
  startDate?: string;
  currentCompensation?: number;
  isEmploymentActive?: boolean;
}

// ── Apply correction ──────────────────────────────────────────────────────────

export async function applyCorrection(
  staffId: string,
  issueId: string | null,
  corrections: CorrectionPayload,
  runBy: string
): Promise<{ success: boolean; message: string; revalidated?: number }> {
  const updateWd: Record<string, unknown> = {};
  const updateDir: Record<string, unknown> = {};

  if (corrections.fullName !== undefined) {
    updateWd.fullName = corrections.fullName;
    updateDir.fullName = corrections.fullName;
  }
  if (corrections.hubspotRole !== undefined) {
    updateWd.hubspotRole = corrections.hubspotRole;
    updateDir.staffRole = corrections.hubspotRole;
  }
  if (corrections.normalizedRole !== undefined) {
    updateWd.normalizedRole = corrections.normalizedRole;
    updateWd.normalizedRoleStatus = corrections.normalizedRole ? "APPROVED" : null;
  }
  if (corrections.successManagerName !== undefined) {
    updateWd.successManagerName = corrections.successManagerName;
    updateDir.smName = corrections.successManagerName;
  }
  if (corrections.reportingManagerName !== undefined) {
    updateWd.reportingManagerName = corrections.reportingManagerName;
    updateDir.rmName = corrections.reportingManagerName;
  }
  if (corrections.startDate !== undefined) {
    const d = new Date(corrections.startDate);
    if (!isNaN(d.getTime())) {
      updateWd.startDate = d;
      updateDir.staffStartDate = d;
    }
  }
  if (corrections.isEmploymentActive !== undefined) {
    updateWd.isActiveForAppraisal = corrections.isEmploymentActive;
    updateDir.isEmploymentActive = corrections.isEmploymentActive;
  }

  // Update EmployeeWorkingData
  if (Object.keys(updateWd).length > 0) {
    await prisma.employeeWorkingData
      .updateMany({
        where: { staffId },
        data: { ...(updateWd as Prisma.EmployeeWorkingDataUpdateManyMutationInput), lastEvaluatedAt: new Date() }
      })
      .catch((err) =>
        console.warn(`[dataIntegrity] WD update failed for ${staffId}:`, err instanceof Error ? err.message : err)
      );
  }

  // Update EmployeeDirectory
  if (Object.keys(updateDir).length > 0) {
    await prisma.employeeDirectory
      .updateMany({
        where: { staffId },
        data: updateDir as Prisma.EmployeeDirectoryUpdateManyMutationInput
      })
      .catch((err) =>
        console.warn(`[dataIntegrity] Directory update failed for ${staffId}:`, err instanceof Error ? err.message : err)
      );
  }

  // Handle compensation update
  if (corrections.currentCompensation !== undefined && corrections.currentCompensation > 0) {
    try {
      const existing = await prisma.currentCompensation.findUnique({ where: { staffId } });
      if (existing) {
        await prisma.currentCompensation.update({
          where: { staffId },
          data: { currentCompensation: corrections.currentCompensation, effectiveDate: new Date() }
        });
      } else {
        const dirRecord = await prisma.employeeDirectory.findUnique({ where: { staffId } });
        if (dirRecord) {
          await prisma.currentCompensation.create({
            data: {
              staffId,
              currentCompensation: corrections.currentCompensation,
              currency: "AUD",
              effectiveDate: new Date(),
              uploadedBy: runBy
            }
          });
        }
      }
    } catch (err) {
      console.warn(`[dataIntegrity] Compensation update failed for ${staffId}:`, err instanceof Error ? err.message : err);
    }
  }

  // Handle new staffId correction
  if (corrections.staffId && corrections.staffId !== staffId) {
    try {
      await prisma.employeeWorkingData.updateMany({
        where: { staffId },
        data: { staffId: corrections.staffId }
      });
      await prisma.employeeDirectory.updateMany({
        where: { staffId },
        data: { staffId: corrections.staffId }
      });
    } catch (err) {
      console.warn(`[dataIntegrity] StaffId rename failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Re-run working data refresh for this employee
  try {
    await refreshWorkingDataForEmployees([staffId]);
  } catch (err) {
    console.warn(`[dataIntegrity] WD refresh failed for ${staffId}:`, err instanceof Error ? err.message : err);
  }

  // If role changed and an approved mapping exists, re-propagate
  if (corrections.hubspotRole) {
    try {
      const wd = await prisma.employeeWorkingData.findUnique({ where: { staffId } });
      if (wd?.hubspotRole) {
        const mapping = await prisma.roleAlignmentMapping.findFirst({
          where: {
            sourceRoleName: { equals: wd.hubspotRole, mode: "insensitive" },
            matchSource: "ADMIN_CONFIRMED"
          },
          include: { standardizedRole: { select: { roleName: true } } }
        });
        if (mapping) {
          await prisma.employeeWorkingData.updateMany({
            where: { staffId },
            data: {
              normalizedRole: mapping.standardizedRole?.roleName ?? mapping.mappedRoleName,
              normalizedRoleStatus: "APPROVED",
              standardizedRoleId: mapping.standardizedRoleId ?? undefined
            }
          });
        }
      }
    } catch (err) {
      console.warn(`[dataIntegrity] Role re-propagation failed for ${staffId}:`, err instanceof Error ? err.message : err);
    }
  }

  // Mark original issue as resolved
  if (issueId) {
    await prisma.dataQualityIssue
      .update({
        where: { id: issueId },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: runBy }
      })
      .catch(() => {});
  }

  // Revalidate this employee
  let revalidated = 0;
  try {
    const result = await runDataQualityChecks([staffId], runBy);
    revalidated = result.detected;
  } catch { /* non-fatal */ }

  await logSystemAction(
    "CORRECTION_APPLIED",
    runBy,
    1,
    "SUCCESS",
    `Correction applied to staff ${staffId}. ${revalidated} issue(s) revalidated.`
  );

  return {
    success: true,
    message: `Corrections applied. ${revalidated} issue(s) revalidated.`,
    revalidated
  };
}

// ── Rebuild employee working data ─────────────────────────────────────────────

export async function rebuildEmployeeWorkingData(
  staffId: string,
  runBy: string
): Promise<{ success: boolean; message: string }> {
  try {
    await refreshWorkingDataForEmployees([staffId]);
    const result = await runDataQualityChecks([staffId], runBy);
    await logSystemAction(
      "WORKING_DATA_REBUILD",
      runBy,
      1,
      "SUCCESS",
      `Working data rebuilt for staff ${staffId}. ${result.detected} issue(s) revalidated.`
    );
    return { success: true, message: `Working data rebuilt. ${result.detected} issue(s) revalidated.` };
  } catch (err) {
    await logSystemAction("WORKING_DATA_REBUILD", runBy, 0, "FAILED",
      `Failed to rebuild working data for ${staffId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return { success: false, message: "Failed to rebuild working data." };
  }
}

// ── Close open cases ──────────────────────────────────────────────────────────

export async function closeCasesForEmployee(
  staffId: string,
  runBy: string
): Promise<{ success: boolean; message: string; casesUpdated: number }> {
  try {
    const updated = await prisma.appraisalCase.updateMany({
      where: {
        staffId,
        isRemoved: false,
        status: { notIn: ["REMOVED_FROM_SCOPE", "PAYROLL_PROCESSED", "LOCKED"] }
      },
      data: { status: "REMOVED_FROM_SCOPE", isRemoved: true }
    });
    const result = await runDataQualityChecks([staffId], runBy);
    await logSystemAction(
      "CASE_CLOSED",
      runBy,
      updated.count,
      "SUCCESS",
      `${updated.count} case(s) closed for staff ${staffId}. ${result.detected} issue(s) revalidated.`
    );
    return { success: true, message: `${updated.count} case(s) closed.`, casesUpdated: updated.count };
  } catch (err) {
    return { success: false, message: "Failed to close cases.", casesUpdated: 0 };
  }
}
