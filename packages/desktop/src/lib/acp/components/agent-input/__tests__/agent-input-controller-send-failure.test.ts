/**
 * A failed send on an EXISTING session must never silently swallow the message.
 *
 * Observed live 2026-09-01: clicking Send cleared the composer, the send failed
 * server-side (no MessageSent committed), and nothing happened — no toast, no
 * draft restore, no console output. Two controller paths did this:
 *   - handleSend's non-pre-session error branch ended in
 *     `Effect.catch(() => Effect.succeed(undefined))` with no restore/surface;
 *   - handleSteer's cancelStreaming→sendMessage chain lost the message when
 *     either step failed (console.error only).
 *
 * Contract under test: a failed send/steer on an existing session restores the
 * composer draft (message, attachments, inline maps) and surfaces the failure
 * to the user (toast).
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

import { ConnectionError } from "../../../errors/app-error.js";
import type { AgentInputControllerHost } from "../agent-input-controller-host.js";
import type { AgentInputState } from "../state/agent-input-state.svelte.js";
import type { Attachment } from "../types/attachment.js";
import type { InlineImageReference } from "../types/inline-image-reference.js";

const toastError = mock((_message: string) => {});
const toastSuccess = mock((_message: string) => {});

mock.module("svelte-sonner", () => ({
	toast: {
		error: toastError,
		success: toastSuccess,
		info: mock(() => {}),
	},
}));

const { createAgentInputController } = await import("../agent-input-controller.js");

type TestInputState = {
	message: string;
	attachments: Attachment[];
	inlineTextMap: Map<string, string>;
	inlineImageMap: Map<string, InlineImageReference>;
	textareaRef: HTMLTextAreaElement | null;
	clearAttachments: () => void;
	clearInlineReferenceMaps: () => void;
	updateInlineText: (refId: string, text: string) => void;
	updateInlineImage: (refId: string, image: InlineImageReference) => void;
	sendPreparedMessage: ReturnType<typeof mock>;
};

function makeInputState(options: {
	message: string;
	sendPreparedMessage?: () => Effect.Effect<void, Error>;
}): TestInputState {
	const state: TestInputState = {
		message: options.message,
		attachments: [],
		inlineTextMap: new Map(),
		inlineImageMap: new Map(),
		textareaRef: null,
		clearAttachments() {
			state.attachments = [];
		},
		clearInlineReferenceMaps() {
			state.inlineTextMap.clear();
			state.inlineImageMap.clear();
		},
		updateInlineText(refId: string, text: string) {
			state.inlineTextMap.set(refId, text);
		},
		updateInlineImage(refId: string, image: InlineImageReference) {
			state.inlineImageMap.set(refId, image);
		},
		sendPreparedMessage: mock(options.sendPreparedMessage ?? (() => Effect.void)),
	};
	return state;
}

function makeHost(options: {
	inputState: TestInputState;
	cancelStreaming?: () => Effect.Effect<void, Error>;
	sendMessage?: () => Effect.Effect<void, Error>;
}): {
	host: AgentInputControllerHost;
	dispatchSettled: Promise<void>;
	panelStore: Record<string, ReturnType<typeof mock>>;
} {
	let resolveDispatchSettled: () => void = () => {};
	const dispatchSettled = new Promise<void>((resolve) => {
		resolveDispatchSettled = resolve;
	});

	const panelStore = {
		setMessageDraft: mock(() => {}),
		getHotState: mock(() => ({ pendingUserEntry: null })),
		setPendingUserEntry: mock(() => {}),
		clearPendingUserEntry: mock(() => {}),
		clearPendingWorktreeSetup: mock(() => {}),
		setPendingWorktreeSetup: mock(() => {}),
		setPendingComposerRestore: mock(() => {}),
		setSignInRequirement: mock(() => {}),
	};

	const logger = {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	};

	const host = {
		getProps: () => ({
			panelId: "panel-1",
			sessionId: "session-1",
			projectPath: "/repo",
			projectName: "Acepe",
			selectedAgentId: "claude-code",
		}),
		inputState: options.inputState as unknown as AgentInputState,
		getComposerInteraction: () => ({
			defaultSubmitAction: "send" as const,
			primaryButtonIntent: "send" as const,
			primaryButtonDisabled: false,
		}),
		getPendingQuestion: () => null,
		getAutonomousToggleActive: () => false,
		getProvisionalModeId: () => null,
		getInitialModelIdForNewSession: () => null,
		getIsStreaming: () => false,
		sessionStore: {
			composer: {
				beginDispatch: mock(() => {}),
				endDispatch: mock(() => {
					resolveDispatchSettled();
				}),
			},
			connection: {
				cancelStreaming: mock(options.cancelStreaming ?? (() => Effect.void)),
				sendMessage: mock(options.sendMessage ?? (() => Effect.void)),
			},
		},
		panelStore,
		connectionStore: { send: mock(() => {}) },
		messageQueueStore: { enqueue: mock(() => true) },
		logger,
		syncEditorFromMessage: mock(() => {}),
		getEditorRef: () => null,
		getLastDraftValue: () => "",
		setLastDraftValue: mock(() => {}),
		getDraftDebounceTimer: () => null,
		setDraftDebounceTimer: mock(() => {}),
		handleCancel: mock(() => {}),
	} as unknown as AgentInputControllerHost;

	return { host, dispatchSettled, panelStore };
}

beforeEach(() => {
	toastError.mockClear();
	toastSuccess.mockClear();
});

describe("handleSend failure on an existing session", () => {
	it("restores the composer draft and surfaces the failure", async () => {
		const inputState = makeInputState({
			message: "important message",
			sendPreparedMessage: () => Effect.fail(new ConnectionError("session-1")),
		});
		const { host, dispatchSettled } = makeHost({ inputState });
		const controller = createAgentInputController(host);

		await controller.handleSend();
		await dispatchSettled;

		expect(inputState.message).toBe("important message");
		expect(toastError).toHaveBeenCalled();
	});

	it("restores attachments and inline references with the draft", async () => {
		const attachment: Attachment = {
			id: "attachment-1",
			type: "file",
			path: "/repo/src/file.ts",
			displayName: "file.ts",
			extension: "ts",
			content: "console.log('x');",
		};
		const inputState = makeInputState({
			message: "review @[text_ref:ref-1]",
			sendPreparedMessage: () => Effect.fail(new ConnectionError("session-1")),
		});
		inputState.attachments = [attachment];
		inputState.inlineTextMap.set("ref-1", "inline text");
		const { host, dispatchSettled } = makeHost({ inputState });
		const controller = createAgentInputController(host);

		await controller.handleSend();
		await dispatchSettled;

		expect(inputState.message).toBe("review @[text_ref:ref-1]");
		expect(inputState.attachments).toHaveLength(1);
		expect(inputState.attachments[0]?.id).toBe("attachment-1");
		expect(inputState.inlineTextMap.get("ref-1")).toBe("inline text");
	});

	it("keeps the composer untouched and shows no toast when the send succeeds", async () => {
		const inputState = makeInputState({ message: "hello" });
		const { host, dispatchSettled } = makeHost({ inputState });
		const controller = createAgentInputController(host);

		await controller.handleSend();
		await dispatchSettled;

		expect(inputState.message).toBe("");
		expect(toastError).not.toHaveBeenCalled();
	});
});

describe("handleSteer failure", () => {
	it("restores the draft and surfaces the failure when cancelStreaming fails", async () => {
		const inputState = makeInputState({ message: "steer message" });
		const { host, dispatchSettled } = makeHost({
			inputState,
			cancelStreaming: () => Effect.fail(new ConnectionError("session-1")),
		});
		const controller = createAgentInputController(host);

		controller.handleSteer();
		await dispatchSettled;

		expect(inputState.message).toBe("steer message");
		expect(toastError).toHaveBeenCalled();
	});

	it("restores the draft and surfaces the failure when sendMessage fails", async () => {
		const inputState = makeInputState({ message: "steer message" });
		const { host, dispatchSettled } = makeHost({
			inputState,
			sendMessage: () => Effect.fail(new ConnectionError("session-1")),
		});
		const controller = createAgentInputController(host);

		controller.handleSteer();
		await dispatchSettled;

		expect(inputState.message).toBe("steer message");
		expect(toastError).toHaveBeenCalled();
	});

	it("clears the composer and shows no toast when the steer succeeds", async () => {
		const inputState = makeInputState({ message: "steer message" });
		const { host, dispatchSettled } = makeHost({ inputState });
		const controller = createAgentInputController(host);

		controller.handleSteer();
		await dispatchSettled;

		expect(inputState.message).toBe("");
		expect(toastError).not.toHaveBeenCalled();
	});
});
