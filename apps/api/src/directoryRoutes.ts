import { Router, type Request, type Response } from "express";
import { CanonicalHierarchyRole } from "@prisma/client";
import { getSMDirectory, getRMDirectory, syncEmployeeDirectory, getAdminDirectory } from "./services/employeeDirectoryService";
import { runDataQualityChecks } from "./services/dataQualityService";
import { resolveViewerHierarchy } from "./services/hierarchyResolutionService";
import { ViewerNotFoundError, resolveViewerByEmail } from "./services/viewerResolutionService";
import {
  backfillCanonicalHierarchyMappings,
  listUnresolvedCanonicalHierarchyMappings,
  upsertAdminHierarchyOverride,
  validateCanonicalHierarchyMappings
} from "./services/canonicalHierarchyService";

const router = Router();

interface StaffRow {
  hubspot_id: string;
  staff_id: string;
  full_name: string;
  email: string;
  staff_role: string;
  contact_type: string;
  sm_owner_id: string;
  rm: string;
  staff_start_date?: string;
}

const mapDirectoryRecordToStaffRow = (record: {
  staffId: string;
  fullName: string;
  email: string;
  staffRole: string;
  contactType: string;
  smName: string | null;
  smOwnerId: string | null;
  rmName: string | null;
}): StaffRow => ({
  hubspot_id: "",
  staff_id: record.staffId,
  full_name: record.fullName,
  email: record.email,
  staff_role: record.staffRole,
  contact_type: record.contactType,
  sm_owner_id: record.smName ?? "",
  rm: record.rmName ?? ""
});

const parseCanonicalRole = (value: string | null | undefined): CanonicalHierarchyRole => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "SITE_LEAD") {
    return CanonicalHierarchyRole.SITE_LEAD;
  }

  if (normalized === "SUCCESS_MANAGER" || normalized === "SM") {
    return CanonicalHierarchyRole.SUCCESS_MANAGER;
  }

  if (normalized === "RELATIONSHIP_MANAGER" || normalized === "RM") {
    return CanonicalHierarchyRole.RELATIONSHIP_MANAGER;
  }

  if (normalized === "REVIEWER") {
    return CanonicalHierarchyRole.REVIEWER;
  }

  return CanonicalHierarchyRole.UNSCOPED;
};

/**
 * GET /directory/viewer/:email
 * Resolve viewer by email and return their directory scope
 * Automatically determines if SM or RM and returns appropriate data
 */
router.get("/viewer/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "email parameter is required" });
    }

    const resolvedViewer = await resolveViewerByEmail(email);

    if (resolvedViewer.scopedRole === "SITE_LEAD") {
      const adminDirectory = await getAdminDirectory();

      return res.status(200).json({
        viewer_type: "Admin",
        viewer_email: resolvedViewer.normalizedEmail,
        viewer_name: resolvedViewer.fullName,
        permissions: {
          canViewDashboard: true,
          canViewCases: true,
          canViewWsll: true,
          canEditWsll: true,
          canUploadWsll: true,
          canViewPayrollExport: true,
          canViewAdminConsole: true
        },
        scope_summary: {
          total_sm_count: adminDirectory.success_managers.length,
          total_va_count: adminDirectory.virtual_assistants.length
        },
        success_managers: adminDirectory.success_managers,
        virtual_assistants: adminDirectory.virtual_assistants
      });
    }

    if (resolvedViewer.scopedRole !== "SUCCESS_MANAGER" && resolvedViewer.scopedRole !== "RELATIONSHIP_MANAGER") {
      return res.status(404).json({
        error: "Viewer not found",
        details: `No SM or RM profile found for email: ${email}`
      });
    }

    const hierarchy = await resolveViewerHierarchy({
      email: resolvedViewer.normalizedEmail,
      role: resolvedViewer.scopedRole
    });

    if (hierarchy.scopedRole !== "SUCCESS_MANAGER" && hierarchy.scopedRole !== "RELATIONSHIP_MANAGER") {
      return res.status(404).json({
        error: "Viewer not found",
        details: `No SM or RM scope found for email: ${email}`
      });
    }

    const viewerEmail = resolvedViewer.normalizedEmail;
    const viewerName =
      hierarchy.resolvedViewerRecord?.fullName ||
      resolvedViewer.fullName ||
      hierarchy.rmOwner?.fullName ||
      viewerEmail;

    if (hierarchy.scopedRole === "SUCCESS_MANAGER") {
      const virtualAssistants = hierarchy.vaRecords.map(mapDirectoryRecordToStaffRow);

      return res.status(200).json({
        viewer_type: "SM",
        viewer_email: viewerEmail,
        viewer_name: viewerName,
        scope_summary: {
          total_sm_count: 1,
          total_va_count: virtualAssistants.length
        },
        virtual_assistants: virtualAssistants,
        unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason,
        hierarchyDiagnostics: hierarchy.diagnostics
      });
    }

    const successManagers = hierarchy.smRecords.map(mapDirectoryRecordToStaffRow);
    const virtualAssistants = hierarchy.vaRecords.map(mapDirectoryRecordToStaffRow);

    return res.status(200).json({
      viewer_type: "RM",
      viewer_email: viewerEmail,
      viewer_name: viewerName,
      scope_summary: {
        total_sm_count: successManagers.length,
        total_va_count: virtualAssistants.length
      },
      success_managers: successManagers,
      virtual_assistants: virtualAssistants,
      unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason,
      hierarchyDiagnostics: hierarchy.diagnostics
    });
  } catch (error) {
    if (error instanceof ViewerNotFoundError) {
      return res.status(404).json({
        error: "Viewer not found",
        details: `No exact email match for: ${error.email}`
      });
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to resolve viewer",
      details: errorMessage
    });
  }
});

