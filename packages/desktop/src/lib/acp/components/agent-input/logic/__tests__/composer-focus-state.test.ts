import { afterEach, describe, expect, it } from "vitest";

import {
	getKeybindingsService,
	resetKeybindingsService,
} from "../../../../../keybindings/index.js";

describe("composer focus keybinding context", () => {
	afterEach(() => {
		resetKeybindingsService();
	});

	it("toggles inputFocused context from editor focus state", () => {
		const kb = getKeybindingsService();
		const editor = document.createElement("div");
		editor.tabIndex = 0;
		editor.setAttribute("contenteditable", "true");

		const handleFocus = () => kb.setContext("inputFocused", true);
		const handleBlur = () => kb.setContext("inputFocused", false);

		editor.addEventListener("focus", handleFocus);
		editor.addEventListener("blur", handleBlur);
		document.body.appendChild(editor);

		editor.dispatchEvent(new FocusEvent("focus"));
		expect(kb.getContext("inputFocused")).toBe(true);

		editor.dispatchEvent(new FocusEvent("blur"));
		expect(kb.getContext("inputFocused")).toBe(false);

		editor.removeEventListener("focus", handleFocus);
		editor.removeEventListener("blur", handleBlur);
		editor.remove();
	});
});
