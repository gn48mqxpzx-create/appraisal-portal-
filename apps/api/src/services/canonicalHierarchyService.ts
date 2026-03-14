import {
  CanonicalHierarchyRole,
  HierarchyMappingSource,
  HierarchyScopeType,
  PrismaClient
} from "@prisma/client";
import { resolveViewerByEmail } from "./viewerResolutionService";
import { fetchHubSpotOwners } from "./hubspotClient";

type DirectoryEmployeeRecord = {
  staffId: string;
  fullName: string;
  email: string;
  employeeType: string;
  staffRole: string;
  contactType: string;
  smName: string | null;
  smOwnerId: string | null;
  rmName: string | null;
};

export type CanonicalHierarchyDiagnostics = {
  matchedEmployeeRecord: {
    staffId: string;
    fullName: string;
    email: string;
    employeeType: string;
    staffRole: string;
  } | null;
  attemptedManagerFields: string[];
  candidateSmEmails: string[];
  candidateVaStaffIds: string[];
  conflictNotes: string[];
  unresolvedHierarchyReason: string | null;
};

export type CanonicalHierarchyMapping = {
  userEmail: string;
  userName: string | null;
  canonicalRole: CanonicalHierarchyRole;
  managerEmail: string | null;
  managerName: string | null;
  staffId: string | null;
  mappedSmEmails: string[];
  mappedSmNames: string[];
  mappedRmEmail: string | null;
  mappedRmName: string | null;
  scopedStaffIds: string[];
  scopeType: HierarchyScopeType;
  source: HierarchyMappingSource;
  unresolvedHierarchyReason: string | null;
  diagnostics: CanonicalHierarchyDiagnostics;
  isActive: boolean;
  updatedAt: Date;
};

export type CanonicalHierarchyValidationRow = {
  userEmail: string;
  userName: string | null;
  canonicalRole: "SUCCESS_MANAGER" | "RELATIONSHIP_MANAGER";
  resolvedScopeCount: number;
  smCountInScope: number;
  vaCountInScope: number;
  dashboardScopeCount: number;
  casesScopeCount: number;
  wsllScopeCount: number;
  reviewQueueScopeCount: number;
  scopeConsistentAcrossModules: boolean;
  unresolvedHierarchyReason: string | null;
};

export type CanonicalHierarchyValidationReport = {
  generatedAt: string;
  totalManagers: number;
  totalSm: number;
  totalRm: number;
  totalUnresolved: number;
  rows: CanonicalHierarchyValidationRow[];
};

const prisma = new PrismaClient();
const CACHE_TTL_MS = 15 * 60 * 1000;

const normalize = (value: string | null | undefined): string => (value ?? "").trim();
const normalizeLower = (value: string | null | undefined): string => normalize(value).toLowerCase();
const buildOwnerName = (owner: { firstName?: string | null; lastName?: string | null }): string =>
  [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();

const toUnique = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => normalize(value)).filter(Boolean))];

const toUniqueLower = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => normalizeLower(value)).filter(Boolean))];

const isActiveDirectoryContact = (record: Pick<DirectoryEmployeeRecord, "contactType">): boolean =>
  !record.contactType.toLowerCase().includes("separated");

const normalizeRoleToCanonical = (role: string): CanonicalHierarchyRole => {
  const normalized = normalize(role).toUpperCase();

  if (normalized === "ADMIN" || normalized === "SITE_LEAD") {
    return CanonicalHierarchyRole.SITE_LEAD;
  }

  if (normalized === "SM" || normalized === "SUCCESS_MANAGER") {
    return CanonicalHierarchyRole.SUCCESS_MANAGER;
  }

  if (normalized === "RM" || normalized === "RELATIONSHIP_MANAGER") {
    return CanonicalHierarchyRole.RELATIONSHIP_MANAGER;
  }

  if (normalized === "REVIEWER") {
    return CanonicalHierarchyRole.REVIEWER;
  }

  return CanonicalHierarchyRole.UNSCOPED;
};

