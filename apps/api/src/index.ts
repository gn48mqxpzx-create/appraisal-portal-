import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import { CycleStatus, CycleType, MovementType, ProcessingStatus, RowStatus, UploadType, EvidenceType, PayrollStatus } from "@prisma/client";
import {
  EmployeeDerivedDataService,
  type AttritionCategory,
  type TenureBand
} from "./services/employeeDerivedDataService";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const upload = multer({ storage: multer.memoryStorage() });

const reportPathByBatchId = (batchId: string) => `/intake/upload/${batchId}/questionable-rows.csv`;

const startOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const ensureActiveCycle = async () => {
  const activeCycles = await prisma.cycle.findMany({
    where: {
      OR: [{ status: CycleStatus.ACTIVE }, { isActive: true }]
    },
    orderBy: { startDate: "desc" }
  });

  if (activeCycles.length === 0) {
    const today = startOfTodayUtc();
    const createdCycle = await prisma.cycle.create({
      data: {
        cycleName: "Initial Appraisal Cycle",
        cycleType: CycleType.ANNUAL,
        fiscalYear: today.getUTCFullYear(),
        startDate: today,
        status: CycleStatus.ACTIVE,
        isActive: true
      }
    });

    return createdCycle;
  }

  const [primaryActiveCycle, ...extraActiveCycles] = activeCycles;

  if (extraActiveCycles.length > 0) {
    await prisma.cycle.updateMany({
      where: {
        id: { in: extraActiveCycles.map((cycle) => cycle.id) }
      },
      data: {
        status: CycleStatus.DRAFT,
        isActive: false
      }
    });
  }

  if (!primaryActiveCycle.isActive || primaryActiveCycle.status !== CycleStatus.ACTIVE) {
    return prisma.cycle.update({
      where: { id: primaryActiveCycle.id },
      data: {
        status: CycleStatus.ACTIVE,
        isActive: true
      }
    });
  }

  return primaryActiveCycle;
};

type IntakeCsvRow = Record<string, string>;

type IntakeUploadSummary = {
  total: number;
  imported: number;
  flagged: number;
  errors: number;
  reportUrl: string;
};

const normalizeHeader = (header: string) =>
  header
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getStringValue = (row: IntakeCsvRow, headerAliases: string[]): string => {
  const normalizedAliases = new Set(headerAliases.map(normalizeHeader));

  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeHeader(key))) {
      const trimmed = value?.trim() ?? "";
      return trimmed;
    }
  }

  return "";
};

const getStaffId = (row: IntakeCsvRow): string => {
  return getStringValue(row, [
    "Staff ID Number",
    "Staff ID",
    "StaffID",
    "staff_id_number",
    "staff_id",
    "staff id number",
    "staff id"
  ]);
};

const getFullName = (row: IntakeCsvRow): string => {
  const fullName = getStringValue(row, ["Full Name", "full_name", "full name"]);
  if (fullName) return fullName;

  const firstName = getStringValue(row, ["First Name", "first_name", "first name"]);
  const lastName = getStringValue(row, ["Last Name", "last_name", "last name"]);
  const combined = [firstName, lastName].filter(Boolean).join(" ").replace(/\s+/g, " ");
  return combined;
};

const getContactType = (row: IntakeCsvRow): string => {
  return getStringValue(row, ["Contact Type", "contact_type", "contact type"]);
};

const getCompanyName = (row: IntakeCsvRow): string => {
  return getStringValue(row, ["Company Name", "company_name", "company name"]);
};

const getStaffRole = (row: IntakeCsvRow): string => {
  return getStringValue(row, ["Staff Role", "staff_role", "staff role"]);
};

const getSuccessManagerStaffId = (row: IntakeCsvRow): string => {
  return getStringValue(row, [
    "Success Manager",
    "Success Manager Staff ID",
    "success_manager_staff_id",
    "success manager staff id"
  ]);
};

const getRelationshipManagerStaffId = (row: IntakeCsvRow): string => {
  return getStringValue(row, [
    "Relationship Manager",
    "Relationship Manager Staff ID",
    "relationship_manager_staff_id",
    "relationship manager staff id"
  ]);
};

const getManagerStaffId = (row: IntakeCsvRow): string => {
  return getStringValue(row, [
    "Manager",
    "Manager Staff ID",
    "manager_staff_id",
    "manager staff id"
  ]);
};

const getStartDate = (row: IntakeCsvRow): string => {
  return getStringValue(row, [
    "Start Date",
    "VAP Start Date",
    "VAP Start",
    "vap_start_date",
    "vap_start",
    "start_date",
    "start date"
  ]);
};

const parseCsvFile = (content: Buffer): IntakeCsvRow[] => {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true
  }) as IntakeCsvRow[];

  return records;
};

const parseDate = (value: string): Date | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const CONTACT_TYPE_MAPPING: Record<string, string> = {
  "ops staff - active": "Ops Active",
  "ops staff - separated": "Ops Separated",
  "staff member - active": "Active",
  "staff member - for reprofile": "Reprofile",
  "staff member - hr floating": "Floating",
  "staff member - maternity": "Maternity",
  "staff member - separated": "Separated",
  "staff member - sabbatical": "Leave",
  "ops staff - loa": "Leave",
  "onshore staff member": "AU Active",
  "onshore staff - separated": "AU Separated"
};

const normalizeContactType = (value: string): string => {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .toLowerCase();
};

const isValidContactType = (value: string): boolean => {
  return Boolean(value && value.trim());
};

const mapContactType = (value: string): { mapped: string; normalized: string } => {
  const normalized = normalizeContactType(value);
  const mapped = CONTACT_TYPE_MAPPING[normalized];
  return {
    mapped: mapped || value,
    normalized
  };
};

const shouldFlagContactType = (value: string): boolean => {
  if (!value) {
    return false;
  }

  const normalized = normalizeContactType(value);
  return !CONTACT_TYPE_MAPPING.hasOwnProperty(normalized);
};

