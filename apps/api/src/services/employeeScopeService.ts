import { CaseStatus, PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const CASE_STATUSES = new Set(Object.values(CaseStatus));

export const ALLOWED_APPRAISAL_CONTACT_TYPES = [
  "Ops Staff - Active",
  "Staff Member - Active",
  "Staff Member - For Reprofile",
  "Staff Member - HR Floating",
  "Staff Member - Maternity"
] as const;

export type ScopedEmployeeRole = "SITE_LEAD" | "SUCCESS_MANAGER" | "RELATIONSHIP_MANAGER" | "REVIEWER";

export type ScopedEmployeeUser = {
  role: string;
  name?: string | null;
  email?: string | null;
  id?: string | null;
};

export type ScopedEmployeeQueryOptions = {
  cycleId?: string;
  includeRemoved?: boolean;
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  staffRole?: string;
  contactType?: string;
};

type ScopedCaseFilterOptions = Omit<ScopedEmployeeQueryOptions, "page" | "pageSize">;

type ScopedHierarchy = {
  vaStaffIds: string[];
  smIdentifiers: string[];
  rmIdentifiers: string[];
};

export type ScopedEmployeeCaseRecord = {
  id: string;
  staffId: string;
  fullName: string;
  staffRole: string;
  contactType: string;
  successManagerStaffId: string | null;
  relationshipManagerStaffId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  closeDate: Date | null;
  compCurrent: { baseSalary: Prisma.Decimal } | null;
  marketSnapshot: { wsllGateStatus: string } | null;
  recommendation:
    | {
        recommendedNewBase: Prisma.Decimal;
        submittedTargetSalary: Prisma.Decimal | null;
        submittedIncreaseAmount: Prisma.Decimal | null;
        finalTargetSalary: Prisma.Decimal | null;
        finalIncreaseAmount: Prisma.Decimal | null;
      }
    | null;
  override:
    | {
        overrideAmount: Prisma.Decimal | null;
        overridePercent: Prisma.Decimal | null;
        overrideNewBase: Prisma.Decimal | null;
      }
    | null;
};

const normalizeIdentifier = (value: string | null | undefined): string => value?.trim() ?? "";
const toIdentifierSet = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => normalizeIdentifier(value).toLowerCase()).filter(Boolean))];

const buildViewerIdentifiers = (user: ScopedEmployeeUser): string[] =>
  toIdentifierSet([user.email, user.id, user.name]);

const buildSuccessManagerIdentifiers = (user: ScopedEmployeeUser): string[] => buildViewerIdentifiers(user);

export const normalizeScopedRole = (role: string): ScopedEmployeeRole | null => {
  const normalized = role.trim().toUpperCase();

  if (normalized === "ADMIN" || normalized === "SITE_LEAD") {
    return "SITE_LEAD";
  }

  if (normalized === "SM" || normalized === "SUCCESS_MANAGER") {
    return "SUCCESS_MANAGER";
  }

  if (normalized === "RM" || normalized === "RELATIONSHIP_MANAGER") {
    return "RELATIONSHIP_MANAGER";
  }

  if (normalized === "REVIEWER") {
    return "REVIEWER";
  }

  return null;
};

const toInsensitiveEquals = (field: "staffId" | "fullName" | "email" | "smOwnerId" | "smName" | "rmName", values: string[]) =>
  values.map((value) => ({
    [field]: {
      equals: value,
      mode: "insensitive" as const
    }
  }));

const getSmRecordsForViewer = async (viewerIdentifiers: string[]) => {
  if (viewerIdentifiers.length === 0) {
    return [];
  }

  return prisma.employeeDirectory.findMany({
    where: {
      employeeType: "SM",
      OR: [
        ...toInsensitiveEquals("email", viewerIdentifiers),
        ...toInsensitiveEquals("fullName", viewerIdentifiers),
        ...toInsensitiveEquals("staffId", viewerIdentifiers),
        ...toInsensitiveEquals("smOwnerId", viewerIdentifiers)
      ]
    },
    select: {
      staffId: true,
      fullName: true,
      email: true,
      smOwnerId: true
    }
  });
};

