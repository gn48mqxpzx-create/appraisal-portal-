import { Prisma, PrismaClient, TenureBandLabel, WsllGateStatus } from "@prisma/client";
import {
  getLatestWsllEligibilityByStaffId,
  wsllStatusToGateStatus
} from "./wsllEligibilityService";
import { getOrBuildWorkingData } from "./employeeWorkingDataService";

const prisma = new PrismaClient();

export async function computeRecommendation(caseId: string, computedBy?: string) {
  // Fetch case context
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      cycle: true,
    },
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  const currentCompensation = await prisma.currentCompensation.findUnique({
    where: {
      staffId: caseRecord.staffId
    }
  });

  if (!currentCompensation) {
    throw new Error("Current compensation not set");
  }

  const currentBase = Number(currentCompensation.currentCompensation);
  const workingData = await getOrBuildWorkingData(caseRecord.staffId);

  // Compute tenure months from start date to now
  const startDate = new Date(caseRecord.startDate);
  const now = new Date();
  const fallbackTenureMonths = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  );
  const tenureMonths = workingData?.tenureMonths ?? fallbackTenureMonths;

  const tenureBand: TenureBandLabel =
    tenureMonths < 12
      ? TenureBandLabel.T1
      : tenureMonths < 24
        ? TenureBandLabel.T2
        : tenureMonths < 48
          ? TenureBandLabel.T3
          : TenureBandLabel.T4;

  // Find canonical role mapping + market matrix row
  let benchmark = null;
  let benchmarkBase = null;
  let catchupPercent = null;

  if (workingData?.normalizedRole) {
    benchmark = await prisma.marketValueMatrix.findFirst({
      where: {
        tenureBand,
        OR: [
          ...(workingData.standardizedRoleId
            ? [
                {
                  standardizedRoleId: workingData.standardizedRoleId
                }
              ]
            : []),
          {
            roleName: {
              equals: workingData.normalizedRole,
              mode: "insensitive"
            }
          }
        ]
      }
    });

    if (benchmark) {
      const midpoint = benchmark.minSalary.plus(benchmark.maxSalary).dividedBy(new Prisma.Decimal(2));
      benchmarkBase = Number(midpoint);
      catchupPercent = 75;
    }
  }

  const wsllEligibility = await getLatestWsllEligibilityByStaffId(caseRecord.staffId);
  const wsllGateStatus: WsllGateStatus = wsllStatusToGateStatus(wsllEligibility.status);
  const wsllScoreUsed: number | null = wsllEligibility.averageWsll;

  // Store market snapshot
  await prisma.caseMarketSnapshot.upsert({
    where: { caseId },
    create: {
      caseId,
      tenureMonthsUsed: tenureMonths,
      tenureBandIdUsed: tenureBand,
      benchmarkBaseUsed: benchmarkBase,
      catchupPercentUsed: catchupPercent,
      wsllScoreUsed: wsllScoreUsed,
      wsllGateStatus,
    },
    update: {
      tenureMonthsUsed: tenureMonths,
      tenureBandIdUsed: tenureBand,
      benchmarkBaseUsed: benchmarkBase,
      catchupPercentUsed: catchupPercent,
      wsllScoreUsed: wsllScoreUsed,
      wsllGateStatus,
    },
  });

  // Compute recommendation
  let varianceAmount = 0;
  let variancePercent = null;
  let recommendedAmount = 0;
  let recommendedPercent = null;
  let recommendedNewBase = currentBase;

  if (benchmarkBase && currentBase < benchmarkBase) {
    // Compute catch-up recommendation.
    // WSLL now influences approval flow (RM override), not recommendation generation.
    varianceAmount = benchmarkBase - currentBase;
    variancePercent = currentBase > 0 ? varianceAmount / currentBase : 0;
    recommendedAmount = varianceAmount * ((catchupPercent || 75) / 100);
    recommendedNewBase = currentBase + recommendedAmount;
    recommendedPercent = currentBase > 0 ? recommendedAmount / currentBase : 0;
  }

  // Store recommendation
  const recommendation = await prisma.caseRecommendation.upsert({
    where: { caseId },
    create: {
      caseId,
      varianceAmount,
      variancePercent,
      recommendedAmount,
      recommendedPercent,
      recommendedNewBase,
      computedBy,
    },
    update: {
      varianceAmount,
      variancePercent,
      recommendedAmount,
      recommendedPercent,
      recommendedNewBase,
      computedBy,
      computedAt: new Date(),
    },
  });

  // Update case flags
  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      isMissingBenchmark: !benchmarkBase,
      tenureMonths,
      tenureComputedAt: now,
    },
  });

  return {
    recommendation,
    marketSnapshot: await prisma.caseMarketSnapshot.findUnique({ where: { caseId } }),
  };
}

export async function getFinalNewBase(caseId: string): Promise<number> {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      compCurrent: true,
      recommendation: true,
      override: true,
    },
  });

  if (!caseRecord || !caseRecord.compCurrent) {
    return 0;
  }

  const currentBase = Number(caseRecord.compCurrent.baseSalary);
  const override = caseRecord.override;
  const recommendation = caseRecord.recommendation;

  // Priority: override_new_base > override_amount > override_percent > recommended_new_base
  if (override) {
    if (override.overrideNewBase !== null) {
      return Number(override.overrideNewBase);
    }
    if (override.overrideAmount !== null) {
      return currentBase + Number(override.overrideAmount);
    }
    if (override.overridePercent !== null) {
      return currentBase * (1 + Number(override.overridePercent));
    }
  }

  if (recommendation) {
    return Number(recommendation.recommendedNewBase);
  }

  return currentBase;
}
