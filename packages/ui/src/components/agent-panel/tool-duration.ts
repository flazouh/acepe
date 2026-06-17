import type { AgentToolStatus } from "./types.js";

export interface ToolDurationTiming {
	startedAtMs?: number | null;
	completedAtMs?: number | null;
	status: AgentToolStatus;
}

interface ToolDurationLabelInput extends ToolDurationTiming {
	nowMs: number;
}

export interface ToolDurationAnimateValue {
	value: number;
	minimumFractionDigits: number;
	maximumFractionDigits: number;
}

function isRunningToolStatus(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running" || status === "blocked";
}

function resolveElapsedMs(input: ToolDurationLabelInput): number | null {
	if (input.startedAtMs === null || input.startedAtMs === undefined) {
		return null;
	}

	const isRunning = isRunningToolStatus(input.status);
	if (!isRunning && (input.completedAtMs === null || input.completedAtMs === undefined)) {
		return null;
	}

	const endMs = isRunning ? input.nowMs : input.completedAtMs;
	if (endMs === null || endMs === undefined) {
		return null;
	}

	return Math.max(0, endMs - input.startedAtMs);
}

export function resolveToolDurationAnimateValue(
	input: ToolDurationLabelInput
): ToolDurationAnimateValue | null {
	const elapsedMs = resolveElapsedMs(input);
	if (elapsedMs === null) {
		return null;
	}

	if (isRunningToolStatus(input.status)) {
		return {
			value: Math.floor(elapsedMs / 1000),
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		};
	}

	return {
		value: elapsedMs / 1000,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	};
}

export function formatToolDurationLabel(input: ToolDurationLabelInput): string | null {
	const elapsedMs = resolveElapsedMs(input);
	if (elapsedMs === null) {
		return null;
	}

	if (isRunningToolStatus(input.status)) {
		return `${Math.floor(elapsedMs / 1000)}s`;
	}

	return `${(elapsedMs / 1000).toFixed(2)}s`;
}
