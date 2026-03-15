import { PrismaClient, RoleMatchSource } from "@prisma/client";

const prisma = new PrismaClient();
const API_BASE = "http://localhost:3001";
const ADMIN_EMAIL = "uly@vaplatinum.com.au";

const OPEN_CASE_EXCLUDED_STATUSES = ["REMOVED_FROM_SCOPE", "PAYROLL_PROCESSED", "LOCKED"];

const normalizeKey = (value) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const tenureBandFromMonths = (months) => {
  if (months == null || Number.isNaN(months) || months < 0) return null;
  if (months < 12) return "T1";
  if (months < 24) return "T2";
  if (months < 48) return "T3";
  return "T4";
};

async function loginAdmin() {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Admin login failed (${response.status}): ${body}`);
  }

  const body = await response.json();
  if (!body?.token) {
    throw new Error("Admin login did not return token");
  }

  return body.token;
}

async function approveRoleMapping(token, payload) {
  const response = await fetch(`${API_BASE}/role-library/approve?viewerRole=ADMIN`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: body?.error || body?.message || "Unknown error"
    };
  }

  return {
    ok: true,
    propagation: body?.propagation ?? null,
    data: body?.data ?? null
  };
}

async function runDataQuality(token) {
  const response = await fetch(`${API_BASE}/admin/data-quality/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Data quality run failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body?.data?.detected ?? null;
}

async function loadState() {
  const [approvedMappings, openCases, workingDataRows, matrixRows, employees] = await Promise.all([
    prisma.roleAlignmentMapping.findMany({
      where: { matchSource: RoleMatchSource.ADMIN_CONFIRMED },
      select: {
        sourceRoleName: true,
        mappedRoleName: true,
        standardizedRoleId: true,
        standardizedRole: { select: { roleName: true } }
      }
    }),
    prisma.appraisalCase.findMany({
      where: {
        isRemoved: false,
        status: { notIn: OPEN_CASE_EXCLUDED_STATUSES }
      },
      select: {
        id: true,
        staffId: true,
        staffRole: true,
        status: true
      }
    }),
    prisma.employeeWorkingData.findMany({
      select: {
        staffId: true,
        hubspotRole: true,
        normalizedRole: true,
        normalizedRoleStatus: true,
        standardizedRoleId: true,
        tenureMonths: true,
        marketMatrixStatus: true,
        updatedAt: true
      }
    }),
    prisma.marketValueMatrix.findMany({
      select: { roleName: true, tenureBand: true, standardizedRoleId: true }
    }),
    prisma.employeeDirectory.findMany({
      select: { staffId: true, staffRole: true }
    })
  ]);

  const wdByStaffId = new Map(workingDataRows.map((row) => [row.staffId, row]));
  const employeeByStaffId = new Map(employees.map((row) => [row.staffId, row]));

  const exactAdminMappingByLower = new Map();
  const normalizedAdminMappingByKey = new Map();

  for (const mapping of approvedMappings) {
    const lower = mapping.sourceRoleName.trim().toLowerCase();
    exactAdminMappingByLower.set(lower, mapping);

    const normalizedKey = normalizeKey(mapping.sourceRoleName);
    const arr = normalizedAdminMappingByKey.get(normalizedKey) ?? [];
    arr.push(mapping);
    normalizedAdminMappingByKey.set(normalizedKey, arr);
  }

  const matrixByRoleBand = new Set();
  const matrixByStdBand = new Set();
  for (const row of matrixRows) {
    matrixByRoleBand.add(`${normalizeKey(row.roleName)}|${row.tenureBand}`);
    if (row.standardizedRoleId) {
      matrixByStdBand.add(`${row.standardizedRoleId}|${row.tenureBand}`);
    }
  }

  const unresolved = [];

  for (const openCase of openCases) {
    const wd = wdByStaffId.get(openCase.staffId) ?? null;
    const rawRole = (wd?.hubspotRole ?? openCase.staffRole ?? "").trim();
    if (!rawRole) continue;

    const exact = exactAdminMappingByLower.get(rawRole.toLowerCase()) ?? null;
    const normalizedCandidates = normalizedAdminMappingByKey.get(normalizeKey(rawRole)) ?? [];

    const expectedMapping = exact ?? (normalizedCandidates.length === 1 ? normalizedCandidates[0] : null);
    if (!expectedMapping) continue;

    const normalizedRole = wd?.normalizedRole?.trim() ?? "";
    if (normalizedRole) continue;

    unresolved.push({
      caseId: openCase.id,
      staffId: openCase.staffId,
      rawRole,
      caseStatus: openCase.status,
      expectedMapping,
      hasExactMapping: Boolean(exact),
      normalizedCandidatesCount: normalizedCandidates.length,
      hasWorkingData: Boolean(wd),
      wdMarketMatrixStatus: wd?.marketMatrixStatus ?? null,
      employeeRole: employeeByStaffId.get(openCase.staffId)?.staffRole ?? null
    });
  }

  return {
    approvedMappings,
    openCases,
    wdByStaffId,
    matrixByRoleBand,
    matrixByStdBand,
    unresolved
  };
}

