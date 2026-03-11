import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import scopeRoutes from "./scopeRoutes";
import directoryRoutes from "./directoryRoutes";
import { loginHandler, requireAuth, meHandler } from "./auth";
const prisma = new PrismaClient();
import { CycleStatus, CycleType, MovementType, ProcessingStatus, RowStatus, UploadType, EvidenceType, PayrollStatus, WsllRecordSource, MarketValueSource } from "@prisma/client";
import {
  EmployeeDerivedDataService,
  type AttritionCategory,
  type TenureBand
} from "./services/employeeDerivedDataService";
import { getContactByStaffId, getContactProperties, getContactPropertyByName } from "./services/hubspotService";
import { HUBSPOT_CONTACT_PROPS } from "./config/hubspotPropertyMap";
import { getContactByStaffId as getIdentityContactByStaffId, getContactByEmail } from "./hubspot/hubspotService";
import { toIdentity } from "./hubspot/hubspotIdentityMap";
import {
  buildHeaderMap,
  buildMarketHeaderMap,
  normalizeWsllRow,
  normalizeStaffId as normalizeCsvStaffId,
  parseFlexibleDateToIso,
  type WsllFlagCode
} from "./intake/csvNormalize";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);
const upload = multer({ storage: multer.memoryStorage() });
const ADMIN_EMAIL = "uly@vaplatinum.com.au";

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

const parseCompensationValue = (value: string): number | null => {
  const normalized = value.replace(/,/g, "").replace(/\$/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const isAdminImportRequest = (req: Request): boolean => {
  const roleFromBody = typeof req.body?.viewerRole === "string" ? req.body.viewerRole : "";
  const roleFromQuery = typeof req.query?.viewerRole === "string" ? req.query.viewerRole : "";
  const emailFromBody = typeof req.body?.viewerEmail === "string" ? req.body.viewerEmail : "";

  if (roleFromBody.toUpperCase() === "ADMIN" || roleFromQuery.toUpperCase() === "ADMIN") {
    return true;
  }

  return emailFromBody.trim().toLowerCase() === ADMIN_EMAIL;
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
app.use("/scope", scopeRoutes);
app.use("/directory", directoryRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Authentication endpoints
app.post("/auth/login", loginHandler);
app.get("/me", requireAuth, meHandler);

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
// OPTION 1 IDENTITY ENDPOINTS (HubSpot source of truth)
// ============================================================================

app.get("/identity/staff/:staffId", async (req, res) => {
  try {
    const normalizedStaffId = normalizeCsvStaffId(req.params.staffId ?? "");
    if (!normalizedStaffId) {
      return res.status(400).json({ error: "staffId is required" });
    }

    const contact = await getIdentityContactByStaffId(normalizedStaffId);
    if (!contact) {
      return res.status(404).json({ error: "Identity not found" });
    }

    return res.status(200).json(toIdentity(contact));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }

    return res.status(500).json({
      error: "Failed to fetch identity by staff id",
      details: errorMessage
    });
  }
});

app.get("/identity/email/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email ?? "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const contact = await getContactByEmail(email);
    if (!contact) {
      return res.status(404).json({ error: "Identity not found" });
    }

    return res.status(200).json(toIdentity(contact));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }

    return res.status(500).json({
      error: "Failed to fetch identity by email",
      details: errorMessage
    });
  }
});

// ============================================================================
// OPTION 1 WSLL ENDPOINTS (history + normalized CSV)
// ============================================================================

app.post("/wsll/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { message: "No file uploaded" }
      });
    }

    const uploadedBy = typeof req.body?.uploaded_by === "string"
      ? req.body.uploaded_by
      : typeof req.body?.uploadedBy === "string"
        ? req.body.uploadedBy
        : null;

    const rows = parse(req.file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as Array<Record<string, string>>;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          total_rows: 0,
          imported: 0,
          flagged: 0,
          questionableRows: []
        }
      });
    }

    const headers = Object.keys(rows[0]);
    const headerMap = buildHeaderMap(headers);

    const blockingFlags = new Set<WsllFlagCode>([
      "MISSING_STAFF_ID",
      "INVALID_WSLL_SCORE",
      "WSLL_SCORE_OUT_OF_RANGE",
      "INVALID_WSLL_DATE_FORMAT"
    ]);

    const questionableRows: Array<{
      row_number: number;
      raw_values: Record<string, string>;
      flags: WsllFlagCode[];
    }> = [];

    let imported = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 2;
      const normalized = normalizeWsllRow(rows[index], rowNumber, headerMap);
      const flags: WsllFlagCode[] = [...normalized.flags];

      const hasBlockingFlag = flags.some((flag) => blockingFlags.has(flag));

      if (!hasBlockingFlag) {
        const hubspotContact = await getIdentityContactByStaffId(normalized.staff_id);
        if (!hubspotContact) {
          flags.push("MISSING_IN_HUBSPOT");
        }
      }

      if (flags.length > 0) {
        questionableRows.push({
          row_number: rowNumber,
          raw_values: normalized.raw,
          flags
        });
        continue;
      }

      await prisma.wsllRecord.create({
        data: {
          staffId: normalized.staff_id,
          wsllScore: normalized.wsll_score as number,
          wsllDate: normalized.wsll_date ? new Date(`${normalized.wsll_date}T00:00:00.000Z`) : null,
          source: WsllRecordSource.CSV,
          uploadedBy,
          rawRowJson: normalized.raw,
          flags: null
        }
      });

      imported += 1;
    }

    return res.status(200).json({
      success: true,
      data: {
        total_rows: rows.length,
        imported,
        flagged: questionableRows.length,
        questionableRows
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to upload WSLL records";
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      return res.status(500).json({
        success: false,
        error: { message: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment." }
      });
    }

    return res.status(500).json({
      success: false,
      error: { message: errorMessage }
    });
  }
});

