import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { composerMachine } from "../composer-machine.js";
import { deriveStoreComposerState } from "../composer-ui-state.js";
import type { SessionRuntimeState } from "../session-ui-state.js";

function disconnectedLoadedRuntime(): SessionRuntimeState {
	return {
		connectionPhase: "disconnected",
		contentPhase: "loaded",
		activityPhase: "idle",
		canSubmit: true,
		canCancel: false,
		showStop: false,
		showThinking: false,
		showConnectingOverlay: false,
		showConversation: true,
		showReadyPlaceholder: false,
	};
}

describe("composer machine", () => {
	it("allows send affordance when idle and runtime permits submit", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		const store = deriveStoreComposerState({
			machineSnapshot: actor.getSnapshot(),
			runtime: disconnectedLoadedRuntime(),
		});
		expect(store.isBlocked).toBe(false);
		expect(store.isDispatching).toBe(false);
		expect(store.canSubmit).toBe(true);
	});

	it("blocks submit while config is blocking", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		actor.send({
			type: "CONFIG_BLOCK_BEGIN",
			provisionalModeId: "plan",
			provisionalModelId: "m1",
			provisionalAutonomousEnabled: false,
		});
		const store = deriveStoreComposerState({
			machineSnapshot: actor.getSnapshot(),
			runtime: disconnectedLoadedRuntime(),
		});
		expect(store.isBlocked).toBe(true);
		expect(store.canSubmit).toBe(false);
		expect(store.selectorsDisabled).toBe(true);
	});

	it("clears blocking on CONFIG_BLOCK_FAIL", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		actor.send({
			type: "CONFIG_BLOCK_BEGIN",
			provisionalModeId: "plan",
			provisionalModelId: "m1",
			provisionalAutonomousEnabled: false,
		});
		actor.send({ type: "CONFIG_BLOCK_FAIL" });
		const store = deriveStoreComposerState({
			machineSnapshot: actor.getSnapshot(),
			runtime: disconnectedLoadedRuntime(),
		});
		expect(store.isBlocked).toBe(false);
		expect(store.provisionalModeId).toBeNull();
	});

	it("increments boundGeneration on SESSION_BOUND for stale-effect tests", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		const g0 = actor.getSnapshot().context.boundGeneration;
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		const g1 = actor.getSnapshot().context.boundGeneration;
		expect(g1).toBe(g0 + 1);
	});

	it("ignores SESSION_BOUND while dispatching", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		actor.send({ type: "DISPATCH_BEGIN" });
		expect(actor.getSnapshot().value).toBe("dispatching");
		const gen = actor.getSnapshot().context.boundGeneration;
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "other",
			committedModelId: "m2",
			committedAutonomousEnabled: true,
		});
		expect(actor.getSnapshot().value).toBe("dispatching");
		expect(actor.getSnapshot().context.boundGeneration).toBe(gen);
	});

	it("applies CONFIG_BLOCK_SUCCESS with committed config and returns to interactive", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		actor.send({
			type: "CONFIG_BLOCK_BEGIN",
			provisionalModeId: "plan",
			provisionalModelId: "m1",
			provisionalAutonomousEnabled: false,
		});
		actor.send({
			type: "CONFIG_BLOCK_SUCCESS",
			committedModeId: "plan",
			committedModelId: "m2",
			committedAutonomousEnabled: true,
		});
		expect(actor.getSnapshot().value).toBe("interactive");
		const ctx = actor.getSnapshot().context;
		expect(ctx.committedModeId).toBe("plan");
		expect(ctx.committedModelId).toBe("m2");
		expect(ctx.committedAutonomousEnabled).toBe(true);
		expect(ctx.provisionalModeId).toBeNull();
	});

	it("resets blocking state when rebinding session", () => {
		const actor = createActor(composerMachine, { input: { sessionId: "s1" } });
		actor.start();
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: false,
		});
		actor.send({
			type: "CONFIG_BLOCK_BEGIN",
			provisionalModeId: "plan",
			provisionalModelId: "m1",
			provisionalAutonomousEnabled: false,
		});
		expect(actor.getSnapshot().value).toBe("configBlocking");
		actor.send({
			type: "SESSION_BOUND",
			committedModeId: "build",
			committedModelId: "m1",
			committedAutonomousEnabled: true,
		});
		expect(actor.getSnapshot().value).toBe("interactive");
		const store = deriveStoreComposerState({
			machineSnapshot: actor.getSnapshot(),
			runtime: disconnectedLoadedRuntime(),
		});
		expect(store.isBlocked).toBe(false);
		expect(store.committedAutonomousEnabled).toBe(true);
	});
});
