import { describe, expect, it } from "vitest";

import {
	shouldRouteWindowVoiceHold,
	shouldStartVoiceHold,
	shouldStopVoiceHold,
} from "../voice-keyboard.js";

function createKeyboardEventLike(
	overrides: Partial<{
		altKey: boolean;
		code: string;
		ctrlKey: boolean;
		key: string;
		metaKey: boolean;
		repeat: boolean;
		shiftKey: boolean;
	}> = {}
) {
	return {
		altKey: true,
		code: "AltRight",
		ctrlKey: false,
		key: "Alt",
		metaKey: false,
		repeat: false,
		shiftKey: false,
		...overrides,
	};
}

describe("voice-keyboard", () => {
	it("starts hold only for a fresh right option press", () => {
		expect(shouldStartVoiceHold(createKeyboardEventLike())).toBe(true);
		expect(shouldStartVoiceHold(createKeyboardEventLike({ repeat: true }))).toBe(false);
		expect(shouldStartVoiceHold(createKeyboardEventLike({ shiftKey: true }))).toBe(false);
	});

	it("does not start hold for left option or space", () => {
		expect(shouldStartVoiceHold(createKeyboardEventLike({ code: "AltLeft" }))).toBe(false);
		expect(
			shouldStartVoiceHold({
				altKey: false,
				code: "Space",
				ctrlKey: false,
				key: " ",
				metaKey: false,
				repeat: false,
				shiftKey: false,
			})
		).toBe(false);
	});

	it("stops hold on right option release when active", () => {
		expect(shouldStopVoiceHold(createKeyboardEventLike(), true)).toBe(true);
		expect(shouldStopVoiceHold(createKeyboardEventLike({ ctrlKey: true }), true)).toBe(false);
		expect(shouldStopVoiceHold(createKeyboardEventLike(), false)).toBe(false);
	});

	it("routes window voice hold only to the focused panel", () => {
		expect(
			shouldRouteWindowVoiceHold({
				editorHasFocus: false,
				focusedPanelId: "panel-a",
				panelId: "panel-a",
			})
		).toBe(true);
		expect(
			shouldRouteWindowVoiceHold({
				editorHasFocus: false,
				focusedPanelId: "panel-a",
				panelId: "panel-b",
			})
		).toBe(false);
		expect(
			shouldRouteWindowVoiceHold({
				editorHasFocus: true,
				focusedPanelId: "panel-a",
				panelId: "panel-a",
			})
		).toBe(false);
		expect(
			shouldRouteWindowVoiceHold({
				editorHasFocus: false,
				focusedPanelId: null,
			})
		).toBe(true);
	});
});
