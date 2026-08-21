import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, type AppError } from "$lib/acp/errors/app-error.js";
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

function toAppError(error: unknown): AppError {
	if (error instanceof AgentError) {
		return error;
	}
	return new AgentError(
		"preconnection-capabilities",
		error instanceof Error ? error : new Error(String(error))
	);
}

async function runToResult<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
	return Effect.runPromise(Effect.result(effect));
}

describe("PreconnectionCapabilitiesState", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		resetForTesting();
		fetchFn.mockReset();
	});

	it("loads startup-global capabilities before a session exists", async () => {
		fetchFn.mockReturnValueOnce(Effect.succeed(makeResolvedCapabilities()));

		const state = new PreconnectionCapabilitiesState(fetchFn);
		const result = await runToResult(
			state.ensureLoaded({
				agentId: "claude-code",
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode: "startupGlobal",
			})
		);

		expect(Result.isSuccess(result)).toBe(true);
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
		fetchFn.mockReturnValueOnce(fromPromise(() => deferred.promise, toAppError));

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

		const firstResult = await runToResult(firstRequest);
		const secondResult = await runToResult(secondRequest);
		expect(Result.isSuccess(firstResult)).toBe(true);
		expect(Result.isSuccess(secondResult)).toBe(true);
		expect(first.loadingCacheKey).toBeNull();
		expect(second.loadingCacheKey).toBeNull();
	});

	it("force refreshes capabilities that were cached before an agent install", async () => {
		const beforeInstall = makeResolvedCapabilities("fable", "Fable");
		const afterInstall = makeResolvedCapabilities("claude-opus-4-8", "Claude Opus 4.8");
		fetchFn.mockReturnValueOnce(Effect.succeed(beforeInstall));
		fetchFn.mockReturnValueOnce(Effect.succeed(afterInstall));

		const state = new PreconnectionCapabilitiesState(fetchFn);
		await runToResult(
			state.ensureLoaded({
				agentId: "claude-code",
				hasConnectedSession: false,
				projectPath: null,
				preconnectionCapabilityMode: "startupGlobal",
			})
		);
		const refreshResult = await runToResult(
			state.ensureLoaded(
				{
					agentId: "claude-code",
					hasConnectedSession: false,
					projectPath: null,
					preconnectionCapabilityMode: "startupGlobal",
				},
				{ force: true }
			)
		);

		expect(Result.isSuccess(refreshResult)).toBe(true);
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
