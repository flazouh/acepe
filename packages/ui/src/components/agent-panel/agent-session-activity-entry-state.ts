import type {
	AgentSessionActivityContextUsage,
	AgentSessionActivityEntry,
	AgentSessionActivityMetadataItem,
} from "./types.js";

/** Fill tones match the composer metrics chip so "context pressure" reads identically everywhere. */
const NEUTRAL_FILL_CLASS = "bg-foreground/55";
const WATCH_FILL_CLASS = "bg-[#ff9500] dark:bg-[#ff9f0a]";
const CRITICAL_FILL_CLASS = "bg-[#ff3b30] dark:bg-[#ff453a]";

export interface SessionActivityComparableUsage {
	readonly before: number;
	readonly after: number;
}

export interface SessionActivityGaugeModel {
	readonly beforePercent: number;
	readonly afterPercent: number;
	readonly beforeFillClass: string;
	readonly afterFillClass: string;
}

function isValidTokenCount(value: number | null | undefined): value is number {
	return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

function stripTrailingZero(value: string): string {
	return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/** Compact token count for the seam line: 950, 9.4k, 142k, 1.2m. */
export function formatCompactTokens(value: number): string {
	if (value < 1_000) {
		return String(value);
	}
	if (value < 10_000) {
		return `${stripTrailingZero((value / 1_000).toFixed(1))}k`;
	}
	if (value < 1_000_000) {
		return `${Math.round(value / 1_000)}k`;
	}
	return `${stripTrailingZero((value / 1_000_000).toFixed(1))}m`;
}

export function compactionUsagePercent(
	tokens: number | null | undefined,
	windowSize: number | null | undefined
): number | null {
	if (!isValidTokenCount(tokens)) {
		return null;
	}
	if (windowSize === null || windowSize === undefined || !Number.isFinite(windowSize) || windowSize <= 0) {
		return null;
	}
	return Math.min(100, Math.max(0, (tokens / windowSize) * 100));
}

/** Same escalation thresholds as the composer context gauge: neutral → watch (60) → critical (80). */
export function usageFillClass(percent: number): string {
	if (percent >= 80) {
		return CRITICAL_FILL_CLASS;
	}
	if (percent >= 60) {
		return WATCH_FILL_CLASS;
	}
	return NEUTRAL_FILL_CLASS;
}

/** Fill height inside the gauge track; keeps a 1px floor so "after" never vanishes. */
export function gaugeFillHeightPx(percent: number, innerPx: number): number {
	return Math.max(1, Math.round((innerPx * percent) / 100));
}

export function resolveComparableUsage(
	usage: AgentSessionActivityContextUsage | null | undefined
): SessionActivityComparableUsage | null {
	if (usage === null || usage === undefined) {
		return null;
	}
	if (!isValidTokenCount(usage.preCompactionTokens) || !isValidTokenCount(usage.postCompactionTokens)) {
		return null;
	}
	return {
		before: usage.preCompactionTokens,
		after: usage.postCompactionTokens,
	};
}

export function resolveSessionActivityGauge(
	usage: AgentSessionActivityContextUsage | null | undefined
): SessionActivityGaugeModel | null {
	const comparable = resolveComparableUsage(usage);
	if (comparable === null) {
		return null;
	}
	const beforePercent = compactionUsagePercent(comparable.before, usage?.contextWindowSize);
	const afterPercent = compactionUsagePercent(comparable.after, usage?.contextWindowSize);
	if (beforePercent === null || afterPercent === null) {
		return null;
	}
	return {
		beforePercent,
		afterPercent,
		beforeFillClass: usageFillClass(beforePercent),
		afterFillClass: NEUTRAL_FILL_CLASS,
	};
}

/** Detail parts under the seam: subtitle first, then metadata pairs. Rendered no-wrap so lines break at separators. */
export function sessionActivityDetailParts(
	subtitle: string | null | undefined,
	metadata: readonly AgentSessionActivityMetadataItem[] | undefined
): readonly string[] {
	const parts: string[] = [];
	if (subtitle !== null && subtitle !== undefined && subtitle.length > 0) {
		parts.push(subtitle);
	}
	for (const item of metadata ?? []) {
		parts.push(`${item.label}: ${item.value}`);
	}
	return parts;
}

/** One quiet line under the seam: subtitle first, then metadata pairs, middot-separated. */
export function sessionActivityDetailText(
	subtitle: string | null | undefined,
	metadata: readonly AgentSessionActivityMetadataItem[] | undefined
): string | null {
	const parts = sessionActivityDetailParts(subtitle, metadata);
	if (parts.length === 0) {
		return null;
	}
	return parts.join(" · ");
}

function formatFullTokens(value: number): string {
	return value.toLocaleString("en-US");
}

/** Screen-reader summary with full token counts; visible text uses compact counts. */
export function sessionActivityAriaLabel(input: {
	readonly title: string;
	readonly status: AgentSessionActivityEntry["status"];
	readonly subtitle: string | null | undefined;
	readonly contextUsage: AgentSessionActivityContextUsage | null | undefined;
	readonly metadata: readonly AgentSessionActivityMetadataItem[] | undefined;
}): string {
	const parts: string[] = [input.title];
	const comparable = resolveComparableUsage(input.contextUsage);
	if (comparable !== null) {
		const windowSize = input.contextUsage?.contextWindowSize;
		const windowSuffix = isValidTokenCount(windowSize)
			? ` of ${formatFullTokens(windowSize)} window`
			: "";
		parts.push(
			`context ${formatFullTokens(comparable.before)} tokens before, ${formatFullTokens(comparable.after)} tokens after${windowSuffix}`
		);
	}
	const detail = sessionActivityDetailText(input.subtitle, input.metadata);
	if (detail !== null) {
		parts.push(detail);
	}
	return parts.join(" — ");
}