app.post("/wsll", express.json(), async (req, res) => {
  try {
    const normalizedStaffId = normalizeCsvStaffId(String(req.body?.staff_id ?? ""));
    const rawScore = req.body?.wsll_score;
    const score = Number.parseFloat(String(rawScore ?? ""));
    const rawDate = String(req.body?.wsll_date ?? "");

    if (!normalizedStaffId) {
      return res.status(400).json({ error: "MISSING_STAFF_ID" });
    }

    if (!Number.isFinite(score)) {
      return res.status(400).json({ error: "INVALID_WSLL_SCORE" });
    }

    if (score < 0 || score > 5) {
      return res.status(400).json({ error: "WSLL_SCORE_OUT_OF_RANGE" });
    }

    const dateIso = parseFlexibleDateToIso(rawDate);
    if (rawDate.trim() && !dateIso) {
      return res.status(400).json({ error: "INVALID_WSLL_DATE_FORMAT" });
    }

    const hubspotContact = await getIdentityContactByStaffId(normalizedStaffId);
    if (!hubspotContact) {
      return res.status(404).json({ error: "MISSING_IN_HUBSPOT" });
    }

    const requestedSource = String(req.body?.source ?? "API").toUpperCase();
    const source = requestedSource === "CSV"
      ? WsllRecordSource.CSV
      : requestedSource === "UI"
        ? WsllRecordSource.UI
        : WsllRecordSource.API;

    const created = await prisma.wsllRecord.create({
      data: {
        staffId: normalizedStaffId,
        wsllScore: score,
        wsllDate: dateIso ? new Date(`${dateIso}T00:00:00.000Z`) : null,
        source,
        uploadedBy: typeof req.body?.uploaded_by === "string" ? req.body.uploaded_by : null,
        rawRowJson: req.body?.raw_row_json ?? null,
        flags: null
      }
    });

    return res.status(201).json({
      staff_id: created.staffId,
      wsll_score: created.wsllScore,
      wsll_date: created.wsllDate ? created.wsllDate.toISOString().slice(0, 10) : null,
      source: created.source,
      uploaded_by: created.uploadedBy,
      uploaded_at: created.uploadedAt
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to create WSLL record";
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }

    return res.status(500).json({ error: errorMessage });
  }
});

app.get("/wsll/latest/:staffId", async (req, res) => {
  try {
    const staffId = normalizeCsvStaffId(req.params.staffId ?? "");
    if (!staffId) {
      return res.status(400).json({ error: "staffId is required" });
    }

    const latest = await prisma.wsllRecord.findFirst({
      where: { staffId },
      orderBy: [{ wsllDate: "desc" }, { uploadedAt: "desc" }]
    });

    if (!latest) {
      return res.status(404).json({ error: "No WSLL records found" });
    }

    return res.status(200).json({
      staff_id: latest.staffId,
      wsll_score: latest.wsllScore,
      wsll_date: latest.wsllDate ? latest.wsllDate.toISOString().slice(0, 10) : null,
      uploaded_at: latest.uploadedAt
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch latest WSLL"
    });
  }
});

app.get("/wsll/history/:staffId", async (req, res) => {
  try {
    const staffId = normalizeCsvStaffId(req.params.staffId ?? "");
    if (!staffId) {
      return res.status(400).json({ error: "staffId is required" });
    }

    const history = await prisma.wsllRecord.findMany({
      where: { staffId },
      orderBy: [{ wsllDate: "desc" }, { uploadedAt: "desc" }]
    });

    return res.status(200).json({
      staff_id: staffId,
      records: history.map((record) => ({
        id: record.id,
        wsll_score: record.wsllScore,
        wsll_date: record.wsllDate ? record.wsllDate.toISOString().slice(0, 10) : null,
        source: record.source,
        uploaded_by: record.uploadedBy,
        uploaded_at: record.uploadedAt,
        flags: record.flags
      }))
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch WSLL history"
    });
  }
});

// ============================================================================
// OPTION 1 MARKET VALUE ENDPOINTS (DB + normalized CSV)
// ============================================================================

app.post("/market-value/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { message: "No file uploaded" }
      });
    }

    const rows = parse(req.file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as Array<Record<string, string>>;

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          total_rows: 0,
          imported: 0,
          flagged: 0,
          questionableRows: []
        }
      });
    }

    const headerMap = buildMarketHeaderMap(Object.keys(rows[0]));
    const questionableRows: Array<{
      row_number: number;
      raw_values: Record<string, string>;
      flags: string[];
    }> = [];

    let imported = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 2;
      const flags: string[] = [];

      const staffRole = (headerMap.staff_role ? row[headerMap.staff_role] : "")?.trim() ?? "";
      const location = (headerMap.location ? row[headerMap.location] : "")?.trim() || null;
      const band = (headerMap.band ? row[headerMap.band] : "")?.trim() || null;
      const minValueRaw = (headerMap.min_value ? row[headerMap.min_value] : "")?.trim() ?? "";
      const maxValueRaw = (headerMap.max_value ? row[headerMap.max_value] : "")?.trim() ?? "";
      const currency = ((headerMap.currency ? row[headerMap.currency] : "")?.trim() || "AUD").toUpperCase();
      const effectiveDateRaw = (headerMap.effective_date ? row[headerMap.effective_date] : "")?.trim() ?? "";

      if (!staffRole) {
        flags.push("MISSING_STAFF_ROLE");
      }

      const minValue = Number.parseFloat(minValueRaw);
      if (!Number.isFinite(minValue)) {
        flags.push("INVALID_MIN_VALUE");
      }

      const maxValue = Number.parseFloat(maxValueRaw);
      if (!Number.isFinite(maxValue)) {
        flags.push("INVALID_MAX_VALUE");
      }

      if (Number.isFinite(minValue) && Number.isFinite(maxValue) && minValue > maxValue) {
        flags.push("MIN_GREATER_THAN_MAX");
      }

      const effectiveDate = parseFlexibleDateToIso(effectiveDateRaw);
      if (!effectiveDate) {
        flags.push("INVALID_EFFECTIVE_DATE");
      }

      if (flags.length > 0) {
        questionableRows.push({
          row_number: rowNumber,
          raw_values: row,
          flags
        });
        continue;
      }

      await prisma.marketValueGuide.create({
        data: {
          staffRole,
          location,
          band,
          minValue,
          maxValue,
          currency,
          effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
          source: MarketValueSource.CSV,
          rawRowJson: row
        }
      });

      imported += 1;
    }

    return res.status(200).json({
      success: true,
      data: {
        total_rows: rows.length,
        imported,
        flagged: questionableRows.length,
        questionableRows
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : "Failed to upload market value guides" }
    });
  }
});