function groupRemainingFailures(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const expectedNormalizedRole = row.expectedMapping.standardizedRole?.roleName ?? row.expectedMapping.mappedRoleName ?? null;

    let reason = "stale working data row";
    if (!row.hasWorkingData) {
      reason = "missing working data record";
    } else if (!row.hasExactMapping && row.normalizedCandidatesCount > 0) {
      reason = "raw role text mismatch + no exact approved mapping key";
    } else if (!row.hasExactMapping) {
      reason = "no exact approved mapping key";
    } else if (row.attemptedAction && !row.attemptedAction.ok) {
      reason = "propagation write failure";
    } else if (row.attemptedAction && row.attemptedAction.ok) {
      reason = "propagation write failure";
    }

    const key = `${row.rawRole}|||${expectedNormalizedRole ?? "(unknown)"}|||${reason}`;
    const existing = grouped.get(key) ?? {
      rawHubspotRole: row.rawRole,
      normalizedRoleExpected: expectedNormalizedRole,
      employeeCount: 0,
      caseCount: 0,
      reason,
      issueType: "logic"
    };

    existing.caseCount += 1;
    existing.employeeCount += 1;

    if (
      reason.includes("mismatch") ||
      reason.includes("no exact") ||
      reason.includes("missing") ||
      reason.includes("benchmark")
    ) {
      existing.issueType = "data";
    } else {
      existing.issueType = "logic";
    }

    grouped.set(key, existing);
  }

  return [...grouped.values()].sort((a, b) => b.caseCount - a.caseCount || b.employeeCount - a.employeeCount);
}

function buildValidationSummary({ approvedMappings, openCases, wdByStaffId, matrixByRoleBand, matrixByStdBand }) {
  const approvedRoleKeys = new Set(approvedMappings.map((m) => normalizeKey(m.sourceRoleName)));

  let openCasesWithAdminApprovedMapping = 0;
  let normalizedRolePopulated = 0;
  let normalizedRoleMissing = 0;
  let falseRoleNotMappedStates = 0;
  let matrixApplicableCases = 0;
  let matrixStatusCorrect = 0;
  let matrixStatusIncorrect = 0;

  for (const openCase of openCases) {
    const wd = wdByStaffId.get(openCase.staffId) ?? null;
    const rawRole = (wd?.hubspotRole ?? openCase.staffRole ?? "").trim();
    if (!approvedRoleKeys.has(normalizeKey(rawRole))) continue;

    openCasesWithAdminApprovedMapping += 1;

    const normalizedRole = wd?.normalizedRole?.trim() ?? "";
    const matrixStatus = (wd?.marketMatrixStatus ?? "").toUpperCase();

    if (normalizedRole) normalizedRolePopulated += 1;
    else normalizedRoleMissing += 1;

    if (normalizedRole && matrixStatus === "MISSING_ROLE") {
      falseRoleNotMappedStates += 1;
    }

    const tenureBand = tenureBandFromMonths(wd?.tenureMonths ?? null);
    if (!normalizedRole || !tenureBand) continue;

    const hasMatrix =
      (wd?.standardizedRoleId ? matrixByStdBand.has(`${wd.standardizedRoleId}|${tenureBand}`) : false) ||
      matrixByRoleBand.has(`${normalizeKey(normalizedRole)}|${tenureBand}`);

    if (!hasMatrix) continue;

    matrixApplicableCases += 1;
    if (matrixStatus === "READY" || matrixStatus === "MISSING_COMP") {
      matrixStatusCorrect += 1;
    } else {
      matrixStatusIncorrect += 1;
    }
  }

  return {
    openCasesWithAdminApprovedMapping,
    normalizedRolePopulated,
    normalizedRoleMissing,
    falseRoleNotMappedStates,
    matrixApplicableCases,
    matrixStatusCorrect,
    matrixStatusIncorrect
  };
}

