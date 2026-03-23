/**
 * Type-safe Tauri command client.
 *
 * Re-exports from the modular tauri-client/ package. All logic lives in
 * domain-specific sub-clients (acp, history, projects, etc.).
 */

export type {
	CustomAgentConfig,
	HistorySessionMessage,
	ProjectData,
	ProjectInfo,
	ProjectSessionCounts,
	ThreadListSettings,
} from "./tauri-client/index.js";

export { openFileInEditor, revealInFinder, tauriClient } from "./tauri-client/index.js";
