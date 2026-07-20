import { describe, expect, it } from "bun:test";

import type { AskMessage } from "../../types/ask-message.js";

import {
	buildAskMessageDisplayState,
	getAskOptionIdFromKeyboardShortcut,
	getAskOptionShortcutLabel,
} from "./ask-message-state.js";

const message: AskMessage = {
	id: "ask-1",
	question: "Choose a mode",
	options: [
		{ id: "fast", label: "Fast", description: "Quick answer" },
		{ id: "deep", label: "Deep" },
	],
};

describe("ask-message-state", () => {
	it("builds option view state with shortcuts and selected state", () => {
		const state = buildAskMessageDisplayState({ message, selectedId: "deep" });

		expect(state.options).toEqual([
			{
				option: message.options[0],
				shortcutLabel: "Alt+1",
				isSelected: false,
			},
			{
				option: message.options[1],
				shortcutLabel: "Alt+2",
				isSelected: true,
			},
		]);
	});

	it("builds shortcut labels from option index", () => {
		expect(getAskOptionShortcutLabel(0)).toBe("Alt+1");
		expect(getAskOptionShortcutLabel(8)).toBe("Alt+9");
	});

	it("finds an option id from an Alt+number shortcut", () => {
		expect(getAskOptionIdFromKeyboardShortcut({ altKey: true, key: "1" }, message.options)).toBe(
			"fast"
		);
		expect(getAskOptionIdFromKeyboardShortcut({ altKey: true, key: "2" }, message.options)).toBe(
			"deep"
		);
	});

	it("ignores keys that are not valid shortcuts", () => {
		expect(
			getAskOptionIdFromKeyboardShortcut({ altKey: false, key: "1" }, message.options)
		).toBeNull();
		expect(
			getAskOptionIdFromKeyboardShortcut({ altKey: true, key: "x" }, message.options)
		).toBeNull();
		expect(
			getAskOptionIdFromKeyboardShortcut({ altKey: true, key: "0" }, message.options)
		).toBeNull();
		expect(
			getAskOptionIdFromKeyboardShortcut({ altKey: true, key: "3" }, message.options)
		).toBeNull();
	});
});