const csvEscape = (value: string) => {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
};

const toReportCsv = (
  rows: Array<{
    rowNumber: number;
    status: RowStatus;
    flags: string[];
    errorMessage: string | null;
    rawData: unknown;
  }>
) => {
  const header = ["rowNumber", "status", "flags", "errorMessage", "staffId", "fullName", "contactType", "rawData"].join(",");
  const lines = rows.map((row) => {
    const rawRow = (row.rawData ?? {}) as IntakeCsvRow;
    const staffId = getStaffId(rawRow);
    const fullName = getFullName(rawRow);
    const contactType = getContactType(rawRow);

    return [
      row.rowNumber,
      row.status,
      row.flags.join("|"),
      row.errorMessage ?? "",
      staffId,
      fullName,
      contactType,
      JSON.stringify(row.rawData ?? {})
    ]
      .map((item) => csvEscape(String(item)))
      .join(",");
  });

  return [header, ...lines].join("\n");
};

const processIntakeUpload = async (
  rows: IntakeCsvRow[],
  fileName: string,
  uploadedBy: string
): Promise<{ batchId: string; summary: IntakeUploadSummary }> => {
  const activeCycle = await ensureActiveCycle();

  const batch = await prisma.uploadBatch.create({
    data: {
      cycleId: activeCycle.id,
      uploadType: UploadType.INTAKE,
      fileName,
      uploadedBy,
      totalRows: rows.length,
      processingStatus: ProcessingStatus.PROCESSING
    }
  });

  let imported = 0;
  let flagged = 0;
  let errors = 0;
  const seenStaffIds = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;

    const staffId = getStaffId(row);
    const fullName = getFullName(row);
    const contactType = getContactType(row);
    const { mapped: mappedContactType, normalized: normalizedContactType } = mapContactType(contactType);
    const companyName = getCompanyName(row);
    const staffRole = getStaffRole(row);
    const successManagerStaffId = getSuccessManagerStaffId(row);
    const relationshipManagerStaffId = getRelationshipManagerStaffId(row);
    const managerStaffId = getManagerStaffId(row);
    const startDateRaw = getStartDate(row);
    const startDate = parseDate(startDateRaw);

    const flags: string[] = [];

    // BLOCKING ERROR: Missing staff ID
    if (!staffId) {
      errors += 1;
      await prisma.uploadRowResult.create({
        data: {
          batchId: batch.id,
          rowNumber,
          status: RowStatus.ERROR,
          flags: ["MISSING_STAFF_ID"],
          errorMessage: "Staff ID is required",
          rawData: row
        }
      });
      continue;
    }

    // Non-blocking flags
    if (seenStaffIds.has(staffId)) {
      flags.push("DUPLICATE_STAFF_ID");
    } else {
      seenStaffIds.add(staffId);
    }

    if (!isValidContactType(contactType)) {
      flags.push("MISSING_CONTACT_TYPE");
    } else if (shouldFlagContactType(contactType)) {
      flags.push("UNMAPPED_CONTACT_TYPE");
    }

    if (!fullName) {
      flags.push("MISSING_FULL_NAME");
    }

    if (managerStaffId && staffId === managerStaffId) {
      flags.push("MANAGER_EQUALS_SELF");
    }

    if (!startDate) {
      flags.push("INVALID_START_DATE");
    }

    // If there are flags but no start date, skip row creation
    if (!startDate) {
      flagged += 1;
      await prisma.uploadRowResult.create({
        data: {
          batchId: batch.id,
          rowNumber,
          status: RowStatus.FLAGGED,
          flags,
          errorMessage: null,
          rawData: row
        }
      });
      continue;
    }

    // If flagged but has valid start date, still proceed to import
    if (flags.length > 0) {
      flagged += 1;
    }

    try {
      const existingCase = await prisma.appraisalCase.findUnique({
        where: {
          cycleId_staffId: {
            cycleId: activeCycle.id,
            staffId
          }
        }
      });

      if (!existingCase) {
        const created = await prisma.appraisalCase.create({
          data: {
            cycleId: activeCycle.id,
            staffId,
            fullName,
            rawContactType: contactType,
            contactType: mappedContactType,
            companyName,
            staffRole,
            startDate: startDate!,
            successManagerStaffId: successManagerStaffId || null,
            relationshipManagerStaffId: relationshipManagerStaffId || null,
            managerStaffIdFromIntake: managerStaffId || null,
            resolvedManagerStaffId: managerStaffId || null,
            isRemoved: false,
            status: "DRAFT"
          }
        });

        await prisma.caseMovementLog.create({
          data: {
            caseId: created.id,
            movementType: MovementType.ADDED
          }
        });
      } else {
        const fieldChanges: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }> = [];

        const applyChange = (fieldName: string, oldValue: string | null, newValue: string | null) => {
          if ((oldValue ?? "") !== (newValue ?? "")) {
            fieldChanges.push({ fieldName, oldValue, newValue });
          }
        };

        applyChange("full_name", existingCase.fullName, fullName);
        applyChange("contact_type", existingCase.contactType, mappedContactType);
        applyChange("company_name", existingCase.companyName, companyName);
        applyChange("staff_role", existingCase.staffRole, staffRole);
        applyChange("success_manager_staff_id", existingCase.successManagerStaffId, successManagerStaffId || null);
        applyChange(
          "relationship_manager_staff_id",
          existingCase.relationshipManagerStaffId,
          relationshipManagerStaffId || null
        );
        applyChange("manager_staff_id", existingCase.managerStaffIdFromIntake, managerStaffId || null);
        applyChange("start_date", existingCase.startDate.toISOString(), startDate!.toISOString());

        await prisma.appraisalCase.update({
          where: { id: existingCase.id },
          data: {
            fullName,
            rawContactType: contactType,
            contactType: mappedContactType,
            companyName,
            staffRole,
            successManagerStaffId: successManagerStaffId || null,
            relationshipManagerStaffId: relationshipManagerStaffId || null,
            managerStaffIdFromIntake: managerStaffId || null,
            resolvedManagerStaffId: managerStaffId || null,
            startDate: startDate!,
            isRemoved: false,
            status: "DRAFT",
            closeDate: null,
            updatedAt: new Date()
          }
        });

        if (existingCase.isRemoved) {
          await prisma.caseMovementLog.create({
            data: {
              caseId: existingCase.id,
              movementType: MovementType.RE_ADDED
            }
          });
        }

        for (const fieldChange of fieldChanges) {
          await prisma.caseMovementLog.create({
            data: {
              caseId: existingCase.id,
              movementType: MovementType.FIELD_CHANGE,
              fieldName: fieldChange.fieldName,
              oldValue: fieldChange.oldValue,
              newValue: fieldChange.newValue
            }
          });
        }
      }

      imported += 1;
      const rowStatus = flags.length > 0 ? RowStatus.FLAGGED : RowStatus.IMPORTED;
      await prisma.uploadRowResult.create({
        data: {
          batchId: batch.id,
          rowNumber,
          status: rowStatus,
          flags,
          errorMessage: null,
          rawData: row
        }
      });
    } catch (error) {
      errors += 1;
      await prisma.uploadRowResult.create({
        data: {
          batchId: batch.id,
          rowNumber,
          status: RowStatus.ERROR,
          flags,
          errorMessage: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          rawData: row
        }
      });
    }
  }

  await prisma.uploadBatch.update({
    where: { id: batch.id },
    data: {
      processingStatus: ProcessingStatus.COMPLETED,
      processedAt: new Date(),
      importedCount: imported,
      flaggedCount: flagged,
      errorCount: errors
    }
  });

  return {
    batchId: batch.id,
    summary: {
      total: rows.length,
      imported,
      flagged,
      errors,
      reportUrl: reportPathByBatchId(batch.id)
    }
  };
};

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/cycles/ensure-active", async (_req, res) => {
  try {
    const cycle = await ensureActiveCycle();

    return res.status(200).json({
      success: true,
      data: {
        id: cycle.id,
        cycle_name: cycle.cycleName,
        cycle_type: cycle.cycleType,
        fiscal_year: cycle.fiscalYear,
        start_date: cycle.startDate,
        end_date: cycle.endDate,
        lock_date: cycle.lockDate,
        payroll_release_date: cycle.payrollReleaseDate,
        status: cycle.status
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "ENSURE_ACTIVE_CYCLE_FAILED",
        message: error instanceof Error ? error.message : "Failed to ensure active cycle"
      }
    });
  }
});