app.get("/market-value", async (req, res) => {
  try {
    const role = typeof req.query.role === "string" ? req.query.role.trim() : "";
    const location = typeof req.query.location === "string" ? req.query.location.trim() : "";
    const effectiveDateRaw = typeof req.query.effective_date === "string" ? req.query.effective_date.trim() : "";

    const where: {
      staffRole?: string;
      location?: string;
      effectiveDate?: Date;
    } = {};

    if (role) {
      where.staffRole = role;
    }

    if (location) {
      where.location = location;
    }

    if (effectiveDateRaw) {
      const effectiveDate = parseFlexibleDateToIso(effectiveDateRaw);
      if (!effectiveDate) {
        return res.status(400).json({ error: "INVALID_EFFECTIVE_DATE" });
      }
      where.effectiveDate = new Date(`${effectiveDate}T00:00:00.000Z`);
    }

    const guides = await prisma.marketValueGuide.findMany({
      where,
      orderBy: [{ effectiveDate: "desc" }, { uploadedAt: "desc" }]
    });

    return res.status(200).json({
      count: guides.length,
      items: guides.map((guide) => ({
        id: guide.id,
        staff_role: guide.staffRole,
        location: guide.location,
        band: guide.band,
        min_value: guide.minValue,
        max_value: guide.maxValue,
        currency: guide.currency,
        effective_date: guide.effectiveDate.toISOString().slice(0, 10),
        source: guide.source,
        uploaded_at: guide.uploadedAt
      }))
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch market value guides"
    });
  }
});

// ============================================================================
// CURRENT COMPENSATION IMPORT + READ ENDPOINTS
// ============================================================================

