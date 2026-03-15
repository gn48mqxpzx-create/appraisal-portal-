import { PrismaClient, Prisma } from "@prisma/client";
import { hubspotFetch, fetchHubSpotOwners, resolveOwnerIdByName, HubSpotOwner } from "./hubspotClient";
import { refreshWorkingDataForEmployees } from "./employeeWorkingDataService";
import { exportLearnedRecords, reapplyLearnedRecordsAfterRebuild } from "./learnedDataPersistenceService";
import { resolveInternalCompanyIdentity } from "./companyNormalizationService";

const prisma = new PrismaClient();

// ── Sync lock: prevents concurrent syncs (single-process guard) ──────────────
let activeSyncPromise: Promise<SyncResult> | null = null;

export interface SyncResult {
  result: "success" | "failed";
  synced: number;
  updated: number;
  created: number;
  mergedDuplicates: number;
  skipped: number;
  conflicts: number;
  errors: string[];
  timestamp: string;
  mode: "FULL" | "DELTA";
  durationMs: number;
}

/** Returns the most recent SyncRecord, or null if none exists */
export async function getLastSyncRecord() {
  const latestRun = await prisma.directorySyncRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (latestRun) {
    return {
      id: latestRun.id,
      startedAt: latestRun.startedAt,
      completedAt: latestRun.completedAt,
      syncMode: latestRun.mode,
      triggeredBy: latestRun.triggeredBy,
      status: latestRun.status,
      syncedCount: latestRun.syncedCount,
      skippedCount: latestRun.skippedCount,
      errorCount: latestRun.errorCount,
      conflictCount: latestRun.conflictsCount,
      durationMs: latestRun.durationMs
    };
  }

  return prisma.syncRecord.findFirst({ orderBy: { startedAt: "desc" } });
}

/** Returns recent SyncRecord history, newest first */
export async function getSyncHistory(limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.trunc(limit) : 25));

  const runRows = await prisma.directorySyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: safeLimit,
    include: {
      issues: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (runRows.length > 0) {
    return runRows.map((row) => ({
      id: row.id,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      syncMode: row.mode,
      status: row.status,
      syncedCount: row.syncedCount,
      updatedCount: row.updatedCount,
      createdCount: row.createdCount,
      skippedCount: row.skippedCount,
      conflictCount: row.conflictsCount,
      mergedDuplicatesCount: row.mergedDuplicatesCount,
      errorCount: row.errorCount,
      summaryMessage: row.summaryMessage,
      issues: row.issues.map((issue) => ({
        id: issue.id,
        issueType: issue.issueType,
        referenceValue: issue.referenceValue,
        message: issue.message,
        severity: issue.severity,
        createdAt: issue.createdAt
      }))
    }));
  }

  const legacyRows = await prisma.syncRecord.findMany({
    orderBy: { startedAt: "desc" },
    take: safeLimit
  });

  return legacyRows.map((row) => {
    let updatedCount: number | null = null;
    let createdCount: number | null = null;
    let mergedDuplicatesCount: number | null = null;

    if (row.errorMessage?.startsWith("SYNC_SUMMARY:")) {
      try {
        const parsed = JSON.parse(row.errorMessage.slice("SYNC_SUMMARY:".length)) as {
          updated?: number;
          created?: number;
          mergedDuplicates?: number;
        };
        updatedCount = Number.isFinite(parsed.updated) ? Number(parsed.updated) : null;
        createdCount = Number.isFinite(parsed.created) ? Number(parsed.created) : null;
        mergedDuplicatesCount = Number.isFinite(parsed.mergedDuplicates) ? Number(parsed.mergedDuplicates) : null;
      } catch {
        // non-fatal parse fallback
      }
    }

    return {
      ...row,
      updatedCount,
      createdCount,
        mergedDuplicatesCount,
        status: row.status,
        summaryMessage: null,
        issues: []
    };
  });
}

/**
 * Returns true if a sync should be triggered because the last successful sync
 * is older than thresholdMinutes, or no sync has ever run.
 */
export async function shouldTriggerSync(thresholdMinutes = 10): Promise<boolean> {
  const last = await prisma.syncRecord.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { startedAt: "desc" }
  });
  if (!last) return true;
  const ageMs = Date.now() - last.startedAt.getTime();
  return ageMs > thresholdMinutes * 60_000;
}

