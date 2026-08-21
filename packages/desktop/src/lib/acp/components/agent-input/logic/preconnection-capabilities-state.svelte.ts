import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import { SvelteMap } from "svelte/reactivity";
import { AgentError, AppError } from "$lib/acp/errors/app-error.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { ProviderMetadataProjection, ResolvedCapabilities } from "$lib/services/acp-types.js";
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

interface EnsureLoadedOptions {
	readonly force?: boolean;
}

interface StartupGlobalCapabilitiesAgent {
	readonly id: string;
	readonly providerMetadata?: ProviderMetadataProjection;
	readonly provider_metadata?: ProviderMetadataProjection;
}

type FetchCapabilities = (
	projectPath: string,
	agentId: string
) => Effect.Effect<ResolvedCapabilities, AppError>;

const logger = createLogger({
	id: "preconnection-capabilities",
	name: "PreconnectionCapabilities",
});

const capabilitiesByKey = new SvelteMap<string, ResolvedCapabilities>();
const inFlightByKey = new Map<string, Promise<ResolvedCapabilities>>();
const loadingByKey = new SvelteMap<string, true>();

function toAppError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}
	return new AgentError(
		"preconnection-capabilities",
		error instanceof Error ? error : new Error(String(error))
	);
}

function wrapPending(
	pending: Promise<ResolvedCapabilities>
): Effect.Effect<ResolvedCapabilities, AppError> {
	return fromPromise(() => pending, toAppError);
}

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

	ensureLoaded(
		input: EnsureLoadedInput,
		options: EnsureLoadedOptions = {}
	): Effect.Effect<void, AppError> {
		const cacheKey = buildCacheKey(
			input.agentId,
			input.projectPath,
			input.preconnectionCapabilityMode
		);
		const existingRequest = cacheKey ? inFlightByKey.get(cacheKey) : undefined;
		if (existingRequest && cacheKey && options.force) {
			return wrapPending(existingRequest).pipe(
				Effect.map(() => undefined),
				Effect.catch(() => Effect.succeed(undefined)),
				Effect.flatMap(() => {
					capabilitiesByKey.delete(cacheKey);
					inFlightByKey.delete(cacheKey);
					loadingByKey.delete(cacheKey);
					if (this.loadingCacheKey === cacheKey) {
						this.loadingCacheKey = null;
					}
					return this.ensureLoaded(input, { force: true });
				})
			);
		}
		if (existingRequest && cacheKey) {
			this.loadingCacheKey = cacheKey;
			return wrapPending(existingRequest).pipe(
				Effect.map(() => {
					if (this.loadingCacheKey === cacheKey) {
						this.loadingCacheKey = null;
					}
				}),
				Effect.mapError((error) => {
					if (this.loadingCacheKey === cacheKey) {
						this.loadingCacheKey = null;
					}
					return error;
				})
			);
		}

		if (cacheKey && options.force) {
			capabilitiesByKey.delete(cacheKey);
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
			return Effect.succeed(undefined);
		}

		const agentId = input.agentId;
		if (!cacheKey || !agentId) {
			return Effect.succeed(undefined);
		}

		const cwd = input.projectPath ?? "";
		const pending = Effect.runPromise(this.fetchCapabilities(cwd, agentId));

		inFlightByKey.set(cacheKey, pending);
		loadingByKey.set(cacheKey, true);
		this.loadingCacheKey = cacheKey;

		return wrapPending(pending).pipe(
			Effect.map((capabilities) => {
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
			}),
			Effect.mapError((error) => {
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
			})
		);
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

	initializeStartupGlobal(
		agents: ReadonlyArray<StartupGlobalCapabilitiesAgent>
	): Effect.Effect<void, AppError> {
		const startupGlobalAgents = agents.filter(
			(agent) =>
				(agent.providerMetadata ?? agent.provider_metadata)?.preconnectionCapabilityMode ===
				"startupGlobal"
		);

		if (startupGlobalAgents.length === 0) {
			return Effect.succeed(undefined);
		}

		const requests = startupGlobalAgents.map((agent) =>
			this.ensureLoaded({
				agentId: agent.id,
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode:
					(agent.providerMetadata ?? agent.provider_metadata)?.preconnectionCapabilityMode ??
					"unsupported",
			})
		);

		return Effect.all(requests).pipe(Effect.map(() => undefined));
	}
}