app.post("/compensation/import", upload.single("file"), async (req, res) => {
  try {
    if (!isAdminImportRequest(req)) {
      return res.status(403).json({
        error: "Admin access required"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded"
      });
    }

    const rows = parse(req.file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as Array<Record<string, string>>;

    if (rows.length === 0) {
      return res.status(200).json({
        processed: 0,
        updated: 0,
        skipped: 0,
        skippedStaffIds: [],
        timestamp: new Date().toISOString()
      });
    }

    const headers = Object.keys(rows[0]).map(normalizeHeader);
    const requiredHeaders = [
      normalizeHeader("Staff ID"),
      normalizeHeader("Current Compensation"),
      normalizeHeader("Currency"),
      normalizeHeader("Effective Date")
    ];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

    if (missingHeaders.length > 0) {
      return res.status(400).json({
        error: "Missing required CSV columns",
        details: ["Staff ID", "Current Compensation", "Currency", "Effective Date"]
      });
    }

    const uploadedBy = typeof req.body?.uploadedBy === "string" && req.body.uploadedBy.trim()
      ? req.body.uploadedBy.trim()
      : typeof req.body?.viewerEmail === "string" && req.body.viewerEmail.trim()
        ? req.body.viewerEmail.trim()
        : "admin";

    const uniqueStaffIds = Array.from(new Set(
      rows
        .map((row) => normalizeCsvStaffId(getStringValue(row, ["Staff ID", "Staff ID Number", "staff_id"])))
        .filter(Boolean)
    ));

    const existingEmployees = await prisma.employeeDirectory.findMany({
      where: {
        staffId: {
          in: uniqueStaffIds
        }
      },
      select: {
        staffId: true
      }
    });

    const existingStaffIds = new Set(existingEmployees.map((employee) => employee.staffId));

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    const skippedStaffIds = new Set<string>();

    for (const row of rows) {
      processed += 1;

      const staffId = normalizeCsvStaffId(getStringValue(row, ["Staff ID", "Staff ID Number", "staff_id"]));
      const compensationRaw = getStringValue(row, ["Current Compensation", "current_compensation"]);
      const currencyRaw = getStringValue(row, ["Currency", "currency"]);
      const effectiveDateRaw = getStringValue(row, ["Effective Date", "effective_date"]);

      const compensationValue = parseCompensationValue(compensationRaw);
      const effectiveDateIso = parseFlexibleDateToIso(effectiveDateRaw);

      if (!staffId || !existingStaffIds.has(staffId) || compensationValue === null || !effectiveDateIso) {
        skipped += 1;
        if (staffId) {
          skippedStaffIds.add(staffId);
        }
        continue;
      }

      await prisma.currentCompensation.upsert({
        where: {
          staffId
        },
        create: {
          staffId,
          currentCompensation: compensationValue,
          currency: currencyRaw || "AUD",
          effectiveDate: new Date(effectiveDateIso),
          uploadedBy,
          uploadedAt: new Date()
        },
        update: {
          currentCompensation: compensationValue,
          currency: currencyRaw || "AUD",
          effectiveDate: new Date(effectiveDateIso),
          uploadedBy,
          uploadedAt: new Date()
        }
      });

      updated += 1;
    }

    return res.status(200).json({
      processed,
      updated,
      skipped,
      skippedStaffIds: Array.from(skippedStaffIds),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to import current compensation"
    });
  }
});

app.get("/compensation/current", async (req, res) => {
  try {
    const staffIdsParam = typeof req.query.staffIds === "string" ? req.query.staffIds : "";
    const parsedStaffIds = Array.from(new Set(
      staffIdsParam
        .split(",")
        .map((staffId) => normalizeCsvStaffId(staffId))
        .filter(Boolean)
    ));

    if (parsedStaffIds.length === 0) {
      return res.status(200).json({
        items: []
      });
    }

    const records = await prisma.currentCompensation.findMany({
      where: {
        staffId: {
          in: parsedStaffIds
        }
      },
      orderBy: {
        uploadedAt: "desc"
      }
    });

    return res.status(200).json({
      items: records.map((record) => ({
        staffId: record.staffId,
        currentCompensation: record.currentCompensation,
        currency: record.currency,
        effectiveDate: record.effectiveDate,
        uploadedAt: record.uploadedAt,
        uploadedBy: record.uploadedBy
      }))
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch current compensation"
    });
  }
});

app.get("/compensation/current/:staffId", async (req, res) => {
  try {
    const staffId = normalizeCsvStaffId(req.params.staffId ?? "");
    if (!staffId) {
      return res.status(400).json({
        error: "staffId is required"
      });
    }

    const record = await prisma.currentCompensation.findUnique({
      where: {
        staffId
      }
    });

    if (!record) {
      return res.status(200).json({
        data: null
      });
    }

    return res.status(200).json({
      data: {
        staffId: record.staffId,
        currentCompensation: record.currentCompensation,
        currency: record.currency,
        effectiveDate: record.effectiveDate,
        uploadedAt: record.uploadedAt,
        uploadedBy: record.uploadedBy
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch current compensation by staff id"
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
      const line = headers.map((h) => (row as Record<string, string>)[h] || "").join(",");
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

// HubSpot property discovery for contacts
app.get("/hubspot/properties/contacts", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const group = typeof req.query.group === "string" ? req.query.group : undefined;
    const includeHidden = typeof req.query.includeHidden === "string"
      ? req.query.includeHidden.toLowerCase() === "true"
      : false;
    const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;

    const data = await getContactProperties({
      search,
      group,
      includeHidden,
      limit
    });

    return res.status(200).json(data);
  } catch (error) {
    console.error("HubSpot property discovery failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }
    // Ensure we don't leak the token in error messages
    const sanitizedMessage = errorMessage.replace(/Bearer [^\s]+/g, "Bearer [REDACTED]");
    return res.status(500).json({ 
      error: "HubSpot property discovery failed", 
      details: sanitizedMessage 
    });
  }
});

app.get("/hubspot/properties/contacts/:name", async (req, res) => {
  try {
    const { name } = req.params;

    if (!name) {
      return res.status(400).json({ error: "Property name is required" });
    }

    const property = await getContactPropertyByName(name);
    return res.status(200).json(property);
  } catch (error) {
    console.error("HubSpot property detail lookup failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      return res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
    }
    if (errorMessage.includes("HubSpot API error: 404")) {
      return res.status(404).json({ error: `Property '${req.params.name}' not found` });
    }
    const sanitizedMessage = errorMessage.replace(/Bearer [^\s]+/g, "Bearer [REDACTED]");
    return res.status(500).json({
      error: "HubSpot property detail lookup failed",
      details: sanitizedMessage
    });
  }
});

// HubSpot contact lookup by staff ID
app.get("/hubspot/contact/:staffId", async (req, res) => {
  try {
    const { staffId } = req.params;

    const contact = await getContactByStaffId(staffId);

    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    const properties = contact.properties;

    return res.status(200).json({
      staff_id: properties[HUBSPOT_CONTACT_PROPS.staffId] || "",
      email: properties[HUBSPOT_CONTACT_PROPS.email] || "",
      contact_type: properties[HUBSPOT_CONTACT_PROPS.contactType] || "",
      staff_role: properties[HUBSPOT_CONTACT_PROPS.staffRole] || "",
      staff_start_date: properties[HUBSPOT_CONTACT_PROPS.staffStartDate] || "",
      relationship_manager: properties[HUBSPOT_CONTACT_PROPS.relationshipManager] || "",
      success_manager: properties[HUBSPOT_CONTACT_PROPS.successManager] || ""
    });
  } catch (error) {
    console.error("HubSpot lookup failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    // Ensure we don't leak the token in error messages
    const sanitizedMessage = errorMessage.replace(/Bearer [^\s]+/g, "Bearer [REDACTED]");
    return res.status(500).json({ 
      error: "HubSpot lookup failed", 
      details: sanitizedMessage 
    });
  }
});

// ============================================================================
// MARKET VALUE MATRIX + ROLE LIBRARY ENDPOINTS
// ============================================================================

const TENURE_BANDS = ["T1", "T2", "T3", "T4"] as const;
type TenureBandLabel = (typeof TENURE_BANDS)[number];

const isTenureBand = (v: unknown): v is TenureBandLabel =>
  typeof v === "string" && (TENURE_BANDS as readonly string[]).includes(v);

const parseSalaryValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toTitleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const canonicalizeRoleLabel = (value: string): string =>
  toTitleCase(value.trim().replace(/[^a-zA-Z0-9\s/&-]+/g, " ").replace(/\s+/g, " "));

const normalizeRoleTokens = (value: string): string[] => {
  const normalized = normalizeRoleName(value)
    .replace(/\b(sr|senior)\b/g, "")
    .replace(/\b(jr|junior)\b/g, "")
    .replace(/\bii|iii|iv|1|2|3|4\b/g, "")
    .replace(/\bfp\b/g, "financial planning")
    .replace(/\bmb\b/g, "mortgage broker")
    .replace(/\bparabroker\b/g, "credit analyst")
    .replace(/\bclient\b/g, "customer")
    .replace(/\bpersonal\b/g, "executive")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.split(" ").filter(Boolean);
};

const roleFamilyPatterns: Array<{ family: string; patterns: RegExp[] }> = [
  { family: "Paraplanner", patterns: [/paraplanner/] },
  { family: "Loan Processor", patterns: [/loan\s*processor/, /mortgage\s*broker\s*admin/] },
  { family: "Credit Analyst", patterns: [/credit\s*analyst/, /parabroker/] },
  { family: "Customer Service Representative", patterns: [/customer\s*service/, /client\s*service/] },
  { family: "Administrative Assistant", patterns: [/administrative\s*assistant/, /admin\b/] },
  { family: "Executive Assistant", patterns: [/executive\s*assistant/, /personal\s*assistant/] }
];

const scoreRoleSimilarity = (rawRole: string, targetRole: string): number => {
  const rawNormalized = normalizeRoleName(rawRole);
  const targetNormalized = normalizeRoleName(targetRole);

  if (!rawNormalized || !targetNormalized) {
    return 0;
  }
  if (rawNormalized === targetNormalized) {
    return 1;
  }

  const rawTokens = new Set(normalizeRoleTokens(rawRole));
  const targetTokens = new Set(normalizeRoleTokens(targetRole));

  const intersection = [...rawTokens].filter((token) => targetTokens.has(token)).length;
  const union = new Set([...rawTokens, ...targetTokens]).size || 1;
  let score = intersection / union;

  if (rawNormalized.includes(targetNormalized) || targetNormalized.includes(rawNormalized)) {
    score = Math.max(score, 0.82);
  }

  const familyHit = roleFamilyPatterns.find((family) =>
    family.patterns.some((pattern) => pattern.test(rawNormalized)) && normalizeRoleName(family.family) === targetNormalized
  );
  if (familyHit) {
    score = Math.max(score, 0.9);
  }

  return Number(score.toFixed(4));
};

const getNewRoleSuggestion = (rawRole: string): string => canonicalizeRoleLabel(rawRole);

type MatchStatus = "Learned" | "Auto-Matched" | "Needs Review" | "New Role Suggested" | "Approved";

const findOrCreateStandardizedRole = async (payload: { standardizedRoleId?: string; roleName?: string; allowCreate?: boolean }) => {
  const allowCreate = payload.allowCreate === true;

  if (payload.standardizedRoleId) {
    const byId = await prisma.standardizedRole.findUnique({ where: { id: payload.standardizedRoleId } });
    if (!byId) {
      throw new Error("Standardized role not found");
    }
    return byId;
  }

  const roleName = typeof payload.roleName === "string" ? canonicalizeRoleLabel(payload.roleName) : "";
  if (!roleName) {
    throw new Error("standardizedRoleId or roleName is required");
  }

  const existing = await prisma.standardizedRole.findFirst({
    where: { roleName: { equals: roleName, mode: "insensitive" } }
  });
  if (existing) {
    return existing;
  }

  if (!allowCreate) {
    throw new Error("Standardized role not found");
  }

  return prisma.standardizedRole.create({
    data: { roleName, isActive: true }
  });
};

const normalizeRoleName = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const getMatrixRoleName = (row: { roleName: string; standardizedRole?: { roleName: string } | null }) =>
  row.standardizedRole?.roleName ?? row.roleName;

const getMappedRoleName = (mapping: { mappedRoleName: string; standardizedRole?: { roleName: string } | null }) =>
  mapping.standardizedRole?.roleName ?? mapping.mappedRoleName;

const roleSimilarity = (rawRole: string, standardRole: string): number => {
  const raw = normalizeRoleName(rawRole);
  const target = normalizeRoleName(standardRole);

  if (!raw || !target) return 0;
  if (raw === target) return 1;

  const rawTokens = new Set(raw.split(" "));
  const targetTokens = new Set(target.split(" "));
  const intersection = [...rawTokens].filter((token) => targetTokens.has(token)).length;
  const union = new Set([...rawTokens, ...targetTokens]).size || 1;
  const jaccard = intersection / union;

  if (raw.includes(target) || target.includes(raw)) {
    return Math.max(jaccard, 0.86);
  }

  return jaccard;
};

const getBestRoleSuggestion = (rawRole: string, standardRoles: string[]) => {
  let bestRole: string | null = null;
  let bestScore = 0;

  for (const candidate of standardRoles) {
    const score = roleSimilarity(rawRole, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestRole = candidate;
    }
  }

  return {
    suggestedMatch: bestRole,
    confidence: bestScore,
    autoMapped: bestRole !== null && bestScore >= 0.82
  };
};

const ensureAdmin = (req: Request, res: Response) => {
  const viewer = getViewer(req);
  if (!viewer || viewer.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return viewer;
};

// GET /market-matrix  — list all rows, optionally filtered by ?role=
app.get("/market-matrix", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const roleFilter = typeof req.query.role === "string" ? req.query.role.trim() : "";

    const rows = await prisma.marketValueMatrix.findMany({
      where: roleFilter
        ? {
            OR: [
              {
                roleName: { equals: roleFilter, mode: "insensitive" }
              },
              {
                standardizedRole: {
                  roleName: { equals: roleFilter, mode: "insensitive" }
                }
              }
            ]
          }
        : undefined,
      include: {
        standardizedRole: true
      },
      orderBy: [{ roleName: "asc" }, { tenureBand: "asc" }]
    });

    return res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        standardizedRoleId: row.standardizedRoleId,
        roleName: getMatrixRoleName(row),
        tenureBand: row.tenureBand,
        minSalary: row.minSalary,
        maxSalary: row.maxSalary,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch market matrix" });
  }
});

// GET /market-matrix/:role  — all four tenure bands for one role
app.get("/market-matrix/:role", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const roleName = decodeURIComponent(req.params.role ?? "").trim();
    if (!roleName) {
      return res.status(400).json({ error: "role is required" });
    }

    const rows = await prisma.marketValueMatrix.findMany({
      where: {
        OR: [
          {
            roleName: { equals: roleName, mode: "insensitive" }
          },
          {
            standardizedRole: {
              roleName: { equals: roleName, mode: "insensitive" }
            }
          }
        ]
      },
      include: { standardizedRole: true },
      orderBy: { tenureBand: "asc" }
    });

    return res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        standardizedRoleId: row.standardizedRoleId,
        roleName: getMatrixRoleName(row),
        tenureBand: row.tenureBand,
        minSalary: row.minSalary,
        maxSalary: row.maxSalary,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch market matrix for role" });
  }
});

// POST /market-matrix  — upsert one cell (roleName + tenureBand)
app.post("/market-matrix", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { standardizedRoleId, roleName, tenureBand, minSalary, maxSalary } = req.body ?? {};

    if (!isTenureBand(tenureBand)) {
      return res.status(400).json({ error: "tenureBand must be one of T1, T2, T3, T4" });
    }
    const parsedMinSalary = parseSalaryValue(minSalary);
    if (parsedMinSalary === null) {
      return res.status(400).json({ error: "minSalary must be a number" });
    }
    const parsedMaxSalary = parseSalaryValue(maxSalary);
    if (parsedMaxSalary === null) {
      return res.status(400).json({ error: "maxSalary must be a number" });
    }

    if (parsedMinSalary > parsedMaxSalary) {
      return res.status(400).json({ error: "minSalary cannot be greater than maxSalary" });
    }

    const role = await findOrCreateStandardizedRole({ standardizedRoleId, roleName, allowCreate: true });

    const existingSameRow = await prisma.marketValueMatrix.findFirst({
      where: {
        OR: [
          { standardizedRoleId: role.id },
          { roleName: { equals: role.roleName, mode: "insensitive" } }
        ],
        tenureBand
      }
    });

    const row = existingSameRow
      ? await prisma.marketValueMatrix.update({
          where: { id: existingSameRow.id },
          data: {
            roleName: role.roleName,
            standardizedRoleId: role.id,
            minSalary: parsedMinSalary,
            maxSalary: parsedMaxSalary
          }
        })
      : await prisma.marketValueMatrix.create({
          data: {
            roleName: role.roleName,
            standardizedRoleId: role.id,
            tenureBand,
            minSalary: parsedMinSalary,
            maxSalary: parsedMaxSalary
          }
        });

    const withRole = await prisma.marketValueMatrix.findUnique({
      where: { id: row.id },
      include: { standardizedRole: true }
    });

    return res.status(200).json({
      success: true,
      data: withRole
        ? {
            id: withRole.id,
            standardizedRoleId: withRole.standardizedRoleId,
          roleName: getMatrixRoleName(withRole),
            tenureBand: withRole.tenureBand,
            minSalary: withRole.minSalary,
            maxSalary: withRole.maxSalary
          }
        : null
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to upsert market matrix row" });
  }
});

// PUT /market-matrix/:id  — update a specific row by id
app.put("/market-matrix/:id", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    const { standardizedRoleId, roleName, tenureBand, minSalary, maxSalary } = req.body ?? {};

    const existing = await prisma.marketValueMatrix.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Market matrix row not found" });
    }

    const role = standardizedRoleId || roleName
      ? await findOrCreateStandardizedRole({ standardizedRoleId, roleName, allowCreate: true })
      : existing.standardizedRoleId
        ? await prisma.standardizedRole.findUnique({ where: { id: existing.standardizedRoleId } })
        : await findOrCreateStandardizedRole({ roleName: existing.roleName, allowCreate: true });
    if (!role) {
      return res.status(400).json({ error: "Unable to resolve standardized role" });
    }

    const nextRoleId = role.id;
    const nextTenureBand = tenureBand === undefined ? existing.tenureBand : tenureBand;

    if (!isTenureBand(nextTenureBand)) {
      return res.status(400).json({ error: "tenureBand must be one of T1, T2, T3, T4" });
    }

    const parsedMinSalary = minSalary === undefined ? Number(existing.minSalary) : parseSalaryValue(minSalary);
    if (parsedMinSalary === null) {
      return res.status(400).json({ error: "minSalary must be a number" });
    }

    const parsedMaxSalary = maxSalary === undefined ? Number(existing.maxSalary) : parseSalaryValue(maxSalary);
    if (parsedMaxSalary === null) {
      return res.status(400).json({ error: "maxSalary must be a number" });
    }

    if (parsedMinSalary > parsedMaxSalary) {
      return res.status(400).json({ error: "minSalary cannot be greater than maxSalary" });
    }

    const duplicate = await prisma.marketValueMatrix.findFirst({
      where: {
        id: { not: id },
        OR: [
          { standardizedRoleId: nextRoleId },
          { roleName: { equals: role.roleName, mode: "insensitive" } }
        ],
        tenureBand: nextTenureBand
      },
      select: { id: true }
    });
    if (duplicate) {
      return res.status(409).json({ error: "A matrix row already exists for this role and tenure band" });
    }

    const updated = await prisma.marketValueMatrix.update({
      where: { id },
      data: {
        roleName: role.roleName,
        standardizedRoleId: nextRoleId,
        tenureBand: nextTenureBand,
        minSalary: parsedMinSalary,
        maxSalary: parsedMaxSalary
      }
    });

    const withRole = await prisma.marketValueMatrix.findUnique({
      where: { id: updated.id },
      include: { standardizedRole: true }
    });

    return res.status(200).json({
      success: true,
      data: withRole
        ? {
            id: withRole.id,
            standardizedRoleId: withRole.standardizedRoleId,
          roleName: getMatrixRoleName(withRole),
            tenureBand: withRole.tenureBand,
            minSalary: withRole.minSalary,
            maxSalary: withRole.maxSalary
          }
        : null
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update market matrix row" });
  }
});

// DELETE /market-matrix/:id  — delete a specific row by id
app.delete("/market-matrix/:id", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    const existing = await prisma.marketValueMatrix.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Market matrix row not found" });
    }

    await prisma.marketValueMatrix.delete({ where: { id } });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete market matrix row" });
  }
});

