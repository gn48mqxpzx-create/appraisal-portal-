import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type GuardrailLevel = "Green" | "Yellow" | "Red" | "Unknown";

export interface GuardrailEvaluationResult {
  guardrailLevel: GuardrailLevel;
  colorCode: string;
  actionRequired: string;
  matchedByPercent: GuardrailLevel;
  matchedByAmount: GuardrailLevel;
}

// Severity order: lower index = lower severity
const SEVERITY_ORDER: GuardrailLevel[] = ["Unknown", "Green", "Yellow", "Red"];

function higherSeverity(a: GuardrailLevel, b: GuardrailLevel): GuardrailLevel {
  const ai = SEVERITY_ORDER.indexOf(a);
  const bi = SEVERITY_ORDER.indexOf(b);
  return ai >= bi ? a : b;
}

interface GuardrailRow {
  levelName: string;
  colorCode: string;
  minPercent: unknown;
  maxPercent: unknown;
  minAmount: unknown;
  maxAmount: unknown;
  actionRequired: string;
}

function matchesRange(value: number, min: unknown, max: unknown): boolean {
  const lo = min !== null && min !== undefined ? Number(min) : null;
  const hi = max !== null && max !== undefined ? Number(max) : null;
  if (lo !== null && value < lo) return false;
  if (hi !== null && value > hi) return false;
  return true;
}

function evaluateValue(
  value: number,
  rows: GuardrailRow[],
  kind: "percent" | "amount"
): { level: GuardrailLevel; colorCode: string; actionRequired: string } {
  for (const row of rows) {
    const min = kind === "percent" ? row.minPercent : row.minAmount;
    const max = kind === "percent" ? row.maxPercent : row.maxAmount;
    if (matchesRange(value, min, max)) {
      return {
        level: row.levelName as GuardrailLevel,
        colorCode: row.colorCode,
        actionRequired: row.actionRequired,
      };
    }
  }
  // No row matched — treat as highest severity (Red) to be safe
  return { level: "Red", colorCode: "#ef4444", actionRequired: "Executive Override Required" };
}

export async function evaluateGuardrails(
  increasePercent: number,
  increaseAmount: number
): Promise<GuardrailEvaluationResult> {
  const rows = await prisma.increaseGuardrail.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (rows.length === 0) {
    return {
      guardrailLevel: "Unknown",
      colorCode: "#6b7280",
      actionRequired: "No guardrails configured",
      matchedByPercent: "Unknown",
      matchedByAmount: "Unknown",
    };
  }

  const percentResult = evaluateValue(increasePercent, rows, "percent");
  const amountResult = evaluateValue(increaseAmount, rows, "amount");

  const winnerLevel = higherSeverity(percentResult.level, amountResult.level);
  const winnerRow =
    winnerLevel === amountResult.level ? amountResult : percentResult;

  return {
    guardrailLevel: winnerLevel,
    colorCode: winnerRow.colorCode,
    actionRequired: winnerRow.actionRequired,
    matchedByPercent: percentResult.level,
    matchedByAmount: amountResult.level,
  };
}

export default { evaluateGuardrails };
