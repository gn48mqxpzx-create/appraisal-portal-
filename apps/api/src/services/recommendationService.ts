import { PrismaClient, WsllGateStatus } from "@prisma/client";

const prisma = new PrismaClient();

export async function computeRecommendation(caseId: string, computedBy?: string) {
  // Fetch case with current compensation
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      compCurrent: true,
      cycle: true,
    },
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  if (!caseRecord.compCurrent) {
    throw new Error("Current compensation not set");
  }

  const currentBase = Number(caseRecord.compCurrent.baseSalary);

  // Compute tenure months from start date to now
  const startDate = new Date(caseRecord.startDate);
  const now = new Date();
  const tenureMonths = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  );

  // Find matching tenure band
  const tenureBand = await prisma.tenureBand.findFirst({
    where: {
      minMonths: { lte: tenureMonths },
      maxMonths: { gte: tenureMonths },
    },
  });

  // Find market benchmark for staff role and tenure band
  let benchmark = null;
  let benchmarkBase = null;
  let catchupPercent = null;

  if (tenureBand) {
    benchmark = await prisma.marketBenchmark.findUnique({
      where: {
        staffRole_tenureBandId: {
          staffRole: caseRecord.staffRole,
          tenureBandId: tenureBand.id,
        },
      },
    });

    if (benchmark) {
      benchmarkBase = Number(benchmark.baseSalary);
      catchupPercent = benchmark.catchupPercent || 75; // Default to 75%
    }
  }

  // Fetch WSLL score for the cycle
  const wsllScore = await prisma.wsllScore.findUnique({
    where: {
      cycleId_staffId: {
        cycleId: caseRecord.cycleId,
        staffId: caseRecord.staffId,
      },
    },
  });

  let wsllGateStatus: WsllGateStatus = WsllGateStatus.MISSING;
  let wsllScoreUsed: number | null = null;

  if (wsllScore) {
    wsllScoreUsed = Number(wsllScore.wsllScore);
    wsllGateStatus = wsllScoreUsed >= 3.0 ? WsllGateStatus.PASS : WsllGateStatus.FAIL;
  }

  // Store market snapshot
  await prisma.caseMarketSnapshot.upsert({
    where: { caseId },
    create: {
      caseId,
      tenureMonthsUsed: tenureMonths,
      tenureBandIdUsed: tenureBand?.id || null,
      benchmarkBaseUsed: benchmarkBase,
      catchupPercentUsed: catchupPercent,
      wsllScoreUsed: wsllScoreUsed,
      wsllGateStatus,
    },
    update: {
      tenureMonthsUsed: tenureMonths,
      tenureBandIdUsed: tenureBand?.id || null,
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

  // If WSLL < 3.0, recommendation must be 0
  if (wsllGateStatus === WsllGateStatus.FAIL) {
    recommendedAmount = 0;
    recommendedPercent = 0;
    recommendedNewBase = currentBase;
  } else if (benchmarkBase && currentBase < benchmarkBase) {
    // Compute catch-up recommendation
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
