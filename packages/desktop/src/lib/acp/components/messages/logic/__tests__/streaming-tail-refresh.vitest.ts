import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_REFRESH_CLASS, SMOOTH_FADE_CLASS, streamingTailRefresh } from "../streaming-tail-refresh.js";

let rafCallbacks: FrameRequestCallback[] = [];

function flushRaf(): void {
	const cbs = rafCallbacks.splice(0);
	for (const cb of cbs) {
		cb(performance.now());
	}
}

function createRefreshNode(): {
	node: HTMLDivElement;
} {
	const node = document.createElement("div");

	return { node };
}

describe("streamingTailRefresh", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		rafCallbacks = [];
		vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
			rafCallbacks.push(cb);
			return rafCallbacks.length;
		});
	});

	it("starts the refresh animation when mounted with active content", () => {
		const { node } = createRefreshNode();

		streamingTailRefresh(node, { active: true, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
	});

	it("does not restart the animation when the active value is unchanged", () => {
		const { node } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: true, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
	});

	it("keeps the refresh class active without forcing reflow when the live value changes", () => {
		const { node } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: true, value: "Hello world" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
	});

	it("restarts the animation when the section becomes active again", () => {
		const { node } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: false, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);

		action.update({ active: true, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
	});

	it("removes the refresh class when deactivated and destroyed", () => {
		const { node } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: false, value: "Hello" });
		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);

		action.destroy();
		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);
	});

	describe("smooth mode", () => {
		it("applies smooth fade class instead of live-refresh on mount", () => {
			const { node } = createRefreshNode();

			streamingTailRefresh(node, { active: true, value: "Hello", mode: "smooth" });
			flushRaf();

			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(true);
			expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);
		});

		it("re-applies smooth fade on content update", () => {
			const { node } = createRefreshNode();
			const action = streamingTailRefresh(node, { active: true, value: "Hello", mode: "smooth" });
			flushRaf();

			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(true);

			node.classList.remove(SMOOTH_FADE_CLASS);
			action.update({ active: true, value: "Hello world", mode: "smooth" });
			flushRaf();

			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(true);
			expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);
		});

		it("removes both classes when deactivated", () => {
			const { node } = createRefreshNode();
			const action = streamingTailRefresh(node, { active: true, value: "Hello", mode: "smooth" });
			flushRaf();

			action.update({ active: false, value: "Hello", mode: "smooth" });

			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(false);
			expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);
		});

		it("transitions from smooth to classic: removes smooth fade, adds live-refresh", () => {
			const { node } = createRefreshNode();
			const action = streamingTailRefresh(node, { active: true, value: "Hello", mode: "smooth" });
			flushRaf();

			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(true);

			action.update({ active: true, value: "Hello world", mode: "classic" });

			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(false);
			expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
		});

		it("transitions from classic to smooth: removes live-refresh, adds smooth fade", () => {
			const { node } = createRefreshNode();
			const action = streamingTailRefresh(node, { active: true, value: "Hello", mode: "classic" });

			expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);

			action.update({ active: true, value: "Hello world", mode: "smooth" });
			flushRaf();

			expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);
			expect(node.classList.contains(SMOOTH_FADE_CLASS)).toBe(true);
		});

		it("sets data-streaming-animation-mode attribute", () => {
			const { node } = createRefreshNode();
			const action = streamingTailRefresh(node, { active: true, value: "Hello", mode: "smooth" });

			expect(node.dataset.streamingAnimationMode).toBe("smooth");

			action.update({ active: true, value: "Hello", mode: "classic" });
			expect(node.dataset.streamingAnimationMode).toBe("classic");
		});
	});
});
