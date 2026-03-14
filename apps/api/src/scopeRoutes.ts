import { Router, type Request, type Response } from "express";
import { hubspotFetch, getHubSpotToken } from "./services/hubspotClient";
import { requireAuth } from "./auth";
import { resolveViewerHierarchy } from "./services/hierarchyResolutionService";

const router = Router();

// Staff-only contact types
const STAFF_CONTACT_TYPES = [
  "Staff Member - Active",
  "Staff Member - Separated",
  "Staff Member - For Reprofile",
  "Staff Member - HR Floating",
  "Staff Member - Maternity",
  "Staff Member - Temporary Inactive",
  "Ops Staff - Active",
  "Ops Staff - Separated",
  "Ops Staff - Maternity",
  "Ops Staff - HR Floating",
  "Ops Staff - Reprofile",
  "Ops Staff - Temporary Inactive",
  "Ops Intern - Active",
  "Ops Intern - Separated",
  "Onshore Staff Member",
  "Onshore Staff - Separated"
];

// Appraisal-eligible contact types (active only, no separated)
const APPRAISAL_ELIGIBLE_CONTACT_TYPES = [
  "Staff Member - Active",
  "Ops Staff - Active",
  "Onshore Staff - Active"
];

// Staff roles to exclude from appraisal eligibility
const NON_VA_ROLE_KEYWORDS = ["Manager", "Director", "Head", "Lead", "Controller", "Officer"];
const NON_VA_EXACT_ROLES = ["Success Manager", "Relationship Manager"];

