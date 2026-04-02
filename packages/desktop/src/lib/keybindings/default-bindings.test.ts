import { describe, expect, it } from "vitest";

import { DEFAULT_KEYBINDINGS } from "./bindings/defaults.js";
import { KEYBINDING_ACTIONS } from "./constants.js";

function getBinding(command: string) {
	const binding = DEFAULT_KEYBINDINGS.find((entry) => entry.command === command);

	expect(binding).toBeDefined();

	return binding;
}

describe("default keybindings", () => {
	it("suppresses app-level toggles while a modal is open", () => {
		expect(getBinding(KEYBINDING_ACTIONS.COMMAND_PALETTE_TOGGLE)?.when).toContain(
			"!modalOpen"
		);
		expect(getBinding(KEYBINDING_ACTIONS.SIDEBAR_TOGGLE)?.when).toContain("!modalOpen");
		expect(getBinding(KEYBINDING_ACTIONS.TOP_BAR_TOGGLE)?.when).toContain("!modalOpen");
		expect(getBinding(KEYBINDING_ACTIONS.THREAD_CREATE)?.when).toContain("!modalOpen");
		expect(getBinding(KEYBINDING_ACTIONS.THREAD_CLOSE)?.when).toContain("!modalOpen");
		expect(getBinding(KEYBINDING_ACTIONS.DEBUG_TOGGLE)?.when).toContain("!modalOpen");
		expect(getBinding(KEYBINDING_ACTIONS.URGENCY_JUMP_FIRST)?.when).toContain(
			"!modalOpen"
		);
	});

	it("does not allow the file explorer toggle to fire from another modal", () => {
		expect(getBinding(KEYBINDING_ACTIONS.FILE_EXPLORER_TOGGLE)?.when).toContain(
			"!modalOpen"
		);
	});

	it("keeps mode cycling available while the composer is focused", () => {
		expect(getBinding(KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE)?.when).not.toContain(
			"!inputFocused"
		);
		expect(getBinding(KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE)?.key).toBe("$mod+Period");
		expect(getBinding(KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE)?.when).toContain(
			"!settingsOpen"
		);
		expect(getBinding(KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE)?.when).toContain(
			"!modalOpen"
		);
	});

	it("adds a shifted dot fallback for layouts where period requires Shift", () => {
		const modeBindings = DEFAULT_KEYBINDINGS.filter(
			(entry) => entry.command === KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE
		).map((entry) => entry.key);

		expect(modeBindings).toContain("$mod+Shift+.");
	});

	it("does not include legacy sequence-style shortcuts", () => {
		const sequenceBindings = DEFAULT_KEYBINDINGS.filter(
			(entry) => entry.key.includes(" ") && !entry.key.includes("+")
		);

		expect(sequenceBindings).toEqual([]);
	});
});
