import { PrismaClient, WsllGateStatus } from "@prisma/client";

const prisma = new PrismaClient();

export const WSLL_ELIGIBILITY_THRESHOLD = 2.8;

export type WsllEligibilityStatus = "PASS" | "MISSING_WSLL" | "WSLL_BELOW_THRESHOLD";

export type WsllEligibilityResult = {
  status: WsllEligibilityStatus;
  averageWsll: number | null;
  isEligibleForAppraisal: boolean;
  blockerMessage: string | null;
};

const parseAverageFromRawRow = (rawRowJson: unknown): number | null => {
  if (!rawRowJson || typeof rawRowJson !== "object") {
    return null;
  }

  const average = (rawRowJson as Record<string, unknown>).averageWsll;
  if (typeof average !== "number" || !Number.isFinite(average)) {
    return null;
  }

  return Number(average.toFixed(2));
};

const toWsllResult = (averageWsll: number | null): WsllEligibilityResult => {
  if (averageWsll === null) {
    return {
      status: "MISSING_WSLL",
      averageWsll: null,
      isEligibleForAppraisal: false,
      blockerMessage: "WSLL data is required before a recommendation can be created."
    };
  }

  if (averageWsll < WSLL_ELIGIBILITY_THRESHOLD) {
    return {
      status: "WSLL_BELOW_THRESHOLD",
      averageWsll,
      isEligibleForAppraisal: false,
      blockerMessage: "Employee is not eligible for appraisal because average WSLL is below 2.8."
    };
  }

  return {
    status: "PASS",
    averageWsll,
    isEligibleForAppraisal: true,
    blockerMessage: null
  };
};

export const wsllStatusToGateStatus = (status: WsllEligibilityStatus): WsllGateStatus => {
  if (status === "PASS") {
    return WsllGateStatus.PASS;
  }

  if (status === "MISSING_WSLL") {
    return WsllGateStatus.MISSING;
  }

  return WsllGateStatus.FAIL;
};

export async function getLatestWsllEligibilityByStaffIds(staffIds: string[]): Promise<Map<string, WsllEligibilityResult>> {
  const uniqueStaffIds = [...new Set(staffIds.filter(Boolean))];
  const resultMap = new Map<string, WsllEligibilityResult>();

  if (uniqueStaffIds.length === 0) {
    return resultMap;
  }

  const latestRecords = await prisma.wsllRecord.findMany({
    where: {
      staffId: {
        in: uniqueStaffIds
      }
    },
    orderBy: [{ wsllDate: "desc" }, { uploadedAt: "desc" }],
    select: {
      staffId: true,
      wsllScore: true,
      rawRowJson: true
    }
  });

  for (const row of latestRecords) {
    if (resultMap.has(row.staffId)) {
      continue;
    }

    const fromRaw = parseAverageFromRawRow(row.rawRowJson);
    const averageWsll = fromRaw ?? (Number.isFinite(row.wsllScore) ? Number(row.wsllScore.toFixed(2)) : null);
    resultMap.set(row.staffId, toWsllResult(averageWsll));
  }

  return resultMap;
}

export async function getLatestWsllEligibilityByStaffId(staffId: string): Promise<WsllEligibilityResult> {
  const map = await getLatestWsllEligibilityByStaffIds([staffId]);
  return map.get(staffId) ?? toWsllResult(null);
}
