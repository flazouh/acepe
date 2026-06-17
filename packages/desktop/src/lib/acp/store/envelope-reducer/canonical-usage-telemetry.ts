import type { UsageTelemetryData } from "../../../services/acp-types.js";
import type { SessionContextBudget, SessionUsageTelemetry } from "../types.js";

function resolveContextBudget(
	usageTelemetryData: UsageTelemetryData,
	previous: SessionUsageTelemetry | undefined,
	_currentModelId: string | null,
	updatedAt: number
): SessionContextBudget | null {
	const explicitMaxTokens = usageTelemetryData.contextWindowSize ?? null;
	if (explicitMaxTokens != null && explicitMaxTokens > 0) {
		return {
			maxTokens: explicitMaxTokens,
			source: "provider-explicit",
			scope: usageTelemetryData.scope ?? "step",
			updatedAt,
		};
	}

	if (previous?.contextBudget?.source === "provider-explicit") {
		return previous.contextBudget;
	}

	return previous?.contextBudget ?? null;
}

export function buildCanonicalUsageTelemetry(
	usageTelemetryData: UsageTelemetryData,
	previous: SessionUsageTelemetry | undefined,
	currentModelId: string | null,
	updatedAt: number
): SessionUsageTelemetry | null {
	const eventId = usageTelemetryData.eventId ?? null;
	if (eventId !== null && previous?.lastTelemetryEventId === eventId) {
		return null;
	}

	const costUsd = usageTelemetryData.costUsd ?? 0;
	const sessionSpendUsd = (previous?.sessionSpendUsd ?? 0) + costUsd;
	const tokens = usageTelemetryData.tokens;

	return {
		sessionSpendUsd,
		latestStepCostUsd: usageTelemetryData.costUsd ?? null,
		latestTokensTotal: tokens?.total ?? null,
		latestTokensInput: tokens?.input ?? null,
		latestTokensOutput: tokens?.output ?? null,
		latestTokensCacheRead: tokens?.cacheRead ?? null,
		latestTokensCacheWrite: tokens?.cacheWrite ?? null,
		latestTokensReasoning: tokens?.reasoning ?? null,
		lastTelemetryEventId: eventId,
		contextBudget: resolveContextBudget(usageTelemetryData, previous, currentModelId, updatedAt),
		updatedAt,
	};
}
