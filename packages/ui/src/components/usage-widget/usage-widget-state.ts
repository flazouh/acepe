import type { UsageMetricTone, UsageProgressLine, UsageProvider } from "./types.js";

export function clampPercent(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	if (value < 0) {
		return 0;
	}

	if (value > 100) {
		return 100;
	}

	return Math.round(value);
}

export function getToneClass(tone: UsageMetricTone): string {
	if (tone === "watch") {
		return "bg-amber-500 dark:bg-amber-400";
	}

	if (tone === "danger") {
		return "bg-destructive";
	}

	return "bg-foreground/35";
}

export function getToneTextClass(tone: UsageMetricTone): string {
	if (tone === "watch") {
		return "text-amber-600 dark:text-amber-400";
	}

	if (tone === "danger") {
		return "text-destructive";
	}

	return "text-muted-foreground";
}

export function getToneRailClass(tone: UsageMetricTone): string {
	if (tone === "watch") {
		return "bg-amber-500/55 dark:bg-amber-400/50";
	}

	if (tone === "danger") {
		return "bg-destructive/70";
	}

	return "bg-transparent";
}

export function getProviderHealth(provider: UsageProvider): UsageMetricTone {
	if (provider.state === "error" || provider.state === "disconnected") {
		return "danger";
	}

	if (provider.state === "loading" || provider.state === "stale") {
		return "watch";
	}

	let health: UsageMetricTone = "neutral";

	for (const line of provider.lines) {
		if (line.tone === "danger") {
			return "danger";
		}

		if (line.tone === "watch") {
			health = "watch";
		}

		if (line.tone === "good" && health === "neutral") {
			health = "good";
		}
	}

	return health;
}

export function getProviderStateLabel(provider: UsageProvider): string {
	if (provider.state === "loading") {
		return "Loading";
	}

	if (provider.state === "stale") {
		return "Stale";
	}

	if (provider.state === "error") {
		return "Needs attention";
	}

	if (provider.state === "disconnected") {
		return "Disconnected";
	}

	return provider.statusLabel;
}

export function getProgressAriaValue(line: UsageProgressLine): number {
	return clampPercent(line.percentUsed);
}
