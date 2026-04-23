import { ResultAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedCapabilities } from "$lib/services/acp-types.js";
import { BUILTIN_PROVIDER_METADATA_BY_AGENT_ID } from "$lib/services/acp-provider-metadata.js";
import { PreconnectionCapabilitiesState, resetForTesting } from "./preconnection-capabilities-state.svelte.js";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function makeResolvedCapabilities(): ResolvedCapabilities {
	return {
		status: "resolved",
		availableModels: [{ modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
		currentModelId: "claude-sonnet-4-6",
		modelsDisplay: {
			groups: [
				{
					label: "",
					models: [{ modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" }],
				},
			],
			presentation: undefined,
		},
		providerMetadata: BUILTIN_PROVIDER_METADATA_BY_AGENT_ID["claude-code"],
		availableModes: [{ id: "build", name: "Build" }],
		currentModeId: "build",
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
});
