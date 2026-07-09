import type { AgentSessionActivityContextUsage } from "./types.js";

export interface CompactionContextUsageViewModel {
	readonly beforeTokens: number;
	readonly afterTokens: number;
	readonly scaleTokens: number;
	readonly beforePercent: number;
	readonly afterPercent: number;
	readonly reclaimedPercent: number;
	readonly unusedPercent: number;
	readonly hasKnownWindow: boolean;
}

function validTokenCount(value: number | null): value is number {
	return Number.isFinite(value) && value !== null && value >= 0;
}

function clampedPercent(value: number, scale: number): number {
	return Math.round(Math.max(0, Math.min(100, (value / scale) * 100)));
}

export function buildCompactionContextUsageViewModel(
	usage: AgentSessionActivityContextUsage
): CompactionContextUsageViewModel | null {
	if (!validTokenCount(usage.preCompactionTokens)) {
		return null;
	}
	if (!validTokenCount(usage.postCompactionTokens)) {
		return null;
	}

	const hasKnownWindow = validTokenCount(usage.contextWindowSize) && usage.contextWindowSize > 0;
	const scaleTokens = hasKnownWindow
		? usage.contextWindowSize
		: Math.max(usage.preCompactionTokens, usage.postCompactionTokens, 1);
	const beforePercent = clampedPercent(usage.preCompactionTokens, scaleTokens);
	const afterPercent = clampedPercent(usage.postCompactionTokens, scaleTokens);
	const reclaimedPercent = Math.max(0, beforePercent - afterPercent);
	const unusedPercent = Math.max(0, 100 - Math.max(beforePercent, afterPercent));

	return {
		beforeTokens: usage.preCompactionTokens,
		afterTokens: usage.postCompactionTokens,
		scaleTokens,
		beforePercent,
		afterPercent,
		reclaimedPercent,
		unusedPercent,
		hasKnownWindow,
	};
}