// DELETE /market-matrix/role/:role  — delete all rows for one role
app.delete("/market-matrix/role/:role", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const roleName = decodeURIComponent(req.params.role ?? "").trim();
    if (!roleName) {
      return res.status(400).json({ error: "role is required" });
    }

    const standardizedRole = await prisma.standardizedRole.findFirst({
      where: { roleName: { equals: roleName, mode: "insensitive" } }
    });

    if (!standardizedRole) {
      return res.status(200).json({ success: true, deletedCount: 0 });
    }

    const deleted = await prisma.marketValueMatrix.deleteMany({
      where: {
        OR: [
          { standardizedRoleId: standardizedRole.id },
          { roleName: { equals: standardizedRole.roleName, mode: "insensitive" } }
        ]
      }
    });

    return res.status(200).json({ success: true, deletedCount: deleted.count });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete role matrix" });
  }
});

// POST /market-matrix/role - save all role rows with overwrite protection
app.post("/market-matrix/role", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const roleName = typeof req.body?.roleName === "string" ? req.body.roleName.trim() : "";
    const standardizedRoleId = typeof req.body?.standardizedRoleId === "string" ? req.body.standardizedRoleId : "";
    const overwrite = req.body?.overwrite === true;
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

    const standardizedRole = await findOrCreateStandardizedRole({
      standardizedRoleId: standardizedRoleId || undefined,
      roleName: roleName || undefined,
      allowCreate: true
    });

    const existingRows = await prisma.marketValueMatrix.findMany({
      where: {
        OR: [
          { standardizedRoleId: standardizedRole.id },
          { roleName: { equals: standardizedRole.roleName, mode: "insensitive" } }
        ]
      },
      orderBy: { tenureBand: "asc" }
    });

    if (existingRows.length > 0 && !overwrite) {
      return res.status(409).json({
        error: "Role already has saved matrix values",
        requiresOverwrite: true,
        existingRows
      });
    }

    const normalizedEntries = entries
      .filter((entry: any) => isTenureBand(entry?.tenureBand))
      .map((entry: any) => ({
        tenureBand: entry.tenureBand as TenureBandLabel,
        minSalary: Number(entry.minSalary),
        maxSalary: Number(entry.maxSalary)
      }))
      .filter((entry: any) => Number.isFinite(entry.minSalary) && Number.isFinite(entry.maxSalary))
      .filter((entry: any) => entry.minSalary <= entry.maxSalary);

    if (normalizedEntries.length === 0) {
      return res.status(400).json({ error: "At least one valid tenure band entry is required" });
    }

    const savedRows = await prisma.$transaction(
      normalizedEntries.map((entry: any) =>
        prisma.marketValueMatrix.findFirst({
          where: {
            OR: [
              { standardizedRoleId: standardizedRole.id },
              { roleName: { equals: standardizedRole.roleName, mode: "insensitive" } }
            ],
            tenureBand: entry.tenureBand
          }
        }).then((existingRow) => {
          if (existingRow) {
            return prisma.marketValueMatrix.update({
              where: { id: existingRow.id },
              data: {
                roleName: standardizedRole.roleName,
                standardizedRoleId: standardizedRole.id,
                minSalary: entry.minSalary,
                maxSalary: entry.maxSalary
              }
            });
          }

          return prisma.marketValueMatrix.create({
            data: {
              roleName: standardizedRole.roleName,
              standardizedRoleId: standardizedRole.id,
              tenureBand: entry.tenureBand,
              minSalary: entry.minSalary,
              maxSalary: entry.maxSalary
            }
          });
        })
      )
    );

    return res.status(200).json({
      success: true,
      data: {
        overwritten: overwrite,
        standardizedRoleId: standardizedRole.id,
        roleName: standardizedRole.roleName,
        rows: savedRows
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to save role matrix"
    });
  }
});

