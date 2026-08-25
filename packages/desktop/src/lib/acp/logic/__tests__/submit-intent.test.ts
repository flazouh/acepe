import { describe, expect, it } from "vitest";

import {
	isPrimaryButtonDisabled,
	resolveDefaultSubmitAction,
	resolveEnterKeyIntent,
	resolvePrimaryButtonIntent,
} from "../submit-intent.js";

describe("submit intent", () => {
	it("steers on Enter while agent is busy", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
			})
		).toBe("steer");
	});

	it("steers on Enter while agent is busy even when direct submit is disabled", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				isSubmitDisabled: true,
			})
		).toBe("steer");
	});

	it("queues on Cmd+Enter while agent is busy", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: false,
				metaKey: true,
				ctrlKey: false,
			})
		).toBe("queue");
	});

	it("queues on Ctrl+Enter while agent is busy", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: false,
				metaKey: false,
				ctrlKey: true,
			})
		).toBe("queue");
	});

	it("sends on Cmd+Enter while agent is idle", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: false,
				shiftKey: false,
				metaKey: true,
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

	it("steers on Shift+Enter while agent is busy even when direct submit is disabled", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				shiftKey: true,
				metaKey: false,
				ctrlKey: false,
				isSubmitDisabled: true,
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

	it("suppresses Enter submit when idle direct submit is disabled", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: false,
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				isSubmitDisabled: true,
			})
		).toBe("none");
	});

	it("shows steer button by default while busy with draft", () => {
		expect(
			resolvePrimaryButtonIntent({
				hasDraftInput: true,
				isAgentBusy: true,
				isStreaming: true,
			})
		).toBe("steer");
	});

	it("uses cancel when streaming without a draft", () => {
		expect(
			resolvePrimaryButtonIntent({
				hasDraftInput: false,
				isAgentBusy: true,
				isStreaming: true,
			})
		).toBe("cancel");
	});

	it("steers by default while streaming and busy", () => {
		expect(
			resolveDefaultSubmitAction({
				hasDraftInput: true,
				hasSessionId: true,
				isAgentBusy: true,
				isStreaming: true,
				isSubmitDisabled: true,
			})
		).toBe("steer");
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

	it("keeps the steer button enabled while busy", () => {
		expect(
			isPrimaryButtonDisabled({
				hasDraftInput: true,
				isComposerDispatching: false,
				isAgentBusy: true,
				isSubmitDisabled: true,
				primaryButtonIntent: "steer",
			})
		).toBe(false);
	});

	it("keeps the stop button enabled while streaming without a draft", () => {
		expect(
			isPrimaryButtonDisabled({
				hasDraftInput: false,
				isComposerDispatching: false,
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
				hasBlockingComposerConfig: true,
			})
		).toBe("none");
	});

	it("disables the primary send button while submit is blocked by pending session config", () => {
		expect(
			isPrimaryButtonDisabled({
				hasDraftInput: true,
				isComposerDispatching: false,
				isAgentBusy: false,
				isSubmitDisabled: false,
				primaryButtonIntent: "send",
				hasBlockingComposerConfig: true,
			})
		).toBe(true);
	});

	it("suppresses Enter submit while composer config is blocking", () => {
		expect(
			resolveEnterKeyIntent({
				hasDraftInput: true,
				isAgentBusy: false,
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				hasBlockingComposerConfig: true,
			})
		).toBe("none");
	});

	it("suppresses default submit action while composer dispatch is in flight", () => {
		expect(
			resolveDefaultSubmitAction({
				hasDraftInput: true,
				hasSessionId: true,
				isAgentBusy: false,
				isStreaming: false,
				isSubmitDisabled: false,
				isComposerDispatching: true,
			})
		).toBe("none");
	});
});
