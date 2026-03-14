import { PrismaClient, HierarchyMappingSource } from "@prisma/client";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { refreshAllWorkingData } from "./employeeWorkingDataService";
import { backfillCanonicalHierarchyMappings } from "./canonicalHierarchyService";

const prisma = new PrismaClient();

const SNAPSHOT_VERSION = 1;

export type LearnedDataSnapshot = {
  version: number;
  exportedAt: string;
  standardizedRoles: Array<{
    roleName: string;
    isActive: boolean;
  }>;
  roleAlignmentMappings: Array<{
    sourceRoleName: string;
    mappedRoleName: string;
    standardizedRoleName: string | null;
    matchSource: string;
    confidenceScore: number | null;
  }>;
  hierarchyOverrides: Array<{
    userEmail: string;
    userName: string | null;
    canonicalRole: string;
    managerEmail: string | null;
    managerName: string | null;
    staffId: string | null;
    mappedSmEmails: string[];
    mappedSmNames: string[];
    mappedRmEmail: string | null;
    mappedRmName: string | null;
    scopedStaffIds: string[];
    scopeType: string;
    source: string;
    unresolvedHierarchyReason: string | null;
    diagnostics: unknown;
    isActive: boolean;
  }>;
  conflictResolutions: Array<{
    issueType: string;
    staffId: string | null;
    employeeName: string | null;
    status: string;
    description: string;
    metadata: unknown;
    resolvedBy: string | null;
    resolvedAt: string | null;
  }>;
};

export function getLearnedDataSnapshotPath(): string {
  if (process.env.LEARNED_DATA_SNAPSHOT_PATH?.trim()) {
    return process.env.LEARNED_DATA_SNAPSHOT_PATH.trim();
  }

  return path.resolve(process.cwd(), "data", "learned", "learned-data.snapshot.json");
}

async function ensureSnapshotDirectory(snapshotPath: string): Promise<void> {
  await mkdir(path.dirname(snapshotPath), { recursive: true });
}

async function snapshotExists(snapshotPath: string): Promise<boolean> {
  try {
    await access(snapshotPath);
    return true;
  } catch {
    return false;
  }
}

export async function exportLearnedRecords(snapshotPath = getLearnedDataSnapshotPath()): Promise<{
  snapshotPath: string;
  exportedAt: string;
  counts: {
    standardizedRoles: number;
    roleAlignmentMappings: number;
    hierarchyOverrides: number;
    conflictResolutions: number;
  };
}> {
  const [standardizedRoles, roleAlignmentMappings, hierarchyOverrides, conflictResolutions] = await Promise.all([
    prisma.standardizedRole.findMany({
      orderBy: { roleName: "asc" },
      select: { roleName: true, isActive: true }
    }),
    prisma.roleAlignmentMapping.findMany({
      orderBy: { sourceRoleName: "asc" },
      include: { standardizedRole: { select: { roleName: true } } }
    }),
    prisma.userScopeMapping.findMany({
      where: {
        isActive: true,
        OR: [
          { source: HierarchyMappingSource.ADMIN_OVERRIDE },
          { scopeType: "OVERRIDE" }
        ]
      },
      orderBy: { userEmail: "asc" }
    }),
    prisma.dataQualityIssue.findMany({
      where: {
        issueType: { in: ["DUPLICATE_EMAIL", "MERGED_DUPLICATE_DIRECTORY_RECORD"] },
        status: { not: "OPEN" }
      },
      orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
      select: {
        issueType: true,
        staffId: true,
        employeeName: true,
        status: true,
        description: true,
        metadata: true,
        resolvedBy: true,
        resolvedAt: true
      }
    })
  ]);

  const exportedAt = new Date().toISOString();
  const snapshot: LearnedDataSnapshot = {
    version: SNAPSHOT_VERSION,
    exportedAt,
    standardizedRoles,
    roleAlignmentMappings: roleAlignmentMappings.map((row) => ({
      sourceRoleName: row.sourceRoleName,
      mappedRoleName: row.mappedRoleName,
      standardizedRoleName: row.standardizedRole?.roleName ?? null,
      matchSource: row.matchSource,
      confidenceScore: row.confidenceScore === null ? null : Number(row.confidenceScore)
    })),
    hierarchyOverrides: hierarchyOverrides.map((row) => ({
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
      diagnostics: row.diagnostics,
      isActive: row.isActive
    })),
    conflictResolutions: conflictResolutions.map((row) => ({
      issueType: row.issueType,
      staffId: row.staffId,
      employeeName: row.employeeName,
      status: row.status,
      description: row.description,
      metadata: row.metadata,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null
    }))
  };

  await ensureSnapshotDirectory(snapshotPath);
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return {
    snapshotPath,
    exportedAt,
    counts: {
      standardizedRoles: snapshot.standardizedRoles.length,
      roleAlignmentMappings: snapshot.roleAlignmentMappings.length,
      hierarchyOverrides: snapshot.hierarchyOverrides.length,
      conflictResolutions: snapshot.conflictResolutions.length
    }
  };
}

