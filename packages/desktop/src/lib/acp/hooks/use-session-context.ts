import { getContext } from "svelte";
import type { TurnState } from "../store/types.js";
import type { ModifiedFilesState } from "../types/modified-files-state.js";

/**
 * Session context shared across all message and tool-call components.
 * Set at VirtualizedEntryList level to provide context to all nested children.
 */
export interface SessionContext {
	sessionId?: string;
	panelId?: string;
	projectPath?: string;
	turnState: TurnState;
	modifiedFilesState?: ModifiedFilesState;
}

const SESSION_CONTEXT_KEY = "sessionContext";

/**
 * Get the current session context from Svelte context.
 * Returns undefined if no context is available.
 *
 * This context is set at the VirtualizedEntryList level and provides:
 * - projectPath: For opening files and GitHub integration
 * - turnState: For detecting streaming state
 * - modifiedFilesState: For git status in file badges
 *
 * Example:
 * ```svelte
 * <script lang="ts">
 *   const context = useSessionContext();
 * </script>
 *
 * {context?.projectPath ? 'Has project' : 'No project'}
 * {context?.turnState === 'streaming' ? 'Streaming...' : ''}
 * ```
 */
export function useSessionContext(): SessionContext | undefined {
	return getContext<SessionContext>(SESSION_CONTEXT_KEY);
}

/**
 * Export the context key for use in setContext calls (internal use only).
 */
export const SESSION_CONTEXT_KEY_EXPORT = SESSION_CONTEXT_KEY;
