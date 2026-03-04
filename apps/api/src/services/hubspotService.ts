import { hubspotFetch } from "./hubspotClient";

export interface HubSpotContact {
  id: string;
  properties: {
    [key: string]: string;
  };
}

interface HubSpotSearchResponse {
  results: HubSpotContact[];
  total: number;
}

interface HubSpotContactProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  hasUniqueValue: boolean;
  hidden: boolean;
  options?: unknown[];
  [key: string]: unknown;
}

interface HubSpotContactPropertiesResponse {
  results: HubSpotContactProperty[];
}

export interface ContactPropertiesFilters {
  search?: string;
  group?: string;
  includeHidden?: boolean;
  limit?: number;
}

export interface TrimmedContactProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  hasUniqueValue: boolean;
  hidden: boolean;
  optionsCount: number;
}

export interface ContactPropertiesResult {
  count: number;
  properties: TrimmedContactProperty[];
}

/**
 * Search for a HubSpot contact by staff ID
 * @param staffId - The staff ID number to search for
 * @returns The contact data or null if not found
 */
export async function getContactByStaffId(staffId: string): Promise<HubSpotContact | null> {
  const searchPayload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "staff_id_number",
            operator: "EQ",
            value: staffId
          }
        ]
      }
    ],
    properties: [
      "email",
      "firstname",
      "lastname",
      "staff_id_number",
      "contact_type",
      "staff_role",
      "staff_start_date",
      "senior_success_manager",
      "sm"
    ],
    limit: 1
  };

  const data = await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify(searchPayload)
  }) as HubSpotSearchResponse;

  if (data.results && data.results.length > 0) {
    return data.results[0];
  }

  return null;
}

export async function getContactProperties(filters: ContactPropertiesFilters = {}): Promise<ContactPropertiesResult> {
  const search = (filters.search ?? "").trim().toLowerCase();
  const group = (filters.group ?? "").trim().toLowerCase();
  const includeHidden = filters.includeHidden ?? false;
  const parsedLimit = Number.isFinite(filters.limit) ? Math.floor(filters.limit as number) : 200;
  const limit = Math.max(1, Math.min(parsedLimit || 200, 1000));

  const data = await hubspotFetch("/crm/v3/properties/contacts", {
    method: "GET"
  }) as HubSpotContactPropertiesResponse;

  const filtered = (data.results ?? [])
    .filter((property) => includeHidden || !property.hidden)
    .filter((property) => {
      if (!group) return true;
      return (property.groupName ?? "").toLowerCase() === group;
    })
    .filter((property) => {
      if (!search) return true;
      const name = (property.name ?? "").toLowerCase();
      const label = (property.label ?? "").toLowerCase();
      return name.includes(search) || label.includes(search);
    })
    .map((property) => ({
      name: property.name,
      label: property.label,
      type: property.type,
      fieldType: property.fieldType,
      groupName: property.groupName,
      hasUniqueValue: Boolean(property.hasUniqueValue),
      hidden: Boolean(property.hidden),
      optionsCount: Array.isArray(property.options) ? property.options.length : 0
    }))
    .slice(0, limit);

  return {
    count: filtered.length,
    properties: filtered
  };
}

export async function getContactPropertyByName(name: string): Promise<Record<string, unknown>> {
  const encodedName = encodeURIComponent(name);
  return await hubspotFetch(`/crm/v3/properties/contacts/${encodedName}`, {
    method: "GET"
  }) as Record<string, unknown>;
}