type EmployeeType = "VA" | "SM";

interface HubSpotContact {
  id: string;
  properties: {
    [key: string]: string;
  };
}

interface HubSpotSearchResponse {
  results: HubSpotContact[];
  paging?: {
    next?: {
      after: string;
    };
  };
}

interface StaffRow {
  hubspot_id: string;
  staff_id: string;
  full_name: string;
  email: string;
  company_name?: string;
  staff_role: string;
  contact_type: string;
  sm_owner_id: string;
  sm_own_owner_id: string;
  rm: string;
  employee_type: EmployeeType;
  staff_start_date?: string;
}

function toStaffRow(record: any): StaffRow {
  return {
    hubspot_id: record.hubspotContactId,
    staff_id: record.staffId,
    full_name: record.fullName,
    email: record.email,
    company_name: record.internalCompanyName || record.hubspotCompanyName || "",
    staff_role: record.staffRole,
    contact_type: record.contactType,
    sm_owner_id: record.smName || "",
    sm_own_owner_id: record.smOwnerId || "",
    rm: record.rmName || "",
    employee_type: record.employeeType as EmployeeType,
    staff_start_date: record.staffStartDate ? record.staffStartDate.toISOString() : undefined
  };
}

/**
 * Fetch staff contacts from HubSpot with pagination.
 * Pass updatedAfter to only fetch contacts modified since that timestamp (delta sync).
 */
async function fetchAllStaffContacts(filterGroups?: any[], updatedAfter?: Date): Promise<HubSpotContact[]> {
  const allContacts: HubSpotContact[] = [];
  let after: string | undefined;

  // Base contact-type groups: VA (Staff Member - Active) and SM (Ops Staff - Active)
  const baseGroups = filterGroups ?? [
    { filters: [{ propertyName: "contact_type", operator: "EQ", value: "Staff Member - Active" }] },
    { filters: [{ propertyName: "contact_type", operator: "EQ", value: "Ops Staff - Active" }] }
  ];

  // For delta sync: add hs_lastmodifieddate filter to each group (AND within group)
  const effectiveGroups = updatedAfter
    ? baseGroups.map((g: any) => ({
        filters: [
          ...g.filters,
          {
            propertyName: "hs_lastmodifieddate",
            operator: "GTE",
            value: String(updatedAfter.getTime())
          }
        ]
      }))
    : baseGroups;

  do {
    const searchPayload: any = {
      filterGroups: effectiveGroups,
      properties: [
        "staff_id_number",
        "firstname",
        "lastname",
        "email",
        "staff_role",
        "company",
        "contact_type",
        "sm",
        "senior_success_manager",
        "staff_start_date",
        "hs_lastmodifieddate"
      ],
      limit: 200
    };

    if (after) {
      searchPayload.after = after;
    }

    const data = await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(searchPayload)
    }) as HubSpotSearchResponse;

    allContacts.push(...data.results);
    after = data.paging?.next?.after;
  } while (after);

  return allContacts;
}

/**
 * Transform HubSpot contact to staff row format
 */
function transformToStaffRow(contact: HubSpotContact): StaffRow {
  const props = contact.properties;
  const firstName = props.firstname || "";
  const lastName = props.lastname || "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const contactType = props.contact_type || "";
  const staffRole = props.staff_role || "";

  let employeeType: EmployeeType = "VA";
  if (contactType === "Ops Staff - Active" && staffRole === "Success Manager") {
    employeeType = "SM";
  }

  return {
    hubspot_id: contact.id,
    staff_id: props.staff_id_number || "",
    full_name: fullName,
    email: props.email || "",
    company_name: props.company || "",
    staff_role: staffRole,
    contact_type: contactType,
    sm_owner_id: props.sm || "",
    sm_own_owner_id: "",  // Not available in HubSpot contact properties, populated during sync
    rm: props.senior_success_manager || "",
    employee_type: employeeType
  };
}

/**
 * Get all VAs under a specific Success Manager
 */
export async function getSMDirectory(smOwnerId: string): Promise<StaffRow[]> {
  const records = await prisma.employeeDirectory.findMany({
    where: {
      employeeType: "VA",
      smName: smOwnerId
    },
    orderBy: {
      fullName: "asc"
    }
  });

  return records.map(toStaffRow);
}