const getSmRecordsForRm = async (rmIdentifiers: string[]) => {
  if (rmIdentifiers.length === 0) {
    return [];
  }

  return prisma.employeeDirectory.findMany({
    where: {
      employeeType: "SM",
      OR: [
        ...toInsensitiveEquals("rmName", rmIdentifiers),
        ...toInsensitiveEquals("smName", rmIdentifiers)
      ]
    },
    select: {
      staffId: true,
      fullName: true,
      email: true,
      smOwnerId: true
    }
  });
};

const getVaStaffIdsForSmIdentifiers = async (
  smIdentifiers: string[],
  rmIdentifiers: string[] = []
): Promise<string[]> => {
  if (smIdentifiers.length === 0 && rmIdentifiers.length === 0) {
    return [];
  }

  const rows = await prisma.employeeDirectory.findMany({
    where: {
      employeeType: "VA",
      OR: [
        ...toInsensitiveEquals("smName", smIdentifiers),
        ...toInsensitiveEquals("rmName", rmIdentifiers)
      ]
    },
    select: {
      staffId: true
    }
  });

  return [...new Set(rows.map((row) => row.staffId).filter(Boolean))];
};

const buildSmIdentifierSet = (
  smRecords: Array<{
    staffId: string;
    fullName: string;
    email: string;
    smOwnerId: string | null;
  }>
): string[] =>
  toIdentifierSet(
    smRecords.flatMap((record) => [record.staffId, record.fullName, record.email, record.smOwnerId])
  );

export async function getHierarchyForRM(user: ScopedEmployeeUser): Promise<ScopedHierarchy> {
  const rmIdentifiers = buildViewerIdentifiers(user);
  const smRecords = await getSmRecordsForRm(rmIdentifiers);
  const smIdentifiers = buildSmIdentifierSet(smRecords);
  const vaStaffIds = await getVaStaffIdsForSmIdentifiers(smIdentifiers, rmIdentifiers);

  return {
    vaStaffIds,
    smIdentifiers,
    rmIdentifiers
  };
}

const getHierarchyForSM = async (user: ScopedEmployeeUser): Promise<ScopedHierarchy> => {
  const smRecords = await getSmRecordsForViewer(buildViewerIdentifiers(user));
  const smIdentifiers = buildSmIdentifierSet(smRecords);
  const vaStaffIds = await getVaStaffIdsForSmIdentifiers(smIdentifiers);

  return {
    vaStaffIds,
    smIdentifiers,
    rmIdentifiers: []
  };
};