const mapRecord = (record: {
  staffId: string;
  fullName: string;
  email: string;
  employeeType: string;
  staffRole: string;
  contactType: string;
  smName: string | null;
  smOwnerId: string | null;
  rmName: string | null;
}): DirectoryEmployeeRecord => ({
  staffId: record.staffId,
  fullName: record.fullName,
  email: record.email,
  employeeType: record.employeeType,
  staffRole: record.staffRole,
  contactType: record.contactType,
  smName: record.smName,
  smOwnerId: record.smOwnerId,
  rmName: record.rmName
});

const getDirectoryRecords = async (): Promise<DirectoryEmployeeRecord[]> => {
  const rows = await prisma.employeeDirectory.findMany({
    select: {
      staffId: true,
      fullName: true,
      email: true,
      employeeType: true,
      staffRole: true,
      contactType: true,
      smName: true,
      smOwnerId: true,
      rmName: true
    }
  });

  return rows.map(mapRecord);
};

const getSmCandidatesForRm = (
  rmIdentifiers: string[],
  smRecords: DirectoryEmployeeRecord[]
): DirectoryEmployeeRecord[] => {
  if (rmIdentifiers.length === 0) {
    return [];
  }

  const rmIdentifierSet = new Set(rmIdentifiers);

  return smRecords.filter((record) => {
    const fields = toUniqueLower([record.rmName, record.smName]);
    return fields.some((field) => rmIdentifierSet.has(field));
  });
};

const getVaCandidatesForSm = (
  smIdentifiers: string[],
  vaRecords: DirectoryEmployeeRecord[]
): DirectoryEmployeeRecord[] => {
  if (smIdentifiers.length === 0) {
    return [];
  }

  const smIdentifierSet = new Set(smIdentifiers);

  return vaRecords.filter((record) => {
    const fields = toUniqueLower([record.smName]);
    return fields.some((field) => smIdentifierSet.has(field));
  });
};

const getVaCandidatesForRm = (
  smIdentifiers: string[],
  rmIdentifiers: string[],
  vaRecords: DirectoryEmployeeRecord[]
): DirectoryEmployeeRecord[] => {
  const smIdentifierSet = new Set(smIdentifiers);
  const rmIdentifierSet = new Set(rmIdentifiers);

  return vaRecords.filter((record) => {
    const smFields = toUniqueLower([record.smName]);
    const rmFields = toUniqueLower([record.rmName]);

    return smFields.some((field) => smIdentifierSet.has(field)) || rmFields.some((field) => rmIdentifierSet.has(field));
  });
};

const getFallbackCaseStaffIds = async (input: {
  smIdentifiers?: string[];
  rmIdentifiers?: string[];
}): Promise<string[]> => {
  const smIdentifiers = input.smIdentifiers ?? [];
  const rmIdentifiers = input.rmIdentifiers ?? [];

  if (smIdentifiers.length === 0 && rmIdentifiers.length === 0) {
    return [];
  }

  const whereOr = [
    ...smIdentifiers.map((value) => ({ successManagerStaffId: { equals: value, mode: "insensitive" as const } })),
    ...rmIdentifiers.map((value) => ({ relationshipManagerStaffId: { equals: value, mode: "insensitive" as const } }))
  ];

  if (whereOr.length === 0) {
    return [];
  }

  const rows = await prisma.appraisalCase.findMany({
    where: {
      OR: whereOr,
      isRemoved: false
    },
    select: {
      staffId: true
    }
  });

  return toUnique(rows.map((row) => row.staffId));
};

const resolveManagerEmailByName = (
  managerName: string | null,
  rmRecords: DirectoryEmployeeRecord[],
  conflictNotes: string[]
): string | null => {
  const normalizedManagerName = normalizeLower(managerName);
  if (!normalizedManagerName) {
    return null;
  }

  const matches = rmRecords.filter((record) => normalizeLower(record.fullName) === normalizedManagerName);
  if (matches.length === 1) {
    return matches[0].email;
  }

  if (matches.length > 1) {
    conflictNotes.push(`Multiple RM records share full name: ${managerName}`);
    return matches[0].email;
  }

  return null;
};

