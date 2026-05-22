import { describe, expect, it } from "bun:test";

import {
	getProjectSelectionModifierSymbol,
	getProjectSelectionPathsKey,
	getProjectSelectionShortcutIndex,
	getSelectableProjectByIndex,
	isProjectSelectionTextInputTarget,
	shouldSyncProjectSelectionMetadata,
} from "../project-selection-panel-state.js";

const projects = [
	{ path: "/repo/a", name: "A" },
	{ path: "/repo/b", name: "B" },
] as const;

describe("project selection panel state", () => {
	it("uses a platform-specific shortcut modifier label", () => {
		expect(getProjectSelectionModifierSymbol("MacIntel")).toBe("⌘");
		expect(getProjectSelectionModifierSymbol("Linux x86_64")).toBe("Ctrl");
		expect(getProjectSelectionModifierSymbol(undefined)).toBe("Ctrl");
	});

	it("builds a stable project paths key", () => {
		expect(getProjectSelectionPathsKey(projects)).toBe("/repo/a\n/repo/b");
	});

	it("detects text input keyboard targets", () => {
		const input = { tagName: "INPUT" } as unknown as EventTarget;
		const textarea = { tagName: "TEXTAREA" } as unknown as EventTarget;
		const button = { tagName: "BUTTON" } as unknown as EventTarget;

		expect(isProjectSelectionTextInputTarget(input)).toBe(true);
		expect(isProjectSelectionTextInputTarget(textarea)).toBe(true);
		expect(isProjectSelectionTextInputTarget(button)).toBe(false);
		expect(isProjectSelectionTextInputTarget(null)).toBe(false);
	});

	it("resolves numeric shortcut indexes only for the correct modifier", () => {
		expect(
			getProjectSelectionShortcutIndex({
				key: "2",
				isMac: true,
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			})
		).toBe(1);
		expect(
			getProjectSelectionShortcutIndex({
				key: "2",
				isMac: false,
				metaKey: false,
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
			})
		).toBe(1);
		expect(
			getProjectSelectionShortcutIndex({
				key: "2",
				isMac: true,
				metaKey: false,
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
			})
		).toBeNull();
		expect(
			getProjectSelectionShortcutIndex({
				key: "0",
				isMac: true,
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			})
		).toBeNull();
	});

	it("returns selectable projects and skips missing ones", () => {
		expect(
			getSelectableProjectByIndex({
				projects,
				index: 0,
				missingProjectPaths: new Set(),
			})
		).toBe(projects[0]);
		expect(
			getSelectableProjectByIndex({
				projects,
				index: 1,
				missingProjectPaths: new Set(["/repo/b"]),
			})
		).toBeNull();
		expect(
			getSelectableProjectByIndex({
				projects,
				index: 5,
				missingProjectPaths: new Set(),
			})
		).toBeNull();
	});

	it("syncs metadata for changed visible projects or retryable metadata", () => {
		expect(
			shouldSyncProjectSelectionMetadata({
				displayProjectsKey: "a",
				lastDisplayProjectsKey: "a",
				hasRetryableMetadata: false,
			})
		).toBe(false);
		expect(
			shouldSyncProjectSelectionMetadata({
				displayProjectsKey: "b",
				lastDisplayProjectsKey: "a",
				hasRetryableMetadata: false,
			})
		).toBe(true);
		expect(
			shouldSyncProjectSelectionMetadata({
				displayProjectsKey: "a",
				lastDisplayProjectsKey: "a",
				hasRetryableMetadata: true,
			})
		).toBe(true);
	});
});
