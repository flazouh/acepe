/**
 * Type-safe Tauri command client.
 *
 * Re-exports from the modular backend-client/ package. All logic lives in
 * domain-specific sub-clients (acp, history, projects, etc.).
 */

export type {
	CustomAgentConfig,
	HistorySessionMessage,
	ProjectData,
	ProjectInfo,
	ProjectSessionCounts,
	ThreadListSettings,
} from "./backend-client/index.js";

export { openFileInEditor, revealInFinder, backendClient } from "./backend-client/index.js";
