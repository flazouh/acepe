import type { ProviderModel } from "./provider-model.js";

export type Provider = {
	id: string;
	name: string;
	source: "env" | "config" | "custom" | "api";
	env: string[];
	key?: string;
	options: Record<string, unknown>;
	models: ProviderModel[];
};
