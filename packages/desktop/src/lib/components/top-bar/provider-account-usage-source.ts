import type { ProviderBrand } from "@acepe/ui";
import { TAURI_COMMAND_CLIENT } from "$lib/services/tauri-command-client.js";
import type {
	UsageAccountConnectionState,
	UsageProviderAccount,
	UsageQuotaMetric,
	UsageQuotaMetricRole,
	UsageTextMetric,
} from "./usage-widget-model.js";

type ProviderAccountConnection = "connected" | "notConnected" | "unavailable";
type ProviderUsageWindowRole = "primaryShort" | "weekly" | "overage" | "other";

type ProviderUsageWindow = {
	readonly id: string;
	readonly label: string;
	readonly role: ProviderUsageWindowRole;
	readonly usedFraction: number;
	readonly windowMinutes: number;
	readonly resetsAtMs: number | null;
};

type ProviderAccountUsage = {
	readonly providerId: string;
	readonly displayName: string;
	readonly plan: string | null;
	readonly capturedAtMs: number;
	readonly connection: ProviderAccountConnection;
	readonly windows: ReadonlyArray<ProviderUsageWindow>;
	readonly message: string | null;
};

type ProviderIdentity = {
	readonly providerId: string;
	readonly providerName: string;
	readonly providerBrand: ProviderBrand | null;
};

const PROVIDERS: ReadonlyArray<ProviderIdentity> = [
	{
		providerId: "codex",
		providerName: "Codex",
		providerBrand: "codex",
	},
	{
		providerId: "claude-code",
		providerName: "Claude Code",
		providerBrand: "claude-code",
	},
	{
		providerId: "cursor",
		providerName: "Cursor",
		providerBrand: "cursor",
	},
];

export function loadProviderAccountUsageAccounts() {
	return TAURI_COMMAND_CLIENT.provider_account_usage.get
		.invoke<ProviderAccountUsage[]>()
		.map(mapProviderAccountUsageToAccounts);
}

export function buildProviderUsageCheckingAccounts(): ReadonlyArray<UsageProviderAccount> {
	return buildUnavailableAccounts("Checking usage", "Reading provider account limits");
}

export function buildProviderUsageErrorAccounts(): ReadonlyArray<UsageProviderAccount> {
	return buildUnavailableAccounts(
		"Usage unavailable",
		"Acepe could not read provider account limits"
	);
}

export function mapProviderAccountUsageToAccounts(
	providers: ReadonlyArray<ProviderAccountUsage>
): ReadonlyArray<UsageProviderAccount> {
	const accounts: UsageProviderAccount[] = [];

	for (const provider of providers) {
		accounts.push(mapProviderAccountUsageToAccount(provider));
	}

	return accounts;
}

function mapProviderAccountUsageToAccount(provider: ProviderAccountUsage): UsageProviderAccount {
	const identity = resolveProviderIdentity(provider.providerId, provider.displayName);
	const quotaMetrics: UsageQuotaMetric[] = [];

	for (const window of provider.windows) {
		quotaMetrics.push(mapWindowToQuotaMetric(provider.providerId, window));
	}

	return {
		providerId: identity.providerId,
		providerName: identity.providerName,
		providerBrand: identity.providerBrand,
		connectionState: mapConnection(provider.connection),
		planLabel: provider.plan,
		statusLabel: statusLabelForConnection(provider.connection),
		quotaMetrics,
		textMetrics: [],
	};
}

function mapWindowToQuotaMetric(providerId: string, window: ProviderUsageWindow): UsageQuotaMetric {
	const usedPercent = clampPercent(window.usedFraction * 100);
	const leftPercent = Math.max(0, 100 - usedPercent);

	return {
		id: `${providerId}:${window.id}`,
		label: window.label,
		role: mapWindowRole(window.role),
		used: usedPercent,
		limit: 100,
		resetAtMs: window.resetsAtMs,
		sourceLabel: formatWindowSourceLabel(window.windowMinutes),
		usedLabel: `${usedPercent.toString()}% used`,
		leftLabel: `${leftPercent.toString()}% left`,
	};
}

function mapWindowRole(role: ProviderUsageWindowRole): UsageQuotaMetricRole {
	if (role === "primaryShort") {
		return "primary-short";
	}

	if (role === "weekly") {
		return "weekly";
	}

	if (role === "overage") {
		return "overage";
	}

	return "other";
}

function resolveProviderIdentity(providerId: string, displayName: string): ProviderIdentity {
	for (const provider of PROVIDERS) {
		if (provider.providerId === providerId) {
			return provider;
		}
	}

	return {
		providerId,
		providerName: displayName,
		providerBrand: null,
	};
}

function mapConnection(connection: ProviderAccountConnection): UsageAccountConnectionState {
	if (connection === "connected") {
		return "connected";
	}

	if (connection === "notConnected") {
		return "not-connected";
	}

	return "unavailable";
}

function statusLabelForConnection(connection: ProviderAccountConnection): string {
	if (connection === "connected") {
		return "Connected";
	}

	if (connection === "notConnected") {
		return "Not connected";
	}

	return "Unavailable";
}

function buildUnavailableAccounts(
	value: string,
	subtitle: string
): ReadonlyArray<UsageProviderAccount> {
	const accounts: UsageProviderAccount[] = [];

	for (const provider of PROVIDERS) {
		accounts.push({
			providerId: provider.providerId,
			providerName: provider.providerName,
			providerBrand: provider.providerBrand,
			connectionState: "unavailable",
			planLabel: null,
			statusLabel: value,
			quotaMetrics: [],
			textMetrics: [
				{
					id: `${provider.providerId}:status`,
					label: "Account usage",
					value,
					subtitle,
					tone: "neutral",
				},
			],
		});
	}

	return accounts;
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

function formatWindowSourceLabel(windowMinutes: number): string {
	if (windowMinutes < 60) {
		return `${windowMinutes.toString()}m window`;
	}

	if (windowMinutes < 1_440) {
		return `${Math.round(windowMinutes / 60).toString()}h window`;
	}

	return `${Math.round(windowMinutes / 1_440).toString()}d window`;
}
