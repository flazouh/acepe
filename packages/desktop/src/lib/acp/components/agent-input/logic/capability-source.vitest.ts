import { describe, expect, it } from "vitest";

import { BUILTIN_PROVIDER_METADATA_BY_AGENT_ID } from "$lib/services/acp-provider-metadata.js";
import type { SessionCapabilities } from "$lib/acp/application/dto/session-capabilities.js";
import {
	resolveCapabilityContextProviderMetadata,
	resolveCapabilitySource,
} from "./capability-source.js";

function liveSession(capabilities: SessionCapabilities) {
	return {
		kind: "canonical" as const,
		capabilities,
	};
}

function modeIds(modes: readonly { id: string }[] | null): string[] | null {
	return modes?.map((mode) => mode.id) ?? null;
}

function modelIds(models: readonly { id: string }[] | null): string[] | null {
	return models?.map((model) => model.id) ?? null;
}

describe("resolveCapabilitySource", () => {
	it("uses resolved preconnection capabilities before persisted caches for never-connected built-in agents", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: { kind: "no_session" },
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
		expect(modeIds(resolution.availableModes)).toEqual(["build", "plan"]);
		expect(modelIds(resolution.availableModels)).toEqual(["claude-sonnet-4-6"]);
	});

	it("keeps live session capabilities ahead of preconnection data", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: liveSession({
				availableModels: [{ id: "live-model", name: "Live Model" }],
				availableModes: [{ id: "plan", name: "Plan" }],
				availableCommands: [],
				modelsDisplay: undefined,
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
			}),
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
		expect(modeIds(resolution.availableModes)).toEqual(["plan"]);
		expect(modelIds(resolution.availableModels)).toEqual(["live-model"]);
	});

	it("preserves unknown live session capability lists", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: liveSession({
				availableModels: null,
				availableModes: null,
				availableCommands: [],
				modelsDisplay: undefined,
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
			}),
			preconnectionCapabilities: null,
			cachedModes: [{ id: "plan", name: "Plan" }],
			cachedModels: [{ id: "cached-cursor-model", name: "Cached Cursor Model" }],
			cachedModelsDisplay: null,
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
		});

		expect(resolution.source).toBe("liveSession");
		expect(resolution.availableModes).toBeNull();
		expect(resolution.availableModels).toBeNull();
	});

	it("does not fill missing live session models from cached capabilities", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: liveSession({
				availableModels: [],
				availableModes: [{ id: "build", name: "Build" }],
				availableCommands: [],
				modelsDisplay: undefined,
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
			}),
			preconnectionCapabilities: null,
			cachedModes: [{ id: "plan", name: "Plan" }],
			cachedModels: [{ id: "cached-cursor-model", name: "Cached Cursor Model" }],
			cachedModelsDisplay: {
				groups: [
					{
						label: "Cursor",
						models: [
							{
								modelId: "cached-cursor-model",
								displayName: "Cached Cursor Model",
							},
						],
					},
				],
				presentation: undefined,
			},
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
		});

		expect(resolution.source).toBe("liveSession");
		expect(modeIds(resolution.availableModes)).toEqual(["build"]);
		expect(resolution.availableModels).toEqual([]);
		expect(resolution.modelsDisplay).toBeNull();
	});

	it("uses canonical empty live session capabilities instead of partial preconnection data", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: liveSession({
				availableModels: [],
				availableModes: [],
				availableCommands: [],
				modelsDisplay: { groups: [], presentation: undefined },
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
			}),
			preconnectionCapabilities: {
				status: "partial",
				availableModels: [],
				currentModelId: null,
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

		expect(resolution.source).toBe("liveSession");
		expect(resolution.availableModes).toEqual([]);
		expect(resolution.availableModels).toEqual([]);
		expect(resolution.modelsDisplay).toEqual({ groups: [], presentation: undefined });
	});

	it("keeps persisted cache precedence ahead of partial preconnection capabilities", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: { kind: "no_session" },
			preconnectionCapabilities: {
				status: "partial",
				availableModels: [],
				currentModelId: null,
				modelsDisplay: { groups: [], presentation: undefined },
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
				availableModes: [
					{ id: "build", name: "Build" },
					{ id: "plan", name: "Plan" },
				],
				currentModeId: "build",
			},
			cachedModes: [{ id: "build", name: "Build" }],
			cachedModels: [{ id: "cached-model", name: "Cached Model" }],
			cachedModelsDisplay: {
				groups: [{ label: "", models: [{ modelId: "cached-model", displayName: "Cached Model" }] }],
				presentation: undefined,
			},
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
		});

		expect(resolution.source).toBe("persistedCache");
		expect(modeIds(resolution.availableModes)).toEqual(["build"]);
		expect(modelIds(resolution.availableModels)).toEqual(["cached-model"]);
	});

	it("ignores empty cached modelsDisplay placeholders when partial preconnection data exists", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: { kind: "no_session" },
			preconnectionCapabilities: {
				status: "partial",
				availableModels: [],
				currentModelId: null,
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
			cachedModelsDisplay: { groups: [], presentation: undefined },
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
		});

		expect(resolution.source).toBe("preconnectionPartial");
		expect(modeIds(resolution.availableModes)).toEqual(["build", "plan"]);
	});

	it("does not fall back to cached or preconnection data when a real session has no canonical capabilities", () => {
		const resolution = resolveCapabilitySource({
			sessionSource: {
				kind: "missing_canonical",
				sessionId: "session-1",
			},
			preconnectionCapabilities: {
				status: "resolved",
				availableModels: [{ modelId: "preconnection-model", name: "Preconnection Model" }],
				currentModelId: "preconnection-model",
				modelsDisplay: { groups: [], presentation: undefined },
				providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
				availableModes: [{ id: "build", name: "Build" }],
				currentModeId: "build",
			},
			cachedModes: [{ id: "plan", name: "Plan" }],
			cachedModels: [{ id: "cached-model", name: "Cached Model" }],
			cachedModelsDisplay: {
				groups: [{ label: "", models: [{ modelId: "cached-model", displayName: "Cached Model" }] }],
				presentation: undefined,
			},
			providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
		});

		expect(resolution.source).toBe("missingCanonicalSession");
		expect(resolution.availableModes).toEqual([]);
		expect(resolution.availableModels).toEqual([]);
		expect(resolution.modelsDisplay).toBeNull();
	});
});

describe("resolveCapabilityContextProviderMetadata", () => {
	it("uses selected agent metadata before a session exists", () => {
		expect(
			resolveCapabilityContextProviderMetadata({
				sessionSource: { kind: "no_session" },
				selectedAgentProviderMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
			})
		).toBe(BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor);
	});

	it("uses canonical provider metadata for a live session", () => {
		expect(
			resolveCapabilityContextProviderMetadata({
				sessionSource: liveSession({
					availableModels: [],
					availableModes: [],
					availableCommands: [],
					modelsDisplay: undefined,
					providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
				}),
				selectedAgentProviderMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
			})
		).toBe(BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"]);
	});

	it("does not fall back to selected agent metadata when session canonical capabilities are missing", () => {
		expect(
			resolveCapabilityContextProviderMetadata({
				sessionSource: {
					kind: "missing_canonical",
					sessionId: "session-1",
				},
				selectedAgentProviderMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID.cursor,
			})
		).toBeNull();
	});
});
