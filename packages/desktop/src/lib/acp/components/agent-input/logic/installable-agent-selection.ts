import { okAsync, type ResultAsync } from "neverthrow";

import type { AppError } from "$lib/acp/errors/app-error.js";
import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";

interface InstallableAgentSelectionInput {
	readonly agentId: string;
	readonly installRequired: boolean;
	readonly projectPath: string | null;
	readonly preconnectionCapabilityMode: ProviderMetadataProjection["preconnectionCapabilityMode"];
}

interface PreconnectionCapabilitiesInput {
	readonly agentId: string | null;
	readonly hasConnectedSession: boolean;
	readonly projectPath: string | null;
	readonly preconnectionCapabilityMode: ProviderMetadataProjection["preconnectionCapabilityMode"];
}

interface InstallableAgentSelectionDependencies {
	readonly installAgent: (agentId: string) => ResultAsync<void, AppError>;
	readonly refreshPreconnectionCapabilities: (
		input: PreconnectionCapabilitiesInput,
		options: { readonly force: boolean }
	) => ResultAsync<void, AppError>;
	readonly selectAgent: (agentId: string) => void;
}

interface PostInstallCapabilityModeInput {
	readonly projectedProviderMetadata: ProviderMetadataProjection | undefined;
	readonly canonicalProviderMetadata: ProviderMetadataProjection | undefined;
	readonly requiresPostInstallCatalog: boolean;
}

/**
 * Resolve the capability catalog mode from canonical agent metadata first.
 * Managed agents without metadata still take the conservative startup-global
 * catalog path so installation can never silently skip model readiness.
 */
export function resolvePostInstallCapabilityMode(
	input: PostInstallCapabilityModeInput
): ProviderMetadataProjection["preconnectionCapabilityMode"] {
	const metadata = input.canonicalProviderMetadata ?? input.projectedProviderMetadata;
	if (metadata) {
		return metadata.preconnectionCapabilityMode;
	}

	return input.requiresPostInstallCatalog ? "startupGlobal" : "unsupported";
}

/**
 * Installs a managed agent and refreshes its canonical preconnection catalog
 * before exposing the agent as selected to the composer.
 */
export function installAgentForSelection(
	input: InstallableAgentSelectionInput,
	dependencies: InstallableAgentSelectionDependencies
): ResultAsync<void, AppError> {
	const installation = input.installRequired
		? dependencies.installAgent(input.agentId)
		: okAsync(undefined);
	return installation
		.andThen(() =>
			dependencies.refreshPreconnectionCapabilities(
				{
					agentId: input.agentId,
					hasConnectedSession: false,
					projectPath: input.projectPath,
					preconnectionCapabilityMode: input.preconnectionCapabilityMode,
				},
				{ force: true }
			)
		)
		.map(() => {
			dependencies.selectAgent(input.agentId);
		});
}
