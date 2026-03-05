import { hubspotFetch } from "../services/hubspotClient";
import { HUBSPOT_IDENTITY_PROPS } from "./hubspotIdentityMap";

export interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

interface HubSpotSearchResponse {
  results: HubSpotContact[];
}

const normalizeStaffId = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, "");

const IDENTITY_PROPERTY_LIST = [
  HUBSPOT_IDENTITY_PROPS.staff_id,
  HUBSPOT_IDENTITY_PROPS.email,
  HUBSPOT_IDENTITY_PROPS.contact_type,
  HUBSPOT_IDENTITY_PROPS.staff_role,
  HUBSPOT_IDENTITY_PROPS.staff_start_date,
  HUBSPOT_IDENTITY_PROPS.relationship_manager,
  HUBSPOT_IDENTITY_PROPS.success_manager,
  "firstname",
  "lastname"
];

const searchContact = async (propertyName: string, value: string): Promise<HubSpotContact | null> => {
  const payload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName,
            operator: "EQ",
            value
          }
        ]
      }
    ],
    properties: IDENTITY_PROPERTY_LIST,
    limit: 1
  };

  const data = (await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify(payload)
  })) as HubSpotSearchResponse;

  return data.results?.[0] ?? null;
};

export async function getContactByStaffId(staffId: string): Promise<HubSpotContact | null> {
  const normalizedStaffId = normalizeStaffId(staffId);
  if (!normalizedStaffId) {
    return null;
  }

  return searchContact(HUBSPOT_IDENTITY_PROPS.staff_id, normalizedStaffId);
}

export async function getContactByEmail(email: string): Promise<HubSpotContact | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  return searchContact(HUBSPOT_IDENTITY_PROPS.email, normalizedEmail);
}
