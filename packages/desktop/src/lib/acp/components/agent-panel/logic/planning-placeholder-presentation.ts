export interface PlanningPlaceholderPresentation {
	readonly label: string;
	readonly agentIconSrc: string | null;
	readonly showWorkingSpark: boolean;
	/**
	 * AC-269: Claude Code working line inputs, only ever consumed by
	 * transcript-viewport-rendered-rows.ts's createLocalPlanningEntry for the
	 * "planning" placeholder mode (a turn is actually running) -- the
	 * "connection" mode keeps using `label` instead, so these stay populated
	 * but unused during connection. `startedAtMs` doubles as the working
	 * line's rotation seed (stable per turn, changes between turns).
	 */
	readonly startedAtMs: number | null;
	readonly workingLineVerbs: readonly string[] | null;
	readonly workingLineTokens: number | null;
}

export function resolvePlanningPlaceholderPresentation(input: {
	readonly agentName: string | null | undefined;
	readonly agentIconSrc: string | null | undefined;
	readonly showWorkingSpark: boolean;
	readonly startedAtMs?: number | null;
	readonly workingLineVerbs?: readonly string[] | null;
	readonly workingLineTokens?: number | null;
}): PlanningPlaceholderPresentation {
	const agentName = normalizeAgentName(input.agentName);

	return {
		label: `Connecting to ${agentName}`,
		agentIconSrc: input.agentIconSrc ?? null,
		showWorkingSpark: input.showWorkingSpark,
		startedAtMs: input.startedAtMs ?? null,
		workingLineVerbs: input.workingLineVerbs ?? null,
		workingLineTokens: input.workingLineTokens ?? null,
	};
}

function normalizeAgentName(agentName: string | null | undefined): string {
	const trimmed = agentName?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : "agent";
}

/**
 * AC-269: resolves the running turn's output-token count for the working
 * line, from the session's usageTelemetry transient (the same
 * SessionUsageTelemetry the model-selector metrics chip reads --
 * `sessionStore.read.getSessionUsageTelemetry`).
 *
 * usageTelemetry is session-scoped and persists across turns (it exists to
 * drive the context-window occupancy chip), so a stale reading from a PRIOR
 * turn can still be sitting there the instant a new turn starts, before any
 * fresh usage event has arrived for it. Gating on
 * `usageTelemetry.updatedAt >= turnStartedAtMs` is what tells a genuinely
 * fresh reading for THIS turn apart from a leftover one -- returns null
 * (never a fabricated number) whenever there is no telemetry yet, no turn
 * running yet, or the telemetry predates the turn's own start.
 */
export function resolveRunningTurnOutputTokens(input: {
	readonly usageTelemetry: {
		readonly latestTokensOutput: number | null;
		readonly updatedAt: number;
	} | null;
	readonly turnStartedAtMs: number | null;
}): number | null {
	if (input.usageTelemetry === null || input.turnStartedAtMs === null) {
		return null;
	}
	if (input.usageTelemetry.updatedAt < input.turnStartedAtMs) {
		return null;
	}
	return input.usageTelemetry.latestTokensOutput;
}
