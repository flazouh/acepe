import type { UsageTelemetryData } from "../../../services/acp-types.js";
import type { SessionContextBudget, SessionUsageTelemetry } from "../types.js";

function resolveContextBudget(
	usageTelemetryData: UsageTelemetryData,
	previous: SessionUsageTelemetry | undefined,
	_currentModelId: string | null,
	updatedAt: number
): SessionContextBudget | null {
	if (usageTelemetryData.contextWindowSource === "unknown") {
		return null;
	}
	const explicitMaxTokens = usageTelemetryData.contextWindowSize ?? null;
	if (explicitMaxTokens != null && explicitMaxTokens > 0) {
		const source =
			usageTelemetryData.contextWindowSource != null
				? usageTelemetryData.contextWindowSource
				: "provider-explicit";
		return {
			maxTokens: explicitMaxTokens,
			source,
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

	// Context-window occupancy ("used") is a point-in-time snapshot, reported by
	// `usage_update` system messages and per-assistant-message usage. Cost-only events
	// (notably the Claude Code Result message, whose token usage is cumulative across
	// the turn and overshoots the window) carry no occupancy total — when that happens
	// we keep the last authoritative snapshot rather than wiping it. Cost always
	// updates regardless.
	const hasOccupancySnapshot = tokens?.total != null;

	return {
		sessionSpendUsd,
		latestStepCostUsd: usageTelemetryData.costUsd ?? null,
		latestTokensTotal: hasOccupancySnapshot
			? (tokens.total ?? null)
			: (previous?.latestTokensTotal ?? null),
		latestTokensInput: hasOccupancySnapshot
			? (tokens.input ?? null)
			: (previous?.latestTokensInput ?? null),
		latestTokensOutput: hasOccupancySnapshot
			? (tokens.output ?? null)
			: (previous?.latestTokensOutput ?? null),
		latestTokensCacheRead: hasOccupancySnapshot
			? (tokens.cacheRead ?? null)
			: (previous?.latestTokensCacheRead ?? null),
		latestTokensCacheWrite: hasOccupancySnapshot
			? (tokens.cacheWrite ?? null)
			: (previous?.latestTokensCacheWrite ?? null),
		latestTokensReasoning: hasOccupancySnapshot
			? (tokens.reasoning ?? null)
			: (previous?.latestTokensReasoning ?? null),
		lastTelemetryEventId: eventId,
		contextBudget: resolveContextBudget(usageTelemetryData, previous, currentModelId, updatedAt),
		updatedAt,
	};
}
