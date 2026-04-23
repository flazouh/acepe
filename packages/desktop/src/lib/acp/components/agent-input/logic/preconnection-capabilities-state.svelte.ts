import { okAsync, ResultAsync } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { AgentInfo } from "$lib/acp/store/api.js";
import type {
	ProviderMetadataProjection,
	ResolvedCapabilities,
} from "$lib/services/acp-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

interface EnsureLoadedInput {
	agentId: string | null;
	hasConnectedSession: boolean;
	projectPath: string | null;
	preconnectionCapabilityMode: ProviderMetadataProjection["preconnectionCapabilityMode"];
}

interface GetCapabilitiesInput {
	agentId: string | null;
	projectPath: string | null;
	preconnectionCapabilityMode: ProviderMetadataProjection["preconnectionCapabilityMode"];
}

type FetchCapabilities = (
	projectPath: string,
	agentId: string
) => ResultAsync<ResolvedCapabilities, AppError>;

const logger = createLogger({
	id: "preconnection-capabilities",
	name: "PreconnectionCapabilities",
});

const capabilitiesByKey = new SvelteMap<string, ResolvedCapabilities>();
const inFlightByKey = new Map<string, ResultAsync<ResolvedCapabilities, AppError>>();
const loadingByKey = new SvelteMap<string, true>();

function buildCacheKey(
	agentId: string | null,
	projectPath: string | null,
	mode: ProviderMetadataProjection["preconnectionCapabilityMode"]
): string | null {
	if (!agentId) {
		return null;
	}

	if (mode === "projectScoped") {
		return projectPath ? `${agentId}::${projectPath}` : null;
	}

	return agentId;
}

export function shouldLoadPreconnectionCapabilities(input: {
	agentId: string | null;
	hasConnectedSession: boolean;
	projectPath: string | null;
	preconnectionCapabilityMode: ProviderMetadataProjection["preconnectionCapabilityMode"];
	alreadyLoaded: boolean;
	alreadyLoading: boolean;
}): boolean {
	if (input.hasConnectedSession) {
		return false;
	}

	if (input.preconnectionCapabilityMode === "unsupported") {
		return false;
	}

	if (!input.agentId) {
		return false;
	}

	if (input.preconnectionCapabilityMode === "projectScoped" && !input.projectPath) {
		return false;
	}

	if (input.alreadyLoaded || input.alreadyLoading) {
		return false;
	}

	return true;
}

export function resetForTesting(): void {
	capabilitiesByKey.clear();
	inFlightByKey.clear();
	loadingByKey.clear();
}

export class PreconnectionCapabilitiesState {
	loadingCacheKey = $state<string | null>(null);
	private readonly fetchCapabilities: FetchCapabilities;

	constructor(fetchCapabilities?: FetchCapabilities) {
		this.fetchCapabilities = fetchCapabilities
			? fetchCapabilities
			: tauriClient.acp.listPreconnectionCapabilities;
	}

	ensureLoaded(input: EnsureLoadedInput): ResultAsync<void, AppError> {
		const cacheKey = buildCacheKey(
			input.agentId,
			input.projectPath,
			input.preconnectionCapabilityMode
		);
		const existingRequest = cacheKey ? inFlightByKey.get(cacheKey) : undefined;
		if (existingRequest && cacheKey) {
			this.loadingCacheKey = cacheKey;
			return existingRequest
				.map(() => {
					if (this.loadingCacheKey === cacheKey) {
						this.loadingCacheKey = null;
					}
				})
				.mapErr((error) => {
					if (this.loadingCacheKey === cacheKey) {
						this.loadingCacheKey = null;
					}
					return error;
				});
		}

		const alreadyLoaded = cacheKey ? capabilitiesByKey.has(cacheKey) : false;
		const alreadyLoading = cacheKey ? loadingByKey.has(cacheKey) : false;

		if (
			!shouldLoadPreconnectionCapabilities({
				agentId: input.agentId,
				hasConnectedSession: input.hasConnectedSession,
				projectPath: input.projectPath,
				preconnectionCapabilityMode: input.preconnectionCapabilityMode,
				alreadyLoaded,
				alreadyLoading,
			})
		) {
			return okAsync(undefined);
		}

		const agentId = input.agentId;
		if (!cacheKey || !agentId) {
			return okAsync(undefined);
		}

		const cwd = input.projectPath ?? "";
		const request = this.fetchCapabilities(cwd, agentId);

		inFlightByKey.set(cacheKey, request);
		loadingByKey.set(cacheKey, true);
		this.loadingCacheKey = cacheKey;

		return request
			.map((capabilities) => {
				capabilitiesByKey.set(cacheKey, capabilities);
				inFlightByKey.delete(cacheKey);
				loadingByKey.delete(cacheKey);
				if (this.loadingCacheKey === cacheKey) {
					this.loadingCacheKey = null;
				}
				logger.info("Loaded preconnection capabilities", {
					agentId,
					projectPath: input.projectPath,
					status: capabilities.status,
					modelCount: capabilities.availableModels.length,
					modeCount: capabilities.availableModes.length,
				});
			})
			.mapErr((error) => {
				inFlightByKey.delete(cacheKey);
				loadingByKey.delete(cacheKey);
				if (this.loadingCacheKey === cacheKey) {
					this.loadingCacheKey = null;
				}
				logger.error("Failed to load preconnection capabilities", {
					agentId,
					projectPath: input.projectPath,
					error: error.message,
				});
				return error;
			});
	}

	getCapabilities(input: GetCapabilitiesInput): ResolvedCapabilities | null {
		const cacheKey = buildCacheKey(
			input.agentId,
			input.projectPath,
			input.preconnectionCapabilityMode
		);
		if (!cacheKey) {
			return null;
		}

		return capabilitiesByKey.get(cacheKey) ?? null;
	}

	isLoading(input: GetCapabilitiesInput): boolean {
		const cacheKey = buildCacheKey(
			input.agentId,
			input.projectPath,
			input.preconnectionCapabilityMode
		);
		return cacheKey ? loadingByKey.has(cacheKey) : false;
	}

	initializeStartupGlobal(agents: ReadonlyArray<AgentInfo>): ResultAsync<void, AppError> {
		const startupGlobalAgents = agents.filter(
			(agent) => agent.provider_metadata?.preconnectionCapabilityMode === "startupGlobal"
		);

		if (startupGlobalAgents.length === 0) {
			return okAsync(undefined);
		}

		const requests = startupGlobalAgents.map((agent) =>
			this.ensureLoaded({
				agentId: agent.id,
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode:
					agent.provider_metadata?.preconnectionCapabilityMode ?? "unsupported",
			})
		);

		return ResultAsync.combine(requests).map(() => undefined);
	}
}
