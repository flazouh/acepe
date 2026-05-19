import type { AgentToolStatus } from "./types.js";

interface ToolDurationLabelInput {
	startedAtMs?: number | null;
	completedAtMs?: number | null;
	status: AgentToolStatus;
	nowMs: number;
}

function isRunningToolStatus(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function formatToolDurationLabel({
	startedAtMs,
	completedAtMs,
	status,
	nowMs,
}: ToolDurationLabelInput): string | null {
	if (startedAtMs === null || startedAtMs === undefined) {
		return null;
	}

	const isRunning = isRunningToolStatus(status);
	if (!isRunning && (completedAtMs === null || completedAtMs === undefined)) {
		return null;
	}

	const endMs = isRunning ? nowMs : completedAtMs;
	if (endMs === null || endMs === undefined) {
		return null;
	}

	const elapsedMs = Math.max(0, endMs - startedAtMs);

	if (isRunning) {
		return `${Math.floor(elapsedMs / 1000)}s`;
	}

	return `${(elapsedMs / 1000).toFixed(2)}s`;
}
