import { describe, expect, it } from "vitest";

import {
	isPrimaryButtonDisabled,
	resolveDefaultSubmitAction,
	resolveEnterKeyIntent,
	resolvePrimaryButtonIntent,
} from "./submit-intent.js";

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

	it("queues by default while streaming and busy", () => {
		expect(
			resolveDefaultSubmitAction({
				hasDraftInput: true,
				hasSessionId: true,
				isAgentBusy: true,
				isStreaming: true,
				isSubmitDisabled: true,
			})
		).toBe("queue");
	});

	it("steers only when streaming without a running turn", () => {
		expect(
			resolveDefaultSubmitAction({
				hasDraftInput: true,
				hasSessionId: true,
				isAgentBusy: false,
				isStreaming: true,
				isSubmitDisabled: true,
			})
		).toBe("steer");
	});

	it("keeps the queue button enabled while busy", () => {
		expect(
			isPrimaryButtonDisabled({
				hasDraftInput: true,
				isSending: false,
				isAgentBusy: true,
				isSubmitDisabled: true,
				primaryButtonIntent: "send",
			})
		).toBe(false);
	});

	it("keeps the stop button enabled while streaming without a draft", () => {
		expect(
			isPrimaryButtonDisabled({
				hasDraftInput: false,
				isSending: false,
				isAgentBusy: true,
				isSubmitDisabled: true,
				primaryButtonIntent: "cancel",
			})
		).toBe(false);
	});

	it("does not expose a send action while a pending config gate can still veto submit", () => {
		expect(
			resolveDefaultSubmitAction({
				hasDraftInput: true,
				hasSessionId: true,
				isAgentBusy: false,
				isStreaming: false,
				isSubmitDisabled: false,
				hasBlockingPendingSessionConfigOperation: true,
			})
		).toBe("none");
	});

	it("disables the primary send button while submit is blocked by pending session config", () => {
		expect(
			isPrimaryButtonDisabled({
				hasDraftInput: true,
				isSending: false,
				isAgentBusy: false,
				isSubmitDisabled: false,
				primaryButtonIntent: "send",
				hasBlockingPendingSessionConfigOperation: true,
			})
		).toBe(true);
	});
});
