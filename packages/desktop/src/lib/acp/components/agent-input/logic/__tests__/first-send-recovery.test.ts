import { describe, expect, it } from "bun:test";

import { PanelConnectionState } from "../../../../types/panel-connection-state.js";
import type { Attachment } from "../../types/attachment.js";
import {
	formatPreSessionSendFailure,
	restoreComposerStateAfterFailedSend,
	shouldDisableSendForFailedFirstSend,
} from "../first-send-recovery.js";

describe("first-send-recovery", () => {
	it("restores the live composer state after a failed first send", () => {
		const originalAttachment: Attachment = {
			id: "attachment-1",
			type: "file",
			path: "/repo/src/file.ts",
			displayName: "file.ts",
			extension: "ts",
			content: "console.log('x');",
		};
		const target = {
			message: "",
			attachments: [] as Attachment[],
			clearedInlineTextMapCount: 0,
			inlineTextById: new Map<string, string>(),
			clearInlineTextMap() {
				this.clearedInlineTextMapCount += 1;
				this.inlineTextById.clear();
			},
			updateInlineText(refId: string, text: string) {
				this.inlineTextById.set(refId, text);
			},
		};

		restoreComposerStateAfterFailedSend(target, {
			draft: "Review @[text_ref:ref-1]",
			attachments: [originalAttachment],
			inlineTextEntries: [["ref-1", "restored text"]],
		});

		expect(target.message).toBe("Review @[text_ref:ref-1]");
		expect(target.clearedInlineTextMapCount).toBe(1);
		expect(target.inlineTextById.get("ref-1")).toBe("restored text");
		expect(target.attachments).toEqual([originalAttachment]);
		expect(target.attachments[0]).not.toBe(originalAttachment);
	});

	it("formats nested pre-session errors with their root cause", () => {
		const error = new Error("Failed to create session for agent codex", {
			cause: new Error("Failed to spawn subprocess: No such file or directory (os error 2)"),
		});

		expect(formatPreSessionSendFailure(error)).toContain("No such file or directory (os error 2)");
	});

	it("blocks sending while a pre-session panel error is active", () => {
		expect(
			shouldDisableSendForFailedFirstSend({
				hasSession: false,
				panelConnectionState: PanelConnectionState.ERROR,
			})
		).toBe(true);

		expect(
			shouldDisableSendForFailedFirstSend({
				hasSession: false,
				panelConnectionState: PanelConnectionState.IDLE,
			})
		).toBe(false);

		expect(
			shouldDisableSendForFailedFirstSend({
				hasSession: true,
				panelConnectionState: PanelConnectionState.ERROR,
			})
		).toBe(false);
	});
});
