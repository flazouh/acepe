export type AgentPanelPerformanceSample = {
	readonly phase: string;
	readonly durationMs: number;
	readonly itemCount: number | null;
	readonly nodeCount: number | null;
	readonly timestampMs: number;
};

export type AgentPanelPerformanceRecorder = (sample: AgentPanelPerformanceSample) => void;

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

export function recordAgentPanelPerformanceSample(
	recorder: AgentPanelPerformanceRecorder | undefined,
	input: {
		readonly phase: string;
		readonly durationMs: number;
		readonly itemCount?: number | null;
		readonly nodeCount?: number | null;
	}
): void {
	if (recorder === undefined) {
		return;
	}
	recorder({
		phase: input.phase,
		durationMs: roundMs(input.durationMs),
		itemCount: input.itemCount ?? null,
		nodeCount: input.nodeCount ?? null,
		timestampMs: roundMs(nowMs()),
	});
}

export function measureAgentPanelPerformance<T>(
	recorder: AgentPanelPerformanceRecorder | undefined,
	input: {
		readonly phase: string;
		readonly itemCount?: number | null;
		readonly nodeCount?: number | null;
	},
	work: () => T
): T {
	const startedAtMs = nowMs();
	const result = work();
	recordAgentPanelPerformanceSample(recorder, {
		phase: input.phase,
		durationMs: nowMs() - startedAtMs,
		itemCount: input.itemCount ?? null,
		nodeCount: input.nodeCount ?? null,
	});
	return result;
}