const getDashboardSummary = async (_req: Request, res: Response) => {
  try {
    const activeCycle = await ensureActiveCycle();

    const inScopeEmployees = await prisma.appraisalCase.count({
      where: {
        cycleId: activeCycle.id,
        isRemoved: false
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        inScopeEmployees,
        activeCycleId: activeCycle.id
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "DASHBOARD_SUMMARY_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch dashboard summary"
      }
    });
  }
};

app.get("/dashboard/summary", getDashboardSummary);

app.get("/api/dashboard/summary", getDashboardSummary);

app.post("/intake/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_FILE",
          message: "Upload requires a CSV file in multipart field 'file'."
        }
      });
    }

    const rows = parseCsvFile(file.buffer);
    const { summary } = await processIntakeUpload(rows, file.originalname, "system-upload");

    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTAKE_UPLOAD_FAILED",
        message: error instanceof Error ? error.message : "Failed to process intake upload"
      }
    });
  }
});

app.get("/intake/upload/:batchId/questionable-rows.csv", async (req, res) => {
  try {
    const { batchId } = req.params;
    const questionableRows = await prisma.uploadRowResult.findMany({
      where: {
        batchId,
        status: {
          in: [RowStatus.FLAGGED, RowStatus.ERROR]
        }
      },
      orderBy: { rowNumber: "asc" },
      select: {
        rowNumber: true,
        status: true,
        flags: true,
        errorMessage: true,
        rawData: true
      }
    });

    const csv = toReportCsv(questionableRows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=questionable_rows_${batchId}.csv`
    );
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "QUESTIONABLE_ROWS_EXPORT_FAILED",
        message: error instanceof Error ? error.message : "Failed to export questionable rows"
      }
    });
  }
});

app.get("/employees/:staffId/derived-data", async (req, res) => {
  try {
    const { staffId } = req.params;
    const activeCycle = await ensureActiveCycle();

    const employeeCase = await prisma.appraisalCase.findUnique({
      where: {
        cycleId_staffId: {
          cycleId: activeCycle.id,
          staffId
        }
      }
    });

    if (!employeeCase) {
      return res.status(404).json({
        success: false,
        error: {
          code: "EMPLOYEE_NOT_FOUND",
          message: `No in-scope employee found for staff ID ${staffId}`
        }
      });
    }

    const derived = EmployeeDerivedDataService.compute({
      startDate: employeeCase.startDate,
      contactType: employeeCase.contactType
    });

    return res.status(200).json({
      staffId,
      tenure_months: derived.tenure_months,
      tenure_band: derived.tenure_band,
      attrition: derived.attrition
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "EMPLOYEE_DERIVED_DATA_FAILED",
        message: error instanceof Error ? error.message : "Failed to compute employee derived data"
      }
    });
  }
});

app.post("/api/auth/request-otp", (req, res) => {
  const { email } = req.body ?? {};
  res.status(200).json({
    success: true,
    data: {
      message: `OTP request accepted for ${email ?? "unknown"}`,
      stub: true
    }
  });
});

app.post("/api/auth/verify-otp", (req, res) => {
  const { email, code } = req.body ?? {};
  res.status(200).json({
    success: true,
    data: {
      message: "OTP verification stub response",
      email: email ?? null,
      codeReceived: Boolean(code),
      stub: true
    }
  });
});

app.get("/intake/derived-options", (_req, res) => {
  const supportedTenureBands: TenureBand[] = ["0-6", "7-12", "13-24", "25+"];
  const supportedAttrition: AttritionCategory[] = ["NON_ATTRITION", "ATTRITION", "UNKNOWN"];

  res.status(200).json({
    success: true,
    data: {
      tenureBands: supportedTenureBands,
      attritionCategories: supportedAttrition
    }
  });
});

// Helper: Normalize name for matching (trim, lowercase, collapse multiple spaces)
const normalizeName = (name: string | null | undefined): string => {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
};

// Helper: Extract viewer identification from req.user or query params
const getViewer = (req: Request): { name: string; role: string } | null => {
  // Priority 1: req.user (from future auth implementation)
  if ((req as any).user?.fullName && (req as any).user?.role) {
    return {
      name: (req as any).user.fullName,
      role: (req as any).user.role
    };
  }

  // Priority 2: Query params (temporary)
  const viewerName = (req.query.viewerName as string)?.trim();
  const viewerRole = (req.query.viewerRole as string)?.trim().toUpperCase();

  if (!viewerRole) {
    return null;
  }

  const allowedRoles = ["ADMIN", "SM", "RM"];
  if (!allowedRoles.includes(viewerRole)) {
    return null;
  }

  // For SM and RM, viewerName is required
  if ((viewerRole === "SM" || viewerRole === "RM") && !viewerName) {
    return null;
  }

  return { name: viewerName || "", role: viewerRole };
};

// Helper: Build access control where clause based on viewer role
const buildAccessWhereClause = (viewer: { name: string; role: string }): any => {
  if (viewer.role === "ADMIN") {
    // Admins see all cases
    return {};
  }

  const normalizedViewerName = normalizeName(viewer.name);

  if (viewer.role === "SM") {
    // Success Managers see only cases where they are the success manager
    // Match using raw SQL since Prisma doesn't support case-insensitive normalized comparison
    // We'll need to filter in-memory or use raw query
    // For now, use a workaround with case-insensitive contains
    return {
      successManagerStaffId: {
        mode: "insensitive" as any,
        equals: viewer.name
      }
    };
  }

  if (viewer.role === "RM") {
    // Relationship Managers see cases where they are the relationship manager
    return {
      relationshipManagerStaffId: {
        mode: "insensitive" as any,
        equals: viewer.name
      }
    };
  }

  // Default: no access
  return { id: { equals: "no-access" } };
};

// GET /cases - List cases with pagination, filtering, and access control
app.get("/cases", async (req: Request, res: Response) => {
  try {
    const activeCycle = await ensureActiveCycle();

    // Get viewer identification
    const viewer = getViewer(req);
    if (!viewer) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required query parameters: viewerRole (ADMIN, SM, RM) and viewerName (for SM/RM)"
        }
      });
    }

    // Pagination parameters (safe defaults)
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string) || 20));
    const skip = (page - 1) * pageSize;

    // Filter parameters
    const status = (req.query.status as string)?.trim();
    const search = (req.query.search as string)?.trim();
    const staffRole = (req.query.staffRole as string)?.trim();
    const contactType = (req.query.contactType as string)?.trim();
    const includeRemoved = req.query.includeRemoved === "true";

    // Build where clause
    const whereClause: any = {
      cycleId: activeCycle.id
    };

    // Add removal filter
    if (!includeRemoved) {
      whereClause.isRemoved = false;
    }

    // Add access control filter
    const accessClause = buildAccessWhereClause(viewer);
    Object.assign(whereClause, accessClause);

    // Add status filter
    if (status) {
      whereClause.status = status;
    }

    // Add staff role filter
    if (staffRole) {
      whereClause.staffRole = { contains: staffRole, mode: "insensitive" };
    }

    // Add contact type filter
    if (contactType) {
      whereClause.contactType = { contains: contactType, mode: "insensitive" };
    }

    // Add search filter (staff_id or full_name)
    if (search) {
      whereClause.OR = [
        { staffId: { contains: search, mode: "insensitive" } },
        { fullName: { contains: search, mode: "insensitive" } }
      ];
    }

    // Fetch all cases matching where clause (for name normalization filtering)
    let allCases = await prisma.appraisalCase.findMany({
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
            recommendedNewBase: true
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
      orderBy: [
        { updatedAt: "desc" },
        { fullName: "asc" }
      ]
    });

    // Apply normalized name filtering for SM/RM if needed
    if (viewer.role === "SM" || viewer.role === "RM") {
      const normalizedViewerName = normalizeName(viewer.name);
      allCases = allCases.filter((c) => {
        const managerName = viewer.role === "SM" 
          ? c.successManagerStaffId 
          : c.relationshipManagerStaffId;
        return normalizeName(managerName) === normalizedViewerName;
      });
    }

    // Get total count after filtering
    const total = allCases.length;

    // Apply pagination
    const cases = allCases.slice(skip, skip + pageSize);

    const items = cases.map((c) => {
      const currentBase = Number(c.compCurrent?.baseSalary || 0);
      let finalNewBase = Number(c.recommendation?.recommendedNewBase || currentBase);

      // Apply override with precedence:
      // 1) overrideNewBase (highest priority)
      // 2) overrideAmount
      // 3) overridePercent (lowest priority)
      if (c.override) {
        if (c.override.overrideNewBase !== null) {
          finalNewBase = Number(c.override.overrideNewBase);
        } else if (c.override.overrideAmount !== null) {
          finalNewBase = currentBase + Number(c.override.overrideAmount);
        } else if (c.override.overridePercent !== null) {
          finalNewBase = currentBase * (1 + Number(c.override.overridePercent));
        }
      }

      return {
        id: c.id,
        staff_id: c.staffId,
        full_name: c.fullName,
        staff_role: c.staffRole,
        contact_type: c.contactType,
        success_manager: c.successManagerStaffId,
        relationship_manager: c.relationshipManagerStaffId,
        status: c.status,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        closed_at: c.closeDate,
        wsll_gate_status: c.marketSnapshot?.wsllGateStatus || null,
        final_new_base: finalNewBase
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        items,
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Failed to fetch cases"
      }
    });
  }
});

// GET /cases/:id - Get case detail with movement log and access control
app.get("/cases/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const activeCycle = await ensureActiveCycle();

    // Get viewer identification
    const viewer = getViewer(req);
    if (!viewer) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required query parameters: viewerRole (ADMIN, SM, RM) and viewerName (for SM/RM)"
        }
      });
    }

    const appraisalCase = await prisma.appraisalCase.findFirst({
      where: {
        id,
        cycleId: activeCycle.id
      },
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
        movementLogs: {
          select: {
            id: true,
            movementType: true,
            fieldName: true,
            oldValue: true,
            newValue: true,
            timestamp: true
          },
          orderBy: {
            timestamp: "desc"
          }
        }
      }
    });

    if (!appraisalCase) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Case with ID ${id} not found or you do not have access to it`
        }
      });
    }

    // Apply access control check using normalized names
    if (viewer.role === "SM") {
      const normalizedViewerName = normalizeName(viewer.name);
      const normalizedManagerName = normalizeName(appraisalCase.successManagerStaffId);
      if (normalizedViewerName !== normalizedManagerName) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Case with ID ${id} not found or you do not have access to it`
          }
        });
      }
    } else if (viewer.role === "RM") {
      const normalizedViewerName = normalizeName(viewer.name);
      const normalizedManagerName = normalizeName(appraisalCase.relationshipManagerStaffId);
      if (normalizedViewerName !== normalizedManagerName) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Case with ID ${id} not found or you do not have access to it`
          }
        });
      }
    }

    const caseData = {
      id: appraisalCase.id,
      staff_id: appraisalCase.staffId,
      full_name: appraisalCase.fullName,
      staff_role: appraisalCase.staffRole,
      contact_type: appraisalCase.contactType,
      success_manager: appraisalCase.successManagerStaffId,
      relationship_manager: appraisalCase.relationshipManagerStaffId,
      status: appraisalCase.status,
      created_at: appraisalCase.createdAt,
      updated_at: appraisalCase.updatedAt,
      closed_at: appraisalCase.closeDate,
      movement_log: appraisalCase.movementLogs.map((log) => ({
        id: log.id,
        movement_type: log.movementType,
        field_name: log.fieldName,
        old_value: log.oldValue,
        new_value: log.newValue,
        timestamp: log.timestamp
      }))
    };

    return res.status(200).json({
      success: true,
      data: caseData
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Failed to fetch case detail"
      }
    });
  }
});

