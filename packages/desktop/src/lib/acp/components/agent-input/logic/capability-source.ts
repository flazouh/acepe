import { providerModels, providerModes } from "@acepe/contracts";
import type { Mode } from "$lib/acp/application/dto/mode.js";
import type { Model } from "$lib/acp/application/dto/model.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "$lib/services/acp-provider-metadata.js";
import type { ResolvedCapabilities } from "$lib/services/acp-types.js";

export type CapabilitySourceKind =
	| "liveSession"
	| "missingCanonicalSession"
	| "preconnectionResolved"
	| "persistedCache"
	| "preconnectionPartial"
	| "preconnectionTerminal";

export interface CapabilitySourceResolution {
	readonly source: CapabilitySourceKind;
	readonly availableModes: readonly Mode[] | null;
	readonly availableModels: readonly Model[] | null;
	readonly modelsDisplay: ModelsForDisplay | null;
	readonly providerMetadata: ProviderMetadataProjection | null;
	readonly status:
		| ResolvedCapabilities["status"]
		| "liveSession"
		| "missingCanonicalSession"
		| "persistedCache";
}

export interface CanonicalCapabilitySnapshot {
	readonly availableModes: readonly Mode[] | null;
	readonly availableModels: readonly Model[] | null;
	readonly modelsDisplay: ModelsForDisplay | null;
	readonly providerMetadata: ProviderMetadataProjection | null;
}

export type SessionCapabilitySource =
	| {
			readonly kind: "no_session";
	  }
	| {
			readonly kind: "canonical";
			readonly capabilities: CanonicalCapabilitySnapshot;
	  }
	| {
			readonly kind: "missing_canonical";
			readonly sessionId: string;
	  };

interface ResolveCapabilitySourceInput {
	/** The agent whose provider offers the modes and models, when nothing else does. */
	readonly agentId?: string | null;
	readonly sessionSource: SessionCapabilitySource;
	readonly preconnectionCapabilities: ResolvedCapabilities | null;
	readonly cachedModes: readonly Mode[];
	readonly cachedModels: readonly Model[];
	readonly cachedModelsDisplay: ModelsForDisplay | null;
	readonly providerMetadata: ProviderMetadataProjection | null;
}

export function sessionCapabilitySourceFromCapabilities(
	sessionId: string | null,
	sessionCapabilities: CanonicalCapabilitySnapshot | null
): SessionCapabilitySource {
	if (sessionId === null) {
		return {
			kind: "no_session",
		};
	}

	if (sessionCapabilities === null) {
		return {
			kind: "missing_canonical",
			sessionId,
		};
	}

	return {
		kind: "canonical",
		capabilities: sessionCapabilities,
	};
}

export function resolveCapabilityContextProviderMetadata(input: {
	readonly sessionSource: SessionCapabilitySource;
	readonly selectedAgentProviderMetadata: ProviderMetadataProjection | null;
}): ProviderMetadataProjection | null {
	if (input.sessionSource.kind === "canonical") {
		return input.sessionSource.capabilities.providerMetadata ?? null;
	}

	if (input.sessionSource.kind === "missing_canonical") {
		return null;
	}

	return input.selectedAgentProviderMetadata;
}

function toModes(capabilities: ResolvedCapabilities): Mode[] {
	return capabilities.availableModes.map((mode) => ({
		id: mode.id,
		name: mode.name,
		description: mode.description ?? undefined,
		iconKind: mode.iconKind,
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

function hasCachedCapabilities(input: ResolveCapabilitySourceInput): boolean {
	return (
		input.cachedModes.length > 0 ||
		input.cachedModels.length > 0 ||
		hasUsableModelsDisplay(input.cachedModelsDisplay)
	);
}

function resolveFallbackCapabilitySource(
	input: ResolveCapabilitySourceInput
): CapabilitySourceResolution {
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

/** The provider's own modes, in the shape the toolbar reads. */
function providerFallbackModes(agentId: string | null | undefined): Mode[] {
	return providerModes(agentId).map((mode) => ({
		id: mode.id,
		name: mode.name,
		description: mode.description,
		iconKind: mode.iconKind,
	}));
}

/** The provider's own models, in the shape the toolbar reads. */
function providerFallbackModels(agentId: string | null | undefined): Model[] {
	return providerModels(agentId).map((model) => ({ id: model.modelId, name: model.name }));
}

/**
 * Fill an axis nobody answered from what the provider publishes.
 *
 * A provider's modes and models are contract facts: they do not change as a
 * turn runs, and no event carries them. So they are the honest filler when the
 * answer in hand is empty, and they must fill each axis on its own.
 *
 * Filling both axes together is what the composer used to do, and it hid the
 * mode selector. A cache written before Claude reported its modes holds models
 * and no modes; taken whole, that cache counted as an answer for both axes, and
 * the toolbar draws the mode selector only when modes exist. A preconnection
 * call that ends failed or unsupported did the same. Neither can hide the other
 * half now.
 */
function backfillFromProvider(
	resolution: CapabilitySourceResolution,
	agentId: string | null | undefined
): CapabilitySourceResolution {
	const modesAnswered = (resolution.availableModes?.length ?? 0) > 0;
	const modelsAnswered = (resolution.availableModels?.length ?? 0) > 0;
	if (modesAnswered && modelsAnswered) {
		return resolution;
	}

	return {
		...resolution,
		availableModes: modesAnswered ? resolution.availableModes : providerFallbackModes(agentId),
		availableModels: modelsAnswered ? resolution.availableModels : providerFallbackModels(agentId),
		// Provider models carry no display grouping, and an empty grouping
		// placeholder would hide them.
		modelsDisplay: hasUsableModelsDisplay(resolution.modelsDisplay)
			? resolution.modelsDisplay
			: null,
	};
}

function buildResolution(
	source: CapabilitySourceKind,
	status: CapabilitySourceResolution["status"],
	availableModes: readonly Mode[] | null,
	availableModels: readonly Model[] | null,
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
	if (input.sessionSource.kind === "missing_canonical") {
		return buildResolution(
			"missingCanonicalSession",
			"missingCanonicalSession",
			[],
			[],
			null,
			null
		);
	}

	if (input.sessionSource.kind === "canonical") {
		const liveCapabilities = input.sessionSource.capabilities;
		return buildResolution(
			"liveSession",
			"liveSession",
			liveCapabilities.availableModes,
			liveCapabilities.availableModels,
			liveCapabilities.modelsDisplay ?? null,
			liveCapabilities.providerMetadata ?? null
		);
	}

	return backfillFromProvider(resolveFallbackCapabilitySource(input), input.agentId);
}
