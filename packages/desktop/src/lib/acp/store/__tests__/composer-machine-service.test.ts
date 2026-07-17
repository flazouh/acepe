import { describe, expect, it } from "vitest";

import {
	ComposerMachineService,
	type ComposerSessionCommitState,
} from "../composer-machine-service.svelte.js";
import type { LiveSessionLifecyclePresentation } from "$lib/acp/store/live-session-work.js";
import { SessionTransientProjectionStore } from "../session-transient-projection-store.svelte.js";

function makeCommitState(
	modeId: string | null = null,
	modelId: string | null = null,
	autonomousEnabled: boolean | null = false
): ComposerSessionCommitState {
	return {
		modeId,
		modelId,
		autonomousEnabled,
	};
}

function makeService(
	getCommitState: (sessionId: string) => ComposerSessionCommitState = () => makeCommitState()
): ComposerMachineService {
	const transientProjectionStore = new SessionTransientProjectionStore();
	return new ComposerMachineService({
		getCommitState,
		transientProjectionStore,
		getSessionLifecyclePresentation: () =>
			({
				canSubmit: true,
				connectionPhase: "connected",
				activityPhase: "idle",
			}) as LiveSessionLifecyclePresentation,
	});
}

describe("ComposerMachineService", () => {
	it("creates a reactive snapshot for a session id", () => {
		const service = makeService(() => makeCommitState("build", "m1", false));
		service.createOrGetActor("s1");
		const snap = service.getState("s1");
		expect(snap).not.toBeNull();
		expect(snap?.value).toBe("interactive");
	});

	it("removes actor and snapshot cache on removeMachine", () => {
		const service = makeService();
		service.createOrGetActor("s1");
		expect(service.getState("s1")).not.toBeNull();
		service.removeMachine("s1");
		expect(service.getState("s1")).toBeNull();
	});

	it("binds unknown autonomous state without coercing it to false", () => {
		const service = makeService(() => makeCommitState("build", "m1", null));
		service.bindSession("s1");

		expect(service.getState("s1")?.context.committedAutonomousEnabled).toBeNull();
	});

	it("does not apply bindSession while dispatching", () => {
		const service = makeService(() => makeCommitState("build", "m1", false));
		service.createOrGetActor("s1");
		service.bindSession("s1");
		const genBefore = service.getState("s1")!.context.boundGeneration;
		service.beginDispatch("s1");
		expect(service.getState("s1")?.value).toBe("dispatching");
		service.bindSession("s1");
		expect(service.getState("s1")?.value).toBe("dispatching");
		expect(service.getState("s1")?.context.boundGeneration).toBe(genBefore);
	});

	it("endDispatch is idempotent", () => {
		const service = makeService();
		service.createOrGetActor("s1");
		service.beginDispatch("s1");
		service.endDispatch("s1");
		expect(service.getState("s1")?.value).toBe("interactive");
		service.endDispatch("s1");
		expect(service.getState("s1")?.value).toBe("interactive");
	});

	it("keeps accepted provisional config after success until canonical projection rebinds", async () => {
		const service = makeService(() => makeCommitState("plan", "m1", true));
		const ok = await service.runConfigOperation(
			"s1",
			{
				provisionalModeId: "build",
				provisionalModelId: "m2",
				provisionalAutonomousEnabled: false,
			},
			async () => true
		);
		expect(ok).toBe(true);
		expect(service.getState("s1")?.value).toBe("interactive");
		const snap = service.getState("s1")!;
		expect(snap.context.committedModeId).toBe("build");
		expect(snap.context.committedModelId).toBe("m2");
		expect(snap.context.committedAutonomousEnabled).toBe(false);
	});

	it("does not mutate committed autonomous state until the config operation commits", async () => {
		let canonicalState = makeCommitState("build", "m1", false);
		const service = makeService(() => canonicalState);
		service.bindSession("s1");
		expect(service.getState("s1")?.context.committedAutonomousEnabled).toBe(false);

		let resolveOperation: (value: boolean) => void = () => {};
		const operation = new Promise<boolean>((resolve) => {
			resolveOperation = resolve;
		});
		const runPromise = service.runConfigOperation(
			"s1",
			{ provisionalModeId: "build", provisionalModelId: "m1", provisionalAutonomousEnabled: true },
			() => operation
		);
		canonicalState = makeCommitState("build", "m1", true);
		expect(service.getState("s1")?.context.committedAutonomousEnabled).toBe(false);

		resolveOperation(true);
		await runPromise;
		expect(service.getState("s1")?.context.committedAutonomousEnabled).toBe(true);
	});

	it("aborts runConfigOperation when CONFIG_BLOCK_BEGIN cannot apply", async () => {
		const service = makeService(() => makeCommitState("build", "m1", false));
		service.createOrGetActor("s1");
		service.beginDispatch("s1");
		const ok = await service.runConfigOperation(
			"s1",
			{
				provisionalModeId: "plan",
				provisionalModelId: "m1",
				provisionalAutonomousEnabled: false,
			},
			async () => true
		);
		expect(ok).toBe(false);
		expect(service.getState("s1")?.value).toBe("dispatching");
	});

	it("invalidates async config completion after bind bumps generation", async () => {
		const service = makeService((id) =>
			id === "s1" ? makeCommitState("build", "m1", false) : makeCommitState()
		);
		let resolveOp: (value: boolean) => void = () => {};
		const operation = new Promise<boolean>((resolve) => {
			resolveOp = resolve;
		});
		const runPromise = service.runConfigOperation(
			"s1",
			{ provisionalModeId: "plan", provisionalModelId: "m1", provisionalAutonomousEnabled: false },
			() => operation
		);
		service.bindSession("s1");
		resolveOp(true);
		const ok = await runPromise;
		expect(ok).toBe(false);
	});
});
