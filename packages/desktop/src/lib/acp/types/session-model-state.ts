import type { AvailableModel } from "../../services/acp-types.js";
import type { ModelId } from "./model-id.js";

/**
 * Session model state.
 *
 * Represents the current model state for a session, including
 * available models and the currently selected model.
 *
 * @see https://agentclientprotocol.com/protocol/#sessionmodelstate
 */
export type SessionModelState = {
	/**
	 * List of available models for this session.
	 */
	availableModels: AvailableModel[];

	/**
	 * ID of the currently selected model.
	 */
	currentModelId: ModelId;
};
