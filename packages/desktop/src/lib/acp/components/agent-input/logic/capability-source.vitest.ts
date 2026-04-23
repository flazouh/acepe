import { describe, expect, it } from "vitest";

import { BUILTIN_PROVIDER_METADATA_BY_AGENT_ID } from "$lib/services/acp-provider-metadata.js";
import { resolveCapabilitySource } from "./capability-source.js";

describe("resolveCapabilitySource", () => {
	it("uses resolved preconnection capabilities before persisted caches for never-connected built-in agents", () => {
		const resolution = resolveCapabilitySource({
			sessionCapabilities: null,
			preconnectionCapabilities: {
				status: "resolved",
				availableModels: [{ modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
				currentModelId: "claude-sonnet-4-6",
				modelsDisplay: { groups: [], presentation: undefined },
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
				availableModes: [
					{ id: "build", name: "Build" },
					{ id: "plan", name: "Plan" },
				],
				currentModeId: "build",
			},
			cachedModes: [],
			cachedModels: [],
			cachedModelsDisplay: null,
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
		});

		expect(resolution.source).toBe("preconnectionResolved");
		expect(resolution.availableModes.map((mode) => mode.id)).toEqual(["build", "plan"]);
		expect(resolution.availableModels.map((model) => model.id)).toEqual(["claude-sonnet-4-6"]);
	});

	it("keeps live session capabilities ahead of preconnection data", () => {
		const resolution = resolveCapabilitySource({
			sessionCapabilities: {
				availableModels: [{ id: "live-model", name: "Live Model" }],
				availableModes: [{ id: "plan", name: "Plan" }],
				availableCommands: [],
				modelsDisplay: undefined,
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
			},
			preconnectionCapabilities: {
				status: "resolved",
				availableModels: [{ modelId: "preconnection-model", name: "Preconnection Model" }],
				currentModelId: "preconnection-model",
				modelsDisplay: { groups: [], presentation: undefined },
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
				availableModes: [{ id: "build", name: "Build" }],
				currentModeId: "build",
			},
			cachedModes: [],
			cachedModels: [],
			cachedModelsDisplay: null,
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
		});

		expect(resolution.source).toBe("liveSession");
		expect(resolution.availableModes.map((mode) => mode.id)).toEqual(["plan"]);
		expect(resolution.availableModels.map((model) => model.id)).toEqual(["live-model"]);
	});

	it("falls back to partial preconnection capabilities after persisted caches", () => {
		const resolution = resolveCapabilitySource({
			sessionCapabilities: null,
			preconnectionCapabilities: {
				status: "partial",
				availableModels: [],
				currentModelId: "",
				modelsDisplay: { groups: [], presentation: undefined },
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
				availableModes: [
					{ id: "build", name: "Build" },
					{ id: "plan", name: "Plan" },
				],
				currentModeId: "build",
			},
			cachedModes: [],
			cachedModels: [],
			cachedModelsDisplay: null,
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
		});

		expect(resolution.source).toBe("preconnectionPartial");
		expect(resolution.availableModes.map((mode) => mode.id)).toEqual(["build", "plan"]);
		expect(resolution.availableModels).toEqual([]);
	});
});
