import { beforeEach, describe, expect, it } from "vitest";

import { LIVE_REFRESH_CLASS, streamingTailRefresh } from "../streaming-tail-refresh.js";

function createRefreshNode(): {
	node: HTMLDivElement;
	getReflowCount: () => number;
} {
	const node = document.createElement("div");
	let reflowCount = 0;

	Object.defineProperty(node, "offsetWidth", {
		configurable: true,
		get() {
			reflowCount += 1;
			return 100;
		},
	});

	return {
		node,
		getReflowCount: () => reflowCount,
	};
}

describe("streamingTailRefresh", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("starts the refresh animation when mounted with active content", () => {
		const { node, getReflowCount } = createRefreshNode();

		streamingTailRefresh(node, { active: true, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
		expect(getReflowCount()).toBe(1);
	});

	it("does not restart the animation when the active value is unchanged", () => {
		const { node, getReflowCount } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: true, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
		expect(getReflowCount()).toBe(1);
	});

	it("restarts the animation when the live value changes", () => {
		const { node, getReflowCount } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: true, value: "Hello world" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
		expect(getReflowCount()).toBe(2);
	});

	it("restarts the animation when the section becomes active again", () => {
		const { node, getReflowCount } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: false, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);

		action.update({ active: true, value: "Hello" });

		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(true);
		expect(getReflowCount()).toBe(1);
	});

	it("removes the refresh class when deactivated and destroyed", () => {
		const { node } = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: false, value: "Hello" });
		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);

		action.destroy();
		expect(node.classList.contains(LIVE_REFRESH_CLASS)).toBe(false);
	});
});
