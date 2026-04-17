import { beforeEach, describe, expect, it } from "vitest";

import { streamingTailRefresh } from "../streaming-tail-refresh.js";

function createRefreshNode(): HTMLDivElement {
	return document.createElement("div");
}

describe("streamingTailRefresh", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("sets data-streaming-active when mounted with active content", () => {
		const node = createRefreshNode();

		streamingTailRefresh(node, { active: true, value: "Hello" });

		expect(node.dataset.streamingActive).toBe("true");
	});

	it("does not set data-streaming-active when mounted inactive", () => {
		const node = createRefreshNode();

		streamingTailRefresh(node, { active: false, value: "Hello" });

		expect(node.dataset.streamingActive).toBeUndefined();
	});

	it("does not set data-streaming-active when value is empty", () => {
		const node = createRefreshNode();

		streamingTailRefresh(node, { active: true, value: "" });

		expect(node.dataset.streamingActive).toBeUndefined();
	});

	it("removes data-streaming-active when updated to inactive", () => {
		const node = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		expect(node.dataset.streamingActive).toBe("true");

		action.update({ active: false, value: "Hello" });

		expect(node.dataset.streamingActive).toBeUndefined();
	});

	it("keeps data-streaming-active when active section value grows", () => {
		const node = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.update({ active: true, value: "Hello world" });

		expect(node.dataset.streamingActive).toBe("true");
	});

	it("sets data-streaming-active when section becomes active again", () => {
		const node = createRefreshNode();
		const action = streamingTailRefresh(node, { active: false, value: "Hello" });

		expect(node.dataset.streamingActive).toBeUndefined();

		action.update({ active: true, value: "Hello" });

		expect(node.dataset.streamingActive).toBe("true");
	});

	it("removes data-streaming-active on destroy", () => {
		const node = createRefreshNode();
		const action = streamingTailRefresh(node, { active: true, value: "Hello" });

		action.destroy();

		expect(node.dataset.streamingActive).toBeUndefined();
	});

});