async function fetchPropagationIssueCounts() {
  const [approvedRoleNotPropagatedOpen, approvedRoleMissingNormalizedOpen] = await Promise.all([
    prisma.dataQualityIssue.count({
      where: {
        issueType: "APPROVED_ROLE_NOT_PROPAGATED",
        status: { in: ["OPEN", "NEEDS_ADMIN_REVIEW"] }
      }
    }),
    prisma.dataQualityIssue.count({
      where: {
        issueType: "APPROVED_ROLE_MISSING_NORMALIZED_ROLE",
        status: { in: ["OPEN", "NEEDS_ADMIN_REVIEW"] }
      }
    })
  ]);

  return {
    approvedRoleNotPropagatedOpen,
    approvedRoleMissingNormalizedOpen
  };
}

async function main() {
  const token = await loginAdmin();

  const beforeState = await loadState();
  const unresolvedBefore = beforeState.unresolved;

  const roleActionPlan = new Map();
  for (const row of unresolvedBefore) {
    const expected = row.expectedMapping;
    const key = row.rawRole.toLowerCase();
    if (roleActionPlan.has(key)) continue;

    roleActionPlan.set(key, {
      sourceRoleName: row.rawRole,
      standardizedRoleId: expected.standardizedRoleId ?? undefined,
      standardizedRoleName: expected.standardizedRole?.roleName ?? expected.mappedRoleName,
      actionType: row.hasExactMapping ? "retry_exact_approved_mapping" : "create_exact_alias_for_mismatch"
    });
  }

  let totalCasesRefreshedInPass = 0;
  let totalRecordsRepairedInPass = 0;
  const roleActions = [];

  for (const action of roleActionPlan.values()) {
    const payload = {
      sourceRoleName: action.sourceRoleName,
      ...(action.standardizedRoleId ? { standardizedRoleId: action.standardizedRoleId } : {}),
      standardizedRoleName: action.standardizedRoleName,
      allowCreateRole: false
    };

    const result = await approveRoleMapping(token, payload);
    const refreshed = result?.propagation?.openCasesUpdated ?? 0;

    totalCasesRefreshedInPass += refreshed;
    if (result?.ok) {
      totalRecordsRepairedInPass += result?.propagation?.workingDataSaved ?? 0;
    }

    roleActions.push({
      ...action,
      ok: result.ok,
      propagation: result.propagation ?? null,
      error: result.ok ? null : result.error
    });
  }

  const dqDetected = await runDataQuality(token);

  const afterState = await loadState();
  const unresolvedAfterBase = afterState.unresolved;

  const attemptedByRawRole = new Map(roleActions.map((a) => [a.sourceRoleName.toLowerCase(), a]));
  const unresolvedAfter = unresolvedAfterBase.map((row) => ({
    ...row,
    attemptedAction: attemptedByRawRole.get(row.rawRole.toLowerCase()) ?? null
  }));

  const remainingBreakdown = groupRemainingFailures(unresolvedAfter);
  const validation = buildValidationSummary(afterState);
  const propagationIssueCounts = await fetchPropagationIssueCounts();

  const output = {
    targetedPass: {
      unresolvedBeforeCount: unresolvedBefore.length,
      unresolvedAfterCount: unresolvedAfter.length,
      totalRecordsRepairedInPass,
      totalCasesRefreshedInPass,
      roleActionsAttempted: roleActions.length,
      roleActionsFailed: roleActions.filter((a) => !a.ok).length,
      dataQualityDetectedOnRerun: dqDetected
    },
    validation,
    propagationIssueCounts,
    remainingFailureBreakdown: remainingBreakdown,
    roleActions
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
