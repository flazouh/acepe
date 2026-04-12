export type AgentPanelToolStatus = "pending" | "running" | "done" | "error";

export type AgentPanelToolKind =
	| "read"
	| "edit"
	| "delete"
	| "write"
	| "execute"
	| "search"
	| "fetch"
	| "web_search"
	| "think"
	| "skill"
	| "task"
	| "task_output"
	| "other";

export interface AgentPanelUserEntry {
	id: string;
	type: "user";
	text: string;
}

export interface AgentPanelAssistantEntry {
	id: string;
	type: "assistant";
	markdown: string;
	isStreaming?: boolean;
}

export interface AgentPanelWebSearchLink {
	title: string;
	url: string;
	domain: string;
	pageAge?: string;
}

export type AgentPanelTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface AgentPanelTodoItem {
	content: string;
	activeForm?: string | null;
	status: AgentPanelTodoStatus;
	duration?: number | null;
}

export interface AgentPanelQuestionOption {
	label: string;
	description?: string | null;
}

export interface AgentPanelQuestion {
	question: string;
	header?: string | null;
	options?: readonly AgentPanelQuestionOption[] | null;
	multiSelect?: boolean;
}

export interface AgentPanelLintDiagnostic {
	filePath?: string | null;
	line?: number | null;
	message?: string | null;
	severity?: string | null;
}

export interface AgentPanelToolCallEntry {
	id: string;
	type: "tool_call";
	kind?: AgentPanelToolKind;
	title: string;
	subtitle?: string;
	filePath?: string;
	status: AgentPanelToolStatus;
	command?: string | null;
	stdout?: string | null;
	stderr?: string | null;
	exitCode?: number;
	query?: string | null;
	searchPath?: string;
	searchFiles?: readonly string[];
	searchResultCount?: number;
	url?: string | null;
	resultText?: string | null;
	webSearchLinks?: readonly AgentPanelWebSearchLink[];
	webSearchSummary?: string | null;
	skillName?: string | null;
	skillArgs?: string | null;
	skillDescription?: string | null;
	taskDescription?: string | null;
	taskPrompt?: string | null;
	taskResultText?: string | null;
	taskChildren?: readonly AgentPanelConversationEntry[];
	todos?: readonly AgentPanelTodoItem[];
	question?: AgentPanelQuestion | null;
	lintDiagnostics?: readonly AgentPanelLintDiagnostic[];
}

export interface AgentPanelThinkingEntry {
	id: string;
	type: "thinking";
}

export type AgentPanelConversationEntry =
	| AgentPanelUserEntry
	| AgentPanelAssistantEntry
	| AgentPanelToolCallEntry
	| AgentPanelThinkingEntry;

export interface AgentPanelConversationModel {
	entries: readonly AgentPanelConversationEntry[];
	isStreaming: boolean;
	isAtTop?: boolean;
	isAtBottom?: boolean;
}
