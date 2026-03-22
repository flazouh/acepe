import type { Provider } from "./provider.js";

export type ProviderConfigResponse = {
	providers: Provider[];
	default?: {
		provider?: string;
		model?: string;
	};
};