router.post("/hierarchy/backfill", async (_req: Request, res: Response) => {
  try {
    const result = await backfillCanonicalHierarchyMappings();
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      success: false,
      error: "Failed to backfill canonical hierarchy mappings",
      details: errorMessage
    });
  }
});

router.get("/hierarchy/unresolved", async (_req: Request, res: Response) => {
  try {
    const rows = await listUnresolvedCanonicalHierarchyMappings();
    return res.status(200).json({
      success: true,
      data: {
        total: rows.length,
        rows
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      success: false,
      error: "Failed to fetch unresolved hierarchy mappings",
      details: errorMessage
    });
  }
});

router.post("/hierarchy/override", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const mapping = await upsertAdminHierarchyOverride({
      userEmail: String(body.userEmail ?? ""),
      userName: body.userName ?? null,
      canonicalRole: parseCanonicalRole(body.canonicalRole),
      managerEmail: body.managerEmail ?? null,
      managerName: body.managerName ?? null,
      staffId: body.staffId ?? null,
      mappedSmEmails: Array.isArray(body.mappedSmEmails) ? body.mappedSmEmails.map(String) : [],
      mappedSmNames: Array.isArray(body.mappedSmNames) ? body.mappedSmNames.map(String) : [],
      mappedRmEmail: body.mappedRmEmail ?? null,
      mappedRmName: body.mappedRmName ?? null,
      scopedStaffIds: Array.isArray(body.scopedStaffIds) ? body.scopedStaffIds.map(String) : [],
      unresolvedHierarchyReason: body.unresolvedHierarchyReason ?? null,
      diagnostics: body.diagnostics ?? null
    });

    return res.status(200).json({
      success: true,
      data: mapping
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      success: false,
      error: "Failed to create hierarchy override",
      details: errorMessage
    });
  }
});

router.get("/hierarchy/validate", async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === "true";
    const report = await validateCanonicalHierarchyMappings({
      refreshBeforeValidate: refresh
    });

    return res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      success: false,
      error: "Failed to validate canonical hierarchy mappings",
      details: errorMessage
    });
  }
});

/**
 * GET /directory/sm/:smOwnerId
 * Return all active VAs under a specific SM
 */
router.get("/sm/:smOwnerId", async (req: Request, res: Response) => {
  try {
    const smOwnerId = decodeURIComponent(req.params.smOwnerId).trim();

    if (!smOwnerId) {
      return res.status(400).json({ error: "smOwnerId is required" });
    }

    const virtualAssistants = await getSMDirectory(smOwnerId);

    return res.status(200).json({
      viewer_type: "SM",
      sm_name: smOwnerId,
      total_va_count: virtualAssistants.length,
      virtual_assistants: virtualAssistants
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to fetch SM directory",
      details: errorMessage
    });
  }
});

/**
 * GET /directory/rm/:rmName
 * Return SMs and staff under a specific RM
 */
router.get("/rm/:rmName", async (req: Request, res: Response) => {
  try {
    const rmName = decodeURIComponent(req.params.rmName).trim();

    if (!rmName) {
      return res.status(400).json({ error: "rmName is required" });
    }

    const result = await getRMDirectory(rmName);

    return res.status(200).json({
      viewer_type: "RM",
      rm_name: rmName,
      total_sm_count: result.success_managers.length,
      total_va_count: result.virtual_assistants.length,
      success_managers: result.success_managers,
      virtual_assistants: result.virtual_assistants
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to fetch RM directory",
      details: errorMessage
    });
  }
});

/**
 * POST /directory/sync
 * Sync employee directory from HubSpot
 */
router.post("/sync", async (req: Request, res: Response) => {
  try {
    console.log("[directoryRoutes POST /sync] Starting sync");
    const result = await syncEmployeeDirectory({ triggeredBy: "admin" });
    const hierarchyBackfill = await backfillCanonicalHierarchyMappings();

    // Run data quality checks in background after sync completes
    runDataQualityChecks().catch((err) =>
      console.warn("[directoryRoutes] Data quality checks failed:", err instanceof Error ? err.message : err)
    );

    return res.status(200).json({
      ...result,
      hierarchyBackfill
    });
  } catch (_error) {
    return res.status(500).json({
      error: "Failed to sync employee directory"
    });
  }
});

export default router;