// ============================================================================
// ROLE LIBRARY ENDPOINTS (intelligent matching + admin learning)
// ============================================================================

app.get("/role-library/roles", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const includeInactive = req.query.includeInactive === "true";
    const rows = await prisma.standardizedRole.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: {
        roleName: "asc"
      }
    });

    return res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch standardized roles"
    });
  }
});

app.post("/role-library/roles", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const roleName = typeof req.body?.roleName === "string" ? canonicalizeRoleLabel(req.body.roleName) : "";
    if (!roleName) {
      return res.status(400).json({ error: "roleName is required" });
    }

    const role = await prisma.standardizedRole.upsert({
      where: { roleName },
      create: { roleName, isActive: true },
      update: { isActive: true }
    });

    return res.status(200).json({ success: true, data: role });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to upsert standardized role"
    });
  }
});

app.put("/role-library/roles/:id", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    const roleName = typeof req.body?.roleName === "string" ? canonicalizeRoleLabel(req.body.roleName) : undefined;
    const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined;

    const updated = await prisma.standardizedRole.update({
      where: { id },
      data: {
        roleName,
        isActive
      }
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update standardized role"
    });
  }
});

app.get("/role-library/mappings", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const mappings = await prisma.roleAlignmentMapping.findMany({
      include: {
        standardizedRole: true
      },
      orderBy: {
        sourceRoleName: "asc"
      }
    });

    return res.status(200).json({
      success: true,
      data: mappings
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch role mappings"
    });
  }
});