// Temporary debug endpoint: shows if appraisal cases exist in DB
app.get("/debug-cases", async (req, res) => {
  try {
    const cases = await prisma.appraisalCase.findMany({
      take: 5,
    });

    return res.json({
      success: true,
      count: cases.length,
      sample: cases,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Debug failed",
    });
  }
});

// ============================================================================
// MARKET BENCHMARK ADMIN ENDPOINTS
// ============================================================================

// Create tenure band
app.post("/market/tenure-bands", express.json(), async (req, res) => {
  try {
    const { name, minMonths, maxMonths } = req.body;

    if (!name || minMonths === undefined || maxMonths === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: "name, minMonths, and maxMonths are required" },
      });
    }

    const tenureBand = await prisma.tenureBand.create({
      data: { name, minMonths, maxMonths },
    });

    return res.status(201).json({ success: true, data: tenureBand });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to create tenure band" },
    });
  }
});

// List tenure bands
app.get("/market/tenure-bands", async (req, res) => {
  try {
    const tenureBands = await prisma.tenureBand.findMany({
      orderBy: { minMonths: "asc" },
    });

    return res.status(200).json({ success: true, data: tenureBands });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to fetch tenure bands" },
    });
  }
});

// Create/update single benchmark
app.post("/market/benchmarks", express.json(), async (req, res) => {
  try {
    const { staffRole, tenureBandId, baseSalary, catchupPercent } = req.body;

    if (!staffRole || !tenureBandId || baseSalary === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: "staffRole, tenureBandId, and baseSalary are required" },
      });
    }

    const benchmark = await prisma.marketBenchmark.upsert({
      where: {
        staffRole_tenureBandId: { staffRole, tenureBandId },
      },
      create: {
        staffRole,
        tenureBandId,
        baseSalary,
        catchupPercent,
      },
      update: {
        baseSalary,
        catchupPercent,
      },
    });

    return res.status(200).json({ success: true, data: benchmark });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to create/update benchmark" },
    });
  }
});

