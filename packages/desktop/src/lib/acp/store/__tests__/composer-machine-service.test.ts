import { describe, expect, it } from "vitest";

import { ComposerMachineService } from "../composer-machine-service.svelte.js";
import type { SessionHotState } from "../types.js";
import { DEFAULT_HOT_STATE } from "../types.js";

function makeHot(overrides: Partial<SessionHotState> = {}): SessionHotState {
	return { ...DEFAULT_HOT_STATE, ...overrides };
}

describe("ComposerMachineService", () => {
	it("creates a reactive snapshot for a session id", () => {
		const hot = makeHot({
			currentMode: { id: "build", name: "Build" },
			currentModel: { id: "m1", name: "M1" },
			autonomousEnabled: false,
		});
		const service = new ComposerMachineService(() => hot);
		service.createOrGetActor("s1");
		const snap = service.getState("s1");
		expect(snap).not.toBeNull();
		expect(snap?.value).toBe("interactive");
	});

	it("removes actor and snapshot cache on removeMachine", () => {
		const hot = makeHot();
		const service = new ComposerMachineService(() => hot);
		service.createOrGetActor("s1");
		expect(service.getState("s1")).not.toBeNull();
		service.removeMachine("s1");
		expect(service.getState("s1")).toBeNull();
	});

	it("does not apply bindSession while dispatching", () => {
		const hot = makeHot({
			currentMode: { id: "build", name: "Build" },
			currentModel: { id: "m1", name: "M1" },
			autonomousEnabled: false,
		});
		const service = new ComposerMachineService(() => hot);
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
		const service = new ComposerMachineService(() => makeHot());
		service.createOrGetActor("s1");
		service.beginDispatch("s1");
		service.endDispatch("s1");
		expect(service.getState("s1")?.value).toBe("interactive");
		service.endDispatch("s1");
		expect(service.getState("s1")?.value).toBe("interactive");
	});

	it("completes runConfigOperation on success", async () => {
		const hot = makeHot({
			currentMode: { id: "plan", name: "Plan" },
			currentModel: { id: "m1", name: "M1" },
			autonomousEnabled: true,
		});
		const service = new ComposerMachineService(() => hot);
		const ok = await service.runConfigOperation(
			"s1",
			{
				provisionalModeId: "build",
				provisionalModelId: "m1",
				provisionalAutonomousEnabled: false,
			},
			async () => true
		);
		expect(ok).toBe(true);
		expect(service.getState("s1")?.value).toBe("interactive");
		const snap = service.getState("s1")!;
		expect(snap.context.committedModeId).toBe("plan");
		expect(snap.context.committedModelId).toBe("m1");
	});

	it("aborts runConfigOperation when CONFIG_BLOCK_BEGIN cannot apply", async () => {
		const hot = makeHot({
			currentMode: { id: "build", name: "Build" },
			currentModel: { id: "m1", name: "M1" },
			autonomousEnabled: false,
		});
		const service = new ComposerMachineService(() => hot);
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
		const hotState = makeHot({
			currentMode: { id: "build", name: "Build" },
			currentModel: { id: "m1", name: "M1" },
			autonomousEnabled: false,
		});
		const service = new ComposerMachineService((id) =>
			id === "s1" ? hotState : makeHot()
		);
		let resolveOp: (v: boolean) => void = () => {};
		const p = new Promise<boolean>((r) => {
			resolveOp = r;
		});
		const runPromise = service.runConfigOperation(
			"s1",
			{ provisionalModeId: "plan", provisionalModelId: "m1", provisionalAutonomousEnabled: false },
			() => p
		);
		service.bindSession("s1");
		resolveOp(true);
		const ok = await runPromise;
		expect(ok).toBe(false);
	});
});
