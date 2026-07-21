import type { AgentToolStatus } from "./types.js";

export function isTaskPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function getTaskTitle(input: {
	readonly description: string | null;
	readonly status: AgentToolStatus;
	readonly runningFallback: string;
	readonly doneFallback: string;
}): string {
	if (isTaskPending(input.status)) return input.description ?? input.runningFallback;
	if (input.status === "blocked") return input.description ?? "Waiting for permission";
	if (input.status === "degraded") return input.description ?? "Degraded";
	if (input.status === "cancelled") return input.description ?? "Cancelled";
	if (input.status === "error") return input.description ?? "Task failed";
	return input.description ?? input.doneFallback;
}

export function hasTaskPrompt(prompt: string | null | undefined): boolean {
	return Boolean(prompt);
}

export function getTaskUiClasses(compact: boolean) {
	return {
		card: compact ? "bg-accent/30 border-border/60" : "",
		header: compact
			? "flex h-6 min-w-0 items-center justify-between gap-1 pl-1 pr-0.5 text-sm"
			: "flex h-6 items-center justify-between gap-1 pl-2 pr-0.5 text-sm",
		headerContent: compact
			? "flex min-w-0 flex-1 items-center justify-start gap-1"
			: "flex min-w-0 flex-1 items-center justify-start gap-2",
		liveRow: compact ? "px-1 pb-1 pt-0.5" : "pl-2 pr-0.5 pb-1.5",
	};
}