// List benchmarks with filters
app.get("/market/benchmarks", async (req, res) => {
  try {
    const { staffRole, tenureBandId } = req.query;

    const where: any = {};
    if (staffRole) where.staffRole = staffRole;
    if (tenureBandId) where.tenureBandId = tenureBandId;

    const benchmarks = await prisma.marketBenchmark.findMany({
      where,
      include: { tenureBand: true },
      orderBy: [{ staffRole: "asc" }],
    });

    return res.status(200).json({ success: true, data: benchmarks });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to fetch benchmarks" },
    });
  }
});

// Upload benchmarks CSV
app.post("/market/benchmarks/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { message: "No file uploaded" },
      });
    }

    const csvContent = req.file.buffer.toString("utf-8");
    const rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const questionableRows: any[] = [];
    let importedCount = 0;

    for (const [index, row] of rows.entries()) {
      const staffRole = row["Staff Role"]?.trim();
      const tenureBandName = row["Tenure Band Name"]?.trim();
      const baseSalaryStr = row["Benchmark Base Salary"]?.trim();
      const catchupPercentStr = row["Catch Up Percent"]?.trim();

      const flags: string[] = [];

      if (!staffRole) flags.push("MISSING_STAFF_ROLE");
      if (!tenureBandName) flags.push("MISSING_TENURE_BAND");
      if (!baseSalaryStr) flags.push("MISSING_BASE_SALARY");

      const baseSalary = parseFloat(baseSalaryStr);
      if (isNaN(baseSalary)) flags.push("INVALID_BASE_SALARY");

      let catchupPercent = null;
      if (catchupPercentStr) {
        catchupPercent = parseInt(catchupPercentStr, 10);
        if (isNaN(catchupPercent) || catchupPercent < 1 || catchupPercent > 100) {
          flags.push("INVALID_CATCHUP_PERCENT");
        }
      }

      if (flags.length > 0) {
        questionableRows.push({ row: index + 2, ...row, flags: flags.join(", ") });
        continue;
      }

      // Find tenure band
      const tenureBand = await prisma.tenureBand.findFirst({
        where: { name: tenureBandName },
      });

      if (!tenureBand) {
        questionableRows.push({
          row: index + 2,
          ...row,
          flags: "TENURE_BAND_NOT_FOUND",
        });
        continue;
      }

      // Upsert benchmark
      await prisma.marketBenchmark.upsert({
        where: {
          staffRole_tenureBandId: {
            staffRole,
            tenureBandId: tenureBand.id,
          },
        },
        create: {
          staffRole,
          tenureBandId: tenureBand.id,
          baseSalary,
          catchupPercent,
        },
        update: {
          baseSalary,
          catchupPercent,
        },
      });

      importedCount++;
    }

    return res.status(200).json({
      success: true,
      data: {
        total: rows.length,
        imported: importedCount,
        flagged: questionableRows.length,
        questionableRows,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to upload benchmarks" },
    });
  }
});

