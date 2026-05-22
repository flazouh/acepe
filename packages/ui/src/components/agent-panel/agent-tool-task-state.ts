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

export function hasTaskPrompt(prompt: string | null | undefined): boolean {
	return Boolean(prompt);
}

export function hasTaskResult(input: {
	readonly status: AgentToolStatus;
	readonly resultText: string | null | undefined;
}): boolean {
	return input.status === "done" && Boolean(input.resultText);
}

export function createTaskPreview(input: {
	readonly text: string;
	readonly limit: number;
}): string {
	if (input.text.length <= input.limit) {
		return input.text;
	}
	return `${input.text.slice(0, input.limit)}...`;
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
		promptButton: compact
			? "w-full flex items-center gap-1 px-1 py-0.5 text-sm hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer"
			: "w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer",
		promptBody: compact ? "px-1 pb-0.5" : "px-3 pb-2",
		promptContent: "text-sm whitespace-pre-wrap break-words",
		resultSection: compact ? "border-t border-border/60" : "border-t border-border",
		resultButton: compact
			? "w-full flex items-center gap-1 px-1 py-0.5 text-sm hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer"
			: "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer",
		resultBody: compact ? "px-1 pb-1" : "px-3 pb-3",
		resultContent: compact
			? "bg-muted/30 rounded-sm p-1 text-sm whitespace-pre-wrap break-words"
			: "bg-muted/30 rounded-md p-3 text-sm whitespace-pre-wrap break-words",
		rowSection: compact ? "border-t border-border/60 py-0.5" : "border-t border-border py-1.5",
	};
}

export function getTaskHeaderBorderClass(input: {
	readonly compact: boolean;
	readonly hasBorder: boolean;
}): string {
	if (!input.hasBorder) {
		return "";
	}
	return input.compact ? "border-b border-border/60" : "border-b border-border";
}
