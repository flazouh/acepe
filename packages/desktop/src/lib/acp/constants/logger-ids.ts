/**
 * Centralized logger IDs for the ACP module.
 *
 * These constants define all logger IDs used throughout the codebase.
 * Using centralized IDs ensures consistency and makes it easier to
 * reference loggers across different parts of the application.
 */
export const LOGGER_IDS = {
	MODEL_SELECTOR: "model-selector",
	MODEL_SELECTOR_HOOK: "model-selector-hook",
	MODE_SELECTOR: "mode-selector",
	MODE_SELECTOR_HOOK: "mode-selector-hook",
	AGENT_SELECTOR: "agent-selector",
	AGENT_SELECTOR_HOOK: "agent-selector-hook",
	PROJECT_SELECTOR: "project-selector",
	ACP_CLIENT: "acp-client",
	EVENT_SUBSCRIBER: "event-subscriber",
	SESSION_DOMAIN_EVENT_SUBSCRIBER: "session-domain-event-subscriber",
	AGENT_PANEL: "agent-panel",
	AGENT_PANEL_HOOK: "agent-panel-hook",
	SESSION_HOOK: "session-hook",
	AGENT_ORCHESTRATOR: "agent-orchestrator",
	PANEL_APPLICATION_SERVICE: "panel-application-service",
	SESSION_POOL_MANAGER: "session-pool-manager",
	HISTORICAL_CONVERSATION_VIEW: "historical-conversation-view",
	THREAD_LIST: "thread-list",
	AGENT_SIDEBAR: "agent-sidebar",
	PANEL_LAYOUT: "panel-layout",
	AGENT_INPUT: "agent-input",
	COMMAND_PALETTE: "command-palette",
	SELECTOR: "selector",
	SELECTOR_UI: "selector-ui",
	AGENT_MANAGER: "agent-manager",
	THREAD_LIST_CONVERTER: "thread-list-converter",
	THREAD_LIST_AGGREGATOR: "thread-list-aggregator",
	SELECTOR_LOGIC: "selector-logic",
	CLAUDE_HISTORY_SERVICE: "claude-history-service",
	MAIN_PAGE: "main-page",
	APP_STATE: "app-state",
	CONNECTION_MANAGER: "connection-manager",
	PROJECT_THREADS: "project-threads",
	TODO_STATE: "todo-state",
	USE_PLAN: "use-plan",
	SESSION_STORE: "session-store",
} as const;

export type LoggerId = (typeof LOGGER_IDS)[keyof typeof LOGGER_IDS];
