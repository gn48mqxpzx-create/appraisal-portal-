export const HUBSPOT_CONTACT_PROPS = {
  email: "email",
  contactType: "contact_type",
  staffId: "staff_id_number",
  staffRole: "staff_role",
  staffStartDate: "staff_start_date",
  relationshipManager: "senior_success_manager",
  successManager: "sm"
} as const;

/**
 * Returns an array of HubSpot contact property names
 */
export function getHubSpotPropertyNames(): string[] {
  return Object.values(HUBSPOT_CONTACT_PROPS);
}