/**
 * Get all SMs and VAs under a specific Relationship Manager
 * Uses owner-ID based linkage:
 * 1. Resolves RM display name to RM owner ID via HubSpot owners API
 * 2. Finds SMs where smName = RM owner ID
 * 3. Collects SM owner IDs from those SM rows (smOwnerId field)
 * 4. Finds VAs where smName IN (SM owner IDs)
 */
export async function getRMDirectory(
  rmName: string
): Promise<{
  success_managers: StaffRow[];
  virtual_assistants: StaffRow[];
}> {
  console.log(`[getRMDirectory] Input RM name: "${rmName}"`);

  // Step 1: Resolve RM owner ID from display name
  const rmOwnerId = await resolveOwnerIdByName(rmName);
  if (!rmOwnerId) {
    console.warn(`[getRMDirectory] Could not resolve RM owner ID for: "${rmName}"`);
    return {
      success_managers: [],
      virtual_assistants: []
    };
  }
  console.log(`[getRMDirectory] Resolved RM owner ID: ${rmOwnerId}`);

  // Step 2: Query SMs where smName = RM owner ID
  const smRecords = await prisma.employeeDirectory.findMany({
    where: {
      contactType: "Ops Staff - Active",
      staffRole: "Success Manager",
      smName: rmOwnerId
    },
    orderBy: {
      fullName: "asc"
    }
  });
  console.log(`[getRMDirectory] Found ${smRecords.length} SMs under RM owner ID ${rmOwnerId}`);

  // Step 3: Collect SM owner IDs (smOwnerId field)
  const smOwnerIds = [...new Set(
    smRecords
      .map((sm: { smOwnerId: string | null }) => sm.smOwnerId)
      .filter(Boolean)
  )] as string[];
  console.log(`[getRMDirectory] SM owner IDs: ${smOwnerIds.join(", ")}`);

  // Step 4: Query VAs where smName IN (SM owner IDs)
  const vaRecords = smOwnerIds.length
    ? await prisma.employeeDirectory.findMany({
        where: {
          contactType: "Staff Member - Active",
          smName: {
            in: smOwnerIds
          }
        },
        orderBy: {
          fullName: "asc"
        }
      })
    : [];
  console.log(`[getRMDirectory] Found ${vaRecords.length} VAs under those SMs`);

  const successManagers = smRecords.map(toStaffRow);
  const virtualAssistants = vaRecords.map(toStaffRow);

  return {
    success_managers: successManagers,
    virtual_assistants: virtualAssistants
  };
}

/**
 * Get full directory scope for Admin users.
 */
export async function getAdminDirectory(): Promise<{
  success_managers: StaffRow[];
  virtual_assistants: StaffRow[];
}> {
  const [smRecords, vaRecords] = await Promise.all([
    prisma.employeeDirectory.findMany({
      where: {
        employeeType: "SM"
      },
      orderBy: {
        fullName: "asc"
      }
    }),
    prisma.employeeDirectory.findMany({
      where: {
        employeeType: "VA"
      },
      orderBy: {
        fullName: "asc"
      }
    })
  ]);

  return {
    success_managers: smRecords.map(toStaffRow),
    virtual_assistants: vaRecords.map(toStaffRow)
  };
}

/**
 * Get viewer by email and determine their role (SM or RM)
 * Returns viewer metadata including type, name, and owner ID if applicable
 */
