import type { ModelCapabilities } from "./model-capabilities.js";

export type ProviderModel = {
	id: string;
	providerID: string;
	name: string;
	family?: string;
	capabilities: ModelCapabilities;
	variants?: Record<string, unknown>;
};