// ============================================================================
// WSLL HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize staff ID: trim, uppercase, remove internal spaces.
 */
const normalizeStaffId = (raw: string | undefined | null): string => {
  if (!raw) return "";
  return raw.trim().toUpperCase().replace(/\s+/g, "");
};

/**
 * Parse WSLL score: trim, parseFloat, validate range 0–5, return null if invalid/missing.
 */
const parseWsllScore = (raw: string | undefined | null): { score: number | null; isValid: boolean; flagText: string | null } => {
  if (!raw || !raw.trim()) {
    return { score: null, isValid: false, flagText: "MISSING_WSLL_SCORE" };
  }

  const trimmed = raw.trim();
  const score = parseFloat(trimmed);

  if (isNaN(score)) {
    return { score: null, isValid: false, flagText: "INVALID_WSLL_SCORE" };
  }

  if (score < 0 || score > 5) {
    return { score: null, isValid: false, flagText: "WSLL_SCORE_OUT_OF_RANGE" };
  }

  return { score, isValid: true, flagText: null };
};

/**
 * Parse WSLL date: accepts M/D/YY, MM/DD/YYYY, YYYY-MM-DD, M-D-YYYY.
 * Returns a UTC Date (no timezone shift). Returns null if invalid/missing (but doesn't flag as error).
 */
const parseWsllDate = (raw: string | undefined | null): { date: Date | null; isValid: boolean; flagText: string | null } => {
  if (!raw || !raw.trim()) {
    // Missing date is not an error, just return null
    return { date: null, isValid: true, flagText: null };
  }

  const trimmed = raw.trim();

  // Try various date formats
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;

  // Try M/D/YY or MM/DD/YYYY or M-D-YYYY
  const slashDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (slashDash) {
    month = parseInt(slashDash[1], 10);
    day = parseInt(slashDash[2], 10);
    const yearRaw = parseInt(slashDash[3], 10);
    // Convert YY to YYYY
    year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  }

  // Try YYYY-MM-DD
  const isoish = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoish) {
    year = parseInt(isoish[1], 10);
    month = parseInt(isoish[2], 10);
    day = parseInt(isoish[3], 10);
  }

  if (month === null || day === null || year === null) {
    return { date: null, isValid: false, flagText: "INVALID_WSLL_DATE_FORMAT" };
  }

  // Validate date range
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { date: null, isValid: false, flagText: "INVALID_WSLL_DATE_FORMAT" };
  }

  // Create UTC date (Date.UTC avoids timezone shift)
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  // Verify the date was constructed correctly (e.g., Feb 30 → Mar 2, which is invalid)
  if (utcDate.getUTCMonth() !== month - 1 || utcDate.getUTCDate() !== day) {
    return { date: null, isValid: false, flagText: "INVALID_WSLL_DATE_FORMAT" };
  }

  return { date: utcDate, isValid: true, flagText: null };
};

// ============================================================================
// WSLL UPLOAD ENDPOINT
// ============================================================================