const buildUnresolvedReason = (
  role: CanonicalHierarchyRole,
  vaCount: number,
  matchedEmployee: DirectoryEmployeeRecord | null
): string | null => {
  if (role === CanonicalHierarchyRole.SUCCESS_MANAGER && vaCount === 0) {
    return matchedEmployee ? "SM_HAS_NO_RESOLVED_VA_SCOPE" : "SM_EMPLOYEE_RECORD_NOT_FOUND";
  }

  if (role === CanonicalHierarchyRole.RELATIONSHIP_MANAGER && vaCount === 0) {
    return matchedEmployee ? "RM_HAS_NO_RESOLVED_VA_SCOPE" : "RM_EMPLOYEE_RECORD_NOT_FOUND";
  }

  return null;
};

const rowToMapping = (row: {
  userEmail: string;
  userName: string | null;
  canonicalRole: CanonicalHierarchyRole;
  managerEmail: string | null;
  managerName: string | null;
  staffId: string | null;
  mappedSmEmails: string[];
  mappedSmNames: string[];
  mappedRmEmail: string | null;
  mappedRmName: string | null;
  scopedStaffIds: string[];
  scopeType: HierarchyScopeType;
  source: HierarchyMappingSource;
  unresolvedHierarchyReason: string | null;
  diagnostics: unknown;
  isActive: boolean;
  updatedAt: Date;
}): CanonicalHierarchyMapping => ({
  userEmail: row.userEmail,
  userName: row.userName,
  canonicalRole: row.canonicalRole,
  managerEmail: row.managerEmail,
  managerName: row.managerName,
  staffId: row.staffId,
  mappedSmEmails: row.mappedSmEmails,
  mappedSmNames: row.mappedSmNames,
  mappedRmEmail: row.mappedRmEmail,
  mappedRmName: row.mappedRmName,
  scopedStaffIds: row.scopedStaffIds,
  scopeType: row.scopeType,
  source: row.source,
  unresolvedHierarchyReason: row.unresolvedHierarchyReason,
  diagnostics: (row.diagnostics as CanonicalHierarchyDiagnostics) ?? {
    matchedEmployeeRecord: null,
    attemptedManagerFields: [],
    candidateSmEmails: [],
    candidateVaStaffIds: [],
    conflictNotes: [],
    unresolvedHierarchyReason: row.unresolvedHierarchyReason ?? null
  },
  isActive: row.isActive,
  updatedAt: row.updatedAt
});

