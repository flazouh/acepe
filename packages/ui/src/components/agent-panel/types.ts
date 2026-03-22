/**
 * Presentational types for the shared AgentPanel components.
 * No Tauri, store, or desktop dependencies.
 */

export type AgentSessionStatus =
	| "empty"
	| "warming"
	| "connected"
	| "error"
	| "idle"
	| "running"
	| "done";
export type AgentToolStatus = "pending" | "running" | "done" | "error";

/**
 * Canonical tool kind — maps to icon + label in agent-tool-row.
 * Mirrors the desktop's ToolKind union.
 */
export type AgentToolKind =
	| "read"
	| "edit"
	| "write"
	| "execute"
	| "search"
	| "fetch"
	| "web_search"
	| "think"
	| "task"
	| "other";

export interface AgentUserEntry {
	id: string;
	type: "user";
	text: string;
}

export interface AgentAssistantEntry {
	id: string;
	type: "assistant";
	markdown: string;
	isStreaming?: boolean;
}

export interface AgentToolEntry {
	id: string;
	type: "tool_call";
	kind?: AgentToolKind;
	title: string;
	subtitle?: string;
	/** Absolute or relative file path — used to render a FilePathBadge */
	filePath?: string;
	status: AgentToolStatus;
	// Execute-specific
	command?: string | null;
	stdout?: string | null;
	stderr?: string | null;
	exitCode?: number;
	// Search-specific
	query?: string | null;
	searchPath?: string;
	searchFiles?: string[];
	searchResultCount?: number;
	// Fetch-specific
	url?: string | null;
	resultText?: string | null;
	// Web search-specific
	webSearchLinks?: AgentWebSearchLink[];
	webSearchSummary?: string | null;
	// Task-specific
	taskDescription?: string | null;
	taskPrompt?: string | null;
	taskResultText?: string | null;
	taskChildren?: AnyAgentEntry[];
}

export interface AgentThinkingEntry {
	id: string;
	type: "thinking";
}

export type AnyAgentEntry =
	| AgentUserEntry
	| AgentAssistantEntry
	| AgentToolEntry
	| AgentThinkingEntry;

/** Web search link for display */
export interface AgentWebSearchLink {
	title: string;
	url: string;
	domain: string;
	pageAge?: string;
}

/** Todo item status */
export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

/** Normalized todo item for display */
export interface AgentTodoItem {
	content: string;
	activeForm?: string | null;
	status: AgentTodoStatus;
	duration?: number | null;
}

/** Normalized question option */
export interface AgentQuestionOption {
	label: string;
	description?: string | null;
}

/** Normalized question for display */
export interface AgentQuestion {
	question: string;
	header?: string | null;
	options?: AgentQuestionOption[] | null;
	multiSelect?: boolean;
}

/** Single diagnostic entry for Read Lints tool display */
export interface LintDiagnostic {
	filePath?: string | null;
	line?: number | null;
	message?: string | null;
	severity?: string | null;
}
