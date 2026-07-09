import { describe, expect, it } from "bun:test";
import {
	clampPercent,
	getProgressAriaValue,
	getProviderHealth,
	getProviderStateLabel,
	getVerticalMeterFillClass,
	getVerticalMeterLabel,
	getVerticalMeterMetricLabel,
} from "./usage-widget-state.js";
import type { UsageProvider } from "./types.js";

describe("usage widget state", () => {
	it("clamps progress percentages", () => {
		expect(clampPercent(-12)).toBe(0);
		expect(clampPercent(32.4)).toBe(32);
		expect(clampPercent(140)).toBe(100);
		expect(clampPercent(Number.NaN)).toBe(0);
	});

	it("uses the most urgent provider line as health", () => {
		const provider: UsageProvider = {
			id: "codex",
			name: "Codex",
			plan: "Pro",
			providerBrand: "codex",
			initials: "CX",
			accentColor: "#111827",
			state: "ok",
			statusLabel: "Connected",
			lines: [
				{
					type: "progress",
					label: "Weekly",
					usedLabel: "42% used",
					leftLabel: "58% left",
					resetLabel: "Resets in 4d",
					percentUsed: 42,
					projectedPercent: 56,
					tone: "good",
				},
				{
					type: "badge",
					label: "Reviews",
					value: "Low",
					subtitle: null,
					tone: "watch",
				},
			],
		};

		expect(getProviderHealth(provider)).toBe("watch");
	});

	it("lets provider connection state override line health", () => {
		const provider: UsageProvider = {
			id: "cursor",
			name: "Cursor",
			plan: "Ultra",
			providerBrand: "cursor",
			initials: "CU",
			accentColor: "#2563EB",
			state: "stale",
			statusLabel: "Connected",
			lines: [
				{
					type: "progress",
					label: "Premium",
					usedLabel: "12% used",
					leftLabel: "88% left",
					resetLabel: null,
					percentUsed: 12,
					projectedPercent: null,
					tone: "good",
				},
			],
		};

		expect(getProviderHealth(provider)).toBe("watch");
		expect(getProviderStateLabel(provider)).toBe("Stale");
	});

	it("derives aria value from clamped progress", () => {
		expect(
			getProgressAriaValue({
				type: "progress",
				label: "Session",
				usedLabel: "120% used",
				leftLabel: "0% left",
				resetLabel: null,
				percentUsed: 120,
				projectedPercent: null,
				tone: "danger",
			})
		).toBe(100);
	});

	it("keeps normal vertical meter fills green with tone overrides", () => {
		expect(getVerticalMeterFillClass(0, "good")).toBe("bg-success");
		expect(getVerticalMeterFillClass(1, "good")).toBe(getVerticalMeterFillClass(0, "good"));
		expect(getVerticalMeterFillClass(0, "watch")).toContain("#ff9500");
		expect(getVerticalMeterFillClass(0, "danger")).toContain("#ff3b30");
	});

	it("derives metric abbreviations for vertical meter labels", () => {
		expect(getVerticalMeterMetricLabel("5h window")).toBe("5H");
		expect(getVerticalMeterMetricLabel("Weekly window")).toBe("WK");
		expect(getVerticalMeterMetricLabel("Session")).toBe("SSN");
	});

	it("keeps legacy initials fallback helper", () => {
		expect(getVerticalMeterLabel("CX", "5h window")).toBe("CX");
	});
});