const buildDerivedMapping = async (email: string): Promise<Omit<CanonicalHierarchyMapping, "updatedAt">> => {
  const normalizedEmail = normalizeLower(email);
  const resolvedViewer = await resolveViewerByEmail(normalizedEmail);
  const canonicalRole = normalizeRoleToCanonical(resolvedViewer.scopedRole);
  const allDirectory = await getDirectoryRecords();
  const activeDirectory = allDirectory.filter(isActiveDirectoryContact);
  const vaRecords = activeDirectory.filter((record) => normalize(record.employeeType).toUpperCase() === "VA");
  const smRecords = activeDirectory.filter((record) => normalize(record.employeeType).toUpperCase() === "SM");
  const rmRecords = activeDirectory.filter(
    (record) =>
      normalize(record.employeeType).toUpperCase() === "RM" ||
      normalize(record.staffRole).toUpperCase() === "RELATIONSHIP MANAGER"
  );

  const matchedEmployee =
    resolvedViewer.employeeRecord
      ? mapRecord(resolvedViewer.employeeRecord)
      : activeDirectory.find((record) => normalizeLower(record.email) === normalizedEmail) ?? null;

  const conflictNotes: string[] = [];
  let mappedSmEmails: string[] = [];
  let mappedSmNames: string[] = [];
  let scopedStaffIds: string[] = [];
  let managerName: string | null = null;
  let managerEmail: string | null = null;
  let mappedRmName: string | null = null;
  let mappedRmEmail: string | null = null;
  let scopeType: HierarchyScopeType = HierarchyScopeType.DIRECT;

  if (canonicalRole === CanonicalHierarchyRole.SUCCESS_MANAGER) {
    const smRecord =
      matchedEmployee && normalize(matchedEmployee.employeeType).toUpperCase() === "SM"
        ? matchedEmployee
        : smRecords.find((record) => normalizeLower(record.email) === normalizedEmail) ?? null;

    if (smRecord) {
      const smIdentifiers = toUniqueLower([
        smRecord.staffId,
        smRecord.fullName,
        smRecord.email,
        smRecord.smOwnerId,
        smRecord.smName
      ]);

      const vaMatches = getVaCandidatesForSm(smIdentifiers, vaRecords);
      const vaStaffIds = toUnique(vaMatches.map((record) => record.staffId));
      const fallbackCaseStaffIds = vaStaffIds.length === 0 ? await getFallbackCaseStaffIds({ smIdentifiers }) : [];

      scopedStaffIds = toUnique([...vaStaffIds, ...fallbackCaseStaffIds]);
      mappedSmEmails = [smRecord.email];
      mappedSmNames = [smRecord.fullName];
      mappedRmName = normalize(smRecord.rmName) || null;
      mappedRmEmail = resolveManagerEmailByName(mappedRmName, rmRecords, conflictNotes);
      managerName = mappedRmName;
      managerEmail = mappedRmEmail;

      if (fallbackCaseStaffIds.length > 0) {
        scopeType = HierarchyScopeType.HYBRID;
      }
    }
  }

  if (canonicalRole === CanonicalHierarchyRole.RELATIONSHIP_MANAGER) {
    const rmIdentifiers = toUniqueLower([
      resolvedViewer.normalizedEmail,
      resolvedViewer.fullName,
      resolvedViewer.employeeRecord?.staffId,
      resolvedViewer.employeeRecord?.rmName,
      resolvedViewer.rmOwner?.id,
      resolvedViewer.rmOwner?.email,
      resolvedViewer.rmOwner?.fullName
    ]);

    const rmSmRecords = getSmCandidatesForRm(rmIdentifiers, smRecords);
    const smIdentifiers = toUniqueLower(
      rmSmRecords.flatMap((record) => [record.staffId, record.fullName, record.email, record.smOwnerId, record.smName])
    );

    const vaMatches = getVaCandidatesForRm(smIdentifiers, rmIdentifiers, vaRecords);
    const vaStaffIds = toUnique(vaMatches.map((record) => record.staffId));
    const fallbackCaseStaffIds = vaStaffIds.length === 0 ? await getFallbackCaseStaffIds({ smIdentifiers, rmIdentifiers }) : [];

    mappedSmEmails = toUnique(rmSmRecords.map((record) => record.email));
    mappedSmNames = toUnique(rmSmRecords.map((record) => record.fullName));
    scopedStaffIds = toUnique([...vaStaffIds, ...fallbackCaseStaffIds]);
    mappedRmName = matchedEmployee?.fullName ?? resolvedViewer.rmOwner?.fullName ?? resolvedViewer.fullName;
    mappedRmEmail = normalizedEmail;
    managerName = mappedRmName;
    managerEmail = mappedRmEmail;

    if (fallbackCaseStaffIds.length > 0) {
      scopeType = HierarchyScopeType.HYBRID;
    }
  }

  if (canonicalRole === CanonicalHierarchyRole.SITE_LEAD) {
    const eligibleVas = vaRecords
      .filter((record) => [
        "Staff Member - Active",
        "Staff Member - For Reprofile",
        "Staff Member - HR Floating",
        "Staff Member - Maternity"
      ].includes(record.contactType))
      .map((record) => record.staffId);

    scopedStaffIds = toUnique(eligibleVas);
    scopeType = HierarchyScopeType.DIRECT;
  }

  const unresolvedHierarchyReason = buildUnresolvedReason(canonicalRole, scopedStaffIds.length, matchedEmployee);
  const diagnostics: CanonicalHierarchyDiagnostics = {
    matchedEmployeeRecord: matchedEmployee
      ? {
          staffId: matchedEmployee.staffId,
          fullName: matchedEmployee.fullName,
          email: matchedEmployee.email,
          employeeType: matchedEmployee.employeeType,
          staffRole: matchedEmployee.staffRole
        }
      : null,
    attemptedManagerFields: toUnique([
      matchedEmployee?.smName,
      matchedEmployee?.smOwnerId,
      matchedEmployee?.rmName,
      resolvedViewer.rmOwner?.id,
      resolvedViewer.rmOwner?.fullName,
      resolvedViewer.rmOwner?.email
    ]),
    candidateSmEmails: mappedSmEmails,
    candidateVaStaffIds: scopedStaffIds,
    conflictNotes,
    unresolvedHierarchyReason
  };

  return {
    userEmail: normalizedEmail,
    userName: matchedEmployee?.fullName ?? resolvedViewer.fullName,
    canonicalRole,
    managerEmail,
    managerName,
    staffId: matchedEmployee?.staffId ?? null,
    mappedSmEmails,
    mappedSmNames,
    mappedRmEmail,
    mappedRmName,
    scopedStaffIds,
    scopeType,
    source: HierarchyMappingSource.DIRECTORY_DERIVED,
    unresolvedHierarchyReason,
    diagnostics,
    isActive: true
  };
};

