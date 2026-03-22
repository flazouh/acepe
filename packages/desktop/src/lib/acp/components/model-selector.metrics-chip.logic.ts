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
