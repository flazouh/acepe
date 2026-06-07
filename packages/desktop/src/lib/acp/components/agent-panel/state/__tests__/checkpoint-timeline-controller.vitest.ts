import { describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "../../../../types/checkpoint.js";
import { CheckpointTimelineController } from "../checkpoint-timeline-controller.svelte.js";

/**
 * Vitest (not Bun) because the controller uses Svelte 5 runes — same harness
 * rationale as AgentPanelSessionController. Reactive sessionId is supplied via
 * an accessor a test mutates through a holder.
 */
describe("CheckpointTimelineController", () => {
	const cp = (id: string): Checkpoint => ({ id }) as unknown as Checkpoint;

	const make = (
		initial: { sessionId?: string | null } = {},
		overrides: Partial<{
			getCheckpoints: (sessionId: string) => Checkpoint[];
			loadCheckpoints: (sessionId: string) => Promise<void>;
		}> = {}
	) => {
		const holder = { sessionId: initial.sessionId ?? (null as string | null) };
		const loadCheckpoints = overrides.loadCheckpoints ?? vi.fn(async () => {});
		const controller = new CheckpointTimelineController({
			getSessionId: () => holder.sessionId,
			getCheckpoints: overrides.getCheckpoints ?? (() => []),
			loadCheckpoints,
		});
		return { controller, holder, loadCheckpoints };
	};

	it("starts closed and not loading", () => {
		const { controller } = make({ sessionId: "s1" });
		expect(controller.isOpen).toBe(false);
		expect(controller.isLoading).toBe(false);
	});

	it("returns [] when there is no session", () => {
		const { controller } = make(
			{ sessionId: null },
			{ getCheckpoints: () => [cp("c1")] }
		);
		expect(controller.checkpoints).toEqual([]);
	});

	it("derives checkpoints from the store for the active session", () => {
		const { controller } = make(
			{ sessionId: "s1" },
			{ getCheckpoints: (id) => (id === "s1" ? [cp("c1"), cp("c2")] : []) }
		);
		expect(controller.checkpoints).toEqual([cp("c1"), cp("c2")]);
	});

	it("loads before opening, then opens", async () => {
		const { controller, loadCheckpoints } = make({ sessionId: "s1" });
		await controller.toggle();
		expect(loadCheckpoints).toHaveBeenCalledWith("s1");
		expect(controller.isOpen).toBe(true);
		expect(controller.isLoading).toBe(false);
	});

	it("shows loading while the checkpoint load is in flight", async () => {
		let resolve!: () => void;
		const pending = new Promise<void>((r) => {
			resolve = r;
		});
		const { controller } = make({ sessionId: "s1" }, { loadCheckpoints: () => pending });
		const toggled = controller.toggle();
		expect(controller.isLoading).toBe(true);
		resolve();
		await toggled;
		expect(controller.isLoading).toBe(false);
		expect(controller.isOpen).toBe(true);
	});

	it("closes immediately without reloading", async () => {
		const { controller, loadCheckpoints } = make({ sessionId: "s1" });
		await controller.toggle(); // open (1 load)
		await controller.toggle(); // close (no extra load)
		expect(controller.isOpen).toBe(false);
		expect(loadCheckpoints).toHaveBeenCalledTimes(1);
	});

	it("close() forces the timeline shut", async () => {
		const { controller } = make({ sessionId: "s1" });
		await controller.toggle();
		controller.close();
		expect(controller.isOpen).toBe(false);
	});

	it("is a no-op without a session", async () => {
		const { controller, loadCheckpoints } = make({ sessionId: null });
		await controller.toggle();
		expect(loadCheckpoints).not.toHaveBeenCalled();
		expect(controller.isOpen).toBe(false);
	});
});
