export type AgentPanelPhase1ParityStateId =
	| "project_selection"
	| "ready_empty"
	| "error_install_setup"
	| "optimistic_send_thinking"
	| "active_streaming_conversation"
	| "historical_restore"
	| "modified_files_review_context"
	| "todo_live_completed_paused"
	| "plan_collapsed_open_trigger"
	| "browser_toggle_chrome"
	| "terminal_toggle_available_disabled";

export type AgentPanelDeferredPaneFamily =
	| "browser_body"
	| "terminal_drawer_body"
	| "attached_file_pane"
	| "review_detail_pane"
	| "checkpoint_timeline";

export interface AgentPanelParityStateDefinition {
	id: AgentPanelPhase1ParityStateId;
	label: string;
	description: string;
}

export interface AgentPanelDeferredPaneDefinition {
	id: AgentPanelDeferredPaneFamily;
	label: string;
	defaultDisposition: "deferred" | "chrome_only";
	description: string;
}

export const AGENT_PANEL_PHASE1_PARITY_STATES: readonly AgentPanelParityStateDefinition[] = [
	{
		id: "project_selection",
		label: "Project selection",
		description: "No live session yet; shell and pre-session panel framing must still match desktop.",
	},
	{
		id: "ready_empty",
		label: "Ready empty",
		description: "Connected shell with no conversation entries and the desktop-derived idle presentation.",
	},
	{
		id: "error_install_setup",
		label: "Error or install setup",
		description: "Status-driven error and install/setup surfaces shown inside the shared shell.",
	},
	{
		id: "optimistic_send_thinking",
		label: "Optimistic send thinking",
		description: "A just-submitted user message with the trailing thinking state before the response arrives.",
	},
	{
		id: "active_streaming_conversation",
		label: "Active streaming conversation",
		description: "Conversation presentation during a live run, excluding desktop-owned virtualization behavior.",
	},
	{
		id: "historical_restore",
		label: "Historical restore",
		description: "Restored conversation rows and surrounding chrome from an existing session.",
	},
	{
		id: "modified_files_review_context",
		label: "Modified files review context",
		description: "Above-composer review context and status strips for changed files.",
	},
	{
		id: "todo_live_completed_paused",
		label: "Todo live completed paused",
		description: "Inline todo and execution context states covering active, completed, and paused variants.",
	},
	{
		id: "plan_collapsed_open_trigger",
		label: "Plan collapsed open trigger",
		description: "Plan summary chrome that shows the collapsed state and the action that opens fuller plan UI.",
	},
	{
		id: "browser_toggle_chrome",
		label: "Browser toggle chrome",
		description: "Browser-related header or footer chrome without the embedded browser body.",
	},
	{
		id: "terminal_toggle_available_disabled",
		label: "Terminal toggle available disabled",
		description: "Terminal drawer affordance states without the runtime-owned terminal body.",
	},
] as const;

export const AGENT_PANEL_DEFERRED_PANE_DEFAULTS: readonly AgentPanelDeferredPaneDefinition[] = [
	{
		id: "browser_body",
		label: "Browser body",
		defaultDisposition: "chrome_only",
		description: "Phase 1 keeps the browser toggle and framing only; the browser body remains desktop-owned.",
	},
	{
		id: "terminal_drawer_body",
		label: "Terminal drawer body",
		defaultDisposition: "chrome_only",
		description: "Phase 1 keeps terminal availability and toggle chrome only; the live drawer body is deferred.",
	},
	{
		id: "attached_file_pane",
		label: "Attached file pane",
		defaultDisposition: "deferred",
		description: "Attached file pane extraction waits until the shared shell seams are stable.",
	},
	{
		id: "review_detail_pane",
		label: "Review detail pane",
		defaultDisposition: "deferred",
		description: "Detailed review pane content is outside the first shared slice and stays desktop-owned.",
	},
	{
		id: "checkpoint_timeline",
		label: "Checkpoint timeline",
		defaultDisposition: "deferred",
		description: "Checkpoint timeline parity is intentionally postponed beyond the first shipment slice.",
	},
] as const;
