import { describe, expect, it } from "vitest";

import {
	getAdjacentInlineTokenElement,
	getSerializedCursorOffset,
	getSerializedSelectionRange,
	renderInlineComposerMessage,
	serializeInlineComposerMessage,
	setSerializedCursorOffset,
} from "../inline-composer-dom.js";

describe("inline-composer-dom", () => {
	it("round-trips text, newlines, and artefact tokens", () => {
		const editor = document.createElement("div");
		const message =
			"Run @[command:/review-commit] on @[file:src/main.ts]\nThen use @[skill:/Plan_review]";

		renderInlineComposerMessage(editor, message);

		expect(serializeInlineComposerMessage(editor)).toBe(message);
	});

	it("sets and gets serialized cursor offsets across token chips", () => {
		const editor = document.createElement("div");
		const message = "A @[file:src/main.ts] Z";
		renderInlineComposerMessage(editor, message);

		setSerializedCursorOffset(editor, 2);
		expect(getSerializedCursorOffset(editor)).toBe(2);

		const tokenStart = message.indexOf("@[");
		const tokenEnd = message.indexOf("]", tokenStart) + 1;
		setSerializedCursorOffset(editor, tokenStart + 1);
		expect(getSerializedCursorOffset(editor)).toBe(tokenEnd);

		setSerializedCursorOffset(editor, message.length);
		expect(getSerializedCursorOffset(editor)).toBe(message.length);
	});

	it("serializes a manually inserted token span", () => {
		const editor = document.createElement("div");
		editor.appendChild(document.createTextNode("Open "));
		const token = document.createElement("span");
		token.setAttribute("data-inline-token-type", "file");
		token.setAttribute("data-inline-token-value", "src/lib/file.ts");
		token.setAttribute("contenteditable", "false");
		token.textContent = "file.ts";
		editor.appendChild(token);
		editor.appendChild(document.createTextNode(" now"));

		expect(serializeInlineComposerMessage(editor)).toBe("Open @[file:src/lib/file.ts] now");
	});

	it("finds adjacent token at caret boundaries for delete/backspace", () => {
		const editor = document.createElement("div");
		const message = "A @[command:/review] B";
		renderInlineComposerMessage(editor, message);

		setSerializedCursorOffset(editor, message.indexOf("@["));
		const selectionBefore = window.getSelection();
		expect(selectionBefore).not.toBeNull();
		const rangeBefore = selectionBefore?.rangeCount ? selectionBefore.getRangeAt(0) : null;
		expect(rangeBefore).not.toBeNull();
		if (rangeBefore) {
			const forwardToken = getAdjacentInlineTokenElement(editor, rangeBefore, "forward");
			expect(forwardToken).not.toBeNull();
			expect(forwardToken?.getAttribute("data-inline-token-type")).toBe("command");
		}

		const tokenEnd = message.indexOf("]", message.indexOf("@[")) + 1;
		setSerializedCursorOffset(editor, tokenEnd);
		const selectionAfter = window.getSelection();
		expect(selectionAfter).not.toBeNull();
		const rangeAfter = selectionAfter?.rangeCount ? selectionAfter.getRangeAt(0) : null;
		expect(rangeAfter).not.toBeNull();
		if (rangeAfter) {
			const backwardToken = getAdjacentInlineTokenElement(editor, rangeAfter, "backward");
			expect(backwardToken).not.toBeNull();
			expect(backwardToken?.getAttribute("data-inline-token-type")).toBe("command");
		}
	});

	it("places caret into a text node after a trailing token chip", () => {
		const editor = document.createElement("div");
		const message = "@[text_ref:ref-123]";
		renderInlineComposerMessage(editor, message);

		setSerializedCursorOffset(editor, message.length);

		const selection = window.getSelection();
		const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
		expect(range).not.toBeNull();
		expect(range?.collapsed).toBe(true);
		expect(range?.startContainer.nodeType).toBe(Node.TEXT_NODE);
		expect(getSerializedCursorOffset(editor)).toBe(message.length);
	});

	it("returns the serialized range for a full selection", () => {
		const editor = document.createElement("div");
		const message =
			"app-start.wavapp-start.wavapp-start.wavapp-start.wavapp-start.wavapp-start.wav ";
		renderInlineComposerMessage(editor, message);

		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(editor);
		selection?.removeAllRanges();
		selection?.addRange(range);

		expect(getSerializedSelectionRange(editor)).toEqual({ start: 0, end: message.length });
	});

	it("treats a bare line break editor as empty", () => {
		const editor = document.createElement("div");
		editor.appendChild(document.createElement("br"));

		expect(serializeInlineComposerMessage(editor)).toBe("");
	});

	it("uses shared chip chrome and artefact accents for live composer tokens", () => {
		const editor = document.createElement("div");
		const message =
			"@[command:/review] @[skill:/Plan_review] @[text_ref:ref-123] @[file:src/main.ts]";

		renderInlineComposerMessage(editor, message);

		const commandToken = editor.querySelector(
			'[data-inline-token-type="command"]'
		) as HTMLElement | null;
		const skillToken = editor.querySelector(
			'[data-inline-token-type="skill"]'
		) as HTMLElement | null;
		const textToken = editor.querySelector(
			'[data-inline-token-type="text_ref"]'
		) as HTMLElement | null;
		const fileToken = editor.querySelector('[data-inline-token-type="file"]') as HTMLElement | null;

		expect(commandToken).not.toBeNull();
		expect(skillToken).not.toBeNull();
		expect(textToken).not.toBeNull();
		expect(fileToken).not.toBeNull();

		expect(commandToken?.className).toContain("rounded-sm");
		expect(commandToken?.className).toContain("border");
		expect(commandToken?.className).toContain("border-border/50");
		expect(commandToken?.className).toContain("px-1");
		expect(commandToken?.className).toContain("py-0.5");
		expect(fileToken?.className).toContain("px-1");
		expect(fileToken?.className).toContain("py-0.5");

		const commandIcon = commandToken?.querySelector("svg");
		const skillIcon = skillToken?.querySelector("svg");
		const textIcon = textToken?.querySelector("svg");

		expect(commandIcon?.getAttribute("class") ?? "").toContain("text-violet-500");
		expect(skillIcon?.getAttribute("class") ?? "").toContain("text-violet-500");
		expect(textIcon?.getAttribute("class") ?? "").toContain("text-success");
	});
});
