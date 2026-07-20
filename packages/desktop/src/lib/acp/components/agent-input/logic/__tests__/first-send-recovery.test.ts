import { describe, expect, it } from "bun:test";
import { AuthenticationRequiredError, CreationFailureError } from "../../../../errors/app-error.js";
import { PanelConnectionState } from "../../../../types/panel-connection-state.js";
import { SessionCreationError } from "../../errors/agent-input-error.js";
import type { Attachment } from "../../types/attachment.js";
import type { InlineImageReference } from "../../types/inline-image-reference.js";
import {
	findAuthenticationRequirement,
	findCreationFailureReason,
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
			clearedInlineReferenceMapsCount: 0,
			inlineTextById: new Map<string, string>(),
			inlineImageById: new Map<string, InlineImageReference>(),
			clearInlineReferenceMaps() {
				this.clearedInlineReferenceMapsCount += 1;
				this.inlineTextById.clear();
				this.inlineImageById.clear();
			},
			updateInlineText(refId: string, text: string) {
				this.inlineTextById.set(refId, text);
			},
			updateInlineImage(refId: string, image: InlineImageReference) {
				this.inlineImageById.set(refId, image);
			},
		};

		restoreComposerStateAfterFailedSend(target, {
			draft: "Review @[text_ref:ref-1]",
			attachments: [originalAttachment],
			inlineTextEntries: [["ref-1", "restored text"]],
			inlineImageEntries: [],
		});

		expect(target.message).toBe("Review @[text_ref:ref-1]");
		expect(target.clearedInlineReferenceMapsCount).toBe(1);
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

	it("finds the canonical failure reason carried by a nested CreationFailureError", () => {
		const error = new SessionCreationError(
			"cursor",
			"/repo",
			new CreationFailureError(
				"provider_failed_before_id",
				"Cursor requires authentication.",
				null,
				"attempt-1",
				true,
				"sessionGoneUpstream"
			)
		);

		expect(findCreationFailureReason(error)).toBe("sessionGoneUpstream");
	});

	it("finds an AuthenticationRequiredError anywhere in the cause chain", () => {
		const authError = new AuthenticationRequiredError(
			"Cursor",
			"Run `agent login` in your terminal to authenticate."
		);
		const error = new SessionCreationError("cursor", "/repo", authError);

		const result = findAuthenticationRequirement(error);
		expect(result).toEqual({
			agent: "Cursor",
			instructions: "Run `agent login` in your terminal to authenticate.",
		});
	});

	it("returns null from findAuthenticationRequirement when no auth error in chain", () => {
		const error = new SessionCreationError(
			"cursor",
			"/repo",
			new Error("generic connection failure")
		);

		expect(findAuthenticationRequirement(error)).toBeNull();
	});

	it("returns null when no creation failure in the chain carries a reason", () => {
		const error = new SessionCreationError(
			"codex",
			"/repo",
			new Error("Failed to spawn subprocess")
		);

		expect(findCreationFailureReason(error)).toBeNull();
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
