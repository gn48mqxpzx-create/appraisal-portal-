import { Router, type Request, type Response } from "express";
import { getSMDirectory, getRMDirectory, syncEmployeeDirectory, getViewerByEmail } from "./services/employeeDirectoryService";

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

/**
 * GET /directory/viewer/:email
 * Resolve viewer by email and return their directory scope
 * Automatically determines if SM or RM and returns appropriate data
 */
router.get("/viewer/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email).trim();

    if (!email) {
      return res.status(400).json({ error: "email parameter is required" });
    }

    // Hard-coded admin override: must short-circuit before any directory lookup.
    if (email.toLowerCase() === "uly@vaplatinum.com.au") {
      return res.status(200).json({
        viewer_type: "Admin",
        viewer_email: "uly@vaplatinum.com.au",
        viewer_name: "Uly Catalan",
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
          total_sm_count: 0,
          total_va_count: 0
        },
        success_managers: [],
        virtual_assistants: []
      });
    }

    // Step 1: Resolve viewer by email
    const viewerInfo = await getViewerByEmail(email);

    if (!viewerInfo) {
      return res.status(404).json({
        error: "Viewer not found",
        details: `No SM or RM found with email: ${email}`
      });
    }

    // Step 2: Fetch directory based on viewer type
    try {
      if (viewerInfo.viewer_type === "SM") {
        const smOwnerId = viewerInfo.sm_owner_id;
        if (!smOwnerId) {
          return res.status(400).json({
            error: "SM owner ID not found",
            details: `SM ${viewerInfo.viewer_name} has no owner ID mapped`
          });
        }

        const virtualAssistants = await getSMDirectory(smOwnerId);
        return res.status(200).json({
          viewer_type: "SM",
          viewer_email: viewerInfo.viewer_email,
          viewer_name: viewerInfo.viewer_name,
          scope_summary: {
            total_sm_count: 1,
            total_va_count: virtualAssistants.length
          },
          virtual_assistants: virtualAssistants
        });
      } else if (viewerInfo.viewer_type === "RM") {
        const result = await getRMDirectory(viewerInfo.viewer_name);
        return res.status(200).json({
          viewer_type: "RM",
          viewer_email: viewerInfo.viewer_email,
          viewer_name: viewerInfo.viewer_name,
          scope_summary: {
            total_sm_count: result.success_managers.length,
            total_va_count: result.virtual_assistants.length
          },
          success_managers: result.success_managers,
          virtual_assistants: result.virtual_assistants
        });
      }

      return res.status(400).json({
        error: "Invalid viewer type",
        details: `Viewer type must be SM or RM, got: ${viewerInfo.viewer_type}`
      });
    } catch (scopeError) {
      const errorMessage = scopeError instanceof Error ? scopeError.message : "Unknown error";
      return res.status(500).json({
        error: "Failed to fetch directory scope",
        details: errorMessage,
        viewer_info: {
          viewer_type: viewerInfo.viewer_type,
          viewer_email: viewerInfo.viewer_email,
          viewer_name: viewerInfo.viewer_name
        }
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to resolve viewer",
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
    const result = await syncEmployeeDirectory();

    return res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to sync employee directory",
      details: errorMessage
    });
  }
});

export default router;
