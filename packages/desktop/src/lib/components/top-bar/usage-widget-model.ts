import type { ProviderBrand, UsageMetricTone, UsageWidgetModel } from "@acepe/ui";
import type { SessionCold, SessionUsageTelemetry } from "$lib/acp/store/types.js";

export type UsageAccountConnectionState = "connected" | "not-connected" | "unavailable" | "error";

export type UsageQuotaMetric = {
	readonly id: string;
	readonly label: string;
	readonly role: UsageQuotaMetricRole;
	readonly used: number;
	readonly limit: number;
	readonly resetAtMs: number | null;
	readonly sourceLabel: string;
	readonly usedLabel?: string;
	readonly leftLabel?: string;
};

export type UsageQuotaMetricRole = "primary-short" | "weekly" | "overage" | "other";

export type UsageTextMetric = {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly subtitle: string | null;
	readonly tone?: UsageMetricTone;
};

export type UsageProviderAccount = {
	readonly providerId: string;
	readonly providerName: string;
	readonly providerBrand: ProviderBrand | null;
	readonly connectionState: UsageAccountConnectionState;
	readonly planLabel?: string | null;
	readonly statusLabel: string | null;
	readonly quotaMetrics: ReadonlyArray<UsageQuotaMetric>;
	readonly textMetrics: ReadonlyArray<UsageTextMetric>;
};

export interface UsageWidgetModelInput {
	readonly sessions: ReadonlyArray<UsageWidgetTelemetrySession>;
	readonly nowMs: number;
	readonly accounts?: ReadonlyArray<UsageProviderAccount>;
}

export interface UsageWidgetTelemetrySession {
	readonly session: SessionCold;
	readonly telemetry: SessionUsageTelemetry | null;
	readonly currentModelId: string | null;
	readonly focused: boolean;
}

const DEFAULT_PROVIDER_ACCOUNTS: ReadonlyArray<UsageProviderAccount> = [
	{
		providerId: "codex",
		providerName: "Codex",
		providerBrand: "codex",
		connectionState: "not-connected",
		planLabel: null,
		statusLabel: "Not connected",
		quotaMetrics: [],
		textMetrics: [],
	},
	{
		providerId: "claude-code",
		providerName: "Claude Code",
		providerBrand: "claude-code",
		connectionState: "not-connected",
		planLabel: null,
		statusLabel: "Not connected",
		quotaMetrics: [],
		textMetrics: [],
	},
	{
		providerId: "cursor",
		providerName: "Cursor",
		providerBrand: "cursor",
		connectionState: "not-connected",
		planLabel: null,
		statusLabel: "Not connected",
		quotaMetrics: [],
		textMetrics: [],
	},
];

function baseCopy(): UsageWidgetModel["copy"] {
	return {
		triggerLabel: "AI usage",
		title: "Usage",
		subtitle: "",
		updatedLabel: "Updated",
		refreshLabel: "Refresh",
		localLabel: "Provider account usage only.",
		emptyLabel: "No provider usage source is connected yet",
	};
}

function clampPercent(value: number): number {
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

function formatTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens)) {
		return "0";
	}

	return Math.max(0, Math.round(tokens)).toLocaleString();
}

function formatAgeUntil(resetAtMs: number, nowMs: number): string {
	const remainingMs = Math.max(0, resetAtMs - nowMs);
	const remainingMinutes = Math.ceil(remainingMs / 60_000);

	if (remainingMinutes <= 1) {
		return "resets in 1m";
	}

	if (remainingMinutes < 60) {
		return `resets in ${remainingMinutes.toString()}m`;
	}

	const remainingHours = Math.ceil(remainingMinutes / 60);
	if (remainingHours < 24) {
		return `resets in ${remainingHours.toString()}h`;
	}

	const remainingDays = Math.ceil(remainingHours / 24);
	return `resets in ${remainingDays.toString()}d`;
}

function toneFromPercentUsed(percentUsed: number): UsageMetricTone {
	if (percentUsed >= 85) {
		return "danger";
	}

	if (percentUsed >= 60) {
		return "watch";
	}

	return "good";
}

function providerStateFromAccount(
	connectionState: UsageAccountConnectionState
): UsageWidgetModel["providers"][number]["state"] {
	if (connectionState === "connected") {
		return "ok";
	}

	if (connectionState === "error") {
		return "error";
	}

	if (connectionState === "unavailable") {
		return "disconnected";
	}

	return "disconnected";
}

function summaryTone(accounts: ReadonlyArray<UsageProviderAccount>): UsageMetricTone {
	let highestPercentUsed = 0;

	for (const account of accounts) {
		for (const metric of account.quotaMetrics) {
			if (metric.limit <= 0) {
				continue;
			}
			const percentUsed = clampPercent((metric.used / metric.limit) * 100);
			if (percentUsed > highestPercentUsed) {
				highestPercentUsed = percentUsed;
			}
		}
	}

	if (highestPercentUsed <= 0) {
		return "neutral";
	}

	return toneFromPercentUsed(highestPercentUsed);
}

function buildQuotaLine(
	metric: UsageQuotaMetric,
	nowMs: number
): UsageWidgetModel["providers"][number]["lines"][number] {
	const percentUsed = metric.limit <= 0 ? 0 : clampPercent((metric.used / metric.limit) * 100);
	const percentLeft = Math.max(0, 100 - percentUsed);
	const resetLabel = metric.resetAtMs === null ? metric.sourceLabel : formatAgeUntil(metric.resetAtMs, nowMs);

	return {
		type: "progress",
		label: metric.label,
		usedLabel: metric.usedLabel ?? `${formatTokenCount(metric.used)} used`,
		leftLabel: metric.leftLabel ?? `${percentLeft.toString()}% left`,
		resetLabel,
		percentUsed,
		projectedPercent: null,
		tone: toneFromPercentUsed(percentUsed),
	};
}

