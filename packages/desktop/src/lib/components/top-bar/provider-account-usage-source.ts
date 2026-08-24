import type {
	ProviderAccountConnection,
	ProviderAccountUsage,
	ProviderUsageWindow,
	ProviderUsageWindowRole,
} from "@acepe/contracts";
import type { ProviderBrand } from "@acepe/ui";
import * as Effect from "effect/Effect";
import { withRpcClient } from "$lib/utils/tauri-client/rpc-bridge.ts";
import type {
	UsageAccountConnectionState,
	UsageProviderAccount,
	UsageQuotaMetric,
	UsageQuotaMetricRole,
	UsageTextMetric,
} from "./usage-widget-model.js";

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

// getProviderAccountUsage is a utility RPC (see packages/contracts/src/
// providerUsage.ts and packages/server/src/providerUsage) that ported the
// Rust provider_account_usage command's behavior onto the TS/bun server:
//   - Codex: walks ~/.codex/sessions and parses Codex's own rollout-*.jsonl
//     files.
//   - Claude Code: reads the macOS Keychain (`security` CLI) for the OAuth
//     token, or falls back to decrypting the Claude desktop app's Chromium
//     cookie DB (AES-128-CBC via a Keychain-held key) for a session cookie,
//     then calls the live api.anthropic.com/claude.ai usage APIs over HTTPS.
//   - Cursor: always reports unavailable pending a Cursor account API.
// The response shape is unchanged from the Rust command, so everything
// below this function (the mapping to UsageProviderAccount) did not need to
// change -- only the transport did.
export function loadProviderAccountUsageAccounts() {
	return withRpcClient("providerUsage.get", (client) => client.getProviderAccountUsage({})).pipe(
		Effect.map(mapProviderAccountUsageToAccounts)
	);
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
