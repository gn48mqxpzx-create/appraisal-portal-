import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import { CycleStatus, CycleType, MovementType, ProcessingStatus, RowStatus, UploadType } from "@prisma/client";
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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
