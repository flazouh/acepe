import type { ProviderBrand } from "../provider-mark/index.js";

export type UsageMetricTone = "good" | "watch" | "danger" | "neutral";
export type UsageProviderState = "ok" | "loading" | "stale" | "error" | "disconnected";

export type UsageTextLine = {
	type: "text";
	label: string;
	value: string;
	subtitle: string | null;
	tone: UsageMetricTone;
};

export type UsageProgressLine = {
	type: "progress";
	label: string;
	usedLabel: string;
	leftLabel: string;
	resetLabel: string | null;
	percentUsed: number;
	projectedPercent: number | null;
	tone: UsageMetricTone;
};

export type UsageBadgeLine = {
	type: "badge";
	label: string;
	value: string;
	subtitle: string | null;
	tone: UsageMetricTone;
};

export type UsageMetricLine = UsageTextLine | UsageProgressLine | UsageBadgeLine;

export type UsageProvider = {
	id: string;
	name: string;
	plan: string;
	providerBrand: ProviderBrand | null;
	initials: string;
	accentColor: string;
	state: UsageProviderState;
	statusLabel: string;
	lines: UsageMetricLine[];
};

export type UsageWidgetSummary = {
	label: string;
	value: string;
	tone: UsageMetricTone;
};

export type UsageTriggerLimitItem = {
	id: string;
	providerName: string;
	providerBrand: ProviderBrand | null;
	initials: string;
	label: string;
	leftLabel: string;
	percentUsed: number;
	tone: UsageMetricTone;
};

export type UsageWidgetCopy = {
	triggerLabel: string;
	title: string;
	subtitle: string;
	updatedLabel: string;
	refreshLabel: string;
	localLabel: string;
	emptyLabel: string;
};

export type UsageWidgetModel = {
	summary: UsageWidgetSummary;
	triggerLimits: UsageTriggerLimitItem[];
	updatedAtLabel: string;
	statusLabel: string;
	copy: UsageWidgetCopy;
	providers: UsageProvider[];
};