export async function getViewerByEmail(email: string): Promise<{
  viewer_type: "SM" | "RM" | null;
  viewer_email: string;
  viewer_name: string;
  viewer_hubspot_owner_id?: string;
  sm_owner_id?: string;
} | null> {
  if (!email || !email.trim()) {
    return null;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Step 1: Look up employee by email in the database
  const employee = await prisma.employeeDirectory.findFirst({
    where: {
      email: {
        mode: "insensitive",
        equals: normalizedEmail
      }
    }
  });

  // Step 2: If found and is an SM, return SM viewer type
  if (employee && employee.contactType === "Ops Staff - Active" && employee.staffRole === "Success Manager") {
    return {
      viewer_type: "SM",
      viewer_email: employee.email || email,
      viewer_name: employee.fullName,
      viewer_hubspot_owner_id: employee.smOwnerId || undefined,
      sm_owner_id: employee.smOwnerId || undefined
    };
  }

  // Step 3: If not SM but found, could be a VA (not a viewer type)
  if (employee) {
    return null;
  }

  // Step 4: Try to resolve as RM via HubSpot owners API
  try {
    const owners = await fetchHubSpotOwners();
    const rmOwner = owners.find(
      (owner) => owner.email && owner.email.toLowerCase().trim() === normalizedEmail
    );

    if (rmOwner) {
      return {
        viewer_type: "RM",
        viewer_email: rmOwner.email || email,
        viewer_name: rmOwner.firstName && rmOwner.lastName 
          ? `${rmOwner.firstName} ${rmOwner.lastName}` 
          : rmOwner.firstName || rmOwner.lastName || "Unknown",
        viewer_hubspot_owner_id: rmOwner.id
      };
    }
  } catch (error) {
    console.warn(`[getViewerByEmail] Error checking HubSpot owners for ${normalizedEmail}:`, error);
  }

  // Step 5: Email not found as SM or RM
  return null;
}

/**
 * Sync employee directory from HubSpot.
 *
 * Smart sync features:
 * - Sync lock: if a sync is already running, waits for it and reuses the result
 * - Delta mode: only fetches contacts modified since last successful sync
 * - Strict dedup: match by hubspotContactId → email → create new
 * - Conflict detection: flags duplicate hubspotContactId / email mismatches
 * - Employment status: marks records absent from full sync as inactive
 * - Persists SyncRecord for status visibility
 */
export async function syncEmployeeDirectory(options?: {
  triggeredBy?: "admin" | "login" | "scheduled";
  deltaOnly?: boolean;
}): Promise<SyncResult> {
  // If a sync is already running, wait for it and reuse the result
  if (activeSyncPromise) {
    console.log("[syncEmployeeDirectory] Sync already in progress — waiting to reuse result");
    return activeSyncPromise;
  }

  let resolveActive!: (r: SyncResult) => void;
  activeSyncPromise = new Promise<SyncResult>((res) => { resolveActive = res; });

  const startTime = Date.now();
  const triggeredBy = options?.triggeredBy ?? "admin";

  // Determine sync mode: delta if deltaOnly=true AND a previous successful sync exists
  let syncMode: "FULL" | "DELTA" = "FULL";
  let deltaAfter: Date | undefined;

  if (options?.deltaOnly) {
    const lastSuccess = await prisma.syncRecord.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { startedAt: "desc" }
    });
    if (lastSuccess) {
      syncMode = "DELTA";
      deltaAfter = lastSuccess.startedAt;
    }
  }

  // Create in-progress sync record
  const syncRecord = await prisma.syncRecord.create({
    data: { startedAt: new Date(), syncMode, triggeredBy, status: "RUNNING" }
  });
  const syncRun = await prisma.directorySyncRun.create({
    data: {
      startedAt: new Date(),
      mode: syncMode,
      triggeredBy,
      status: "RUNNING"
    }
  });

  let syncedCount = 0;
  let updatedCount = 0;
  let createdCount = 0;
  let mergedDuplicatesCount = 0;
  let skippedCount = 0;
  let conflictCount = 0;
  const errors: string[] = [];
  const syncedHubspotIds = new Set<string>();
  const runIssues: Array<{
    issueType: string;
    referenceValue: string | null;
    message: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
  }> = [];

  try {
    console.log(`[syncEmployeeDirectory] Starting ${syncMode} sync (triggeredBy: ${triggeredBy})`);

    // ── Step 1: Fetch HubSpot owners (for SM owner ID resolution) ────────────
    const owners = await fetchHubSpotOwners();
    const ownersByEmail = new Map<string, string>();
    owners.forEach((o) => { if (o.email) ownersByEmail.set(o.email.toLowerCase().trim(), o.id); });
    console.log(`[syncEmployeeDirectory] ${owners.length} HubSpot owners loaded`);

    // ── Step 2: Fetch contacts from HubSpot ─────────────────────────────────
    const contacts = await fetchAllStaffContacts(undefined, deltaAfter);
    console.log(`[syncEmployeeDirectory] ${contacts.length} contacts fetched (${syncMode})`);

    // ── Step 3: Process each contact ─────────────────────────────────────────
    for (let i = 0; i < contacts.length; i++) {
      try {
        const contact = contacts[i];
        const props = contact.properties;
        const hubspotId = contact.id;

        if (!hubspotId) { skippedCount++; continue; }

        const staffId = props.staff_id_number?.trim();
        if (!staffId) {
          console.warn(`[syncEmployeeDirectory] Skipping contact ${hubspotId}: missing staff_id_number`);
          skippedCount++;
          continue;
        }

        const firstName = props.firstname || "";
        const lastName = props.lastname || "";
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
        const email = (props.email || "").trim().toLowerCase();
        const contactType = props.contact_type || "";
        const staffRole = props.staff_role || "";
        const hubspotCompanyName = (props.company || "").trim() || null;
        const smName = props.sm || null;
        const rmName = props.senior_success_manager || null;

        const companyIdentity = await resolveInternalCompanyIdentity(hubspotCompanyName);

        // Parse start date
        let staffStartDate: Date | null = null;
        if (props.staff_start_date?.trim()) {
          const parsed = new Date(props.staff_start_date.trim());
          if (!isNaN(parsed.getTime())) staffStartDate = parsed;
        }

        // Determine employee type
        let employeeType: EmployeeType | null = null;
        if (contactType === "Staff Member - Active") employeeType = "VA";
        else if (contactType === "Ops Staff - Active" && staffRole === "Success Manager") employeeType = "SM";

        if (!employeeType) { skippedCount++; continue; }

        // Resolve SM owner ID
        let smOwnerId: string | null = null;
        if (employeeType === "SM" && email) {
          smOwnerId = ownersByEmail.get(email) || null;
        }

        syncedHubspotIds.add(hubspotId);

        // ── Dedup + conflict detection ──────────────────────────────────────
        // 1. Find existing record by hubspotContactId
        const existingByHsId = await prisma.employeeDirectory.findUnique({
          where: { hubspotContactId: hubspotId }
        });

        // 2. Find existing record by staffId
        const existingByStaffId = await prisma.employeeDirectory.findUnique({
          where: { staffId }
        });

        // Merge internal duplicate representations (same logical employee split
        // across two rows by hubspotContactId/staffId mismatch).
        let updateTarget = existingByStaffId ?? existingByHsId ?? null;
        if (existingByHsId && existingByStaffId && existingByHsId.id !== existingByStaffId.id) {
          const mergeDescription = `Merged duplicate directory rows for HubSpot ID ${hubspotId}: kept staffId ${existingByStaffId.staffId}, removed staffId ${existingByHsId.staffId}`;

          await prisma.$transaction(async (tx) => {
            const duplicateComp = await tx.currentCompensation.findUnique({
              where: { staffId: existingByHsId.staffId }
            });
            const keepComp = await tx.currentCompensation.findUnique({
              where: { staffId: existingByStaffId.staffId }
            });

            if (duplicateComp && !keepComp) {
              await tx.currentCompensation.update({
                where: { staffId: existingByHsId.staffId },
                data: { staffId: existingByStaffId.staffId }
              });
            } else if (duplicateComp && keepComp) {
              await tx.currentCompensation.delete({
                where: { staffId: existingByHsId.staffId }
              });
            }

            await tx.employeeDirectory.delete({ where: { id: existingByHsId.id } });
          });

          mergedDuplicatesCount++;
          console.warn(`[syncEmployeeDirectory] ${mergeDescription}`);
          runIssues.push({
            issueType: "MERGED_DUPLICATE_DIRECTORY_RECORD",
            referenceValue: hubspotId,
            message: mergeDescription,
            severity: "MEDIUM"
          });
          await upsertDataQualityIssue(
            existingByStaffId.staffId,
            existingByStaffId.fullName,
            "MERGED_DUPLICATE_DIRECTORY_RECORD",
            "IDENTITY",
            "MEDIUM",
            mergeDescription,
            {
              hubspotId,
              removedStaffId: existingByHsId.staffId,
              keptStaffId: existingByStaffId.staffId,
              suggestedFix: "No action required. Duplicate records were merged automatically."
            }
          );

          updateTarget = await prisma.employeeDirectory.findUnique({
            where: { id: existingByStaffId.id }
          });
        }

        // Conflict: email already exists on a different staffId
        if (email) {
          const existingByEmail = await prisma.employeeDirectory.findFirst({
            where: { email: { equals: email, mode: "insensitive" } }
          });
          if (existingByEmail && existingByEmail.staffId !== staffId) {
            const desc = `Email ${email} exists on staffId ${existingByEmail.staffId} but incoming record has staffId ${staffId}`;
            console.warn(`[syncEmployeeDirectory] Email conflict: ${desc}`);
            await upsertDataQualityIssue(staffId, fullName, "DUPLICATE_EMAIL", "IDENTITY", "HIGH", desc, {
              email,
              conflictingStaffId: existingByEmail.staffId,
              suggestedFix: "Verify employee identifiers in HubSpot and confirm the correct staff ID."
            });
            runIssues.push({
              issueType: "DUPLICATE_EMAIL",
              referenceValue: email,
              message: desc,
              severity: "HIGH"
            });
            conflictCount++;
            // Don't skip — we still update/create by canonical matching
          }
        }

        // ── HubSpot-first update/create behavior ────────────────────────────
        if (updateTarget) {
          await prisma.employeeDirectory.update({
            where: { id: updateTarget.id },
            data: {
              hubspotContactId: hubspotId,
              staffId,
              fullName,
              email,
              contactType,
              staffRole,
              hubspotCompanyName: companyIdentity.hubspotCompanyName,
              internalCompanyId: companyIdentity.internalCompanyId,
              internalCompanyName: companyIdentity.internalCompanyName,
              companyStatus: companyIdentity.companyStatus,
              companySource: companyIdentity.companySource,
              companyNormalizedAt: companyIdentity.companyNormalizedAt,
              smName,
              smOwnerId,
              rmName,
              staffStartDate,
              employeeType,
              isEmploymentActive: true
            }
          });
          updatedCount++;
        } else {
          await prisma.employeeDirectory.create({
            data: {
              hubspotContactId: hubspotId,
              staffId,
              fullName,
              email,
              contactType,
              staffRole,
              hubspotCompanyName: companyIdentity.hubspotCompanyName,
              internalCompanyId: companyIdentity.internalCompanyId,
              internalCompanyName: companyIdentity.internalCompanyName,
              companyStatus: companyIdentity.companyStatus,
              companySource: companyIdentity.companySource,
              companyNormalizedAt: companyIdentity.companyNormalizedAt,
              smName,
              smOwnerId,
              rmName,
              staffStartDate,
              employeeType,
              isEmploymentActive: true
            }
          });
          createdCount++;
        }

        syncedCount = updatedCount + createdCount;
      } catch (err) {
        const contactId = contacts[i]?.id || `index-${i}`;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[syncEmployeeDirectory] Error at contact ${contactId}: ${msg}`);
        errors.push(`Contact ${contactId}: sync processing failed`);
        runIssues.push({
          issueType: "CONTACT_SYNC_ERROR",
          referenceValue: contactId,
          message: msg,
          severity: "MEDIUM"
        });
        skippedCount++;
      }
    }

    // ── Step 4 (FULL sync only): mark absent records as employment-inactive ──
    if (syncMode === "FULL" && syncedHubspotIds.size > 0) {
      const marked = await prisma.employeeDirectory.updateMany({
        where: {
          hubspotContactId: { notIn: [...syncedHubspotIds] },
          isEmploymentActive: true
        },
        data: { isEmploymentActive: false }
      });
      if (marked.count > 0) {
        console.log(`[syncEmployeeDirectory] Marked ${marked.count} record(s) as employment-inactive`);
        // Log data quality issues for each newly-inactive employee
        const inactiveRecords = await prisma.employeeDirectory.findMany({
          where: { hubspotContactId: { notIn: [...syncedHubspotIds] }, isEmploymentActive: false },
          select: { staffId: true, fullName: true }
        });
        for (const rec of inactiveRecords) {
          await upsertDataQualityIssue(
            rec.staffId, rec.fullName,
            "EMPLOYMENT_INACTIVE", "IDENTITY", "MEDIUM",
            `Employee ${rec.fullName} (${rec.staffId}) was not present in latest HubSpot active sync`,
            {}
          );
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const summaryMessage = `Synced=${syncedCount}, Updated=${updatedCount}, Created=${createdCount}, Skipped=${skippedCount}, MergedDuplicates=${mergedDuplicatesCount}, Conflicts=${conflictCount}, Errors=${errors.length}`;
    await prisma.syncRecord.update({
      where: { id: syncRecord.id },
      data: {
        completedAt: new Date(),
        status: "SUCCESS",
        syncedCount,
        skippedCount,
        errorCount: errors.length,
        conflictCount,
        durationMs,
        errorMessage: `SYNC_SUMMARY:${JSON.stringify({
          updated: updatedCount,
          created: createdCount,
          mergedDuplicates: mergedDuplicatesCount
        })}`
      }
    });
    await prisma.directorySyncRun.update({
      where: { id: syncRun.id },
      data: {
        completedAt: new Date(),
        status: "SUCCESS",
        syncedCount,
        updatedCount,
        createdCount,
        skippedCount,
        mergedDuplicatesCount,
        conflictsCount: conflictCount,
        errorCount: errors.length,
        durationMs,
        summaryMessage,
        issues: {
          create: runIssues.map((issue) => ({
            issueType: issue.issueType,
            referenceValue: issue.referenceValue,
            message: issue.message,
            severity: issue.severity
          }))
        }
      }
    });

    console.log(`[syncEmployeeDirectory] Done. Synced=${syncedCount} Updated=${updatedCount} Created=${createdCount} MergedDuplicates=${mergedDuplicatesCount} Skipped=${skippedCount} Conflicts=${conflictCount} Errors=${errors.length}`);

    // ── Step 5: Refresh Working Data for all synced employees ────────────────
    // This is non-blocking for the sync result — use fire-and-forget for large
    // full syncs, but we await here to ensure data is fresh before the response.
    const syncedStaffIds = [...syncedHubspotIds].reduce<string[]>((ids, hsId) => {
      return ids;
    }, []);
    // Collect staff IDs that were actually processed during this sync run
    // by querying all active employees (faster than tracking per-contact above)
    try {
      const activeEmployees = await prisma.employeeDirectory.findMany({
        where: { isEmploymentActive: true },
        select: { staffId: true }
      });
      const allActiveStaffIds = activeEmployees.map((e) => e.staffId);
      // Run refresh asynchronously to not block the sync response
      refreshWorkingDataForEmployees(allActiveStaffIds).catch((err) => {
        console.warn(`[syncEmployeeDirectory] Working Data background refresh failed: ${err instanceof Error ? err.message : err}`);
      });
      console.log(`[syncEmployeeDirectory] Working Data refresh queued for ${allActiveStaffIds.length} employees`);
    } catch (err) {
      console.warn(`[syncEmployeeDirectory] Could not queue Working Data refresh: ${err instanceof Error ? err.message : err}`);
    }

    try {
      await reapplyLearnedRecordsAfterRebuild();
      await exportLearnedRecords();
    } catch (err) {
      console.warn(`[syncEmployeeDirectory] Learned data reapply/export failed: ${err instanceof Error ? err.message : err}`);
    }

    const finalResult: SyncResult = {
      result: "success",
      synced: syncedCount,
      updated: updatedCount,
      created: createdCount,
      mergedDuplicates: mergedDuplicatesCount,
      skipped: skippedCount,
      conflicts: conflictCount,
      errors,
      timestamp: new Date().toISOString(),
      mode: syncMode,
      durationMs
    };

    resolveActive(finalResult);
    return finalResult;

  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[syncEmployeeDirectory] Fatal error: ${errorMsg}`);

    await prisma.syncRecord.update({
      where: { id: syncRecord.id },
      data: {
        completedAt: new Date(),
        status: "FAILED",
        errorMessage: errorMsg,
        durationMs
      }
    }).catch(() => {});
    await prisma.directorySyncRun.update({
      where: { id: syncRun.id },
      data: {
        completedAt: new Date(),
        status: "FAILED",
        errorCount: 1,
        durationMs,
        summaryMessage: errorMsg,
        issues: {
          create: [
            {
              issueType: "SYNC_FATAL_ERROR",
              referenceValue: null,
              message: errorMsg,
              severity: "HIGH"
            }
          ]
        }
      }
    }).catch(() => {});

    const failResult: SyncResult = {
      result: "failed",
      synced: 0,
      updated: 0,
      created: 0,
      mergedDuplicates: 0,
      skipped: 0,
      conflicts: 0,
      errors: ["Directory sync failed. Check server logs for details."],
      timestamp: new Date().toISOString(),
      mode: syncMode,
      durationMs
    };

    resolveActive(failResult);
    return failResult;
  } finally {
    activeSyncPromise = null;
  }
}

