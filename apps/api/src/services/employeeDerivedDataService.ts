export type TenureBand = "0-6" | "7-12" | "13-24" | "25+";
export type AttritionCategory = "ATTRITION" | "NON_ATTRITION" | "UNKNOWN";

export class EmployeeDerivedDataService {
  static compute(input: { startDate: Date; contactType: string; now?: Date }) {
    const now = input.now ?? new Date();
    const tenureMonths = this.calculateTenureMonths(input.startDate, now);
    const tenureBand = this.toTenureBand(tenureMonths);
    const attrition = this.mapAttrition(input.contactType);

    return {
      tenure_months: tenureMonths,
      tenure_band: tenureBand,
      attrition
    };
  }

  static calculateTenureMonths(startDate: Date, now: Date): number {
    const years = now.getUTCFullYear() - startDate.getUTCFullYear();
    const months = now.getUTCMonth() - startDate.getUTCMonth();
    let totalMonths = years * 12 + months;

    if (now.getUTCDate() < startDate.getUTCDate()) {
      totalMonths -= 1;
    }

    return Math.max(0, totalMonths);
  }

  static toTenureBand(tenureMonths: number): TenureBand {
    if (tenureMonths <= 6) {
      return "0-6";
    }
    if (tenureMonths <= 12) {
      return "7-12";
    }
    if (tenureMonths <= 24) {
      return "13-24";
    }

    return "25+";
  }

  static mapAttrition(contactType: string): AttritionCategory {
    const normalized = contactType.trim().toLowerCase();

    if (!normalized) {
      return "UNKNOWN";
    }

    // Attrition indicators: Separated, Left, Inactive
    if (
      normalized.includes("separated") ||
      normalized.includes("resigned") ||
      normalized.includes("terminated") ||
      normalized.includes("inactive") ||
      normalized.includes("left")
    ) {
      return "ATTRITION";
    }

    // Active indicators: Active, Floating, Maternity, Reprofile, Leave, AU Active
    if (
      normalized.includes("active") ||
      normalized.includes("floating") ||
      normalized.includes("maternity") ||
      normalized.includes("reprofile") ||
      normalized.includes("leave")
    ) {
      return "NON_ATTRITION";
    }

    return "UNKNOWN";
  }
}