const upsertCanonicalMapping = async (
  mapping: Omit<CanonicalHierarchyMapping, "updatedAt">
): Promise<CanonicalHierarchyMapping> => {
  const saved = await prisma.userScopeMapping.upsert({
    where: {
      userEmail: mapping.userEmail
    },
    update: {
      userName: mapping.userName,
      canonicalRole: mapping.canonicalRole,
      managerEmail: mapping.managerEmail,
      managerName: mapping.managerName,
      staffId: mapping.staffId,
      mappedSmEmails: mapping.mappedSmEmails,
      mappedSmNames: mapping.mappedSmNames,
      mappedRmEmail: mapping.mappedRmEmail,
      mappedRmName: mapping.mappedRmName,
      scopedStaffIds: mapping.scopedStaffIds,
      scopeType: mapping.scopeType,
      source: mapping.source,
      unresolvedHierarchyReason: mapping.unresolvedHierarchyReason,
      diagnostics: mapping.diagnostics,
      isActive: mapping.isActive
    },
    create: {
      userEmail: mapping.userEmail,
      userName: mapping.userName,
      canonicalRole: mapping.canonicalRole,
      managerEmail: mapping.managerEmail,
      managerName: mapping.managerName,
      staffId: mapping.staffId,
      mappedSmEmails: mapping.mappedSmEmails,
      mappedSmNames: mapping.mappedSmNames,
      mappedRmEmail: mapping.mappedRmEmail,
      mappedRmName: mapping.mappedRmName,
      scopedStaffIds: mapping.scopedStaffIds,
      scopeType: mapping.scopeType,
      source: mapping.source,
      unresolvedHierarchyReason: mapping.unresolvedHierarchyReason,
      diagnostics: mapping.diagnostics,
      isActive: mapping.isActive
    }
  });

  return rowToMapping(saved);
};

export async function resolveCanonicalHierarchyByEmail(
  email: string,
  options?: { refresh?: boolean }
): Promise<CanonicalHierarchyMapping> {
  const normalizedEmail = normalizeLower(email);
  if (!normalizedEmail) {
    throw new Error("Viewer email is required for canonical hierarchy resolution");
  }

  const existing = await prisma.userScopeMapping.findUnique({
    where: {
      userEmail: normalizedEmail
    }
  });

  if (
    existing &&
    existing.isActive &&
    !options?.refresh &&
    (existing.source === HierarchyMappingSource.ADMIN_OVERRIDE || Date.now() - existing.updatedAt.getTime() < CACHE_TTL_MS)
  ) {
    return rowToMapping(existing);
  }

  const derived = await buildDerivedMapping(normalizedEmail);
  return upsertCanonicalMapping(derived);
}

