import { PrismaClient, TenureBandLabel } from "@prisma/client";
import { getLatestWsllEligibilityByStaffIds } from "./wsllEligibilityService";

const prisma = new PrismaClient();

export type WsllStatus = "WITH_WSLL" | "NO_WSLL";
export type WsllReason = "PASS" | "NO_DATA" | "BELOW_THRESHOLD";
export type TenureGroup = "TENURED" | "LESS_THAN_12_MONTHS";
export type MarketPosition = "BELOW_MARKET" | "AT_OR_ABOVE_MARKET";
export type AppraisalCategory = `${WsllStatus} - ${TenureGroup} - ${MarketPosition}`;

export type AppraisalClassification = {
  caseId: string;
  staffId: string;
  wsllStatus: WsllStatus;
  wsllReason: WsllReason;
  wsllAverage: number | null;
  tenureMonths: number | null;
  tenureGroup: TenureGroup;
  marketPosition: MarketPosition;
  benchmarkReference: number | null;
  currentSalary: number | null;
  rmApprovalRequired: boolean;
  appraisalCategory: AppraisalCategory;
};

const normalize = (value: string | null | undefined): string => (value ?? "").trim();
const normalizeLower = (value: string | null | undefined): string => normalize(value).toLowerCase();

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const resolveTenureMonths = (startDate: Date | null): number | null => {
  if (!startDate) {
    return null;
  }

  const now = new Date();
  const years = now.getUTCFullYear() - startDate.getUTCFullYear();
  const months = now.getUTCMonth() - startDate.getUTCMonth();
  const total = years * 12 + months;

  return Number.isFinite(total) && total >= 0 ? total : null;
};

const resolveTenureBand = (tenureMonths: number | null): TenureBandLabel | null => {
  if (tenureMonths === null) {
    return null;
  }

  if (tenureMonths < 12) {
    return TenureBandLabel.T1;
  }

  if (tenureMonths < 24) {
    return TenureBandLabel.T2;
  }

  if (tenureMonths < 48) {
    return TenureBandLabel.T3;
  }

  return TenureBandLabel.T4;
};

const toWsllReason = (status: "PASS" | "MISSING_WSLL" | "WSLL_BELOW_THRESHOLD"): WsllReason => {
  if (status === "PASS") {
    return "PASS";
  }

  if (status === "WSLL_BELOW_THRESHOLD") {
    return "BELOW_THRESHOLD";
  }

  return "NO_DATA";
};

const toWsllStatus = (reason: WsllReason): WsllStatus => (reason === "PASS" ? "WITH_WSLL" : "NO_WSLL");

const toTenureGroup = (tenureMonths: number | null): TenureGroup =>
  tenureMonths !== null && tenureMonths >= 12 ? "TENURED" : "LESS_THAN_12_MONTHS";

const toCategory = (
  wsllStatus: WsllStatus,
  tenureGroup: TenureGroup,
  marketPosition: MarketPosition
): AppraisalCategory => `${wsllStatus} - ${tenureGroup} - ${marketPosition}`;

const buildRoleMappingQueries = (roles: string[]) => {
  const normalizedRoles = unique(roles.map((role) => normalizeLower(role)));
  return normalizedRoles.map((role) => ({
    sourceRoleName: {
      equals: role,
      mode: "insensitive" as const
    }
  }));
};

const toMidpoint = (minSalary: { toNumber(): number }, maxSalary: { toNumber(): number }): number =>
  Number(((minSalary.toNumber() + maxSalary.toNumber()) / 2).toFixed(2));