/**
 * Upsert a DataQualityIssue (auto-resolves a prior open issue of same type+staffId if now gone).
 * Creates or updates the first matching open issue.
 */
async function upsertDataQualityIssue(
  staffId: string | null,
  employeeName: string | null,
  issueType: string,
  category: string,
  severity: string,
  description: string,
  metadata: Record<string, unknown>
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
    console.warn(`[upsertDataQualityIssue] Failed to log issue: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Resolve Success Manager and Relationship Manager display names for a batch of entries.
 *
 * Fallback chain for SM:
 *  1. directSmValue — the raw value from intake (often already the SM display name)
 *  2. Look up the employee in EmployeeDirectory by staffId → get smName (HubSpot owner ID)
 *     → look up SM record with smOwnerId = smName → return SM fullName
 *
 * Fallback chain for RM:
 *  1. directRmValue — the raw value from intake
 *  2. Look up the employee in EmployeeDirectory by staffId → get rmName (display name) → use as-is
 *
 * Returns a Map keyed by staffId with resolved { smName, rmName }.
 */
export async function resolveManagerNamesForCases(
  entries: Array<{ staffId: string; directSmValue: string | null; directRmValue: string | null }>
): Promise<Map<string, { smName: string | null; rmName: string | null }>> {
  const result = new Map<string, { smName: string | null; rmName: string | null }>();

  // Collect staff IDs where fallback lookup is needed
  const needsSmFallback: string[] = [];
  const needsRmFallback: string[] = [];

  for (const entry of entries) {
    const sm = entry.directSmValue?.trim() || null;
    const rm = entry.directRmValue?.trim() || null;
    result.set(entry.staffId, { smName: sm, rmName: rm });
    if (!sm) needsSmFallback.push(entry.staffId);
    if (!rm) needsRmFallback.push(entry.staffId);
  }

  // Deduplicate
  const fallbackStaffIds = [...new Set([...needsSmFallback, ...needsRmFallback])];
  if (fallbackStaffIds.length === 0) return result;

  // Batch fetch employee directory records for fallback staff IDs
  const dirRecords = await prisma.employeeDirectory.findMany({
    where: { staffId: { in: fallbackStaffIds } },
    select: { staffId: true, smName: true, rmName: true }
  });

  const dirByStaffId = new Map(dirRecords.map((r) => [r.staffId, r]));

  // For SM fallback: resolve owner IDs → SM display names
  const ownerIds = [...new Set(
    needsSmFallback
      .map((sid) => dirByStaffId.get(sid)?.smName)
      .filter((id): id is string => Boolean(id))
  )];

  const smOwnerMap = new Map<string, string>();
  if (ownerIds.length > 0) {
    const smRecords = await prisma.employeeDirectory.findMany({
      where: {
        smOwnerId: { in: ownerIds },
        employeeType: "SM"
      },
      select: { smOwnerId: true, fullName: true }
    });
    for (const sm of smRecords) {
      if (sm.smOwnerId) smOwnerMap.set(sm.smOwnerId, sm.fullName);
    }
  }

  // Apply fallback values
  for (const staffId of needsSmFallback) {
    const existing = result.get(staffId);
    if (!existing) continue;
    const ownerId = dirByStaffId.get(staffId)?.smName;
    const resolvedSm = (ownerId && smOwnerMap.get(ownerId)) || null;
    result.set(staffId, { ...existing, smName: resolvedSm });
  }

  for (const staffId of needsRmFallback) {
    const existing = result.get(staffId);
    if (!existing) continue;
    const resolvedRm = dirByStaffId.get(staffId)?.rmName?.trim() || null;
    result.set(staffId, { ...existing, rmName: resolvedRm });
  }

  return result;
}
