export type CanonicalWsllHeader = "staff_id" | "wsll_score" | "wsll_date";

export type WsllHeaderMap = Partial<Record<CanonicalWsllHeader, string>>;

export type WsllFlagCode =
  | "MISSING_STAFF_ID"
  | "INVALID_WSLL_SCORE"
  | "WSLL_SCORE_OUT_OF_RANGE"
  | "INVALID_WSLL_DATE_FORMAT"
  | "MISSING_IN_HUBSPOT";

export type WsllNormalizedRow = {
  rowNumber: number;
  staff_id: string;
  wsll_score: number | null;
  wsll_date: string | null;
  flags: WsllFlagCode[];
  raw: Record<string, string>;
};

export const normalizeStaffId = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, "");

export const normalizeHeader = (header: string): string => {
  return header
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
};

const WSLL_HEADER_VARIANTS: Record<CanonicalWsllHeader, string[]> = {
  staff_id: ["staff id", "staff_id", "staffid", "staff id number", "staff_id_number", "employee id"],
  wsll_score: ["wsll", "wsll score", "score", "wsll_rating"],
  wsll_date: ["wsll date", "date", "rating date", "wsll_date"]
};

export const buildHeaderMap = (headers: string[]): WsllHeaderMap => {
  const normalizedToOriginal = new Map<string, string>();
  for (const header of headers) {
    normalizedToOriginal.set(normalizeHeader(header), header);
  }

  const headerMap: WsllHeaderMap = {};
  for (const [canonical, variants] of Object.entries(WSLL_HEADER_VARIANTS) as Array<[CanonicalWsllHeader, string[]]>) {
    for (const variant of variants) {
      const original = normalizedToOriginal.get(normalizeHeader(variant));
      if (original) {
        headerMap[canonical] = original;
        break;
      }
    }
  }

  return headerMap;
};

const parseWsllScore = (value: string): { score: number | null; flags: WsllFlagCode[] } => {
  const raw = value.trim();
  if (!raw) {
    return { score: null, flags: ["INVALID_WSLL_SCORE"] };
  }

  const score = Number.parseFloat(raw);
  if (!Number.isFinite(score)) {
    return { score: null, flags: ["INVALID_WSLL_SCORE"] };
  }

  if (score < 0 || score > 5) {
    return { score: null, flags: ["WSLL_SCORE_OUT_OF_RANGE"] };
  }

  return { score, flags: [] };
};

const parseWsllDate = (value: string): { wsllDate: string | null; flags: WsllFlagCode[] } => {
  const raw = value.trim();
  if (!raw) {
    return { wsllDate: null, flags: [] };
  }

  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;

  const slashDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(raw);
  if (slashDash) {
    month = Number.parseInt(slashDash[1], 10);
    day = Number.parseInt(slashDash[2], 10);
    const yearRaw = Number.parseInt(slashDash[3], 10);
    year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) {
    year = Number.parseInt(iso[1], 10);
    month = Number.parseInt(iso[2], 10);
    day = Number.parseInt(iso[3], 10);
  }

  if (year === null || month === null || day === null) {
    return { wsllDate: null, flags: ["INVALID_WSLL_DATE_FORMAT"] };
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { wsllDate: null, flags: ["INVALID_WSLL_DATE_FORMAT"] };
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { wsllDate: null, flags: ["INVALID_WSLL_DATE_FORMAT"] };
  }

  return { wsllDate: date.toISOString().slice(0, 10), flags: [] };
};

export const normalizeWsllRow = (
  row: Record<string, string>,
  rowNumber: number,
  headerMap: WsllHeaderMap
): WsllNormalizedRow => {
  const staffIdRaw = headerMap.staff_id ? row[headerMap.staff_id] ?? "" : "";
  const wsllScoreRaw = headerMap.wsll_score ? row[headerMap.wsll_score] ?? "" : "";
  const wsllDateRaw = headerMap.wsll_date ? row[headerMap.wsll_date] ?? "" : "";

  const flags: WsllFlagCode[] = [];

  const staff_id = normalizeStaffId(staffIdRaw);
  if (!staff_id) {
    flags.push("MISSING_STAFF_ID");
  }

  const parsedScore = parseWsllScore(wsllScoreRaw);
  flags.push(...parsedScore.flags);

  const parsedDate = parseWsllDate(wsllDateRaw);
  flags.push(...parsedDate.flags);

  return {
    rowNumber,
    staff_id,
    wsll_score: parsedScore.score,
    wsll_date: parsedDate.wsllDate,
    flags,
    raw: row
  };
};

export type CanonicalMarketHeader =
  | "staff_role"
  | "location"
  | "band"
  | "min_value"
  | "max_value"
  | "currency"
  | "effective_date";

export type MarketHeaderMap = Partial<Record<CanonicalMarketHeader, string>>;

const MARKET_HEADER_VARIANTS: Record<CanonicalMarketHeader, string[]> = {
  staff_role: ["staff role", "staff_role", "role", "job role"],
  location: ["location", "site", "country"],
  band: ["band", "grade", "level"],
  min_value: ["min value", "min_value", "minimum", "min"],
  max_value: ["max value", "max_value", "maximum", "max"],
  currency: ["currency", "ccy"],
  effective_date: ["effective date", "effective_date", "date"]
};

export const buildMarketHeaderMap = (headers: string[]): MarketHeaderMap => {
  const normalizedToOriginal = new Map<string, string>();
  for (const header of headers) {
    normalizedToOriginal.set(normalizeHeader(header), header);
  }

  const headerMap: MarketHeaderMap = {};
  for (const [canonical, variants] of Object.entries(MARKET_HEADER_VARIANTS) as Array<[CanonicalMarketHeader, string[]]>) {
    for (const variant of variants) {
      const original = normalizedToOriginal.get(normalizeHeader(variant));
      if (original) {
        headerMap[canonical] = original;
        break;
      }
    }
  }

  return headerMap;
};

export const parseFlexibleDateToIso = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const parsed = parseWsllDate(raw);
  return parsed.flags.length ? null : parsed.wsllDate;
};
