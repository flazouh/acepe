import type { Mode } from "$lib/acp/application/dto/mode.js";
import type { Model } from "$lib/acp/application/dto/model.js";
import type { SessionCapabilities } from "$lib/acp/application/dto/session-capabilities.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "$lib/services/acp-provider-metadata.js";
import type { ResolvedCapabilities } from "$lib/services/acp-types.js";

export type CapabilitySourceKind =
	| "liveSession"
	| "preconnectionResolved"
	| "persistedCache"
	| "preconnectionPartial"
	| "preconnectionTerminal";

export interface CapabilitySourceResolution {
	readonly source: CapabilitySourceKind;
	readonly availableModes: readonly Mode[];
	readonly availableModels: readonly Model[];
	readonly modelsDisplay: ModelsForDisplay | null;
	readonly providerMetadata: ProviderMetadataProjection | null;
	readonly status: ResolvedCapabilities["status"] | "liveSession" | "persistedCache";
}

interface ResolveCapabilitySourceInput {
	readonly sessionCapabilities: SessionCapabilities | null;
	readonly preconnectionCapabilities: ResolvedCapabilities | null;
	readonly cachedModes: readonly Mode[];
	readonly cachedModels: readonly Model[];
	readonly cachedModelsDisplay: ModelsForDisplay | null;
	readonly providerMetadata: ProviderMetadataProjection | null;
}

function toModes(capabilities: ResolvedCapabilities): Mode[] {
	return capabilities.availableModes.map((mode) => ({
		id: mode.id,
		name: mode.name,
		description: mode.description ?? undefined,
	}));
}

function toModels(capabilities: ResolvedCapabilities): Model[] {
	return capabilities.availableModels.map((model) => ({
		id: model.modelId,
		name: model.name,
		description: model.description ?? undefined,
	}));
}

function hasUsableModelsDisplay(modelsDisplay: ModelsForDisplay | null | undefined): boolean {
	return modelsDisplay?.groups.some((group) => group.models.length > 0) ?? false;
}

function hasLiveCapabilities(capabilities: SessionCapabilities | null): boolean {
	if (!capabilities) {
		return false;
	}

	return (
		capabilities.availableModes.length > 0 ||
		capabilities.availableModels.length > 0 ||
		hasUsableModelsDisplay(capabilities.modelsDisplay)
	);
}

function hasCachedCapabilities(input: ResolveCapabilitySourceInput): boolean {
	return (
		input.cachedModes.length > 0 ||
		input.cachedModels.length > 0 ||
		hasUsableModelsDisplay(input.cachedModelsDisplay)
	);
}

function buildResolution(
	source: CapabilitySourceKind,
	status: CapabilitySourceResolution["status"],
	availableModes: readonly Mode[],
	availableModels: readonly Model[],
	modelsDisplay: ModelsForDisplay | null,
	providerMetadata: ProviderMetadataProjection | null
): CapabilitySourceResolution {
	return {
		source,
		status,
		availableModes,
		availableModels,
		modelsDisplay,
		providerMetadata,
	};
}

export function resolveCapabilitySource(
	input: ResolveCapabilitySourceInput
): CapabilitySourceResolution {
	if (hasLiveCapabilities(input.sessionCapabilities)) {
		return buildResolution(
			"liveSession",
			"liveSession",
			input.sessionCapabilities?.availableModes ?? [],
			input.sessionCapabilities?.availableModels ?? [],
			input.sessionCapabilities?.modelsDisplay ?? null,
			input.sessionCapabilities?.providerMetadata ?? input.providerMetadata
		);
	}

	if (input.preconnectionCapabilities?.status === "resolved") {
		return buildResolution(
			"preconnectionResolved",
			"resolved",
			toModes(input.preconnectionCapabilities),
			toModels(input.preconnectionCapabilities),
			input.preconnectionCapabilities.modelsDisplay,
			input.preconnectionCapabilities.providerMetadata
		);
	}

	if (hasCachedCapabilities(input)) {
		return buildResolution(
			"persistedCache",
			"persistedCache",
			input.cachedModes,
			input.cachedModels,
			input.cachedModelsDisplay,
			input.providerMetadata
		);
	}

	if (input.preconnectionCapabilities?.status === "partial") {
		return buildResolution(
			"preconnectionPartial",
			"partial",
			toModes(input.preconnectionCapabilities),
			toModels(input.preconnectionCapabilities),
			input.preconnectionCapabilities.modelsDisplay,
			input.preconnectionCapabilities.providerMetadata
		);
	}

	if (
		input.preconnectionCapabilities?.status === "failed" ||
		input.preconnectionCapabilities?.status === "unsupported"
	) {
		return buildResolution(
			"preconnectionTerminal",
			input.preconnectionCapabilities.status,
			toModes(input.preconnectionCapabilities),
			toModels(input.preconnectionCapabilities),
			input.preconnectionCapabilities.modelsDisplay,
			input.preconnectionCapabilities.providerMetadata
		);
	}

	return buildResolution("persistedCache", "persistedCache", [], [], null, input.providerMetadata);
}
