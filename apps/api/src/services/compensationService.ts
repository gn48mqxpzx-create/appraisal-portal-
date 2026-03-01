import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function updateCurrentCompensation(
  caseId: string,
  data: {
    baseSalary?: number;
    fixedAllowances?: number;
    variableAllowances?: number;
    recurringBonuses?: number;
    onetimeBonuses?: number;
  },
  updatedBy?: string
) {
  const {
    baseSalary = 0,
    fixedAllowances = 0,
    variableAllowances = 0,
    recurringBonuses = 0,
    onetimeBonuses = 0,
  } = data;

  const totalComp = baseSalary + fixedAllowances + variableAllowances + recurringBonuses + onetimeBonuses;

  const compCurrent = await prisma.caseCompCurrent.upsert({
    where: { caseId },
    create: {
      caseId,
      baseSalary,
      fixedAllowances,
      variableAllowances,
      recurringBonuses,
      onetimeBonuses,
      totalComp,
      updatedBy,
    },
    update: {
      baseSalary,
      fixedAllowances,
      variableAllowances,
      recurringBonuses,
      onetimeBonuses,
      totalComp,
      updatedBy,
    },
  });

  return compCurrent;
}

export async function getCompensationData(caseId: string) {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
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
    throw new Error("Case not found");
  }

  return caseRecord;
}
