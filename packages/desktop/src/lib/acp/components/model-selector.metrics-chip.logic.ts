import type { SessionUsageTelemetry } from "$lib/acp/store/types.js";

export function formatTokenCountCompact(tokens: number): string {
	if (!Number.isFinite(tokens)) return "0";

	const clamped = Math.max(0, Math.round(tokens));
	if (clamped < 1_000) {
		return `${clamped}`;
	}

	const units: ReadonlyArray<{ readonly value: number; readonly suffix: string }> = [
		{ value: 1_000_000_000, suffix: "b" },
		{ value: 1_000_000, suffix: "m" },
		{ value: 1_000, suffix: "k" },
	];

	for (const unit of units) {
		if (clamped >= unit.value) {
			const scaled = clamped / unit.value;
			const rounded = Number(scaled.toFixed(scaled >= 10 ? 0 : 1));
			return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}${unit.suffix}`;
		}
	}

	return `${clamped}`;
}

export function formatTokenUsageCompact(
	totalTokens: number | null,
	contextWindowSize: number | null
): string | null {
	if (
		totalTokens == null ||
		contextWindowSize == null ||
		contextWindowSize <= 0 ||
		totalTokens < 0
	) {
		return null;
	}

	return `${formatTokenCountCompact(totalTokens)}/${formatTokenCountCompact(contextWindowSize)}`;
}

export function getContextUsagePercent(
	totalTokens: number | null,
	contextWindowSize: number | null
): number | null {
	if (
		totalTokens == null ||
		contextWindowSize == null ||
		contextWindowSize <= 0 ||
		totalTokens < 0
	) {
		return null;
	}

	return Math.min(100, Math.max(0, (totalTokens / contextWindowSize) * 100));
}

export function createContextUsageSegments(
	percent: number | null,
	segmentCount: number
): boolean[] {
	if (!Number.isFinite(segmentCount) || segmentCount <= 0) {
		return [];
	}

	const normalizedPercent = percent == null ? 0 : Math.min(100, Math.max(0, percent));
	const filledCount = Math.round((normalizedPercent / 100) * segmentCount);
	return Array.from({ length: segmentCount }, (_, index) => index < filledCount);
}

export function hasVisibleModelSelectorMetrics(
	usageTelemetry: SessionUsageTelemetry | null,
	isClaudeCode: boolean
): boolean {
	if (usageTelemetry === null) {
		return false;
	}

	if (isClaudeCode) {
		return true;
	}

	const hasSpend = usageTelemetry.sessionSpendUsd > 0;
	const hasContextUsage =
		getContextUsagePercent(
			usageTelemetry.latestTokensTotal,
			usageTelemetry.contextBudget?.maxTokens ?? null
		) !== null;

	return hasSpend ? true : hasContextUsage;
}