export async function backfillCanonicalHierarchyMappings(): Promise<{
  totalManagers: number;
  resolved: number;
  unresolved: number;
  failed: number;
  failedEmails: string[];
}> {
  const records = await getDirectoryRecords();
  const activeManagers = records.filter(
    (record) =>
      isActiveDirectoryContact(record) &&
      (normalize(record.employeeType).toUpperCase() === "SM" ||
        normalize(record.employeeType).toUpperCase() === "RM" ||
        normalize(record.staffRole).toUpperCase() === "SUCCESS MANAGER" ||
        normalize(record.staffRole).toUpperCase() === "RELATIONSHIP MANAGER")
  );

  const rmNameCandidates = toUniqueLower(
    records
      .filter(isActiveDirectoryContact)
      .flatMap((record) => [record.rmName])
  );

  let rmEmailsFromOwners: string[] = [];
  try {
    const owners = await fetchHubSpotOwners();
    rmEmailsFromOwners = owners
      .filter((owner) => {
        const ownerName = normalizeLower(buildOwnerName(owner));
        return ownerName ? rmNameCandidates.includes(ownerName) : false;
      })
      .map((owner) => normalizeLower(owner.email))
      .filter(Boolean);
  } catch {
    rmEmailsFromOwners = [];
  }

  const uniqueManagerEmails = toUniqueLower([
    ...activeManagers.map((record) => record.email),
    ...rmEmailsFromOwners
  ]);

  let resolved = 0;
  let unresolved = 0;
  let failed = 0;
  const failedEmails: string[] = [];

  for (const managerEmail of uniqueManagerEmails) {
    try {
      const mapping = await resolveCanonicalHierarchyByEmail(managerEmail, { refresh: true });
      if (mapping.unresolvedHierarchyReason || mapping.scopedStaffIds.length === 0) {
        unresolved += 1;
      } else {
        resolved += 1;
      }
    } catch {
      failed += 1;
      failedEmails.push(managerEmail);
    }
  }

  return {
    totalManagers: uniqueManagerEmails.length,
    resolved,
    unresolved,
    failed,
    failedEmails
  };
}

export async function upsertAdminHierarchyOverride(input: {
  userEmail: string;
  userName?: string | null;
  canonicalRole: CanonicalHierarchyRole;
  managerEmail?: string | null;
  managerName?: string | null;
  staffId?: string | null;
  mappedSmEmails?: string[];
  mappedSmNames?: string[];
  mappedRmEmail?: string | null;
  mappedRmName?: string | null;
  scopedStaffIds?: string[];
  unresolvedHierarchyReason?: string | null;
  diagnostics?: CanonicalHierarchyDiagnostics | null;
}): Promise<CanonicalHierarchyMapping> {
  const normalizedEmail = normalizeLower(input.userEmail);
  if (!normalizedEmail) {
    throw new Error("userEmail is required");
  }

  return upsertCanonicalMapping({
    userEmail: normalizedEmail,
    userName: normalize(input.userName) || null,
    canonicalRole: input.canonicalRole,
    managerEmail: normalize(input.managerEmail) || null,
    managerName: normalize(input.managerName) || null,
    staffId: normalize(input.staffId) || null,
    mappedSmEmails: toUnique(input.mappedSmEmails ?? []),
    mappedSmNames: toUnique(input.mappedSmNames ?? []),
    mappedRmEmail: normalize(input.mappedRmEmail) || null,
    mappedRmName: normalize(input.mappedRmName) || null,
    scopedStaffIds: toUnique(input.scopedStaffIds ?? []),
    scopeType: HierarchyScopeType.OVERRIDE,
    source: HierarchyMappingSource.ADMIN_OVERRIDE,
    unresolvedHierarchyReason: normalize(input.unresolvedHierarchyReason) || null,
    diagnostics: input.diagnostics ?? {
      matchedEmployeeRecord: null,
      attemptedManagerFields: [],
      candidateSmEmails: toUnique(input.mappedSmEmails ?? []),
      candidateVaStaffIds: toUnique(input.scopedStaffIds ?? []),
      conflictNotes: ["MANUAL_ADMIN_OVERRIDE"],
      unresolvedHierarchyReason: normalize(input.unresolvedHierarchyReason) || null
    },
    isActive: true
  });
}

