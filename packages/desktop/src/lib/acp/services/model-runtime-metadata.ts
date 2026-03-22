/**
 * ACP-facing model runtime metadata resolver.
 * Returns context window and other runtime metadata by model ID.
 * Uses models.dev (OpenCode-compatible) as fallback; agent-specific sources can be added later.
 */

import { fetchModelMetadata } from "../../opencode/services/model-metadata.js";

export interface ModelRuntimeMetadata {
	contextWindow?: number;
}

let metadataCache: Map<string, { contextWindow?: number }> | null = null;
let cachePromise: Promise<Map<string, { contextWindow?: number }>> | null = null;

function ensureCache(): Promise<Map<string, { contextWindow?: number }>> {
	if (metadataCache) {
		return Promise.resolve(metadataCache);
	}
	if (cachePromise) {
		return cachePromise;
	}
	cachePromise = fetchModelMetadata()
		.match(
			(map) => {
				const out = new Map<string, { contextWindow?: number }>();
				for (const [key, meta] of map.entries()) {
					if (meta.contextWindow != null) {
						out.set(key, { contextWindow: meta.contextWindow });
					}
				}
				metadataCache = out;
				return out;
			},
			() => new Map<string, { contextWindow?: number }>()
		)
		.then((m) => m);
	return cachePromise;
}

/**
 * Get runtime metadata for a model (context window, etc.).
 * agentId can be used in the future for agent-specific lookup.
 */
export async function getModelRuntimeMetadata(
	modelId: string,
	_agentId?: string
): Promise<ModelRuntimeMetadata> {
	const cache = await ensureCache();
	const exact = cache.get(modelId);
	if (exact) return exact;
	// Try provider/modelId for IDs without slash (e.g. OpenCode anthropic models)
	if (!modelId.includes("/")) {
		const withAnthropic = cache.get(`anthropic/${modelId}`);
		if (withAnthropic) return withAnthropic;
	}
	return {};
}
