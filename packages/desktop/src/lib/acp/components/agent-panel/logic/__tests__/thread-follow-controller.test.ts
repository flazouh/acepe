import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import {
	ThreadFollowController,
	type ThreadRevealTargetHandle,
} from "../thread-follow-controller.svelte.js";

/**
 * Mock requestAnimationFrame to run callbacks synchronously for testability.
 */
const originalRAF = globalThis.requestAnimationFrame;
const originalCancelRAF = globalThis.cancelAnimationFrame;

let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;

function installSyncRAF(): void {
	rafCallbacks = [];
	nextRafId = 1;
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
		const id = nextRafId++;
		// Run synchronously to make tests deterministic
		cb(performance.now());
		return id;
	};
	globalThis.cancelAnimationFrame = (_id: number) => {
		// No-op since callbacks run synchronously
	};
}

function restoreRAF(): void {
	globalThis.requestAnimationFrame = originalRAF;
	globalThis.cancelAnimationFrame = originalCancelRAF;
}

function createOptions(overrides?: {
	isFollowing?: () => boolean;
	isNearBottom?: () => boolean;
	revealListBottom?: (force?: boolean) => boolean;
	getLatestTargetKey?: () => string | null;
	getLatestUserTargetKey?: () => string | null;
}) {
	return {
		isFollowing: overrides?.isFollowing ?? (() => true),
		isNearBottom: overrides?.isNearBottom ?? (() => false),
		revealListBottom: overrides?.revealListBottom ?? mock(() => true),
		getLatestTargetKey: overrides?.getLatestTargetKey ?? (() => null),
		getLatestUserTargetKey: overrides?.getLatestUserTargetKey ?? (() => null),
	};
}

function createHandle(overrides?: {
	reveal?: (force?: boolean) => boolean;
	isMounted?: () => boolean;
}): ThreadRevealTargetHandle & { reveal: ReturnType<typeof mock> } {
	return {
		reveal: overrides?.reveal ? mock(overrides.reveal) : mock(() => true),
		isMounted: overrides?.isMounted ?? (() => true),
	};
}

