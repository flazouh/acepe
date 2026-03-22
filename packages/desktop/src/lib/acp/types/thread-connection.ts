import type { AvailableModel } from "../../services/acp-types.js";
import type { AvailableMode } from "./available-mode.js";
import type { SessionId } from "./session-id.js";

/**
 * Capabilities advertised by an ACP session.
 */
export interface SessionCapabilities {
	/**
	 * Whether the agent supports resuming sessions.
	 */
	canResume: boolean;

	/**
	 * Whether the agent supports forking sessions.
	 */
	canFork: boolean;

	/**
	 * Supported mode IDs for this session (for backwards compatibility).
	 */
	supportedModes: string[];

	/**
	 * Supported model IDs for this session (for backwards compatibility).
	 */
	supportedModels: string[];

	/**
	 * Full available modes with names and descriptions.
	 */
	availableModes: AvailableMode[];

	/**
	 * Full available models with names and descriptions.
	 */
	availableModels: AvailableModel[];

	/**
	 * Current mode ID for this session.
	 */
	currentModeId: string | null;

	/**
	 * Current model ID for this session.
	 */
	currentModelId: string | null;
}

/**
 * Active connection to an ACP session.
 *
 * This is runtime-only state that represents a live connection
 * to an ACP agent subprocess. It is not persisted.
 */
export interface ThreadConnection {
	/**
	 * Live ACP session ID.
	 * This is the session ID from the agent subprocess.
	 */
	acpSessionId: SessionId;

	/**
	 * Capabilities of this session.
	 */
	capabilities: SessionCapabilities;

	/**
	 * When the connection was established.
	 */
	connectedAt: Date;
}

/**
 * Connection status for a thread.
 */
export type ConnectionStatus =
	| { type: "disconnected" }
	| { type: "connecting" }
	| { type: "connected"; connection: ThreadConnection }
	| { type: "error"; error: string };

/**
 * Create default session capabilities.
 */
export function defaultCapabilities(): SessionCapabilities {
	return {
		canResume: false,
		canFork: false,
		supportedModes: [],
		supportedModels: [],
		availableModes: [],
		availableModels: [],
		currentModeId: null,
		currentModelId: null,
	};
}
