import { describe, expect, it } from "bun:test";

import type { UsageMetricTone } from "@acepe/ui";
import type { SessionCold, SessionUsageTelemetry } from "$lib/acp/store/types.js";
import { buildLiveUsageWidgetModel, type UsageProviderAccount } from "./usage-widget-model.js";

const NOW_MS = 1_800_000;

function makeSession(): SessionCold {
	return {
		id: "session-1",
		projectPath: "/repo",
		agentId: "claude-code",
		title: "Historical session that must not drive account usage",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		parentId: null,
		usageStats: {
			totalMessages: 4,
			userMessages: 2,
			assistantMessages: 2,
			totalInputTokens: 999_000,
			totalOutputTokens: 1_000,
		},
	};
}

function makeTelemetry(): SessionUsageTelemetry {
	return {
		sessionSpendUsd: 0.034,
		latestStepCostUsd: 0.004,
		latestTokensTotal: 20_000,
		latestTokensInput: 18_000,
		latestTokensOutput: 2_000,
		latestTokensCacheRead: null,
		latestTokensCacheWrite: null,
		latestTokensReasoning: null,
		lastTelemetryEventId: "usage-1",
		contextBudget: null,
		updatedAt: NOW_MS,
	};
}

function codexAccount(): UsageProviderAccount {
	return {
		providerId: "codex",
		providerName: "Codex",
		providerBrand: "codex",
		connectionState: "connected",
		statusLabel: "Team",
		quotaMetrics: [
			{
				id: "codex-session",
				label: "Session limit",
				role: "primary-short",
				used: 20,
				limit: 100,
				resetAtMs: NOW_MS + 2 * 60 * 60 * 1000,
				sourceLabel: "Codex account",
			},
			{
				id: "codex-weekly",
				label: "Weekly limit",
				role: "weekly",
				used: 70,
				limit: 100,
				resetAtMs: NOW_MS + 4 * 24 * 60 * 60 * 1000,
				sourceLabel: "Codex account",
			},
		],
		textMetrics: [
			{
				id: "codex-reviews",
				label: "Reviews",
				value: "12",
				subtitle: "This week",
			},
		],
	};
}

function codexAccountWithSessionUsage(used: number): UsageProviderAccount {
	return {
		providerId: "codex",
		providerName: "Codex",
		providerBrand: "codex",
		connectionState: "connected",
		statusLabel: "Team",
		quotaMetrics: [
			{
				id: "codex-session",
				label: "Session limit",
				role: "primary-short",
				used,
				limit: 100,
				resetAtMs: NOW_MS + 2 * 60 * 60 * 1000,
				sourceLabel: "Codex account",
			},
		],
		textMetrics: [],
	};
}

function quotaTonesForUsage(used: number): {
	readonly lineTone: UsageMetricTone | undefined;
	readonly summaryTone: UsageMetricTone;
	readonly triggerTone: UsageMetricTone | undefined;
} {
	const model = buildLiveUsageWidgetModel({
		sessions: [],
		nowMs: NOW_MS,
		accounts: [codexAccountWithSessionUsage(used)],
	});

	return {
		lineTone: model.providers[0]?.lines[0]?.tone,
		summaryTone: model.summary.tone,
		triggerTone: model.triggerLimits[0]?.tone,
	};
}

describe("buildLiveUsageWidgetModel", () => {
	it("shows provider rows instead of session rows when account usage is not connected", () => {
		const model = buildLiveUsageWidgetModel({
			sessions: [
				{
					session: makeSession(),
					telemetry: makeTelemetry(),
					currentModelId: "opus-4.8",
					focused: true,
				},
			],
			nowMs: NOW_MS,
		});

		expect(model.summary.value).toBe("Usage · connect providers");
		expect(model.triggerLimits).toEqual([]);
		expect(model.updatedAtLabel).toBe("No account usage source");
		expect(model.statusLabel).toBe("Provider usage not connected");
		expect(model.copy.localLabel).toBe("Provider account usage only.");
		expect(model.providers.map((provider) => provider.name)).toEqual([
			"Codex",
			"Claude Code",
			"Cursor",
		]);
		expect(model.providers.map((provider) => provider.providerBrand)).toEqual([
			"codex",
			"claude-code",
			"cursor",
		]);
		expect(model.providers[0]?.lines[0]).toEqual({
			type: "text",
			label: "Account usage",
			value: "Not connected",
			subtitle: "Connect this provider to show OpenUsage-style limits",
			tone: "neutral",
		});
	});

	it("maps connected provider account quotas into OpenUsage-style limit rows", () => {
		const model = buildLiveUsageWidgetModel({
			sessions: [],
			nowMs: NOW_MS,
			accounts: [codexAccount()],
		});

		expect(model.summary.value).toBe("1 providers · 2 limits");
		expect(model.triggerLimits).toEqual([
			{
				id: "codex:codex-session",
				providerName: "Codex",
				providerBrand: "codex",
				initials: "CO",
				label: "Session limit",
				leftLabel: "80% left",
				percentUsed: 20,
				tone: "good",
			},
		]);
		expect(model.updatedAtLabel).toBe("Account usage");
		expect(model.statusLabel).toBe("1 provider connected");
		expect(model.providers[0]?.name).toBe("Codex");
		expect(model.providers[0]?.plan).toBe("Team");
		expect(model.providers[0]?.lines[0]).toEqual({
			type: "progress",
			label: "Session limit",
			usedLabel: "20 used",
			leftLabel: "80% left",
			resetLabel: "resets in 2h",
			percentUsed: 20,
			projectedPercent: null,
			tone: "good",
		});
		expect(model.providers[0]?.lines[1]).toEqual({
			type: "progress",
			label: "Weekly limit",
			usedLabel: "70 used",
			leftLabel: "30% left",
			resetLabel: "resets in 4d",
			percentUsed: 70,
			projectedPercent: null,
			tone: "watch",
		});
		expect(model.providers[0]?.lines[2]).toEqual({
			type: "text",
			label: "Reviews",
			value: "12",
			subtitle: "This week",
			tone: "neutral",
		});
	});

	it("keeps missing providers as setup rows without inventing zero usage", () => {
		const model = buildLiveUsageWidgetModel({
			sessions: [],
			nowMs: NOW_MS,
			accounts: [codexAccount()],
		});

		expect(model.providers[1]?.name).toBe("Claude Code");
		expect(model.providers[1]?.plan).toBe("Not connected");
		expect(model.providers[1]?.lines[0]).toEqual({
			type: "text",
			label: "Account usage",
			value: "Not connected",
			subtitle: "Connect this provider to show OpenUsage-style limits",
			tone: "neutral",
		});
		expect(model.providers[2]?.name).toBe("Cursor");
		expect(model.providers[2]?.plan).toBe("Not connected");
	});

	it("uses blue before 60%, orange from 60%, and red from 85%", () => {
		expect(quotaTonesForUsage(59)).toEqual({
			lineTone: "good",
			summaryTone: "good",
			triggerTone: "good",
		});
		expect(quotaTonesForUsage(60)).toEqual({
			lineTone: "watch",
			summaryTone: "watch",
			triggerTone: "watch",
		});
		expect(quotaTonesForUsage(84)).toEqual({
			lineTone: "watch",
			summaryTone: "watch",
			triggerTone: "watch",
		});
		expect(quotaTonesForUsage(85)).toEqual({
			lineTone: "danger",
			summaryTone: "danger",
			triggerTone: "danger",
		});
	});
});
