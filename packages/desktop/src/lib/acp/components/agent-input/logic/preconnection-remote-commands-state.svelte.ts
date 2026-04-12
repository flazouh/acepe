import { okAsync, type ResultAsync } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { AvailableCommand } from "$lib/acp/types/available-command.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

interface EnsureLoadedInput {
	agentId: string | null;
	hasConnectedSession: boolean;
	projectPath: string | null;
	preconnectionSlashMode: ProviderMetadataProjection["preconnectionSlashMode"];
}

interface GetCommandsInput {
	agentId: string | null;
	projectPath: string | null;
	preconnectionSlashMode: ProviderMetadataProjection["preconnectionSlashMode"];
	skillCommands: ReadonlyArray<AvailableCommand>;
}

type FetchRemoteCommands = (
	projectPath: string,
	agentId: string
) => ResultAsync<AvailableCommand[], AppError>;

const logger = createLogger({
	id: "preconnection-remote-commands",
	name: "PreconnectionRemoteCommands",
});

function buildProjectScopedCacheKey(
	agentId: string | null,
	projectPath: string | null
): string | null {
	if (!agentId || !projectPath) {
		return null;
	}

	return `${agentId}::${projectPath}`;
}

export function shouldLoadRemotePreconnectionCommands(input: {
	agentId: string | null;
	hasConnectedSession: boolean;
	projectPath: string | null;
	preconnectionSlashMode: ProviderMetadataProjection["preconnectionSlashMode"];
	alreadyLoaded: boolean;
	alreadyLoading: boolean;
}): boolean {
	if (input.preconnectionSlashMode !== "projectScoped") {
		return false;
	}

	if (!input.agentId || !input.projectPath) {
		return false;
	}

	if (input.alreadyLoaded || input.alreadyLoading) {
		return false;
	}

	return true;
}

export class PreconnectionRemoteCommandsState {
	loadingCacheKey = $state<string | null>(null);
	private readonly remoteCommandsByKey = new SvelteMap<string, AvailableCommand[]>();
	private readonly fetchRemoteCommands: FetchRemoteCommands;

	constructor(fetchRemoteCommands?: FetchRemoteCommands) {
		this.fetchRemoteCommands = fetchRemoteCommands
			? fetchRemoteCommands
			: tauriClient.acp.listPreconnectionCommands;
	}

	ensureLoaded(input: EnsureLoadedInput): ResultAsync<void, AppError> {
		const cacheKey = buildProjectScopedCacheKey(input.agentId, input.projectPath);
		const alreadyLoaded = cacheKey ? this.remoteCommandsByKey.has(cacheKey) : false;
		const alreadyLoading = cacheKey !== null && this.loadingCacheKey === cacheKey;

		if (
			!shouldLoadRemotePreconnectionCommands({
				agentId: input.agentId,
				hasConnectedSession: input.hasConnectedSession,
				projectPath: input.projectPath,
				preconnectionSlashMode: input.preconnectionSlashMode,
				alreadyLoaded,
				alreadyLoading,
			})
		) {
			return okAsync(undefined);
		}

		const projectPath = input.projectPath;
		if (!projectPath || !cacheKey) {
			return okAsync(undefined);
		}

		const agentId = input.agentId;
		if (!agentId) {
			return okAsync(undefined);
		}

		logger.info("Loading project-scoped preconnection commands", {
			agentId,
			projectPath,
		});
		this.loadingCacheKey = cacheKey;

		return this.fetchRemoteCommands(projectPath, agentId)
			.map((commands) => {
				logger.info("Loaded project-scoped preconnection commands", {
					agentId,
					projectPath,
					count: commands.length,
					commandNames: commands.map((command) => command.name),
				});
				this.remoteCommandsByKey.set(cacheKey, commands);
				if (this.loadingCacheKey === cacheKey) {
					this.loadingCacheKey = null;
				}
			})
			.mapErr((error) => {
				logger.error("Failed to load project-scoped preconnection commands", {
					agentId,
					projectPath,
					error: error.message,
				});
				if (this.loadingCacheKey === cacheKey) {
					this.loadingCacheKey = null;
				}
				return error;
			});
	}

	getCommands(input: GetCommandsInput): AvailableCommand[] {
		if (input.preconnectionSlashMode !== "projectScoped") {
			return Array.from(input.skillCommands);
		}

		const cacheKey = buildProjectScopedCacheKey(input.agentId, input.projectPath);
		if (!cacheKey) {
			return Array.from(input.skillCommands);
		}

		const remoteCommands = this.remoteCommandsByKey.get(cacheKey);
		if (!remoteCommands) {
			return Array.from(input.skillCommands);
		}

		return Array.from(remoteCommands);
	}
}
