import { ResultAsync } from "neverthrow";

import type { ModelMetadata } from "../types/model-metadata.js";

const MODELS_DEV_API = "https://models.dev/api.json";

function isModelMetadata(value: unknown): value is ModelMetadata {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return typeof obj.name === "string" && typeof obj.description === "string";
}

export function fetchModelMetadata(): ResultAsync<Map<string, ModelMetadata>, Error> {
	return ResultAsync.fromPromise(
		fetch(MODELS_DEV_API, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(8000),
		}).then(async (response) => {
			if (!response.ok) {
				const text = await response.text();
				throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
			}
			return response.json();
		}),
		(e) => new Error(`Failed to fetch model metadata: ${e}`)
	).map((data) => {
		const metadataMap = new Map<string, ModelMetadata>();

		for (const [providerId, providerData] of Object.entries(data)) {
			const models = (providerData as Record<string, unknown>).models;
			if (!models || typeof models !== "object") continue;

			for (const [modelId, modelData] of Object.entries(models as Record<string, unknown>)) {
				if (!isModelMetadata(modelData)) {
					console.warn(`Invalid model metadata for ${providerId}/${modelId}, skipping`);
					continue;
				}
				const key = `${providerId}/${modelId}`;
				metadataMap.set(key, modelData);
			}
		}

		return metadataMap;
	});
}
