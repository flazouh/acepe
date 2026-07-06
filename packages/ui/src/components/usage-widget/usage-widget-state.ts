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

const VERTICAL_METER_GOOD_FILL_CLASS = "bg-success";

export function getVerticalMeterFillClass(slotIndex: number, tone: UsageMetricTone): string {
	void slotIndex;

	if (tone === "danger") {
		return "bg-[#ff3b30] dark:bg-[#ff453a]";
	}

	if (tone === "watch") {
		return "bg-[#ff9500] dark:bg-[#ff9f0a]";
	}

	return VERTICAL_METER_GOOD_FILL_CLASS;
}

export function getVerticalMeterMetricLabel(metricLabel: string): string {
	const normalizedLabel = normalizeVerticalMeterLabelInput(metricLabel);
	const lowerLabel = normalizedLabel.toLowerCase();

	if (lowerLabel.includes("5h") || lowerLabel.includes("five-hour") || lowerLabel.includes("five hour")) {
		return "5H";
	}

	if (lowerLabel.includes("week")) {
		return "WK";
	}

	if (lowerLabel.includes("session")) {
		return "SSN";
	}

	const words = normalizedLabel.split(/\s+/).filter((word) => word.length > 0);
	if (words.length >= 2) {
		let abbreviation = "";
		for (const word of words) {
			if (abbreviation.length >= 3) {
				break;
			}

			const firstCharacter = word.charAt(0);
			if (firstCharacter.length > 0) {
				abbreviation = `${abbreviation}${firstCharacter}`;
			}
		}

		if (abbreviation.length >= 2) {
			return abbreviation.slice(0, 3).toUpperCase();
		}
	}

	const compactLabel = normalizedLabel.replace(/[^a-zA-Z0-9]/g, "");
	if (compactLabel.length >= 2) {
		return compactLabel.slice(0, 3).toUpperCase();
	}

	return normalizedLabel.slice(0, 3).toUpperCase();
}

function normalizeVerticalMeterLabelInput(label: string): string {
	return label.trim();
}

/** @deprecated Use getVerticalMeterMetricLabel instead. */
export function getVerticalMeterLabel(initials: string, metricLabel: string): string {
	const trimmedInitials = initials.trim();
	if (trimmedInitials.length >= 2) {
		return trimmedInitials.slice(0, 3);
	}

	return getVerticalMeterMetricLabel(metricLabel);
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
