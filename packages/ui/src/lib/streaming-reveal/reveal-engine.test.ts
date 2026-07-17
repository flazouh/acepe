import { describe, expect, it } from "bun:test";

import {
	createRevealController,
	type RevealControllerOptions,
	type RevealMode,
	type RevealState,
} from "./reveal-engine.js";

/**
 * Deterministic harness: a fake clock plus a manual frame pump. `pump(dt)`
 * advances time by `dt` ms and fires exactly the frames scheduled before this
 * pump; frames the engine schedules during the pump run on the next one — the
 * same ordering a real rAF loop gives.
 */
function harness(
	opts: Omit<
		RevealControllerOptions,
		"onUpdate" | "now" | "scheduleFrame" | "cancelFrame"
	>,
) {
	let t = 0;
	let nextHandle = 1;
	const queued = new Map<number, (nowMs: number) => void>();
	const updates: RevealState[] = [];

	const ctrl = createRevealController({
		...opts,
		onUpdate: (state) => updates.push(state),
		now: () => t,
		scheduleFrame: (cb) => {
			const h = nextHandle++;
			queued.set(h, cb);
			return h;
		},
		cancelFrame: (h) => {
			queued.delete(h);
		},
	});

	function pump(dtMs: number): void {
		t += dtMs;
		const batch = [...queued.entries()];
		for (const [h, cb] of batch) {
			queued.delete(h);
			cb(t);
		}
	}

	/** Pump N frames of `dtMs` each (default 16ms ≈ 60fps). */
	function pumpFrames(count: number, dtMs = 16): void {
		for (let i = 0; i < count; i += 1) pump(dtMs);
	}

	return {
		ctrl,
		updates,
		pump,
		pumpFrames,
		last: () => updates[updates.length - 1],
		pending: () => queued.size,
	};
}

const A100 = "a".repeat(100);

describe("createRevealController — passthrough modes", () => {
	for (const mode of ["instant", "block-fade"] as RevealMode[]) {
		it(`${mode} reveals the whole push immediately, no frames`, () => {
			const h = harness({ mode });
			h.ctrl.push("hello world");
			expect(h.last().visibleText).toBe("hello world");
			expect(h.pending()).toBe(0); // never scheduled a frame
		});
	}

	it("reducedMotion forces passthrough even in a streaming mode", () => {
		const h = harness({ mode: "buffer", reducedMotion: true });
		h.ctrl.push(A100);
		expect(h.last().visibleText).toBe(A100);
		expect(h.pending()).toBe(0);
	});
});

describe("createRevealController — buffer drip", () => {
	it("does not paint the whole burst at once", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push(A100);
		h.pump(16); // first frame: baseline only, reveals nothing
		expect(h.updates.length).toBe(0);
		h.pump(16); // second frame: first real reveal
		const v = h.last().visibleText.length;
		expect(v).toBeGreaterThan(0);
		expect(v).toBeLessThan(100);
	});

	it("drains a full burst over roughly drainMs", () => {
		const h = harness({ mode: "buffer", drainMs: 450, maxCharIntervalMs: 5 });
		h.ctrl.push(A100);
		// 100 chars, msPerChar clamped to 5 → ~500ms. Pump ~34 frames of 16ms.
		h.pumpFrames(34);
		expect(h.last().visibleText).toBe(A100);
	});

	it("reveals contiguous, non-overlapping justRevealed ranges covering the text", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push(A100);
		h.pumpFrames(40);
		let cursor = 0;
		for (const u of h.updates) {
			if (u.justRevealed === null) continue;
			expect(u.justRevealed[0]).toBe(cursor);
			expect(u.justRevealed[1]).toBeGreaterThan(u.justRevealed[0]);
			cursor = u.justRevealed[1];
		}
		expect(cursor).toBe(100);
	});

	it("keeps dripping across successive bursts (loop restarts on push)", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push("a".repeat(20));
		h.pumpFrames(20); // drain first burst
		expect(h.last().visibleText.length).toBe(20);
		h.ctrl.push("b".repeat(20)); // second burst after idle
		h.pumpFrames(20);
		expect(h.last().visibleText).toBe("a".repeat(20) + "b".repeat(20));
	});
});

describe("createRevealController — backlog cap", () => {
	it("snaps a paste past maxBacklogChars forward instead of dripping it all", () => {
		const h = harness({ mode: "buffer", maxBacklogChars: 100 });
		h.ctrl.push("x".repeat(1000));
		h.pump(16); // baseline
		h.pump(16); // first reveal snaps the 900-char overflow
		expect(h.last().visibleText.length).toBeGreaterThanOrEqual(900);
		expect(h.last().visibleText.length).toBeLessThan(1000);
	});
});

describe("createRevealController — flush / end lifecycle", () => {
	it("flush reveals everything immediately and cancels the loop", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push(A100);
		h.pump(16);
		h.ctrl.flush();
		expect(h.last().visibleText).toBe(A100);
		expect(h.pending()).toBe(0);
	});

	it("end() with no backlog marks done at once", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push("hi");
		h.ctrl.flush();
		h.ctrl.end();
		expect(h.last().done).toBe(true);
	});

	it("end() with backlog drains first, then flips done", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push(A100);
		h.ctrl.end();
		expect(h.last()?.done ?? false).toBe(false); // not done yet
		h.pumpFrames(40);
		expect(h.last().visibleText).toBe(A100);
		expect(h.last().done).toBe(true);
	});

	it("ignores input after done", () => {
		const h = harness({ mode: "buffer" });
		h.ctrl.push("hi");
		h.ctrl.flush();
		h.ctrl.end();
		h.ctrl.push(" more");
		expect(h.last().visibleText).toBe("hi");
	});
});

describe("createRevealController — code points", () => {
	it("counts an emoji surrogate pair as one reveal step, never splitting it", () => {
		// drainMs high so the per-char interval is pinned to the 1000ms cap:
		// exactly one code point per 1000ms elapsed. 🎉 is one code point / two UTF-16 units.
		const h = harness({ mode: "buffer", maxCharIntervalMs: 1000, drainMs: 1_000_000 });
		h.ctrl.push("a🎉b");
		h.pump(16); // baseline
		h.pump(1000); // exactly one code point
		expect(h.last().visibleText).toBe("a");
		h.pump(1000);
		expect(h.last().visibleText).toBe("a🎉"); // whole emoji, no lone surrogate
		expect([...h.last().visibleText]).toHaveLength(2);
	});
});