export async function getScopedCaseWhere(
  user: ScopedEmployeeUser,
  options: ScopedCaseFilterOptions
): Promise<Prisma.AppraisalCaseWhereInput | null> {
  const scopedRole = normalizeScopedRole(user.role);
  if (!scopedRole) {
    return null;
  }

  if (scopedRole === "REVIEWER") {
    return {
      id: {
        equals: "__reviewer_has_no_employee_scope__"
      }
    };
  }

  const whereClause: Prisma.AppraisalCaseWhereInput = {
    ...(options.cycleId ? { cycleId: options.cycleId } : {}),
    contactType: { in: [...ALLOWED_APPRAISAL_CONTACT_TYPES] },
    ...(options.includeRemoved ? {} : { isRemoved: false })
  };

  if (options.status) {
    if (!CASE_STATUSES.has(options.status as CaseStatus)) {
      return {
        id: {
          equals: "__invalid_case_status_filter__"
        }
      };
    }

    whereClause.status = options.status as CaseStatus;
  }

  if (options.staffRole) {
    whereClause.staffRole = { contains: options.staffRole, mode: "insensitive" };
  }

  if (options.contactType) {
    const requestedType = options.contactType.trim();
    if (!ALLOWED_APPRAISAL_CONTACT_TYPES.includes(requestedType as (typeof ALLOWED_APPRAISAL_CONTACT_TYPES)[number])) {
      return {
        id: {
          equals: "__invalid_contact_type_filter__"
        }
      };
    }

    whereClause.contactType = { equals: requestedType, mode: "insensitive" };
  }

  if (options.search) {
    whereClause.OR = [
      { staffId: { contains: options.search, mode: "insensitive" } },
      { fullName: { contains: options.search, mode: "insensitive" } }
    ];
  }

  if (scopedRole === "SITE_LEAD") {
    return whereClause;
  }

  if (scopedRole === "SUCCESS_MANAGER") {
    const directIdentifiers = buildSuccessManagerIdentifiers(user);
    const hierarchy = await getHierarchyForSM(user);

    const smIdentifierConditions = [...new Set([...directIdentifiers, ...hierarchy.smIdentifiers])].map((identifier) => ({
      successManagerStaffId: {
        equals: identifier,
        mode: "insensitive" as const
      }
    }));

    const scopedOrConditions: Prisma.AppraisalCaseWhereInput[] = [];
    if (hierarchy.vaStaffIds.length > 0) {
      scopedOrConditions.push({
        staffId: {
          in: hierarchy.vaStaffIds
        }
      });
    }

    if (smIdentifierConditions.length > 0) {
      scopedOrConditions.push(...smIdentifierConditions);
    }

    if (scopedOrConditions.length === 0) {
      return {
        id: {
          equals: "__missing_success_manager_identifier__"
        }
      };
    }

    return {
      ...whereClause,
      AND: [
        ...(whereClause.AND ? (Array.isArray(whereClause.AND) ? whereClause.AND : [whereClause.AND]) : []),
        {
          OR: scopedOrConditions
        }
      ]
    };
  }

  const hierarchy = await getHierarchyForRM(user);
  const scopedOrConditions: Prisma.AppraisalCaseWhereInput[] = [];

  if (hierarchy.vaStaffIds.length > 0) {
    scopedOrConditions.push({
      staffId: {
        in: hierarchy.vaStaffIds
      }
    });
  }

  for (const smIdentifier of hierarchy.smIdentifiers) {
    scopedOrConditions.push({
      successManagerStaffId: {
        equals: smIdentifier,
        mode: "insensitive"
      }
    });
  }

  for (const rmIdentifier of hierarchy.rmIdentifiers) {
    scopedOrConditions.push({
      relationshipManagerStaffId: {
        equals: rmIdentifier,
        mode: "insensitive"
      }
    });
  }

  if (scopedOrConditions.length === 0) {
    return {
      id: {
        equals: "__rm_scope_empty__"
      }
    };
  }

  return {
    ...whereClause,
    AND: [
      ...(whereClause.AND ? (Array.isArray(whereClause.AND) ? whereClause.AND : [whereClause.AND]) : []),
      {
        OR: scopedOrConditions
      }
    ]
  };
}

export async function getScopedCases(user: ScopedEmployeeUser, options: ScopedEmployeeQueryOptions): Promise<{
  items: ScopedEmployeeCaseRecord[];
  total: number;
}> {
  const whereClause = await getScopedCaseWhere(user, options);
  if (!whereClause) {
    return { items: [], total: 0 };
  }

  const skip = (options.page - 1) * options.pageSize;

  const [total, items] = await prisma.$transaction([
    prisma.appraisalCase.count({ where: whereClause }),
    prisma.appraisalCase.findMany({
      where: whereClause,
      select: {
        id: true,
        staffId: true,
        fullName: true,
        staffRole: true,
        contactType: true,
        successManagerStaffId: true,
        relationshipManagerStaffId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        closeDate: true,
        compCurrent: {
          select: {
            baseSalary: true
          }
        },
        marketSnapshot: {
          select: {
            wsllGateStatus: true
          }
        },
        recommendation: {
          select: {
            recommendedNewBase: true,
            submittedTargetSalary: true,
            submittedIncreaseAmount: true,
            finalTargetSalary: true,
            finalIncreaseAmount: true
          }
        },
        override: {
          select: {
            overrideAmount: true,
            overridePercent: true,
            overrideNewBase: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { fullName: "asc" }],
      skip,
      take: options.pageSize
    })
  ]);

  return {
    items: items as ScopedEmployeeCaseRecord[],
    total
  };
}

export async function getScopedEmployees(user: ScopedEmployeeUser, options: ScopedEmployeeQueryOptions): Promise<{
  items: ScopedEmployeeCaseRecord[];
  total: number;
}> {
  return getScopedCases(user, options);
}