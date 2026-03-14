import { PrismaClient } from "@prisma/client";
import {
  resolveViewerByEmail,
  type ResolvedViewerIdentity
} from "./viewerResolutionService";
import {
  resolveCanonicalHierarchyByEmail,
  type CanonicalHierarchyDiagnostics,
  type CanonicalHierarchyMapping
} from "./canonicalHierarchyService";

const prisma = new PrismaClient();

const HIERARCHY_DEBUG = process.env.HIERARCHY_DEBUG === "true";

const APPRAISAL_ELIGIBLE_DIRECTORY_CONTACT_TYPES = [
  "Staff Member - Active",
  "Staff Member - For Reprofile",
  "Staff Member - HR Floating",
  "Staff Member - Maternity"
] as const;

export type HierarchyScopedRole =
  | "SITE_LEAD"
  | "SUCCESS_MANAGER"
  | "RELATIONSHIP_MANAGER"
  | "REVIEWER"
  | "UNSCOPED";

export type HierarchyViewerInput = {
  role?: string | null;
  email?: string | null;
  name?: string | null;
  id?: string | null;
};

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

export type ResolvedHierarchy = {
  scopedRole: HierarchyScopedRole;
  viewer: HierarchyViewerInput;
  resolvedViewerRecord: DirectoryEmployeeRecord | null;
  rmOwner: {
    id: string;
    email: string;
    fullName: string;
  } | null;
  smRecords: DirectoryEmployeeRecord[];
  vaRecords: DirectoryEmployeeRecord[];
  smIdentifiers: string[];
  rmIdentifiers: string[];
  scopedStaffIds: string[];
  unresolvedHierarchyReason: string | null;
  diagnostics: CanonicalHierarchyDiagnostics | null;
};

const normalizeIdentifier = (value: string | null | undefined): string => value?.trim() ?? "";

const normalizeRole = (role: string | null | undefined): HierarchyScopedRole => {
  const normalized = normalizeIdentifier(role).toUpperCase();

  if (normalized === "ADMIN" || normalized === "SITE_LEAD") {
    return "SITE_LEAD";
  }

  if (normalized === "SM" || normalized === "SUCCESS_MANAGER") {
    return "SUCCESS_MANAGER";
  }

  if (normalized === "RM" || normalized === "RELATIONSHIP_MANAGER") {
    return "RELATIONSHIP_MANAGER";
  }

  if (normalized === "REVIEWER") {
    return "REVIEWER";
  }

  return "UNSCOPED";
};

const uniqueIdentifiers = (values: Array<string | null | undefined>): string[] => {
  const normalized = values
    .map((value) => normalizeIdentifier(value).toLowerCase())
    .filter(Boolean);

  return [...new Set(normalized)];
};