interface HubSpotContact {
  id: string;
  properties: {
    staff_id_number?: string;
    firstname?: string;
    lastname?: string;
    email?: string;
    staff_role?: string;
    contact_type?: string;
    sm?: string;
    senior_success_manager?: string;
    [key: string]: string | undefined;
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
  staff_role: string;
  contact_type: string;
  sm_owner_id: string;
  rm: string;
}

/**
 * Determine if a staff member is eligible for appraisal
 * Appraisal-eligible staff must:
 * 1) Have a contact_type in APPRAISAL_ELIGIBLE_CONTACT_TYPES
 * 2) Have a staff_id present (non-empty)
 * 3) Have an email present (non-empty)
 * 4) Not be a leadership/non-VA role (exclude Manager, Director, Head, Lead, Controller, Officer, Success Manager, Relationship Manager)
 * 5) Optionally: exclude the viewer's own record (by staff_id or email)
 *
 * @param row - The staff row to check
 * @param viewer - Optional viewer context { staff_id?: string; viewer_email?: string }
 * @returns true if eligible for appraisal, false otherwise
 */
function isAppraisalEligibleStaff(
  row: StaffRow,
  viewer?: { staff_id?: string | null; viewer_email?: string | null }
): boolean {
  // Check contact type is appraisal-eligible (active only)
  if (!APPRAISAL_ELIGIBLE_CONTACT_TYPES.includes(row.contact_type)) {
    return false;
  }

  // Must have staff_id
  if (!row.staff_id || row.staff_id.trim() === "") {
    return false;
  }

  // Must have email
  if (!row.email || row.email.trim() === "") {
    return false;
  }

  // Exclude leadership/non-VA roles
  const staffRole = row.staff_role || "";

  // Check exact matches first
  for (const exactRole of NON_VA_EXACT_ROLES) {
    if (staffRole === exactRole) {
      return false;
    }
  }

  // Check for keyword matches (e.g., "Manager" appears in role)
  for (const keyword of NON_VA_ROLE_KEYWORDS) {
    if (staffRole.includes(keyword)) {
      return false;
    }
  }

  // Exclude viewer's own record if viewer is provided
  if (viewer) {
    const viewerStaffId = viewer.staff_id?.trim();
    const viewerEmail = viewer.viewer_email?.trim();

    // Exclude if staff_id matches viewer's staff_id
    if (viewerStaffId && row.staff_id === viewerStaffId) {
      return false;
    }

    // Exclude if email matches viewer's email (case-insensitive)
    if (viewerEmail && row.email.toLowerCase() === viewerEmail.toLowerCase()) {
      return false;
    }
  }

  return true;
}

/**
 * Fetch all staff contacts from HubSpot with pagination
 * @param filters - Optional filter groups for the search
 * @returns Array of all staff contacts
 */
async function fetchAllStaffContacts(filters?: any[]): Promise<HubSpotContact[]> {
  const allContacts: HubSpotContact[] = [];
  let after: string | undefined;

  const filterGroups = filters || [
    {
      filters: [
        {
          propertyName: "contact_type",
          operator: "IN",
          values: STAFF_CONTACT_TYPES
        }
      ]
    }
  ];

  do {
    const searchPayload: any = {
      filterGroups,
      properties: [
        "staff_id_number",
        "firstname",
        "lastname",
        "email",
        "staff_role",
        "contact_type",
        "sm",
        "senior_success_manager"
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

  return {
    hubspot_id: contact.id,
    staff_id: props.staff_id_number || "",
    full_name: fullName,
    email: props.email || "",
    staff_role: props.staff_role || "",
    contact_type: props.contact_type || "",
    sm_owner_id: props.sm || "",
    rm: props.senior_success_manager || ""
  };
}

/**
 * Core logic for SM scope - fetch staff assigned to a specific SM owner ID
 * Exported for reuse in /scope/me endpoint
 * @param smOwnerId - The SM owner ID to filter by
 * @param options - Filter options { includeNonEligible?, includeSeparated?, viewer? }
 * @returns Response object with staff list and counts
 */
export async function fetchSmScope(
  smOwnerId: string,
  options?: {
    includeNonEligible?: boolean;
    includeSeparated?: boolean;
    viewer?: { staff_id?: string | null; viewer_email?: string | null };
  }
) {
  const filterGroups = [
    {
      filters: [
        {
          propertyName: "sm",
          operator: "EQ",
          value: smOwnerId
        },
        {
          propertyName: "contact_type",
          operator: "IN",
          values: STAFF_CONTACT_TYPES
        }
      ]
    }
  ];

  const contacts = await fetchAllStaffContacts(filterGroups);
  const allStaff = contacts.map(transformToStaffRow);
  const rawCount = allStaff.length;

  // Apply filters unless includeNonEligible is true
  let filteredStaff = allStaff;

  if (!options?.includeNonEligible) {
    // Filter for appraisal-eligible staff
    filteredStaff = allStaff.filter((staff) => isAppraisalEligibleStaff(staff, options?.viewer));
  } else if (!options?.includeSeparated) {
    // Filter out separated even when includeNonEligible is true
    filteredStaff = allStaff.filter(
      (staff) => !staff.contact_type.includes("Separated")
    );
  }

  return {
    viewer_type: "SM" as const,
    sm_owner_id: smOwnerId,
    count: filteredStaff.length,
    raw_count: rawCount,
    staff: filteredStaff
  };
}

/**
 * Core logic for RM scope - fetch staff assigned to a specific RM and group by SM
 * Exported for reuse in /scope/me endpoint
 * @param rm - The RM name to filter by
 * @param options - Filter options { includeNonEligible?, includeSeparated?, viewer? }
 * @returns Response object with SM groups and counts
 */
export async function fetchRmScope(
  rm: string,
  options?: {
    includeNonEligible?: boolean;
    includeSeparated?: boolean;
    viewer?: { staff_id?: string | null; viewer_email?: string | null };
  }
) {
  const filterGroups = [
    {
      filters: [
        {
          propertyName: "senior_success_manager",
          operator: "EQ",
          value: rm
        },
        {
          propertyName: "contact_type",
          operator: "IN",
          values: STAFF_CONTACT_TYPES
        }
      ]
    }
  ];

  // Debug logging for non-production environments
  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG fetchRmScope] Filter payload:", JSON.stringify(filterGroups, null, 2));
  }

  const contacts = await fetchAllStaffContacts(filterGroups);
  const allStaff = contacts.map(transformToStaffRow);
  const rawTotalStaff = allStaff.length;

  // Apply filters to each staff member unless includeNonEligible is true
  let filteredStaff = allStaff;

  if (!options?.includeNonEligible) {
    // Filter for appraisal-eligible staff
    filteredStaff = allStaff.filter((staff) => isAppraisalEligibleStaff(staff, options?.viewer));
  } else if (!options?.includeSeparated) {
    // Filter out separated even when includeNonEligible is true
    filteredStaff = allStaff.filter(
      (staff) => !staff.contact_type.includes("Separated")
    );
  }

  // Group filtered staff by SM owner ID
  const groupedBySm = new Map<string, StaffRow[]>();

  for (const staffMember of filteredStaff) {
    const smOwnerId = staffMember.sm_owner_id || "(unassigned)";
    if (!groupedBySm.has(smOwnerId)) {
      groupedBySm.set(smOwnerId, []);
    }
    groupedBySm.get(smOwnerId)!.push(staffMember);
  }

  // Convert to array format for response
  const smGroups = Array.from(groupedBySm.entries()).map(([smOwnerId, staff]) => ({
    sm_owner_id: smOwnerId,
    count: staff.length,
    staff
  }));

  // Sort by SM owner ID for consistent output
  smGroups.sort((a, b) => a.sm_owner_id.localeCompare(b.sm_owner_id));

  return {
    viewer_type: "RM" as const,
    rm,
    total_staff: filteredStaff.length,
    raw_total_staff: rawTotalStaff,
    sm_groups: smGroups
  };
}

/**
 * GET /scope/sm/:smOwnerId
 * Filter HubSpot contacts where sm == :smOwnerId AND contact_type is any staff type
 * By default returns only appraisal-eligible VAs
 * Query params:
 *   - include_non_eligible=true: return all staff including managers, non-active, etc.
 *   - include_separated=true: include separated staff (only with include_non_eligible=true)
 */
router.get("/sm/:smOwnerId", async (req: Request, res: Response) => {
  try {
    // Check for HubSpot token
    try {
      getHubSpotToken();
    } catch {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }

    const smOwnerId = req.params.smOwnerId;

    if (!smOwnerId) {
      return res.status(400).json({ error: "smOwnerId is required" });
    }

    const includeNonEligible = req.query.include_non_eligible === "true";
    const includeSeparated = req.query.include_separated === "true";

    const result = await fetchSmScope(smOwnerId, {
      includeNonEligible,
      includeSeparated
    });
    return res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to fetch SM scope",
      details: errorMessage
    });
  }
});

