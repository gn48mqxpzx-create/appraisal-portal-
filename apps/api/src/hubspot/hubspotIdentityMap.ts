export type Identity = {
  staff_id: string;
  email: string | null;
  contact_type: string | null;
  staff_role: string | null;
  staff_start_date: string | null;
  relationship_manager: string | null;
  success_manager: string | null;
};

export const HUBSPOT_IDENTITY_PROPS = {
  staff_id: "staff_id_number",
  email: "email",
  contact_type: "contact_type",
  staff_role: "staff_role",
  staff_start_date: "staff_start_date",
  relationship_manager: "senior_success_manager",
  success_manager: "sm"
} as const;

const normalizeStaffId = (value: string | null): string => {
  if (!value) {
    return "";
  }

  return value.trim().toUpperCase().replace(/\s+/g, "");
};

const toNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
};

const toIsoDate = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const asNumber = Number.parseInt(raw, 10);
    if (Number.isFinite(asNumber)) {
      const fromMs = new Date(asNumber);
      if (!Number.isNaN(fromMs.getTime())) {
        return fromMs.toISOString().slice(0, 10);
      }
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

export function toIdentity(contact: any): Identity {
  const properties = ((contact as { properties?: Record<string, unknown> } | null | undefined)?.properties ?? {}) as Record<string, unknown>;

  const staffId = normalizeStaffId(toNullableString(properties[HUBSPOT_IDENTITY_PROPS.staff_id]));

  return {
    staff_id: staffId,
    email: toNullableString(properties[HUBSPOT_IDENTITY_PROPS.email]),
    contact_type: toNullableString(properties[HUBSPOT_IDENTITY_PROPS.contact_type]),
    staff_role: toNullableString(properties[HUBSPOT_IDENTITY_PROPS.staff_role]),
    staff_start_date: toIsoDate(properties[HUBSPOT_IDENTITY_PROPS.staff_start_date]),
    relationship_manager: toNullableString(properties[HUBSPOT_IDENTITY_PROPS.relationship_manager]),
    success_manager: toNullableString(properties[HUBSPOT_IDENTITY_PROPS.success_manager])
  };
}
