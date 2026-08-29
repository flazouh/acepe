import { providerModes } from "@acepe/contracts";
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

	return buildResolution(
		"persistedCache",
		"persistedCache",
		[],
		null,
		null,
		input.providerMetadata
	);
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

/**
 * Fill the mode axis from what the provider publishes when nobody answered it.
 *
 * A provider's modes are contract facts: they do not change as a turn runs,
 * and no event carries them. So they are the honest filler when the answer in
 * hand is empty, and they fill their axis on its own. A cache written before
 * Claude reported its modes holds models and no modes; taken whole, that cache
 * counted as an answer for both axes, and the toolbar draws the mode selector
 * only when modes exist.
 *
 * The models are NOT backfilled. A provider ships new models between Acepe
 * releases, so a constant was always the wrong answer: the composer offered
 * five models the agent had outgrown. A provider is asked for its own catalog
 * and publishes it as a canonical session fact, which means a composer with no
 * session yet has no catalog to show, and shows none.
 */
function backfillFromProvider(
	resolution: CapabilitySourceResolution,
	agentId: string | null | undefined
): CapabilitySourceResolution {
	const modesAnswered = (resolution.availableModes?.length ?? 0) > 0;
	if (modesAnswered) {
		return resolution;
	}

	return {
		...resolution,
		availableModes: providerFallbackModes(agentId),
		// An empty grouping placeholder is not an answer, and would hide the
		// models a later source supplies.
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
