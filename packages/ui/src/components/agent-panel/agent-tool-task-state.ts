import type { AgentToolStatus, AnyAgentEntry, AgentToolEntry } from "./types.js";

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

export function getTaskToolChildren(
	children: readonly AnyAgentEntry[]
): readonly AgentToolEntry[] {
	return children.filter((entry): entry is AgentToolEntry => entry.type === "tool_call");
}

export function getLastTaskToolCall(
	toolCallChildren: readonly AgentToolEntry[]
): AgentToolEntry | null {
	return toolCallChildren.length > 0 ? toolCallChildren[toolCallChildren.length - 1] : null;
}

export function getTaskCurrentToolLabel(
	lastToolCall: AgentToolEntry | null
): string | null {
	if (!lastToolCall) {
		return null;
	}
	return lastToolCall.title;
}

export function getTaskProgress(input: {
	readonly toolCallChildren: readonly AgentToolEntry[];
}): { readonly filledCount: number; readonly totalCount: number } {
	const totalCount = input.toolCallChildren.length;
	let filledCount = 0;
	for (const entry of input.toolCallChildren) {
		if (entry.status === "done") {
			filledCount = filledCount + 1;
		}
	}
	return { filledCount, totalCount };
}

export function shouldShowTaskProgress(totalCount: number): boolean {
	return totalCount > 0;
}

export function hasTaskPrompt(prompt: string | null | undefined): boolean {
	return Boolean(prompt);
}

export function hasTaskResult(input: {
	readonly status: AgentToolStatus;
	readonly resultText: string | null | undefined;
}): boolean {
	return input.status === "done" && Boolean(input.resultText);
}

export function getTaskUiClasses(compact: boolean) {
	return {
		card: compact ? "bg-accent/30 border-border/60" : "",
		header: compact
			? "flex min-w-0 items-center justify-between gap-1 px-1 py-0.5 text-sm"
			: "flex h-7 items-center justify-between gap-1 px-2 text-sm",
		headerContent: compact
			? "flex min-w-0 flex-1 items-center justify-start gap-1"
			: "flex min-w-0 flex-1 items-center justify-start gap-2",
	};
}
