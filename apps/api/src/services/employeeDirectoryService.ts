import { PrismaClient } from "@prisma/client";
import { hubspotFetch, fetchHubSpotOwners, resolveOwnerIdByName, HubSpotOwner } from "./hubspotClient";

const prisma = new PrismaClient();

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
 * Fetch all staff contacts from HubSpot with pagination
 */
async function fetchAllStaffContacts(filterGroups?: any[]): Promise<HubSpotContact[]> {
  const allContacts: HubSpotContact[] = [];
  let after: string | undefined;

  const defaultFilters = [
    {
      filters: [
        {
          propertyName: "contact_type",
          operator: "EQ",
          value: "Staff Member - Active"
        }
      ]
    }
  ];

  do {
    const searchPayload: any = {
      filterGroups: filterGroups || defaultFilters,
      properties: [
        "staff_id_number",
        "firstname",
        "lastname",
        "email",
        "staff_role",
        "contact_type",
        "sm",
        "senior_success_manager",
        "staff_start_date"
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
 * Sync employee directory from HubSpot
 * Fetches active VA and SM contacts and upserts into employee_directory
 * Returns count of synced records
 */
export async function syncEmployeeDirectory(): Promise<{ synced: number }> {
  console.log("[syncEmployeeDirectory] Starting sync...");

  try {
    // Fetch HubSpot owners for SM owner ID matching
    console.log("[syncEmployeeDirectory] Fetching HubSpot owners...");
    const owners = await fetchHubSpotOwners();
    const ownersByEmail = new Map<string, string>();
    owners.forEach((owner) => {
      if (owner.email) {
        ownersByEmail.set(owner.email.toLowerCase().trim(), owner.id);
      }
    });
    console.log(`[syncEmployeeDirectory] Loaded ${owners.length} HubSpot owners`);

    // Fetch both VA and Ops Staff populations.
    const filterGroups = [
      {
        filters: [
          {
            propertyName: "contact_type",
            operator: "EQ",
            value: "Staff Member - Active"
          }
        ]
      },
      {
        filters: [
          {
            propertyName: "contact_type",
            operator: "EQ",
            value: "Ops Staff - Active"
          }
        ]
      }
    ];

    const contacts = await fetchAllStaffContacts(filterGroups);
    console.log(`[syncEmployeeDirectory] Fetched ${contacts.length} contacts from HubSpot`);
    console.log(`[syncEmployeeDirectory] Available Prisma models:`, Object.keys(prisma));

    let syncedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < contacts.length; i++) {
      try {
        const contact = contacts[i];
        const props = contact.properties;

        // Required: result.id
        const hubspotId = contact.id;
        if (!hubspotId) {
          console.warn(`[syncEmployeeDirectory] Skipping: Contact missing ID at index ${i}`);
          skippedCount++;
          continue;
        }

        // Required: staff_id_number
        const staffId = props.staff_id_number;
        if (!staffId) {
          console.warn(`[syncEmployeeDirectory] Skipping: Contact ${hubspotId} missing staff_id_number`);
          skippedCount++;
          continue;
        }

        // Map all fields (don't skip rows with blank optional fields)
        const firstName = props.firstname || "";
        const lastName = props.lastname || "";
        const fullName = `${firstName} ${lastName}`.trim();
        const email = props.email || "";
        const contactType = props.contact_type || "";
        const staffRole = props.staff_role || "";
        const smName = props.sm || null;
        const rmName = props.senior_success_manager || null;

        // Parse staff start date
        let staffStartDate: Date | null = null;
        if (props.staff_start_date) {
          const dateStr = props.staff_start_date.trim();
          if (dateStr) {
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
              staffStartDate = parsed;
            }
          }
        }

        let employeeType: EmployeeType | null = null;
        if (contactType === "Staff Member - Active") {
          employeeType = "VA";
        } else if (contactType === "Ops Staff - Active" && staffRole === "Success Manager") {
          employeeType = "SM";
        }

        // Ignore Ops Staff roles other than Success Manager.
        if (!employeeType) {
          skippedCount++;
          continue;
        }

        // Resolve SM's own owner ID by matching email
        let smOwnerId: string | null = null;
        if (employeeType === "SM" && email) {
          smOwnerId = ownersByEmail.get(email.toLowerCase().trim()) || null;
          if (!smOwnerId) {
            console.warn(`[syncEmployeeDirectory] SM ${fullName} (${email}) not found in HubSpot owners`);
          }
        }

        // Log first row for verification
        if (i === 0) {
          console.log("[syncEmployeeDirectory] First row mapping:", {
            hubspotId,
            staffId,
            fullName,
            email,
            contactType,
            staffRole,
            smName,
            smOwnerId,
            rmName,
            staffStartDate,
            employeeType
          });
        }

        // Upsert the record
        await prisma.employeeDirectory.upsert({
          where: { staffId },
          update: {
            hubspotContactId: hubspotId,
            fullName,
            email,
            contactType,
            staffRole,
            smName,
            smOwnerId,
            rmName,
            staffStartDate,
            employeeType
          },
          create: {
            hubspotContactId: hubspotId,
            staffId,
            fullName,
            email,
            contactType,
            staffRole,
            smName,
            smOwnerId,
            rmName,
            staffStartDate,
            employeeType
          }
        });

        syncedCount++;
      } catch (error) {
        const contactId = contacts[i]?.id || "unknown";
        console.error(
          `[syncEmployeeDirectory] Error syncing contact ${contactId}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    }

    console.log(
      `[syncEmployeeDirectory] Sync complete. Synced: ${syncedCount}, Skipped: ${skippedCount}, Total: ${contacts.length}`
    );
    return { synced: syncedCount };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[syncEmployeeDirectory] Fatal error: ${errorMsg}`);
    throw error;
  }
}
