export type CurrencyViewContext =
	| 'dashboard'
	| 'appraisal-cases'
	| 'case-detail'
	| 'review-queue'
	| 'payroll'
	| 'client-approval';

export type CurrencyDisplayContext = 'internal' | 'client-approval';

const CLIENT_APPROVAL_STATUSES = new Set(['PENDING_CLIENT_APPROVAL', 'CLIENT_APPROVED']);

const toNumber = (value: number | string | null | undefined): number | null => {
	if (value === null || value === undefined) {
		return null;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const formatMoney = (value: number, currency: 'PHP' | 'AUD'): string => {
	const locale = currency === 'PHP' ? 'en-PH' : 'en-AU';

	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(value);
	} catch {
		const prefix = currency === 'PHP' ? '₱' : 'AU$';
		return `${prefix}${value.toFixed(2)}`;
	}
};

export const getDisplayCurrencyContext = (
	view: CurrencyViewContext,
	caseStatus?: string | null
): CurrencyDisplayContext => {
	if (view === 'client-approval') {
		return 'client-approval';
	}

	if (caseStatus && CLIENT_APPROVAL_STATUSES.has(caseStatus)) {
		return 'client-approval';
	}

	return 'internal';
};

export const getPhpToAudRate = (): number | null => {
	const envRate = Number(import.meta.env.VITE_PHP_TO_AUD_RATE);
	if (Number.isFinite(envRate) && envRate > 0) {
		return envRate;
	}

	return null;
};

export const formatCompensation = (
	value: number | string | null | undefined,
	options: {
		view: CurrencyViewContext;
		caseStatus?: string | null;
		conversionRate?: number | null;
	}
): string => {
	const amount = toNumber(value);
	if (amount === null) {
		return '—';
	}

	const phpText = formatMoney(amount, 'PHP');
	const displayContext = getDisplayCurrencyContext(options.view, options.caseStatus);

	if (displayContext === 'internal') {
		return phpText;
	}

	const conversionRate = options.conversionRate ?? null;
	if (!conversionRate || conversionRate <= 0) {
		return `${phpText} (AU$ pending FX)`;
	}

	const audValue = amount * conversionRate;
	return `${phpText} (${formatMoney(audValue, 'AUD')})`;
};

/**
 * Format a WSLL score to always display exactly two decimal places.
 * Examples: 4 → "4.00", 3.6 → "3.60", 2.04 → "2.04"
 * Returns '—' for null/undefined/non-finite values.
 */
export const formatWsll = (value: number | null | undefined): string => {
	const n = toNumber(value);
	if (n === null) return '—';
	return n.toFixed(2);
};