const asDirectoryRecord = (
  record: {
    staffId: string;
    fullName: string;
    email: string;
    employeeType: string;
    staffRole: string;
    contactType: string;
    smName: string | null;
    smOwnerId: string | null;
    rmName: string | null;
  }
): DirectoryEmployeeRecord => ({
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

const toInsensitiveEquals = (field: "staffId" | "fullName" | "email", values: string[]) =>
  values.map((value) => ({ [field]: { equals: value, mode: "insensitive" as const } }));

const debugLog = (event: string, data: Record<string, unknown>) => {
  if (!HIERARCHY_DEBUG) {
    return;
  }

  console.log(`[HierarchyResolution] ${event}`, JSON.stringify(data));
};

const resolveVaRecordsByStaffIds = async (staffIds: string[]): Promise<DirectoryEmployeeRecord[]> => {
  if (staffIds.length === 0) {
    return [];
  }

  const rows = await prisma.employeeDirectory.findMany({
    where: {
      staffId: {
        in: staffIds
      }
    },
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

  return rows.map(asDirectoryRecord);
};

const resolveSmRecordsByEmailsOrNames = async (smEmails: string[], smNames: string[]): Promise<DirectoryEmployeeRecord[]> => {
  if (smEmails.length === 0 && smNames.length === 0) {
    return [];
  }

  const loweredEmails = smEmails.map((value) => value.trim().toLowerCase()).filter(Boolean);
  const loweredNames = smNames.map((value) => value.trim().toLowerCase()).filter(Boolean);

  const rows = await prisma.employeeDirectory.findMany({
    where: {
      OR: [
        ...(loweredEmails.length > 0 ? toInsensitiveEquals("email", loweredEmails) : []),
        ...(loweredNames.length > 0 ? toInsensitiveEquals("fullName", loweredNames) : [])
      ]
    },
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

  return rows.map(asDirectoryRecord);
};

const buildScopedStaffIds = (vaRecords: DirectoryEmployeeRecord[]): string[] =>
  [...new Set(vaRecords.map((record) => record.staffId).filter(Boolean))];

const getAppraisalEligibleStaffIdsForSiteLead = async (): Promise<string[]> => {
  const rows = await prisma.employeeDirectory.findMany({
    where: {
      employeeType: "VA",
      contactType: {
        in: [...APPRAISAL_ELIGIBLE_DIRECTORY_CONTACT_TYPES]
      }
    },
    select: {
      staffId: true
    }
  });

  return [...new Set(rows.map((row) => row.staffId).filter(Boolean))];
};

const mapCanonicalRoleToScopedRole = (canonicalRole: string): HierarchyScopedRole => {
  const normalized = normalizeIdentifier(canonicalRole).toUpperCase();
  if (normalized === "SITE_LEAD") {
    return "SITE_LEAD";
  }

  if (normalized === "SUCCESS_MANAGER") {
    return "SUCCESS_MANAGER";
  }

  if (normalized === "RELATIONSHIP_MANAGER") {
    return "RELATIONSHIP_MANAGER";
  }

  if (normalized === "REVIEWER") {
    return "REVIEWER";
  }

  return "UNSCOPED";
};

const getResolvedViewerIdentity = async (viewer: HierarchyViewerInput): Promise<ResolvedViewerIdentity> => {
  return resolveViewerByEmail(normalizeIdentifier(viewer.email));
};

const resolveHierarchyFromCanonicalMapping = async (
  viewer: HierarchyViewerInput,
  resolvedViewer: ResolvedViewerIdentity,
  canonicalMapping: CanonicalHierarchyMapping
): Promise<ResolvedHierarchy> => {
  const canonicalRole = mapCanonicalRoleToScopedRole(canonicalMapping.canonicalRole);
  const resolvedViewerRecord = resolvedViewer.employeeRecord ? asDirectoryRecord(resolvedViewer.employeeRecord) : null;

  if (canonicalRole === "SITE_LEAD") {
    const scopedStaffIds =
      canonicalMapping.scopedStaffIds.length > 0
        ? canonicalMapping.scopedStaffIds
        : await getAppraisalEligibleStaffIdsForSiteLead();

    return {
      scopedRole: canonicalRole,
      viewer,
      resolvedViewerRecord,
      rmOwner: resolvedViewer.rmOwner,
      smRecords: [],
      vaRecords: [],
      smIdentifiers: [],
      rmIdentifiers: [],
      scopedStaffIds,
      unresolvedHierarchyReason: canonicalMapping.unresolvedHierarchyReason,
      diagnostics: canonicalMapping.diagnostics
    };
  }

  const vaRecords = await resolveVaRecordsByStaffIds(canonicalMapping.scopedStaffIds);
  const smRecords =
    canonicalRole === "RELATIONSHIP_MANAGER"
      ? await resolveSmRecordsByEmailsOrNames(canonicalMapping.mappedSmEmails, canonicalMapping.mappedSmNames)
      : resolvedViewerRecord
        ? [resolvedViewerRecord]
        : [];

  const smIdentifiers = uniqueIdentifiers([
    ...canonicalMapping.mappedSmEmails,
    ...canonicalMapping.mappedSmNames,
    ...smRecords.flatMap((record) => [record.staffId, record.fullName, record.email, record.smOwnerId, record.smName])
  ]);

  const rmIdentifiers = uniqueIdentifiers([
    canonicalMapping.mappedRmEmail,
    canonicalMapping.mappedRmName,
    canonicalMapping.managerEmail,
    canonicalMapping.managerName,
    resolvedViewer.rmOwner?.id,
    resolvedViewer.rmOwner?.email,
    resolvedViewer.rmOwner?.fullName,
    resolvedViewer.normalizedEmail,
    resolvedViewer.employeeRecord?.staffId
  ]);

  return {
    scopedRole: canonicalRole,
    viewer,
    resolvedViewerRecord,
    rmOwner: resolvedViewer.rmOwner,
    smRecords,
    vaRecords,
    smIdentifiers,
    rmIdentifiers,
    scopedStaffIds: canonicalMapping.scopedStaffIds,
    unresolvedHierarchyReason: canonicalMapping.unresolvedHierarchyReason,
    diagnostics: canonicalMapping.diagnostics
  };
};

export async function resolveSmScope(viewer: HierarchyViewerInput): Promise<ResolvedHierarchy> {
  const resolvedViewer = await getResolvedViewerIdentity(viewer);
  const canonical = await resolveCanonicalHierarchyByEmail(resolvedViewer.normalizedEmail);
  const hierarchy = await resolveHierarchyFromCanonicalMapping(viewer, resolvedViewer, canonical);

  debugLog("resolveSmScope", {
    viewerEmail: resolvedViewer.normalizedEmail,
    scopedStaffIdCount: hierarchy.scopedStaffIds.length,
    unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason
  });

  return hierarchy;
}

export async function resolveRmScope(viewer: HierarchyViewerInput): Promise<ResolvedHierarchy> {
  const resolvedViewer = await getResolvedViewerIdentity(viewer);
  const canonical = await resolveCanonicalHierarchyByEmail(resolvedViewer.normalizedEmail);
  const hierarchy = await resolveHierarchyFromCanonicalMapping(viewer, resolvedViewer, canonical);

  debugLog("resolveRmScope", {
    viewerEmail: resolvedViewer.normalizedEmail,
    scopedStaffIdCount: hierarchy.scopedStaffIds.length,
    unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason
  });

  return hierarchy;
}

export async function resolveScopedStaffIds(viewer: HierarchyViewerInput): Promise<string[]> {
  const hierarchy = await resolveViewerHierarchy(viewer);
  return hierarchy.scopedStaffIds;
}

export async function resolveViewerHierarchy(viewerOrEmail: HierarchyViewerInput | string): Promise<ResolvedHierarchy> {
  const viewer: HierarchyViewerInput =
    typeof viewerOrEmail === "string"
      ? {
          email: viewerOrEmail,
          name: null,
          id: null,
          role: null
        }
      : {
          role: viewerOrEmail.role ?? null,
          email: viewerOrEmail.email ?? null,
          name: viewerOrEmail.name ?? null,
          id: viewerOrEmail.id ?? null
        };

  const resolvedViewer = await getResolvedViewerIdentity(viewer);
  const canonical = await resolveCanonicalHierarchyByEmail(resolvedViewer.normalizedEmail);
  const canonicalHierarchy = await resolveHierarchyFromCanonicalMapping(viewer, resolvedViewer, canonical);

  const requestedRole = normalizeRole(viewer.role);
  const scopedRole =
    requestedRole === "SITE_LEAD" || requestedRole === "REVIEWER"
      ? requestedRole
      : canonicalHierarchy.scopedRole;

  if (scopedRole === "SUCCESS_MANAGER") {
    return {
      ...canonicalHierarchy,
      scopedRole: "SUCCESS_MANAGER"
    };
  }

  if (scopedRole === "RELATIONSHIP_MANAGER") {
    return {
      ...canonicalHierarchy,
      scopedRole: "RELATIONSHIP_MANAGER"
    };
  }

  if (scopedRole === "SITE_LEAD") {
    const scopedStaffIds =
      canonicalHierarchy.scopedStaffIds.length > 0
        ? canonicalHierarchy.scopedStaffIds
        : await getAppraisalEligibleStaffIdsForSiteLead();

    return {
      ...canonicalHierarchy,
      scopedRole,
      scopedStaffIds
    };
  }

  return {
    ...canonicalHierarchy,
    scopedRole,
    scopedStaffIds: buildScopedStaffIds(canonicalHierarchy.vaRecords)
  };
}
