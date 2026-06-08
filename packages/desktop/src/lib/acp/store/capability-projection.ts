/**
 * Pure capability-projection transforms for the session store: project a
 * canonical `SessionGraphCapabilities` into the display-shaped capability view
 * (available models/modes/commands, current selections, config options, provider
 * metadata) and derive the preview-state classification. GOD-safe — pure
 * canonical → display projection, no provider repair, no state.
 */
import type {
	ConfigOptionData as CanonicalConfigOptionData,
	SessionGraphCapabilities,
} from "../../services/acp-types.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type { AvailableCommand } from "../types/available-command.js";
import type { Mode, Model, SessionCapabilities } from "./types.js";

function mapGraphAvailableModels(capabilities: SessionGraphCapabilities): Array<Model> | null {
	if (!capabilities.models) {
		return null;
	}

	const availableModels = capabilities.models.availableModels ?? [];
	return availableModels.map((model) => ({
		id: model.modelId,
		name: model.name,
		description: model.description ?? undefined,
	}));
}

function mapGraphAvailableModes(capabilities: SessionGraphCapabilities): Array<Mode> | null {
	if (!capabilities.modes) {
		return null;
	}

	const availableModes = capabilities.modes.availableModes ?? [];
	return availableModes.map((mode) => ({
		id: mode.id,
		name: mode.name,
		description: mode.description ?? undefined,
		iconKind: mode.iconKind,
	}));
}

export function projectGraphCapabilities(capabilities: SessionGraphCapabilities): {
	availableModels: Array<Model> | null;
	availableModes: Array<Mode> | null;
	availableCommands: AvailableCommand[] | null;
	currentModelId: string | null;
	currentModeId: string | null;
	currentModel: Model | null;
	currentMode: Mode | null;
	modelsDisplay: ModelsForDisplay | undefined;
	providerMetadata: ProviderMetadataProjection | undefined;
	configOptions: ReadonlyArray<CanonicalConfigOptionData> | null;
	autonomousEnabled: boolean | null;
} {
	const availableModels = mapGraphAvailableModels(capabilities);
	const availableModes = mapGraphAvailableModes(capabilities);
	const modelState = capabilities.models as
		| (NonNullable<SessionGraphCapabilities["models"]> & {
				readonly providerMetadata?: ProviderMetadataProjection | null;
		  })
		| null
		| undefined;
	const providerMetadata = modelState?.providerMetadata ?? undefined;
	const modelsDisplay = capabilities.models?.modelsDisplay ?? undefined;
	const currentModeId = capabilities.modes?.currentModeId ?? null;
	const currentMode =
		currentModeId === null
			? null
			: (availableModes?.find((mode) => mode.id === currentModeId) ?? null);
	const currentModelId = capabilities.models?.currentModelId ?? null;
	const currentModel =
		currentModelId === null
			? null
			: (availableModels?.find((model) => model.id === currentModelId) ?? null);

	return {
		availableModels,
		availableModes,
		availableCommands: capabilities.availableCommands ?? null,
		currentModelId,
		currentModeId,
		currentModel,
		currentMode,
		modelsDisplay,
		providerMetadata,
		configOptions: capabilities.configOptions ?? null,
		autonomousEnabled: capabilities.autonomousEnabled ?? null,
	};
}

export type ProjectedGraphCapabilities = ReturnType<typeof projectGraphCapabilities>;

export function deriveCapabilityPreviewState(
	capabilities: SessionGraphCapabilities
): SessionCapabilities["previewState"] {
	return capabilities.models && capabilities.modes ? "canonical" : "partial";
}