app.get("/role-library/analysis", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const [rawRolesRows, standardizedRoles, savedMappings] = await Promise.all([
      prisma.employeeDirectory.findMany({
        where: {
          staffRole: {
            not: ""
          }
        },
        select: {
          staffRole: true
        },
        distinct: ["staffRole"]
      }),
      prisma.standardizedRole.findMany({
        where: { isActive: true },
        orderBy: { roleName: "asc" }
      }),
      prisma.roleAlignmentMapping.findMany({ include: { standardizedRole: true } })
    ]);

    const rawRoles = rawRolesRows.map((row) => row.staffRole).filter(Boolean).sort();
    const roleCatalog = standardizedRoles.map((role) => role.roleName);
    const mappingBySource = new Map(savedMappings.map((mapping) => [normalizeRoleName(mapping.sourceRoleName), mapping]));

    const reviewQueue: Array<any> = [];
    const autoResolved: Array<any> = [];
    const approvedLibrary: Array<any> = savedMappings
      .sort((a, b) => a.sourceRoleName.localeCompare(b.sourceRoleName))
      .map((mapping) => ({
        id: mapping.id,
        rawRole: mapping.sourceRoleName,
        suggestedStandardRole: getMappedRoleName(mapping),
        finalStandardRole: getMappedRoleName(mapping),
        matchStatus: "Learned" as MatchStatus,
        matchSource: "SAVED_RULE",
        confidenceScore: mapping.confidenceScore ? Number(mapping.confidenceScore) : null,
        standardizedRoleId: mapping.standardizedRoleId
      }));

    const seenRawRole = new Set<string>();

    for (const rawRole of rawRoles) {
      if (seenRawRole.has(normalizeRoleName(rawRole))) {
        continue;
      }
      seenRawRole.add(normalizeRoleName(rawRole));

      const persisted = mappingBySource.get(normalizeRoleName(rawRole));
      if (persisted) {
        continue;
      }

      let bestRole: string | null = null;
      let bestScore = 0;

      for (const roleName of roleCatalog) {
        const score = scoreRoleSimilarity(rawRole, roleName);
        if (score > bestScore) {
          bestScore = score;
          bestRole = roleName;
        }
      }

      const newRoleCandidate = getNewRoleSuggestion(rawRole);
      const payloadBase = {
        rawRole,
        suggestedStandardRole: bestRole,
        finalStandardRole: null,
        confidenceScore: Number(bestScore.toFixed(4)),
        standardizedRoleSuggestion: newRoleCandidate
      };

      if (bestRole && bestScore >= 0.85) {
        autoResolved.push({
          ...payloadBase,
          finalStandardRole: bestRole,
          matchStatus: "Auto-Matched" as MatchStatus,
          matchSource: "AUTO_SIMILARITY"
        });
      } else if (bestRole && bestScore >= 0.55) {
        reviewQueue.push({
          ...payloadBase,
          matchStatus: "Needs Review" as MatchStatus,
          matchSource: "AUTO_SIMILARITY"
        });
      } else {
        reviewQueue.push({
          ...payloadBase,
          suggestedStandardRole: newRoleCandidate,
          matchStatus: "New Role Suggested" as MatchStatus,
          matchSource: "NEW_ROLE_SUGGESTION"
        });
      }
    }

    const unifiedTable = [
      ...approvedLibrary.map((row) => ({ ...row, actionRequired: false })),
      ...autoResolved.map((row) => ({ ...row, actionRequired: false })),
      ...reviewQueue.map((row) => ({ ...row, actionRequired: true }))
    ].sort((a, b) => a.rawRole.localeCompare(b.rawRole));

    return res.status(200).json({
      success: true,
      data: {
        roleCatalog: standardizedRoles,
        reviewQueue,
        approvedLibrary,
        autoResolved,
        unifiedTable
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to analyze role alignment"
    });
  }
});