describe("ThreadFollowController", () => {
	beforeEach(() => {
		installSyncRAF();
	});

	afterEach(() => {
		restoreRAF();
	});

	describe("latest-key gating", () => {
		it("ignores requestReveal for non-latest keys", () => {
			const opts = createOptions({ getLatestTargetKey: () => "entry-2" });
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-1", handle);

			ctrl.requestReveal("entry-1");
			expect(handle.reveal).not.toHaveBeenCalled();
		});

		it("honors requestReveal for the latest key", () => {
			const opts = createOptions({ getLatestTargetKey: () => "entry-1" });
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-1", handle);

			ctrl.requestReveal("entry-1");
			expect(handle.reveal).toHaveBeenCalled();
		});

		it("ignores requestReveal when latestTargetKey is null", () => {
			const revealListBottom = mock(() => true);
			const opts = createOptions({ revealListBottom });
			const ctrl = new ThreadFollowController(opts);

			ctrl.requestReveal("entry-1");
			expect(revealListBottom).not.toHaveBeenCalled();
		});
	});

	describe("force accumulation", () => {
		it("reveals with force when forced", () => {
			const opts = createOptions({
				isFollowing: () => false,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-1", handle);

			ctrl.requestReveal("entry-1", { force: true });
			expect(handle.reveal).toHaveBeenCalledWith(true);
		});

		it("skips reveal when not following and not forced", () => {
			const opts = createOptions({
				isFollowing: () => false,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-1", handle);

			ctrl.requestReveal("entry-1");
			expect(handle.reveal).not.toHaveBeenCalled();
		});
	});

	describe("fallback to revealListBottom", () => {
		it("falls back when target handle is not registered", () => {
			const revealListBottom = mock(() => true);
			const opts = createOptions({
				revealListBottom,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			ctrl.requestReveal("entry-1");
			expect(revealListBottom).toHaveBeenCalled();
		});

		it("falls back when target handle is not mounted", () => {
			const revealListBottom = mock(() => true);
			const opts = createOptions({
				revealListBottom,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle({ isMounted: () => false });
			ctrl.registerTarget("entry-1", handle);

			ctrl.requestReveal("entry-1");
			expect(handle.reveal).not.toHaveBeenCalled();
			expect(revealListBottom).toHaveBeenCalled();
		});

		it("falls back for requestLatestReveal when no handle registered", () => {
			const revealListBottom = mock(() => true);
			const opts = createOptions({
				revealListBottom,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			ctrl.requestLatestReveal();
			expect(revealListBottom).toHaveBeenCalled();
		});
	});

	describe("registration and deregistration", () => {
		it("returns a cleanup function that removes the target", () => {
			const revealListBottom = mock(() => true);
			const opts = createOptions({
				revealListBottom,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			const cleanup = ctrl.registerTarget("entry-1", handle);
			handle.reveal.mockClear();

			cleanup();

			ctrl.requestReveal("entry-1");
			expect(handle.reveal).not.toHaveBeenCalled();
			expect(revealListBottom).toHaveBeenCalled();
		});

		it("does not remove a re-registered handle when old cleanup is called", () => {
			const opts = createOptions({ getLatestTargetKey: () => "entry-1" });
			const ctrl = new ThreadFollowController(opts);

			const handle1 = createHandle();
			const cleanup1 = ctrl.registerTarget("entry-1", handle1);
			handle1.reveal.mockClear();

			const handle2 = createHandle();
			ctrl.registerTarget("entry-1", handle2);
			handle2.reveal.mockClear();

			cleanup1();

			ctrl.requestReveal("entry-1");
			expect(handle2.reveal).toHaveBeenCalled();
			expect(handle1.reveal).not.toHaveBeenCalled();
		});
	});

	describe("reset", () => {
		it("clears targets and pending state", () => {
			const revealListBottom = mock(() => true);
			const opts = createOptions({
				revealListBottom,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-1", handle);
			handle.reveal.mockClear();

			ctrl.reset();

			// After reset, the registry is empty — requestReveal falls back to list bottom.
			ctrl.requestReveal("entry-1");
			expect(handle.reveal).not.toHaveBeenCalled();
			expect(revealListBottom).toHaveBeenCalled();
		});
	});

	describe("generation counter (session switch safety)", () => {
		it("stops retry loop when generation changes mid-reveal", () => {
			let callCount = 0;
			const revealListBottom = mock(() => {
				callCount++;
				if (callCount === 1) {
					ctrl.reset();
				}
				return true;
			});
			const opts = createOptions({
				revealListBottom,
				isNearBottom: () => false,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			ctrl.requestLatestReveal();

			// revealListBottom was called once, but the retry loop stopped
			// because reset() incremented the generation counter
			expect(callCount).toBe(1);
		});
	});

	describe("requestLatestReveal", () => {
		it("uses latestTargetKey for the pending target", () => {
			const opts = createOptions({ getLatestTargetKey: () => "entry-3" });
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-3", handle);

			ctrl.requestLatestReveal();
			expect(handle.reveal).toHaveBeenCalled();
		});

		it("passes force through to handle.reveal", () => {
			const opts = createOptions({
				isFollowing: () => false,
				getLatestTargetKey: () => "entry-1",
			});
			const ctrl = new ThreadFollowController(opts);

			const handle = createHandle();
			ctrl.registerTarget("entry-1", handle);

			ctrl.requestLatestReveal({ force: true });
			expect(handle.reveal).toHaveBeenCalledWith(true);
		});
	});

	describe("prepareForNextLatestReveal", () => {
		it("forces reveal when the next latest target registers", () => {
			let latestTargetKey = "entry-1";
			const opts = createOptions({
				getLatestTargetKey: () => latestTargetKey,
			});
			const ctrl = new ThreadFollowController(opts);

			const currentHandle = createHandle();
			ctrl.registerTarget("entry-1", currentHandle);
			currentHandle.reveal.mockClear();

			ctrl.prepareForNextLatestReveal({ force: true });
			latestTargetKey = "entry-2";

			const nextHandle = createHandle();
			ctrl.registerTarget("entry-2", nextHandle);

			expect(nextHandle.reveal).toHaveBeenCalledWith(true);
			expect(currentHandle.reveal).not.toHaveBeenCalled();
		});
	});

	describe("prepareForNextUserReveal", () => {
		it("forces reveal when the newest user target registers even if it is not the latest display target", () => {
			const latestTargetKey = "thinking-indicator";
			let latestUserTargetKey = "entry-1";
			const opts = createOptions({
				getLatestTargetKey: () => latestTargetKey,
				getLatestUserTargetKey: () => latestUserTargetKey,
			});
			const ctrl = new ThreadFollowController(opts);

			const currentUserHandle = createHandle();
			ctrl.registerTarget("entry-1", currentUserHandle);
			currentUserHandle.reveal.mockClear();

			ctrl.prepareForNextUserReveal({ force: true });
			latestUserTargetKey = "entry-2";

			const nextUserHandle = createHandle();
			ctrl.registerTarget("entry-2", nextUserHandle);

			expect(nextUserHandle.reveal).toHaveBeenCalledWith(true);
			expect(currentUserHandle.reveal).not.toHaveBeenCalled();
		});
	});
});
