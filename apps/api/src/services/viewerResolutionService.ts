import { PrismaClient } from "@prisma/client";
import { fetchHubSpotOwners } from "./hubspotClient";

const prisma = new PrismaClient();
const ADMIN_EMAIL = "uly@vaplatinum.com.au";

export type ResolvedViewerRole =
  | "SITE_LEAD"
  | "SUCCESS_MANAGER"
  | "RELATIONSHIP_MANAGER"
  | "REVIEWER"
  | "UNSCOPED";

export type ResolvedViewerSource = "DIRECTORY" | "HUBSPOT_OWNER" | "ADMIN_OVERRIDE";

export type ResolvedViewerIdentity = {
  source: ResolvedViewerSource;
  normalizedEmail: string;
  fullName: string;
  scopedRole: ResolvedViewerRole;
  employeeRecord: {
    id: string;
    staffId: string;
    fullName: string;
    email: string;
    employeeType: string;
    staffRole: string;
    contactType: string;
    smName: string | null;
    smOwnerId: string | null;
    rmName: string | null;
  } | null;
  rmOwner: {
    id: string;
    email: string;
    fullName: string;
  } | null;
};

export class ViewerNotFoundError extends Error {
  constructor(public readonly email: string) {
    super(`Viewer not found for email: ${email}`);
    this.name = "ViewerNotFoundError";
  }
}

export const normalizeViewerEmail = (email: string | null | undefined): string =>
  (email ?? "").trim().toLowerCase();

const mapEmployeeRole = (employee: {
  employeeType: string;
  staffRole: string;
}): ResolvedViewerRole => {
  const employeeType = employee.employeeType.trim().toUpperCase();
  const staffRole = employee.staffRole.trim().toUpperCase();

  if (employeeType === "SM" || staffRole === "SUCCESS MANAGER") {
    return "SUCCESS_MANAGER";
  }

  if (employeeType === "RM" || staffRole === "RELATIONSHIP MANAGER") {
    return "RELATIONSHIP_MANAGER";
  }

  if (staffRole === "REVIEWER") {
    return "REVIEWER";
  }

  return "UNSCOPED";
};

const buildOwnerFullName = (owner: { firstName?: string | null; lastName?: string | null }): string =>
  [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();

export async function resolveViewerByEmail(email: string): Promise<ResolvedViewerIdentity> {
  const normalizedEmail = normalizeViewerEmail(email);

  if (!normalizedEmail) {
    throw new ViewerNotFoundError(email);
  }

  if (normalizedEmail === ADMIN_EMAIL) {
    return {
      source: "ADMIN_OVERRIDE",
      normalizedEmail,
      fullName: "Uly Catalan",
      scopedRole: "SITE_LEAD",
      employeeRecord: null,
      rmOwner: null
    };
  }

  const employees = await prisma.employeeDirectory.findMany({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive"
      }
    },
    select: {
      id: true,
      staffId: true,
      fullName: true,
      email: true,
      employeeType: true,
      staffRole: true,
      contactType: true,
      smName: true,
      smOwnerId: true,
      rmName: true
    }
  });

  if (employees.length > 1) {
    const exactNormalized = employees.filter(
      (employee) => normalizeViewerEmail(employee.email) === normalizedEmail
    );

    if (exactNormalized.length === 1) {
      const employee = exactNormalized[0];
      return {
        source: "DIRECTORY",
        normalizedEmail,
        fullName: employee.fullName,
        scopedRole: mapEmployeeRole(employee),
        employeeRecord: employee,
        rmOwner: null
      };
    }

    throw new Error(`Ambiguous viewer identity for email: ${normalizedEmail}`);
  }

  if (employees.length === 1) {
    const employee = employees[0];
    return {
      source: "DIRECTORY",
      normalizedEmail,
      fullName: employee.fullName,
      scopedRole: mapEmployeeRole(employee),
      employeeRecord: employee,
      rmOwner: null
    };
  }

  const owners = await fetchHubSpotOwners();
  const owner = owners.find((candidate) => normalizeViewerEmail(candidate.email) === normalizedEmail);

  if (!owner) {
    throw new ViewerNotFoundError(normalizedEmail);
  }

  return {
    source: "HUBSPOT_OWNER",
    normalizedEmail,
    fullName: buildOwnerFullName(owner) || owner.email,
    scopedRole: "RELATIONSHIP_MANAGER",
    employeeRecord: null,
    rmOwner: {
      id: owner.id,
      email: owner.email,
      fullName: buildOwnerFullName(owner)
    }
  };
}
