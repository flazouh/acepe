import type { AvailableModel } from "../../services/acp-types.js";
import type { AgentType } from "./agent-type.js";
import type { AvailableCommand } from "./available-command.js";
import type { AvailableMode } from "./available-mode.js";
import type { ModeId } from "./mode-id.js";
import type { ModelId } from "./model-id.js";
import type { SessionId } from "./session-id.js";
import type { ThreadState } from "./thread-state.js";

/**
 * State of the agent panel.
 *
 * Represents the complete state of the agent panel UI.
 */
export type AgentPanelState = {
	/**
	 * Currently selected agent type.
	 */
	selectedAgent: AgentType;

	/**
	 * List of all threads in history.
	 */
	threads: ThreadState[];

	/**
	 * Whether the panel is loading.
	 */
	loading: boolean;

	/**
	 * Optional error message.
	 */
	error?: string;

	/**
	 * Current session ID.
	 */
	sessionId?: SessionId;

	/**
	 * Available models from the session.
	 */
	availableModels: AvailableModel[];

	/**
	 * Currently selected model ID.
	 */
	currentModelId: ModelId | null;

	/**
	 * Available modes from the session.
	 */
	availableModes: AvailableMode[];

	/**
	 * Currently selected mode ID.
	 */
	currentModeId: ModeId | null;

	/**
	 * Available slash commands from the session.
	 */
	availableCommands: AvailableCommand[];
};