app.post("/role-library/approve", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const sourceRoleName = typeof req.body?.sourceRoleName === "string" ? req.body.sourceRoleName.trim() : "";
    const standardizedRoleName = typeof req.body?.standardizedRoleName === "string" ? req.body.standardizedRoleName.trim() : "";
    const standardizedRoleId = typeof req.body?.standardizedRoleId === "string" ? req.body.standardizedRoleId : "";
    const allowCreateRole = req.body?.allowCreateRole === true;
    const confidenceScore = req.body?.confidenceScore;

    if (!sourceRoleName) {
      return res.status(400).json({
        error: "sourceRoleName is required"
      });
    }

    const role = await findOrCreateStandardizedRole({
      standardizedRoleId: standardizedRoleId || undefined,
      roleName: standardizedRoleName || undefined,
      allowCreate: allowCreateRole
    });

    const parsedConfidence = confidenceScore === undefined || confidenceScore === null
      ? null
      : parseSalaryValue(confidenceScore);

    const saved = await prisma.roleAlignmentMapping.upsert({
      where: {
        sourceRoleName
      },
      create: {
        sourceRoleName,
        mappedRoleName: role.roleName,
        standardizedRoleId: role.id,
        matchSource: "ADMIN_CONFIRMED",
        confidenceScore: parsedConfidence
      },
      update: {
        mappedRoleName: role.roleName,
        standardizedRoleId: role.id,
        matchSource: "ADMIN_CONFIRMED",
        confidenceScore: parsedConfidence
      }
    });

    return res.status(200).json({
      success: true,
      data: await prisma.roleAlignmentMapping.findUnique({
        where: { id: saved.id },
        include: { standardizedRole: true }
      })
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to approve role mapping"
    });
  }
});

app.put("/role-library/mappings/:id", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    const standardizedRoleName = typeof req.body?.standardizedRoleName === "string" ? req.body.standardizedRoleName.trim() : "";
    const standardizedRoleId = typeof req.body?.standardizedRoleId === "string" ? req.body.standardizedRoleId : "";

    const role = await findOrCreateStandardizedRole({
      standardizedRoleId: standardizedRoleId || undefined,
      roleName: standardizedRoleName || undefined,
      allowCreate: false
    }).catch(() => null);

    if (!role) {
      return res.status(400).json({ error: "A valid standardized role is required" });
    }

    const updated = await prisma.roleAlignmentMapping.update({
      where: {
        id
      },
      data: {
        mappedRoleName: role.roleName,
        standardizedRoleId: role.id,
        matchSource: "ADMIN_CONFIRMED"
      }
    });

    return res.status(200).json({
      success: true,
      data: await prisma.roleAlignmentMapping.findUnique({
        where: { id: updated.id },
        include: { standardizedRole: true }
      })
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update role mapping"
    });
  }
});

app.post("/role-library/mappings/reassign", express.json(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const fromRoleId = typeof req.body?.fromRoleId === "string" ? req.body.fromRoleId : "";
    const toRoleId = typeof req.body?.toRoleId === "string" ? req.body.toRoleId : "";

    if (!fromRoleId || !toRoleId || fromRoleId === toRoleId) {
      return res.status(400).json({ error: "fromRoleId and toRoleId are required and must be different" });
    }

    const reassigned = await prisma.roleAlignmentMapping.updateMany({
      where: { standardizedRoleId: fromRoleId },
      data: {
        standardizedRoleId: toRoleId,
        matchSource: "ADMIN_CONFIRMED"
      }
    });

    return res.status(200).json({ success: true, data: { updatedCount: reassigned.count } });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to reassign role mappings"
    });
  }
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
