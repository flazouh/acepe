import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../../services/acp-provider-metadata.js";
import type {
	CapabilityPreviewState,
	ConfigOptionData,
	SessionGraphRevision,
} from "../../../services/acp-types.js";
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
	readonly availableModels: ReadonlyArray<Model> | null;
	readonly availableModes: ReadonlyArray<Mode> | null;
	readonly availableCommands: ReadonlyArray<AvailableCommand> | null;
	readonly revision?: SessionGraphRevision | null;
	readonly pendingMutationId?: string | null;
	readonly previewState?: CapabilityPreviewState;
	readonly configOptions?: ReadonlyArray<ConfigOptionData> | null;
	/**
	 * Pre-computed display groups from backend. Model selector presentation
	 * must come from this canonical metadata, not client-side provider parsing.
	 */
	readonly modelsDisplay?: ModelsForDisplay;
	readonly providerMetadata?: ProviderMetadataProjection;
}
