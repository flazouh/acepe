import { describe, expect, it } from "bun:test";
import type { SelectorGroup } from "../../types/selector-group.js";
import type { SelectorItem } from "../../types/selector-item.js";
import {
	findSelectedSelectorItem,
	normalizeSelectorActionButtons,
	shouldDisableSelector,
	shouldShowSelectorActionSeparator,
} from "../selector-ui-state.js";

const items: SelectorItem<string>[] = [
	{ id: "alpha", name: "Alpha" },
	{ id: "beta", name: "Beta" },
];

describe("selector UI state", () => {
	it("finds the selected item by id", () => {
		expect(findSelectedSelectorItem(items, "beta")).toEqual(items[1]);
	});

	it("returns null when no item is selected or found", () => {
		expect(findSelectedSelectorItem(items, null)).toBeNull();
		expect(findSelectedSelectorItem(items, "missing")).toBeNull();
	});

	it("normalizes missing action buttons to an empty array", () => {
		expect(normalizeSelectorActionButtons(undefined)).toEqual([]);

		const buttons = [{ label: "Browse", onClick: () => undefined }];
		expect(normalizeSelectorActionButtons(buttons)).toBe(buttons);
	});

	it("disables the selector for disabled, loading, or empty states", () => {
		expect(
			shouldDisableSelector({
				disabled: true,
				isLoading: false,
				itemCount: 1,
				actionButtonCount: 0,
			})
		).toBe(true);
		expect(
			shouldDisableSelector({
				disabled: false,
				isLoading: true,
				itemCount: 1,
				actionButtonCount: 0,
			})
		).toBe(true);
		expect(
			shouldDisableSelector({
				disabled: false,
				isLoading: false,
				itemCount: 0,
				actionButtonCount: 0,
			})
		).toBe(true);
		expect(
			shouldDisableSelector({
				disabled: false,
				isLoading: false,
				itemCount: 0,
				actionButtonCount: 1,
			})
		).toBe(false);
	});

	it("shows the action separator when there are items or groups", () => {
		expect(shouldShowSelectorActionSeparator(items, undefined)).toBe(true);

		const groups: SelectorGroup<string>[] = [{ id: "recent", label: "Recent", items: [] }];
		expect(shouldShowSelectorActionSeparator([], groups)).toBe(true);
		expect(shouldShowSelectorActionSeparator([], [])).toBe(false);
	});
});