export async function listUnresolvedCanonicalHierarchyMappings(): Promise<CanonicalHierarchyMapping[]> {
  const rows = await prisma.userScopeMapping.findMany({
    where: {
      isActive: true,
      canonicalRole: {
        in: [CanonicalHierarchyRole.SUCCESS_MANAGER, CanonicalHierarchyRole.RELATIONSHIP_MANAGER]
      },
      OR: [
        {
          unresolvedHierarchyReason: {
            not: null
          }
        },
        {
          scopedStaffIds: {
            isEmpty: true
          }
        }
      ]
    },
    orderBy: [{ canonicalRole: "asc" }, { userEmail: "asc" }]
  });

  return rows.map(rowToMapping);
}

export async function validateCanonicalHierarchyMappings(options?: {
  refreshBeforeValidate?: boolean;
}): Promise<CanonicalHierarchyValidationReport> {
  if (options?.refreshBeforeValidate) {
    await backfillCanonicalHierarchyMappings();
  }

  const activeCycle = await prisma.cycle.findFirst({
    where: {
      OR: [{ isActive: true }, { status: "ACTIVE" }]
    },
    orderBy: {
      startDate: "desc"
    },
    select: {
      id: true
    }
  });

  const mappings = await prisma.userScopeMapping.findMany({
    where: {
      isActive: true,
      canonicalRole: {
        in: [CanonicalHierarchyRole.SUCCESS_MANAGER, CanonicalHierarchyRole.RELATIONSHIP_MANAGER]
      }
    },
    orderBy: [{ canonicalRole: "asc" }, { userEmail: "asc" }]
  });

  const rows: CanonicalHierarchyValidationRow[] = [];

  for (const mapping of mappings) {
    const scopedStaffIds = toUnique(mapping.scopedStaffIds);

    const caseWhereBase = {
      isRemoved: false,
      ...(activeCycle ? { cycleId: activeCycle.id } : {}),
      ...(scopedStaffIds.length > 0 ? { staffId: { in: scopedStaffIds } } : { id: "__empty_scope__" })
    };

    const [casesScopeCount, dashboardScopeCount, wsllScopeCount, reviewQueueScopeCount] = await Promise.all([
      prisma.appraisalCase.count({
        where: caseWhereBase
      }),
      prisma.appraisalCase.count({
        where: caseWhereBase
      }),
      prisma.wsllRecord.count({
        where: {
          ...(scopedStaffIds.length > 0 ? { staffId: { in: scopedStaffIds } } : { id: "__empty_scope__" })
        }
      }),
      prisma.appraisalCase.count({
        where: {
          ...caseWhereBase,
          status: "SUBMITTED_FOR_REVIEW"
        }
      })
    ]);

    const row: CanonicalHierarchyValidationRow = {
      userEmail: mapping.userEmail,
      userName: mapping.userName,
      canonicalRole:
        mapping.canonicalRole === CanonicalHierarchyRole.RELATIONSHIP_MANAGER
          ? "RELATIONSHIP_MANAGER"
          : "SUCCESS_MANAGER",
      resolvedScopeCount: scopedStaffIds.length,
      smCountInScope: mapping.mappedSmEmails.length,
      vaCountInScope: scopedStaffIds.length,
      dashboardScopeCount,
      casesScopeCount,
      wsllScopeCount,
      reviewQueueScopeCount,
      scopeConsistentAcrossModules: dashboardScopeCount === casesScopeCount && reviewQueueScopeCount <= casesScopeCount,
      unresolvedHierarchyReason: mapping.unresolvedHierarchyReason
    };

    rows.push(row);
  }

  const totalUnresolved = rows.filter((row) => row.unresolvedHierarchyReason || row.resolvedScopeCount === 0).length;

  return {
    generatedAt: new Date().toISOString(),
    totalManagers: rows.length,
    totalSm: rows.filter((row) => row.canonicalRole === "SUCCESS_MANAGER").length,
    totalRm: rows.filter((row) => row.canonicalRole === "RELATIONSHIP_MANAGER").length,
    totalUnresolved,
    rows
  };
}
