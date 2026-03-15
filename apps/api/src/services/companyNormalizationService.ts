import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const companyClient = prisma as unknown as {
  companyNameAlias: {
    findUnique: (args: unknown) => Promise<any>;
    create: (args: unknown) => Promise<any>;
  };
  internalCompany: {
    findUnique: (args: unknown) => Promise<any>;
    create: (args: unknown) => Promise<any>;
  };
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export const normalizeCompanyKey = (value: string): string => {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|pty|co|company|corp|corporation|limited)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const toCanonicalCompanyName = (value: string): string => {
  return normalizeWhitespace(value)
    .split(" ")
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(" ");
};

export type ResolvedCompanyIdentity = {
  hubspotCompanyName: string | null;
  internalCompanyId: string | null;
  internalCompanyName: string | null;
  companyStatus: string | null;
  companySource: string | null;
  companyNormalizedAt: Date | null;
};

export async function resolveInternalCompanyIdentity(rawCompanyName: string | null | undefined): Promise<ResolvedCompanyIdentity> {
  const trimmed = (rawCompanyName ?? "").trim();
  if (!trimmed) {
    return {
      hubspotCompanyName: null,
      internalCompanyId: null,
      internalCompanyName: null,
      companyStatus: null,
      companySource: null,
      companyNormalizedAt: null
    };
  }

  const normalizedAlias = normalizeCompanyKey(trimmed);
  if (!normalizedAlias) {
    return {
      hubspotCompanyName: trimmed,
      internalCompanyId: null,
      internalCompanyName: null,
      companyStatus: null,
      companySource: "HUBSPOT_CONTACT_COMPANY",
      companyNormalizedAt: null
    };
  }

  const existingAlias = await companyClient.companyNameAlias.findUnique({
    where: { rawNameNormalized: normalizedAlias },
    include: { internalCompany: true }
  });

  if (existingAlias) {
    return {
      hubspotCompanyName: trimmed,
      internalCompanyId: existingAlias.internalCompany.id,
      internalCompanyName: existingAlias.internalCompany.canonicalName,
      companyStatus: existingAlias.internalCompany.status,
      companySource: existingAlias.internalCompany.source,
      companyNormalizedAt: existingAlias.internalCompany.normalizedAt
    };
  }

  const existingCompany = await companyClient.internalCompany.findUnique({
    where: { normalizedKey: normalizedAlias }
  });

  if (existingCompany) {
    await companyClient.companyNameAlias.create({
      data: {
        rawName: trimmed,
        rawNameNormalized: normalizedAlias,
        internalCompanyId: existingCompany.id
      }
    }).catch(() => {
      // Alias may already exist due to concurrent sync runs.
    });

    return {
      hubspotCompanyName: trimmed,
      internalCompanyId: existingCompany.id,
      internalCompanyName: existingCompany.canonicalName,
      companyStatus: existingCompany.status,
      companySource: existingCompany.source,
      companyNormalizedAt: existingCompany.normalizedAt
    };
  }

  const createdCompany = await companyClient.internalCompany.create({
    data: {
      canonicalName: toCanonicalCompanyName(trimmed),
      normalizedKey: normalizedAlias,
      source: "HUBSPOT_CONTACT_COMPANY",
      status: "ACTIVE"
    }
  });

  await companyClient.companyNameAlias.create({
    data: {
      rawName: trimmed,
      rawNameNormalized: normalizedAlias,
      internalCompanyId: createdCompany.id
    }
  }).catch(() => {
    // Alias may already exist due to concurrent sync runs.
  });

  return {
    hubspotCompanyName: trimmed,
    internalCompanyId: createdCompany.id,
    internalCompanyName: createdCompany.canonicalName,
    companyStatus: createdCompany.status,
    companySource: createdCompany.source,
    companyNormalizedAt: createdCompany.normalizedAt
  };
}