function parseSnapshot(content: string): LearnedDataSnapshot {
  const parsed = JSON.parse(content) as Partial<LearnedDataSnapshot>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Snapshot JSON is invalid");
  }

  if (!Array.isArray(parsed.standardizedRoles) || !Array.isArray(parsed.roleAlignmentMappings) || !Array.isArray(parsed.hierarchyOverrides)) {
    throw new Error("Snapshot JSON is missing required collections");
  }

  return {
    version: typeof parsed.version === "number" ? parsed.version : SNAPSHOT_VERSION,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date(0).toISOString(),
    standardizedRoles: parsed.standardizedRoles as LearnedDataSnapshot["standardizedRoles"],
    roleAlignmentMappings: parsed.roleAlignmentMappings as LearnedDataSnapshot["roleAlignmentMappings"],
    hierarchyOverrides: parsed.hierarchyOverrides as LearnedDataSnapshot["hierarchyOverrides"],
    conflictResolutions: Array.isArray(parsed.conflictResolutions)
      ? (parsed.conflictResolutions as LearnedDataSnapshot["conflictResolutions"])
      : []
  };
}

export async function importLearnedRecords(snapshotPath = getLearnedDataSnapshotPath()): Promise<{
  snapshotPath: string;
  imported: boolean;
  counts: {
    standardizedRoles: number;
    roleAlignmentMappings: number;
    hierarchyOverrides: number;
    conflictResolutions: number;
  };
}> {
  if (!(await snapshotExists(snapshotPath))) {
    return {
      snapshotPath,
      imported: false,
      counts: {
        standardizedRoles: 0,
        roleAlignmentMappings: 0,
        hierarchyOverrides: 0,
        conflictResolutions: 0
      }
    };
  }

  const content = await readFile(snapshotPath, "utf8");
  const snapshot = parseSnapshot(content);

  const roleIdByName = new Map<string, string>();

  for (const role of snapshot.standardizedRoles) {
    const upserted = await prisma.standardizedRole.upsert({
      where: { roleName: role.roleName },
      create: {
        roleName: role.roleName,
        isActive: role.isActive
      },
      update: {
        isActive: role.isActive
      }
    });
    roleIdByName.set(upserted.roleName.toLowerCase(), upserted.id);
  }

  for (const mapping of snapshot.roleAlignmentMappings) {
    let standardizedRoleId: string | null = null;

    if (mapping.standardizedRoleName?.trim()) {
      const standardizedRoleName = mapping.standardizedRoleName.trim();
      const existingId = roleIdByName.get(standardizedRoleName.toLowerCase());
      if (existingId) {
        standardizedRoleId = existingId;
      } else {
        const upsertedRole = await prisma.standardizedRole.upsert({
          where: { roleName: standardizedRoleName },
          create: { roleName: standardizedRoleName, isActive: true },
          update: {}
        });
        roleIdByName.set(upsertedRole.roleName.toLowerCase(), upsertedRole.id);
        standardizedRoleId = upsertedRole.id;
      }
    }

    await prisma.roleAlignmentMapping.upsert({
      where: { sourceRoleName: mapping.sourceRoleName },
      create: {
        sourceRoleName: mapping.sourceRoleName,
        mappedRoleName: mapping.mappedRoleName,
        standardizedRoleId,
        matchSource: mapping.matchSource as any,
        confidenceScore: mapping.confidenceScore
      },
      update: {
        mappedRoleName: mapping.mappedRoleName,
        standardizedRoleId,
        matchSource: mapping.matchSource as any,
        confidenceScore: mapping.confidenceScore
      }
    });
  }

  for (const override of snapshot.hierarchyOverrides) {
    await prisma.userScopeMapping.upsert({
      where: { userEmail: override.userEmail },
      create: {
        userEmail: override.userEmail,
        userName: override.userName,
        canonicalRole: override.canonicalRole as any,
        managerEmail: override.managerEmail,
        managerName: override.managerName,
        staffId: override.staffId,
        mappedSmEmails: override.mappedSmEmails,
        mappedSmNames: override.mappedSmNames,
        mappedRmEmail: override.mappedRmEmail,
        mappedRmName: override.mappedRmName,
        scopedStaffIds: override.scopedStaffIds,
        scopeType: override.scopeType as any,
        source: override.source as any,
        unresolvedHierarchyReason: override.unresolvedHierarchyReason,
        diagnostics: override.diagnostics as any,
        isActive: override.isActive
      },
      update: {
        userName: override.userName,
        canonicalRole: override.canonicalRole as any,
        managerEmail: override.managerEmail,
        managerName: override.managerName,
        staffId: override.staffId,
        mappedSmEmails: override.mappedSmEmails,
        mappedSmNames: override.mappedSmNames,
        mappedRmEmail: override.mappedRmEmail,
        mappedRmName: override.mappedRmName,
        scopedStaffIds: override.scopedStaffIds,
        scopeType: override.scopeType as any,
        source: override.source as any,
        unresolvedHierarchyReason: override.unresolvedHierarchyReason,
        diagnostics: override.diagnostics as any,
        isActive: override.isActive
      }
    });
  }

  for (const resolution of snapshot.conflictResolutions) {
    const existing = await prisma.dataQualityIssue.findFirst({
      where: {
        issueType: resolution.issueType,
        staffId: resolution.staffId ?? undefined,
        status: resolution.status,
        description: resolution.description
      }
    });

    if (existing) {
      continue;
    }

    await prisma.dataQualityIssue.create({
      data: {
        staffId: resolution.staffId,
        employeeName: resolution.employeeName,
        issueType: resolution.issueType,
        category: "IDENTITY",
        severity: "MEDIUM",
        description: resolution.description,
        status: resolution.status,
        metadata: resolution.metadata as any,
        resolvedBy: resolution.resolvedBy,
        resolvedAt: resolution.resolvedAt ? new Date(resolution.resolvedAt) : null
      }
    });
  }

  return {
    snapshotPath,
    imported: true,
    counts: {
      standardizedRoles: snapshot.standardizedRoles.length,
      roleAlignmentMappings: snapshot.roleAlignmentMappings.length,
      hierarchyOverrides: snapshot.hierarchyOverrides.length,
      conflictResolutions: snapshot.conflictResolutions.length
    }
  };
}

