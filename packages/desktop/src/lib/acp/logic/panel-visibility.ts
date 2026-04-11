/**
 * Panel View State
 *
 * Derives a single discriminated union from session runtime state,
 * entry count, error info, and agent selection — exactly one UI
 * section to show. No boolean soup, no impossible states.
 */

import type { PanelErrorInfo } from "../components/agent-panel/logic/connection-ui";
import type { SessionRuntimeState } from "./session-ui-state";

// ── Discriminated Union ────────────────────────────────────────

export type PanelViewState =
	| { readonly kind: "project_selection" }
	| { readonly kind: "error"; readonly details: string }
	| { readonly kind: "conversation"; readonly errorDetails: string | null }
	| { readonly kind: "ready" };

// ── Input ──────────────────────────────────────────────────────

export interface PanelViewStateInput {
	readonly runtimeState: SessionRuntimeState | null;
	readonly entriesCount: number;
	readonly hasSession: boolean;
	readonly showProjectSelection: boolean;
	readonly hasEffectiveProjectPath: boolean;
	readonly hasSelectedAgentId: boolean;
	readonly hasAvailableAgents: boolean;
	readonly errorInfo: PanelErrorInfo;
}

// ── Derive Function ────────────────────────────────────────────

/**
 * Derive the single active panel view state.
 *
 * Priority (first match wins):
 * 1. project_selection — needs project selection OR agent selection (agents are embedded in project cards)
 * 2. error            — blocking error with no entries
 * 3. conversation     — has entries (carries inline errorDetails)
 * 4. ready            — connected session, creating session, or can start one
 */
export function derivePanelViewState(input: PanelViewStateInput): PanelViewState {
	const {
		runtimeState,
		entriesCount,
		hasSession,
		showProjectSelection,
		hasEffectiveProjectPath,
		hasSelectedAgentId,
		hasAvailableAgents,
		errorInfo,
	} = input;

	// 1. Project selection — also handles agent selection since agents are now embedded in project cards.
	// Only new-session flows require selecting an agent from the project cards. Existing sessions
	// already have an agent identity, even if the draft-level selectedAgentId prop is empty.
	const needsProjectOrAgentSelection =
		showProjectSelection || (!hasSession && hasAvailableAgents && !hasSelectedAgentId);
	if (needsProjectOrAgentSelection) {
		return { kind: "project_selection" };
	}

	// 2. Blocking error — only when no entries to show
	if (errorInfo.showError && entriesCount === 0) {
		return { kind: "error", details: errorInfo.details ?? "Unable to connect to the agent." };
	}

	// 3. Conversation — entries exist (inline error banner if applicable)
	if (entriesCount > 0) {
		return {
			kind: "conversation",
			errorDetails: errorInfo.showError ? (errorInfo.details ?? null) : null,
		};
	}

	// 4. Ready — connected session with no entries, or can start a new one.
	// Session creation also falls through here so the user sees "Ready to assist"
	// and can type immediately while the session is being created in the background.
	const sessionIsReady =
		hasSession &&
		((runtimeState?.showReadyPlaceholder ?? false) || (runtimeState?.showConversation ?? false));
	const canStartSession = !hasSession && hasEffectiveProjectPath && hasSelectedAgentId;
	const result: PanelViewState = { kind: "ready" };
	if (sessionIsReady || canStartSession) {
		return result;
	}

	// Fallback — should not happen in practice, but safe default
	return result;
}