/**
 * GET /scope/rm/:rm
 * Filter HubSpot contacts where success_manager == :rm AND contact_type is any staff type
 * Group results by sm (owner id) so RM sees buckets by SM
 * By default returns only appraisal-eligible VAs
 * Query params:
 *   - include_non_eligible=true: return all staff including managers, non-active, etc.
 *   - include_separated=true: include separated staff (only with include_non_eligible=true)
 */
router.get("/rm/:rm", async (req: Request, res: Response) => {
  try {
    // Check for HubSpot token
    try {
      getHubSpotToken();
    } catch {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }

    const rm = decodeURIComponent(req.params.rm).trim();

    if (!rm) {
      return res.status(400).json({ error: "rm is required" });
    }

    const includeNonEligible = req.query.include_non_eligible === "true";
    const includeSeparated = req.query.include_separated === "true";

    const result = await fetchRmScope(rm, {
      includeNonEligible,
      includeSeparated
    });
    return res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to fetch RM scope",
      details: errorMessage
    });
  }
});

/**
 * GET /scope/me
 * Return scoped data for the authenticated viewer based on their type
 * By default returns only appraisal-eligible VAs (excluding the viewer themselves)
 * Query params:
 *   - include_non_eligible=true: return all staff including managers, non-active, etc.
 *   - include_separated=true: include separated staff (only with include_non_eligible=true)
 */
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.viewer) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const viewerRole = req.viewer.viewer_type === "SM" ? "SUCCESS_MANAGER" : req.viewer.viewer_type === "RM" ? "RELATIONSHIP_MANAGER" : "UNSCOPED";
    const hierarchy = await resolveViewerHierarchy({
      email: req.viewer.viewer_email,
      role: viewerRole,
      name: req.viewer.viewer_full_name,
      id: req.viewer.staff_id
    });

    if (hierarchy.scopedRole !== "SUCCESS_MANAGER" && hierarchy.scopedRole !== "RELATIONSHIP_MANAGER") {
      return res.status(403).json({
        error: "Viewer type UNSCOPED has no scope access",
        viewer_type: req.viewer.viewer_type,
        unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason,
        diagnostics: hierarchy.diagnostics
      });
    }

    if (hierarchy.scopedRole === "SUCCESS_MANAGER") {
      return res.status(200).json({
        viewer_type: "SM",
        viewer_email: req.viewer.viewer_email,
        viewer_name: hierarchy.resolvedViewerRecord?.fullName || req.viewer.viewer_full_name,
        count: hierarchy.vaRecords.length,
        raw_count: hierarchy.vaRecords.length,
        staff: hierarchy.vaRecords.map((record) => ({
          hubspot_id: "",
          staff_id: record.staffId,
          full_name: record.fullName,
          email: record.email,
          staff_role: record.staffRole,
          contact_type: record.contactType,
          sm_owner_id: record.smName ?? "",
          rm: record.rmName ?? ""
        })),
        unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason,
        diagnostics: hierarchy.diagnostics
      });
    }

    const groupedBySm = new Map<string, Array<{
      hubspot_id: string;
      staff_id: string;
      full_name: string;
      email: string;
      staff_role: string;
      contact_type: string;
      sm_owner_id: string;
      rm: string;
    }>>();

    for (const vaRecord of hierarchy.vaRecords) {
      const smOwnerId = vaRecord.smName ?? "(unassigned)";
      if (!groupedBySm.has(smOwnerId)) {
        groupedBySm.set(smOwnerId, []);
      }

      groupedBySm.get(smOwnerId)!.push({
        hubspot_id: "",
        staff_id: vaRecord.staffId,
        full_name: vaRecord.fullName,
        email: vaRecord.email,
        staff_role: vaRecord.staffRole,
        contact_type: vaRecord.contactType,
        sm_owner_id: vaRecord.smName ?? "",
        rm: vaRecord.rmName ?? ""
      });
    }

    const smGroups = Array.from(groupedBySm.entries())
      .map(([smOwnerId, staff]) => ({
        sm_owner_id: smOwnerId,
        count: staff.length,
        staff
      }))
      .sort((a, b) => a.sm_owner_id.localeCompare(b.sm_owner_id));

    return res.status(200).json({
      viewer_type: "RM",
      rm: hierarchy.resolvedViewerRecord?.fullName || req.viewer.viewer_full_name,
      total_staff: hierarchy.vaRecords.length,
      raw_total_staff: hierarchy.vaRecords.length,
      sm_groups: smGroups,
      unresolvedHierarchyReason: hierarchy.unresolvedHierarchyReason,
      diagnostics: hierarchy.diagnostics
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to fetch scope",
      details: errorMessage
    });
  }
});

export default router;