export async function validateLearnedDataTargets(): Promise<{
  totalMappings: number;
  invalidMappings: number;
  invalidSourceRoles: string[];
}> {
  const mappings = await prisma.roleAlignmentMapping.findMany({
    include: { standardizedRole: true }
  });

  const invalid = mappings.filter((mapping) => {
    if (mapping.standardizedRoleId === null) {
      return false;
    }

    return !mapping.standardizedRole;
  });

  return {
    totalMappings: mappings.length,
    invalidMappings: invalid.length,
    invalidSourceRoles: invalid.map((row) => row.sourceRoleName)
  };
}

export async function reapplyLearnedRecordsAfterRebuild(): Promise<{
  hierarchyBackfill: {
    totalManagers: number;
    resolved: number;
    unresolved: number;
    failed: number;
    failedEmails: string[];
  };
  workingDataRefresh: {
    saved: number;
    errors: number;
  };
  validation: {
    totalMappings: number;
    invalidMappings: number;
    invalidSourceRoles: string[];
  };
}> {
  const [hierarchyBackfill, workingDataRefresh] = await Promise.all([
    backfillCanonicalHierarchyMappings(),
    refreshAllWorkingData()
  ]);

  const validation = await validateLearnedDataTargets();
  return {
    hierarchyBackfill,
    workingDataRefresh,
    validation
  };
}

export async function initializeLearnedDataPersistence(): Promise<{
  snapshotPath: string;
  imported: boolean;
  validation: {
    totalMappings: number;
    invalidMappings: number;
    invalidSourceRoles: string[];
  };
}> {
  const snapshotPath = getLearnedDataSnapshotPath();
  const imported = await importLearnedRecords(snapshotPath);
  const validation = await validateLearnedDataTargets();

  return {
    snapshotPath,
    imported: imported.imported,
    validation
  };
}
