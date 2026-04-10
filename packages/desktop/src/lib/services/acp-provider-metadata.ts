import type { ModelsForDisplay, ProviderMetadataProjection } from "./acp-types.js";

export type { ModelsForDisplay, ProviderMetadataProjection } from "./acp-types.js";

export const BUILTIN_PROVIDER_METADATA_BY_AGENT_ID: Record<string, ProviderMetadataProjection> = {
	"claude-code": {
		providerBrand: "claude-code",
		displayName: "Claude Code",
		displayOrder: 10,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: "default",
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "launchProfile",
		preconnectionSlashMode: "startupGlobal",
	},
	copilot: {
		providerBrand: "copilot",
		displayName: "GitHub Copilot",
		displayOrder: 30,
		supportsModelDefaults: false,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "projectScoped",
	},
	cursor: {
		providerBrand: "cursor",
		displayName: "Cursor",
		displayOrder: 20,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: "auto",
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "startupGlobal",
	},
	opencode: {
		providerBrand: "opencode",
		displayName: "OpenCode",
		displayOrder: 40,
		supportsModelDefaults: true,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "projectScoped",
	},
	codex: {
		providerBrand: "codex",
		displayName: "Codex",
		displayOrder: 50,
		supportsModelDefaults: true,
		variantGroup: "reasoningEffort",
		defaultAlias: undefined,
		reasoningEffortSupport: true,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "startupGlobal",
	},
};

function cloneProviderMetadataProjection(
	providerMetadata: ProviderMetadataProjection
): ProviderMetadataProjection {
	return {
		providerBrand: providerMetadata.providerBrand,
		displayName: providerMetadata.displayName,
		displayOrder: providerMetadata.displayOrder,
		supportsModelDefaults: providerMetadata.supportsModelDefaults,
		variantGroup: providerMetadata.variantGroup,
		defaultAlias: providerMetadata.defaultAlias,
		reasoningEffortSupport: providerMetadata.reasoningEffortSupport,
		autonomousApplyStrategy: providerMetadata.autonomousApplyStrategy,
		preconnectionSlashMode: providerMetadata.preconnectionSlashMode,
	};
}

export function resolveProviderMetadataProjection(
	agentId: string,
	providerMetadata: ProviderMetadataProjection | null | undefined,
	fallbackDisplayName?: string
): ProviderMetadataProjection {
	if (providerMetadata) {
		return cloneProviderMetadataProjection(providerMetadata);
	}

	const builtInProviderMetadata = BUILTIN_PROVIDER_METADATA_BY_AGENT_ID[agentId];
	if (builtInProviderMetadata) {
		return cloneProviderMetadataProjection(builtInProviderMetadata);
	}

	return {
		providerBrand: "custom",
		displayName: fallbackDisplayName ?? agentId,
		displayOrder: 65535,
		supportsModelDefaults: false,
		variantGroup: "plain",
		defaultAlias: undefined,
		reasoningEffortSupport: false,
		autonomousApplyStrategy: "postConnect",
		preconnectionSlashMode: "unsupported",
	};
}

export function getProviderMetadataFromModelsDisplay(
	modelsDisplay: ModelsForDisplay | null | undefined
): ProviderMetadataProjection | null {
	return modelsDisplay?.presentation?.provider ?? null;
}

export function normalizeModelsForDisplay(
	agentId: string,
	modelsDisplay: ModelsForDisplay | null | undefined,
	fallbackDisplayName?: string,
	providerMetadataOverride?: ProviderMetadataProjection | null
): ModelsForDisplay | null {
	if (!modelsDisplay) {
		return null;
	}

	const providerMetadata = resolveProviderMetadataProjection(
		agentId,
		providerMetadataOverride ?? getProviderMetadataFromModelsDisplay(modelsDisplay),
		fallbackDisplayName
	);
	const presentation = modelsDisplay.presentation;
	const displayFamily =
		presentation?.displayFamily ??
		(providerMetadata.variantGroup === "reasoningEffort"
			? "codexReasoningEffort"
			: "providerGrouped");

	return {
		groups: modelsDisplay.groups,
		presentation: {
			displayFamily,
			usageMetrics: presentation?.usageMetrics ?? "spendAndContext",
			provider: providerMetadata,
		},
	};
}
