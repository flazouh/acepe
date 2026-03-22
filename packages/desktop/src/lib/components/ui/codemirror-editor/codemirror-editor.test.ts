import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
	type EditorThemeMode,
	observeEditorThemeMode,
	resolveEditorThemeMode,
} from "./theme-mode.js";

function waitForObserverTick(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, 0);
	});
}

describe("codemirror-editor theme mode", () => {
	beforeEach(() => {
		document.documentElement.classList.remove("light", "dark");
	});

	afterEach(() => {
		document.documentElement.classList.remove("light", "dark");
	});

	it("resolves dark mode when root has dark class", () => {
		document.documentElement.classList.add("dark");
		expect(resolveEditorThemeMode(document.documentElement)).toBe("dark");
	});

	it("resolves light mode when root does not have dark class", () => {
		document.documentElement.classList.add("light");
		expect(resolveEditorThemeMode(document.documentElement)).toBe("light");
	});

	it("observes root class changes and emits updated mode", async () => {
		document.documentElement.classList.add("dark");

		const observedModes: EditorThemeMode[] = [];
		const observer = observeEditorThemeMode(document.documentElement, (mode) => {
			observedModes.push(mode);
		});

		expect(observedModes).toEqual(["dark"]);

		document.documentElement.classList.remove("dark");
		document.documentElement.classList.add("light");
		await waitForObserverTick();

		expect(observedModes[observedModes.length - 1]).toBe("light");

		observer.disconnect();
	});
});
