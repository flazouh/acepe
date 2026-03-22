export { opencodeClient } from "./client.js";
export { fetchModelMetadata } from "./services/model-metadata.js";
export { getProviderStore } from "./store/provider-store.svelte.js";
export type {
	ModelCapabilities,
	ModelMetadata,
	Provider,
	ProviderConfigResponse,
	ProviderModel,
} from "./types/index.js";