app.post("/wsll/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { message: "No file uploaded" },
      });
    }

    const activeCycle = await ensureActiveCycle();
    const csvContent = req.file.buffer.toString("utf-8");
    const rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const questionableRows: any[] = [];
    let importedCount = 0;

    for (const [index, row] of rows.entries()) {
      const staffIdRaw = row["Staff ID"];
      const wsllScoreRaw = row["WSLL Score"];
      const wsllDateRaw = row["WSLL Date"];

      const flags: string[] = [];

      // Parse and validate staffId
      const staffId = normalizeStaffId(staffIdRaw);
      if (!staffId) {
        flags.push("MISSING_STAFF_ID");
      }

      // Parse and validate wsllScore
      const { score: wsllScore, isValid: scoreValid, flagText: scoreFlagText } = parseWsllScore(wsllScoreRaw);
      if (scoreFlagText) {
        flags.push(scoreFlagText);
      }

      // Parse and validate wsllDate
      const { date: wsllDate, isValid: dateValid, flagText: dateFlagText } = parseWsllDate(wsllDateRaw);
      if (dateFlagText && wsllDateRaw && wsllDateRaw.trim()) {
        // Only flag if a date was provided but invalid
        flags.push(dateFlagText);
      }

      // Blocking errors: MISSING_STAFF_ID and invalid (not just missing) wsll score
      if (!staffId || !scoreValid) {
        questionableRows.push({ row: index + 2, ...row, flags: flags.join(", ") });
        continue;
      }

      // Non-blocking: invalid date format (still allow upload with null date)
      if (dateFlagText && wsllDateRaw && wsllDateRaw.trim()) {
        questionableRows.push({ row: index + 2, ...row, flags: flags.join(", ") });
        continue;
      }

      // Upsert WSLL score
      await prisma.wsllScore.upsert({
        where: {
          cycleId_staffId: {
            cycleId: activeCycle.id,
            staffId,
          },
        },
        create: {
          cycleId: activeCycle.id,
          staffId,
          wsllScore: wsllScore!,
          wsllDate,
        },
        update: {
          wsllScore: wsllScore!,
          wsllDate,
        },
      });

      importedCount++;
    }

    return res.status(200).json({
      success: true,
      data: {
        total: rows.length,
        imported: importedCount,
        flagged: questionableRows.length,
        questionableRows,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to upload WSLL scores" },
    });
  }
});

// ============================================================================
// CASE COMPENSATION ENDPOINTS
// ============================================================================

app.get("/cases/:id/compensation", async (req, res) => {
  try {
    const { id } = req.params;

    const caseRecord = await prisma.appraisalCase.findUnique({
      where: { id },
      include: {
        compCurrent: true,
        recommendation: true,
        override: true,
        marketSnapshot: true,
        approvalWorkflow: true,
        approvalEvidence: true,
        payrollProcessing: true,
      },
    });

    if (!caseRecord) {
      return res.status(404).json({
        success: false,
        error: { message: "Case not found" },
      });
    }

    return res.status(200).json({ success: true, data: caseRecord });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to fetch compensation data" },
    });
  }
});

app.patch("/cases/:id/compensation/current", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { baseSalary, fixedAllowances, variableAllowances, recurringBonuses, onetimeBonuses, updatedBy } = req.body;

    const caseRecord = await prisma.appraisalCase.findUnique({
      where: { id },
    });

    if (!caseRecord) {
      return res.status(404).json({
        success: false,
        error: { message: "Case not found" },
      });
    }

    // Permission check: ADMIN can always edit, SM/RM can edit only in DRAFT or SITE_LEAD_PENDING
    // For now, we'll be lenient; implement more robust role checking later

    const totalComp =
      (baseSalary || 0) +
      (fixedAllowances || 0) +
      (variableAllowances || 0) +
      (recurringBonuses || 0) +
      (onetimeBonuses || 0);

    const compCurrent = await prisma.caseCompCurrent.upsert({
      where: { caseId: id },
      create: {
        caseId: id,
        baseSalary: baseSalary || 0,
        fixedAllowances: fixedAllowances || 0,
        variableAllowances: variableAllowances || 0,
        recurringBonuses: recurringBonuses || 0,
        onetimeBonuses: onetimeBonuses || 0,
        totalComp,
        updatedBy,
      },
      update: {
        baseSalary: baseSalary || 0,
        fixedAllowances: fixedAllowances || 0,
        variableAllowances: variableAllowances || 0,
        recurringBonuses: recurringBonuses || 0,
        onetimeBonuses: onetimeBonuses || 0,
        totalComp,
        updatedBy,
      },
    });

    return res.status(200).json({ success: true, data: compCurrent });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to update current compensation" },
    });
  }
});

// ============================================================================
// RECOMMENDATION COMPUTE ENDPOINT
// ============================================================================

app.post("/cases/:id/recommendation/recompute", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { computedBy } = req.body;

    const { computeRecommendation } = await import("./services/recommendationService");
    const result = await computeRecommendation(id, computedBy);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to recompute recommendation" },
    });
  }
});

// ============================================================================
// OVERRIDE ENDPOINT
// ============================================================================

app.patch("/cases/:id/override", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { overrideAmount, overridePercent, overrideNewBase, overrideReason, overriddenBy } = req.body;

    if (
      (overrideAmount !== null && overrideAmount !== undefined) ||
      (overridePercent !== null && overridePercent !== undefined) ||
      (overrideNewBase !== null && overrideNewBase !== undefined)
    ) {
      if (!overrideReason) {
        return res.status(400).json({
          success: false,
          error: { message: "overrideReason is required when setting an override" },
        });
      }
    }

    const override = await prisma.caseOverride.upsert({
      where: { caseId: id },
      create: {
        caseId: id,
        overrideAmount,
        overridePercent,
        overrideNewBase,
        overrideReason,
        overriddenBy: overriddenBy || "system",
      },
      update: {
        overrideAmount,
        overridePercent,
        overrideNewBase,
        overrideReason,
        overriddenBy: overriddenBy || "system",
        overriddenAt: new Date(),
      },
    });

    return res.status(200).json({ success: true, data: override });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to save override" },
    });
  }
});

// ============================================================================
// APPROVAL WORKFLOW ENDPOINTS
// ============================================================================

app.post("/cases/:id/send-to-site-lead", express.json(), async (req, res) => {
  try {
    const { id } = req.params;

    const { sendToSiteLead } = await import("./services/approvalWorkflowService");
    await sendToSiteLead(id);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to send to site lead" },
    });
  }
});

