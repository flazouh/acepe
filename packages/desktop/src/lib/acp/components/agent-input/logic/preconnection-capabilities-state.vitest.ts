import { okAsync, ResultAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderMetadataProjection, ResolvedCapabilities } from "$lib/services/acp-types.js";
import {
	PreconnectionCapabilitiesState,
	resetForTesting,
} from "./preconnection-capabilities-state.svelte.js";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const CLAUDE_CODE_PROVIDER_METADATA: ProviderMetadataProjection = {
	providerBrand: "claude-code",
	displayName: "Claude Code",
	displayOrder: 10,
	supportsModelDefaults: true,
	variantGroup: "plain",
	defaultAlias: "default",
	reasoningEffortSupport: false,
	preconnectionSlashMode: "startupGlobal",
	preconnectionCapabilityMode: "startupGlobal",
	implicitSessionCreationMode: "allowed",
};

function makeResolvedCapabilities(
	modelId = "claude-sonnet-4-6",
	modelName = "Claude Sonnet 4.6"
): ResolvedCapabilities {
	return {
		status: "resolved",
		availableModels: [{ modelId, name: modelName }],
		currentModelId: modelId,
		modelsDisplay: {
			groups: [
				{
					label: "",
					models: [{ modelId, displayName: modelName }],
				},
			],
			presentation: undefined,
		},
		providerMetadata: CLAUDE_CODE_PROVIDER_METADATA,
		availableModes: [{ id: "build", name: "Build" }],
		currentModeId: "build",
		configOptions: [],
	};
}

describe("PreconnectionCapabilitiesState", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		resetForTesting();
		fetchFn.mockReset();
	});

	it("loads startup-global capabilities before a session exists", async () => {
		fetchFn.mockReturnValueOnce(okAsync(makeResolvedCapabilities()));

		const state = new PreconnectionCapabilitiesState(fetchFn);
		const result = await state.ensureLoaded({
			agentId: "claude-code",
			hasConnectedSession: false,
			projectPath: null,
			preconnectionCapabilityMode: "startupGlobal",
		});

		expect(result.isOk()).toBe(true);
		expect(fetchFn).toHaveBeenCalledWith("", "claude-code");
		expect(
			state.getCapabilities({
				agentId: "claude-code",
				projectPath: null,
				preconnectionCapabilityMode: "startupGlobal",
			})
		).toEqual(makeResolvedCapabilities());
	});

	it("reuses the in-flight capability request for concurrent callers", async () => {
		const deferred = createDeferred<ResolvedCapabilities>();
		fetchFn.mockReturnValueOnce(
			ResultAsync.fromPromise(deferred.promise, (error) =>
				error instanceof Error ? error : new Error(String(error))
			)
		);

		const first = new PreconnectionCapabilitiesState(fetchFn);
		const second = new PreconnectionCapabilitiesState(fetchFn);

		const firstRequest = first.ensureLoaded({
			agentId: "claude-code",
			hasConnectedSession: false,
			projectPath: null,
			preconnectionCapabilityMode: "startupGlobal",
		});
		const secondRequest = second.ensureLoaded({
			agentId: "claude-code",
			hasConnectedSession: false,
			projectPath: null,
			preconnectionCapabilityMode: "startupGlobal",
		});

		expect(fetchFn).toHaveBeenCalledTimes(1);
		deferred.resolve(makeResolvedCapabilities());

		const firstResult = await firstRequest;
		const secondResult = await secondRequest;
		expect(firstResult.isOk()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		expect(first.loadingCacheKey).toBeNull();
		expect(second.loadingCacheKey).toBeNull();
	});

	it("force refreshes capabilities that were cached before an agent install", async () => {
		const beforeInstall = makeResolvedCapabilities("fable", "Fable");
		const afterInstall = makeResolvedCapabilities("claude-opus-4-8", "Claude Opus 4.8");
		fetchFn.mockReturnValueOnce(okAsync(beforeInstall));
		fetchFn.mockReturnValueOnce(okAsync(afterInstall));

		const state = new PreconnectionCapabilitiesState(fetchFn);
		await state.ensureLoaded({
			agentId: "claude-code",
			hasConnectedSession: false,
			projectPath: null,
			preconnectionCapabilityMode: "startupGlobal",
		});
		const refreshResult = await state.ensureLoaded(
			{
				agentId: "claude-code",
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode: "startupGlobal",
			},
			{ force: true }
		);

		expect(refreshResult.isOk()).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(
			state.getCapabilities({
				agentId: "claude-code",
				projectPath: null,
				preconnectionCapabilityMode: "startupGlobal",
			})
		).toEqual(afterInstall);
	});
});
