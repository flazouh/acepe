import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../../services/acp-provider-metadata.js";
import type { AvailableCommand } from "../../types/available-command.js";
import type { Mode } from "./mode.js";
import type { Model } from "./model.js";

/**
 * Session capabilities - ACP configuration received on connect.
 *
 * These fields represent what the connected agent supports.
 * Populated when session connects, cleared when disconnected.
 */
export interface SessionCapabilities {
	readonly availableModels: ReadonlyArray<Model>;
	readonly availableModes: ReadonlyArray<Mode>;
	readonly availableCommands: ReadonlyArray<AvailableCommand>;
	/**
	 * Pre-computed display groups from backend. When present, model selector
	 * uses this instead of client-side parsing (groupModelsByProvider, etc.).
	 */
	readonly modelsDisplay?: ModelsForDisplay;
	readonly providerMetadata?: ProviderMetadataProjection;
}
