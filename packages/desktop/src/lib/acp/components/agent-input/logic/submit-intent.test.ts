import { describe, expect, it } from "vitest";

import { resolveEnterKeyIntent, resolvePrimaryButtonIntent } from "./submit-intent.js";

describe("submit intent", () => {
	it("queues on Enter while agent is busy", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
			})
		).toBe("send");
	});

	it("steers on Shift+Enter while agent is busy", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: true,
				metaKey: false,
				ctrlKey: false,
			})
		).toBe("steer");
	});

	it("keeps Shift+Enter as newline when agent is not busy", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: false,
				shiftKey: true,
				metaKey: false,
				ctrlKey: false,
			})
		).toBe("none");
	});

	it("shows queue button by default while busy with draft", () => {
		expect(
			resolvePrimaryButtonIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				isStreaming: true,
				isShiftPressed: false,
			})
		).toBe("send");
	});

	it("uses cancel when streaming without a draft", () => {
		expect(
			resolvePrimaryButtonIntent({
				hasDraftInput: false,
				isAgentBusy: true,
				isStreaming: true,
				isShiftPressed: false,
			})
		).toBe("cancel");
	});

	it("switches button to steer while Shift is held", () => {
		expect(
			resolvePrimaryButtonIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				isStreaming: true,
				isShiftPressed: true,
			})
		).toBe("steer");
	});
});
