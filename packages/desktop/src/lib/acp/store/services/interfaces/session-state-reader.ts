/**
 * Session State Reader Interface
 *
 * Narrow interface for reading session state.
 * Extracted services use this to access session data without circular dependencies.
 */

import type { SessionGraphLifecycle } from "../../../../services/acp-types.js";
import type { CanonicalSessionProjection } from "../../canonical-session-projection.js";
import type {
	Mode,
	Model,
	SessionCapabilities,
	SessionCold,
} from "../../types.js";
import type { ToolCall } from "../../../types/tool-call.js";

/**
 * Interface for reading session state.
 */
export interface ISessionStateReader {
	/**
	 * Local provider session id used only for transport cleanup.
	 */
	getSessionAcpSessionId(sessionId: string): string | null;

	/**
	 * Local autonomous mutation progress used only to block duplicate toggles.
	 */
	getSessionAutonomousTransitionBusy(sessionId: string): boolean;

	/**
	 * Canonical actionability gate. Returns null before the first canonical graph.
	 */
	getSessionCanSend(sessionId: string): boolean | null;

	/**
	 * Canonical lifecycle status. Used when a caller needs to distinguish
	 * reserved first-send activation from a detached historical reconnect.
	 */
	getSessionLifecycleStatus(sessionId: string): SessionGraphLifecycle["status"] | null;

	/**
	 * Canonical transcript revision. Used by local optimistic send cleanup to
	 * distinguish newly acknowledged text from older identical prompts.
	 */
	getGraphTranscriptRevision(sessionId: string): number | undefined;

	/**
	 * Canonical autonomous setting. Returns null when no canonical projection has materialized.
	 */
	getSessionAutonomousEnabled(sessionId: string): boolean | null;

	/**
	 * Canonical current mode id. Returns null when no canonical projection or selected mode exists.
	 */
	getSessionCurrentModeId(sessionId: string): string | null;

	/**
	 * Canonical capabilities projection. Returns null when no canonical
	 * projection has materialized.
	 */
	getSessionCapabilities(sessionId: string): SessionCapabilities | null;

	/**
	 * Canonical available models. Returns null before canonical capabilities materialize.
	 */
	getSessionAvailableModels(sessionId: string): ReadonlyArray<Model> | null;

	/**
	 * Canonical available modes. Returns null before canonical capabilities materialize.
	 */
	getSessionAvailableModes(sessionId: string): ReadonlyArray<Mode> | null;

	/**
	 * Canonical session projection (lifecycle + activity + turn state + active
	 * failure). Returns null before the first canonical envelope arrives.
	 */
	getCanonicalSessionProjection(sessionId: string): CanonicalSessionProjection | null;

	/**
	 * Canonical operation-backed tool calls for a session.
	 */
	getSessionToolCalls(sessionId: string): ToolCall[];

	/**
	 * Check if a session's entries have been preloaded.
	 */
	isPreloaded(sessionId: string): boolean;

	/**
	 * Get all sessions for a project path.
	 */
	getSessionsForProject(projectPath: string): SessionCold[];

	/**
	 * Get session cold data by ID from the lookup map (O(1)).
	 */
	getSessionCold(id: string): SessionCold | undefined;

	/**
	 * Get all sessions (cold data only).
	 */
	getAllSessions(): SessionCold[];
}
