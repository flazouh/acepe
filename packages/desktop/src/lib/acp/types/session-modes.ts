import type { AvailableMode } from "./available-mode.js";
import type { ModeId } from "./mode-id.js";

/**
 * Session modes state.
 *
 * Represents the current mode state for a session, including
 * available modes and the currently selected mode.
 *
 * @see https://agentclientprotocol.com/protocol/#sessionmodestate
 */
export type SessionModes = {
	/**
	 * ID of the currently selected mode.
	 */
	currentModeId: ModeId;

	/**
	 * List of available modes for this session.
	 */
	availableModes: AvailableMode[];
};
