import * as Effect from "effect/Effect";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { ComposerMcpCatalog } from "$lib/services/acp-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

interface EnsureLoadedInput {
	readonly agentId: string | null;
	readonly projectPath: string | null;
	readonly sessionId: string | null;
}

type FetchComposerMcpCatalog = (
	cwd: string,
	agentId: string,
	sessionId: string | null
) => Effect.Effect<ComposerMcpCatalog, AppError>;

const logger = createLogger({
	id: "composer-mcp-catalog",
	name: "ComposerMcpCatalog",
});

function buildCacheKey(input: {
	agentId: string | null;
	projectPath: string | null;
	sessionId: string | null;
}): string | null {
	if (!input.agentId || !input.projectPath) {
		return null;
	}
	const sessionKey = input.sessionId ?? "no-session";
	return `${input.agentId}::${input.projectPath}::${sessionKey}`;
}

export class ComposerMcpCatalogState {
	loadingCacheKey = $state<string | null>(null);
	private readonly catalogByKey = new SvelteMap<string, ComposerMcpCatalog>();
	private readonly fetchCatalog: FetchComposerMcpCatalog;

	constructor(fetchCatalog?: FetchComposerMcpCatalog) {
		this.fetchCatalog = fetchCatalog
			? fetchCatalog
			: (cwd, agentId, sessionId) => tauriClient.acp.getComposerMcpCatalog(cwd, agentId, sessionId);
	}

	invalidate(input: EnsureLoadedInput): void {
		const cacheKey = buildCacheKey(input);
		if (!cacheKey) {
			return;
		}
		this.catalogByKey.delete(cacheKey);
		if (this.loadingCacheKey === cacheKey) {
			this.loadingCacheKey = null;
		}
	}

	ensureLoaded(
		input: EnsureLoadedInput,
		options?: { readonly force?: boolean }
	): Effect.Effect<void, AppError> {
		const cacheKey = buildCacheKey(input);
		if (!cacheKey) {
			return Effect.succeed(undefined);
		}

		if (options?.force) {
			this.catalogByKey.delete(cacheKey);
		}

		if (this.catalogByKey.has(cacheKey)) {
			return Effect.succeed(undefined);
		}

		if (this.loadingCacheKey === cacheKey) {
			return Effect.succeed(undefined);
		}

		const projectPath = input.projectPath;
		const agentId = input.agentId;
		if (!projectPath || !agentId) {
			return Effect.succeed(undefined);
		}

		this.loadingCacheKey = cacheKey;
		logger.info("Loading composer MCP catalog", {
			agentId,
			projectPath,
			sessionId: input.sessionId,
		});

		return this.fetchCatalog(projectPath, agentId, input.sessionId).pipe(
			Effect.map((catalog) => {
				this.catalogByKey.set(cacheKey, catalog);
				if (this.loadingCacheKey === cacheKey) {
					this.loadingCacheKey = null;
				}
			}),
			Effect.mapError((error) => {
				logger.error("Failed to load composer MCP catalog", {
					agentId,
					projectPath,
					error: error.message,
				});
				this.catalogByKey.set(cacheKey, {
					source: "preconnectionConfig",
					servers: [],
				});
				if (this.loadingCacheKey === cacheKey) {
					this.loadingCacheKey = null;
				}
				return error;
			})
		);
	}

	getCatalog(input: EnsureLoadedInput): ComposerMcpCatalog | null {
		const cacheKey = buildCacheKey(input);
		if (!cacheKey) {
			return null;
		}
		return this.catalogByKey.get(cacheKey) ?? null;
	}

	hasLoaded(input: EnsureLoadedInput): boolean {
		const cacheKey = buildCacheKey(input);
		if (!cacheKey) {
			return false;
		}
		return this.catalogByKey.has(cacheKey);
	}

	isLoading(input: EnsureLoadedInput): boolean {
		const cacheKey = buildCacheKey(input);
		return cacheKey !== null && this.loadingCacheKey === cacheKey;
	}
}