app.post("/cases/:id/site-lead/approve", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedBy, comment } = req.body;

    const { siteLeadApprove } = await import("./services/approvalWorkflowService");
    await siteLeadApprove(id, approvedBy, comment);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to approve" },
    });
  }
});

app.post("/cases/:id/site-lead/reject", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectedBy, comment } = req.body;

    const { siteLeadReject } = await import("./services/approvalWorkflowService");
    await siteLeadReject(id, rejectedBy, comment);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to reject" },
    });
  }
});

app.post("/cases/:id/secure-client-approval", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { createdBy } = req.body;

    const { secureClientApproval } = await import("./services/approvalWorkflowService");
    const result = await secureClientApproval(id, createdBy);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to secure client approval" },
    });
  }
});

// Upload approval evidence (PDF)
app.post("/cases/:id/client-approval/evidence", upload.single("file"), async (req, res) => {
  try {
    const { id } = req.params;
    const { uploadedBy, hubspotLink } = req.body;

    let evidence = null;

    if (req.file) {
      // PDF upload
      const fs = await import("fs/promises");
      const path = await import("path");
      const uploadsDir = path.join(process.cwd(), "uploads", "evidence");
      await fs.mkdir(uploadsDir, { recursive: true });

      const fileName = `${Date.now()}-${req.file.originalname}`;
      const filePath = path.join(uploadsDir, fileName);
      await fs.writeFile(filePath, req.file.buffer);

      evidence = await prisma.approvalEvidence.create({
        data: {
          caseId: id,
          type: EvidenceType.PDF,
          filePath: `/uploads/evidence/${fileName}`,
          uploadedBy: uploadedBy || "system",
        },
      });
    } else if (hubspotLink) {
      // HubSpot link
      evidence = await prisma.approvalEvidence.create({
        data: {
          caseId: id,
          type: EvidenceType.HUBSPOT_LINK,
          linkUrl: hubspotLink,
          uploadedBy: uploadedBy || "system",
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        error: { message: "Either file or hubspotLink must be provided" },
      });
    }

    return res.status(201).json({ success: true, data: evidence });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to upload evidence" },
    });
  }
});

app.post("/cases/:id/client-approve", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedBy, comment } = req.body;

    const { clientApprove } = await import("./services/approvalWorkflowService");
    await clientApprove(id, approvedBy, comment);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to approve client" },
    });
  }
});

// ============================================================================
// PAYROLL PROCESSING ENDPOINTS
// ============================================================================

app.post("/cases/:id/payroll/process", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { processedBy } = req.body;

    const caseRecord = await prisma.appraisalCase.findUnique({
      where: { id },
      include: { payrollProcessing: true },
    });

    if (!caseRecord) {
      return res.status(404).json({
        success: false,
        error: { message: "Case not found" },
      });
    }

    if (caseRecord.status !== "PAYROLL_PENDING") {
      return res.status(400).json({
        success: false,
        error: { message: "Case must be in PAYROLL_PENDING status" },
      });
    }

    if (!caseRecord.payrollProcessing?.effectivityDate) {
      return res.status(400).json({
        success: false,
        error: { message: "Effectivity date must be set before processing" },
      });
    }

    await prisma.payrollProcessing.update({
      where: { caseId: id },
      data: {
        payrollStatus: PayrollStatus.PROCESSED,
        processedBy,
        processedAt: new Date(),
      },
    });

    await prisma.appraisalCase.update({
      where: { id },
      data: {
        status: "PAYROLL_PROCESSED",
      },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to process payroll" },
    });
  }
});

app.patch("/cases/:id/payroll/effectivity-date", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { effectivityDate } = req.body;

    if (!effectivityDate) {
      return res.status(400).json({
        success: false,
        error: { message: "effectivityDate is required" },
      });
    }

    await prisma.payrollProcessing.upsert({
      where: { caseId: id },
      create: {
        caseId: id,
        effectivityDate: new Date(effectivityDate),
      },
      update: {
        effectivityDate: new Date(effectivityDate),
      },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to set effectivity date" },
    });
  }
});

app.post("/cases/:id/lock", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { lockedBy } = req.body;

    const caseRecord = await prisma.appraisalCase.findUnique({
      where: { id },
    });

    if (!caseRecord) {
      return res.status(404).json({
        success: false,
        error: { message: "Case not found" },
      });
    }

    await prisma.appraisalCase.update({
      where: { id },
      data: {
        status: "LOCKED",
        lockedBy,
        lockedAt: new Date(),
      },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to lock case" },
    });
  }
});

// ============================================================================
// EXPORT ENDPOINT
// ============================================================================

app.get("/exports/payroll", async (req, res) => {
  try {
    const { cycleId, status } = req.query;

    const { generatePayrollExport } = await import("./services/exportService");
    const rows = await generatePayrollExport(cycleId as string | undefined);

    // Generate CSV
    const headers = [
      "staff_id",
      "full_name",
      "company_name",
      "staff_role",
      "current_base",
      "final_new_base",
      "final_increase_amount",
      "final_increase_percent",
      "effectivity_date",
      "approval_reference_summary",
    ];

    const csvLines = [headers.join(",")];
    for (const row of rows) {
      const line = headers.map((h) => row[h] || "").join(",");
      csvLines.push(line);
    }

    const csv = csvLines.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=payroll-export.csv");
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to generate payroll export" },
    });
  }
});

// Update market snapshot WSLL exception request
app.patch("/cases/:id/wsll-exception", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { isWsllExceptionRequested, wsllExceptionNote } = req.body;

    await prisma.caseMarketSnapshot.upsert({
      where: { caseId: id },
      create: {
        caseId: id,
        isWsllExceptionRequested: isWsllExceptionRequested || false,
        wsllExceptionNote,
      },
      update: {
        isWsllExceptionRequested: isWsllExceptionRequested || false,
        wsllExceptionNote,
      },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to update WSLL exception" },
    });
  }
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