function isFiveHourQuotaMetric(metric: UsageQuotaMetric): boolean {
	if (metric.role === "primary-short") {
		return true;
	}

	const normalizedId = metric.id.toLowerCase();
	const normalizedLabel = metric.label.toLowerCase();
	const normalizedSource = metric.sourceLabel.toLowerCase();

	return (
		normalizedId.includes("five-hour") ||
		normalizedId.includes("primary") ||
		normalizedLabel.includes("5h") ||
		normalizedSource.includes("5h")
	);
}

function selectTriggerQuotaMetric(
	account: UsageProviderAccount
): UsageQuotaMetric | null {
	for (const metric of account.quotaMetrics) {
		if (isFiveHourQuotaMetric(metric)) {
			return metric;
		}
	}

	return account.quotaMetrics[0] ?? null;
}

function buildTriggerLimit(
	account: UsageProviderAccount
): UsageWidgetModel["triggerLimits"][number] | null {
	if (account.connectionState !== "connected") {
		return null;
	}

	const metric = selectTriggerQuotaMetric(account);
	if (metric === null || metric.limit <= 0) {
		return null;
	}

	const percentUsed = clampPercent((metric.used / metric.limit) * 100);
	const percentLeft = Math.max(0, 100 - percentUsed);

	return {
		id: `${account.providerId}:${metric.id}`,
		providerName: account.providerName,
		providerBrand: account.providerBrand,
		initials: account.providerName.slice(0, 2).toUpperCase(),
		label: metric.label,
		leftLabel: metric.leftLabel ?? `${percentLeft.toString()}% left`,
		percentUsed,
		tone: toneFromPercentUsed(percentUsed),
	};
}

function buildProvider(account: UsageProviderAccount, nowMs: number): UsageWidgetModel["providers"][number] {
	const lines: UsageWidgetModel["providers"][number]["lines"] = [];

	for (const metric of account.quotaMetrics) {
		lines.push(buildQuotaLine(metric, nowMs));
	}

	for (const metric of account.textMetrics) {
		lines.push({
			type: "text",
			label: metric.label,
			value: metric.value,
			subtitle: metric.subtitle,
			tone: metric.tone ?? "neutral",
		});
	}

	if (lines.length === 0) {
		lines.push({
			type: "text",
			label: "Account usage",
			value: "Not connected",
			subtitle: "Connect this provider to show OpenUsage-style limits",
			tone: "neutral",
		});
	}

	return {
		id: account.providerId,
		name: account.providerName,
		plan: account.planLabel ?? account.statusLabel ?? "Account usage",
		providerBrand: account.providerBrand,
		initials: account.providerName.slice(0, 2).toUpperCase(),
		accentColor: "#111827",
		state: providerStateFromAccount(account.connectionState),
		statusLabel: account.statusLabel ?? account.connectionState,
		lines,
	};
}

function mergeDefaultAccounts(
	accounts: ReadonlyArray<UsageProviderAccount>
): ReadonlyArray<UsageProviderAccount> {
	const byProviderId = new Map<string, UsageProviderAccount>();

	for (const account of DEFAULT_PROVIDER_ACCOUNTS) {
		byProviderId.set(account.providerId, account);
	}

	for (const account of accounts) {
		byProviderId.set(account.providerId, account);
	}

	return Array.from(byProviderId.values());
}

function connectedAccountCount(accounts: ReadonlyArray<UsageProviderAccount>): number {
	let count = 0;
	for (const account of accounts) {
		if (account.connectionState === "connected") {
			count += 1;
		}
	}
	return count;
}

function quotaMetricCount(accounts: ReadonlyArray<UsageProviderAccount>): number {
	let count = 0;
	for (const account of accounts) {
		count += account.quotaMetrics.length;
	}
	return count;
}

export function buildLiveUsageWidgetModel(input: UsageWidgetModelInput): UsageWidgetModel {
	const copy = baseCopy();
	const accounts = mergeDefaultAccounts(input.accounts ?? []);
	const connected = connectedAccountCount(accounts);
	const quotaCount = quotaMetricCount(accounts);

	const providers: UsageWidgetModel["providers"] = [];
	const triggerLimits: UsageWidgetModel["triggerLimits"] = [];
	for (const account of accounts) {
		providers.push(buildProvider(account, input.nowMs));
		const triggerLimit = buildTriggerLimit(account);
		if (triggerLimit !== null) {
			triggerLimits.push(triggerLimit);
		}
	}

	if (connected === 0 || quotaCount === 0) {
		return {
			summary: {
				label: "",
				value: "Usage · connect providers",
				tone: "neutral",
			},
			triggerLimits,
			updatedAtLabel: "No account usage source",
			statusLabel: "Provider usage not connected",
			copy,
			providers,
		};
	}

	return {
		summary: {
			label: "",
			value: `${connected.toString()} providers · ${quotaCount.toString()} limits`,
			tone: summaryTone(accounts),
		},
		triggerLimits,
		updatedAtLabel: "Account usage",
		statusLabel: `${connected.toString()} provider${connected === 1 ? "" : "s"} connected`,
		copy,
		providers,
	};
}