export async function getAppraisalClassificationForCases(caseIds: string[]): Promise<Map<string, AppraisalClassification>> {
  const uniqueCaseIds = unique(caseIds);
  const result = new Map<string, AppraisalClassification>();

  if (uniqueCaseIds.length === 0) {
    return result;
  }

  const cases = await prisma.appraisalCase.findMany({
    where: {
      id: {
        in: uniqueCaseIds
      }
    },
    select: {
      id: true,
      staffId: true,
      staffRole: true,
      startDate: true,
      tenureMonths: true
    }
  });

  if (cases.length === 0) {
    return result;
  }

  const staffIds = unique(cases.map((caseItem) => caseItem.staffId));
  const [wsllMap, compensationRows] = await Promise.all([
    getLatestWsllEligibilityByStaffIds(staffIds),
    prisma.currentCompensation.findMany({
      where: {
        staffId: {
          in: staffIds
        }
      },
      select: {
        staffId: true,
        currentCompensation: true
      }
    })
  ]);

  const compensationByStaffId = new Map(
    compensationRows.map((row) => [row.staffId, Number(row.currentCompensation)])
  );

  const roleQueries = buildRoleMappingQueries(cases.map((caseItem) => caseItem.staffRole));
  const roleMappings = roleQueries.length
    ? await prisma.roleAlignmentMapping.findMany({
        where: {
          OR: roleQueries
        },
        include: {
          standardizedRole: true
        }
      })
    : [];

  const roleMappingByRawRole = new Map<string, (typeof roleMappings)[number]>();
  for (const mapping of roleMappings) {
    const key = normalizeLower(mapping.sourceRoleName);
    if (!roleMappingByRawRole.has(key)) {
      roleMappingByRawRole.set(key, mapping);
    }
  }

  const matrixNeeds = cases.map((caseItem) => {
    const roleKey = normalizeLower(caseItem.staffRole);
    const mapping = roleMappingByRawRole.get(roleKey);
    const tenureMonths = caseItem.tenureMonths ?? resolveTenureMonths(caseItem.startDate);
    const tenureBand = resolveTenureBand(tenureMonths);

    return {
      caseId: caseItem.id,
      roleKey,
      mapping,
      tenureBand,
      standardizedRoleId: mapping?.standardizedRoleId ?? null,
      standardizedRoleName: mapping?.standardizedRole?.roleName ?? mapping?.mappedRoleName ?? null
    };
  });

  const matrixRoleIds = unique(matrixNeeds.map((item) => item.standardizedRoleId || "")).filter(Boolean);
  const matrixRoleNames = unique(matrixNeeds.map((item) => item.standardizedRoleName || "")).filter(Boolean);
  const matrixBands = unique(matrixNeeds.map((item) => item.tenureBand || "")).filter(Boolean) as TenureBandLabel[];

  const matrixWhereOr = [
    ...(matrixRoleIds.length > 0
      ? [
          {
            standardizedRoleId: {
              in: matrixRoleIds
            }
          }
        ]
      : []),
    ...matrixRoleNames.map((roleName) => ({
      roleName: {
        equals: roleName,
        mode: "insensitive" as const
      }
    }))
  ];

  const matrixRows = matrixBands.length > 0 && matrixWhereOr.length > 0
    ? await prisma.marketValueMatrix.findMany({
        where: {
          tenureBand: {
            in: matrixBands
          },
          OR: matrixWhereOr
        }
      })
    : [];

  const matrixByKey = new Map<string, (typeof matrixRows)[number]>();
  for (const row of matrixRows) {
    const keyByRoleId = row.standardizedRoleId ? `${row.tenureBand}|roleId:${row.standardizedRoleId}` : null;
    if (keyByRoleId && !matrixByKey.has(keyByRoleId)) {
      matrixByKey.set(keyByRoleId, row);
    }

    const keyByRoleName = `${row.tenureBand}|roleName:${normalizeLower(row.roleName)}`;
    if (!matrixByKey.has(keyByRoleName)) {
      matrixByKey.set(keyByRoleName, row);
    }
  }

  for (const caseItem of cases) {
    const wsll = wsllMap.get(caseItem.staffId) ?? {
      status: "MISSING_WSLL" as const,
      averageWsll: null,
      isEligibleForAppraisal: false,
      blockerMessage: null
    };

    const wsllReason = toWsllReason(wsll.status);
    const wsllStatus = toWsllStatus(wsllReason);
    const tenureMonths = caseItem.tenureMonths ?? resolveTenureMonths(caseItem.startDate);
    const tenureGroup = toTenureGroup(tenureMonths);

    const roleKey = normalizeLower(caseItem.staffRole);
    const mapping = roleMappingByRawRole.get(roleKey);
    const tenureBand = resolveTenureBand(tenureMonths);

    let matrixRow: (typeof matrixRows)[number] | undefined;
    if (tenureBand && mapping?.standardizedRoleId) {
      matrixRow = matrixByKey.get(`${tenureBand}|roleId:${mapping.standardizedRoleId}`);
    }

    if (!matrixRow && tenureBand) {
      const mappedRoleName = mapping?.standardizedRole?.roleName ?? mapping?.mappedRoleName ?? null;
      if (mappedRoleName) {
        matrixRow = matrixByKey.get(`${tenureBand}|roleName:${normalizeLower(mappedRoleName)}`);
      }
    }

    const benchmarkReference = matrixRow ? toMidpoint(matrixRow.minSalary, matrixRow.maxSalary) : null;
    const currentSalary = compensationByStaffId.get(caseItem.staffId) ?? null;

    const marketPosition: MarketPosition =
      benchmarkReference !== null && currentSalary !== null && currentSalary < benchmarkReference
        ? "BELOW_MARKET"
        : "AT_OR_ABOVE_MARKET";

    const rmApprovalRequired = wsllStatus === "NO_WSLL";
    const appraisalCategory = toCategory(wsllStatus, tenureGroup, marketPosition);

    result.set(caseItem.id, {
      caseId: caseItem.id,
      staffId: caseItem.staffId,
      wsllStatus,
      wsllReason,
      wsllAverage: wsll.averageWsll,
      tenureMonths,
      tenureGroup,
      marketPosition,
      benchmarkReference,
      currentSalary,
      rmApprovalRequired,
      appraisalCategory
    });
  }

  return result;
}

export async function getAppraisalClassificationForCase(caseId: string): Promise<AppraisalClassification | null> {
  const map = await getAppraisalClassificationForCases([caseId]);
  return map.get(caseId) ?? null;
}

export async function getAppraisalCategoryBreakdownForCases(caseIds: string[]): Promise<Record<string, number>> {
  const classifications = await getAppraisalClassificationForCases(caseIds);
  const counts: Record<string, number> = {};

  for (const classification of classifications.values()) {
    counts[classification.appraisalCategory] = (counts[classification.appraisalCategory] ?? 0) + 1;
  }

  return counts;
}
