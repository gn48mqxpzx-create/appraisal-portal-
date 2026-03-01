import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function generatePayrollExport(cycleId?: string) {
  const where: any = {
    status: {
      in: ["PAYROLL_PROCESSED", "LOCKED"],
    },
  };

  if (cycleId) {
    where.cycleId = cycleId;
  }

  const cases = await prisma.appraisalCase.findMany({
    where,
    include: {
      compCurrent: true,
      recommendation: true,
      override: true,
      payrollProcessing: true,
      approvalEvidence: true,
    },
    orderBy: [{ companyName: "asc" }, { staffId: "asc" }],
  });

  const rows = cases.map((c) => {
    const currentBase = Number(c.compCurrent?.baseSalary || 0);
    let finalNewBase = Number(c.recommendation?.recommendedNewBase || currentBase);

    // Apply override if present
    if (c.override) {
      if (c.override.overrideNewBase !== null) {
        finalNewBase = Number(c.override.overrideNewBase);
      } else if (c.override.overrideAmount !== null) {
        finalNewBase = currentBase + Number(c.override.overrideAmount);
      } else if (c.override.overridePercent !== null) {
        finalNewBase = currentBase * (1 + Number(c.override.overridePercent));
      }
    }

    const increaseAmount = finalNewBase - currentBase;
    const increasePercent = currentBase > 0 ? (increaseAmount / currentBase) * 100 : 0;

    const pdfCount = c.approvalEvidence.filter((e) => e.type === "PDF").length;
    const hubspotCount = c.approvalEvidence.filter((e) => e.type === "HUBSPOT_LINK").length;
    const approvalReference = `PDF:${pdfCount} HubSpot:${hubspotCount}`;

    return {
      staff_id: c.staffId,
      full_name: c.fullName,
      company_name: c.companyName,
      staff_role: c.staffRole,
      current_base: currentBase.toFixed(2),
      final_new_base: finalNewBase.toFixed(2),
      final_increase_amount: increaseAmount.toFixed(2),
      final_increase_percent: increasePercent.toFixed(2),
      effectivity_date: c.payrollProcessing?.effectivityDate
        ? new Date(c.payrollProcessing.effectivityDate).toISOString().split("T")[0]
        : "",
      approval_reference_summary: approvalReference,
    };
  });

  return rows;
}
