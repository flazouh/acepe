import { describe, expect, it } from "bun:test";

import type { SelectorItem } from "../../types/selector-item.js";

import {
	filterItems,
	findItemById,
	groupItems,
	isItemSelected,
	validateItems,
} from "../selector-logic.js";

describe("selector-logic", () => {
	const mockItems: SelectorItem[] = [
		{
			id: "item-1",
			name: "Item 1",
			icon: "/icon1.svg",
			groupId: "group-a",
		},
		{
			id: "item-2",
			name: "Item 2",
			icon: "/icon2.svg",
			groupId: "group-a",
		},
		{
			id: "item-3",
			name: "Item 3",
			icon: "/icon3.svg",
			groupId: "group-b",
		},
		{
			id: "item-4",
			name: "Item 4",
			icon: "/icon4.svg",
			// No groupId
		},
	];

	describe("findItemById", () => {
		it("should find an item by ID", () => {
			const result = findItemById(mockItems, "item-1");
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toEqual(mockItems[0]);
			}
		});

		it("should return null when id is null", () => {
			const result = findItemById(mockItems, null);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBeNull();
			}
		});

		it("should return error when item not found", () => {
			const result = findItemById(mockItems, "nonexistent");
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.code).toBe("ITEM_NOT_FOUND");
			}
		});

		it("should handle empty array", () => {
			const result = findItemById([], "item-1");
			expect(result.isErr()).toBe(true);
		});
	});

	describe("groupItems", () => {
		it("should group items by groupId", () => {
			const groups = groupItems(mockItems);
			expect(groups.length).toBe(3); // group-a, group-b, ungrouped
		});

		it("should use custom group labels", () => {
			const groupLabels = {
				"group-a": "Group A",
				"group-b": "Group B",
			};
			const groups = groupItems(mockItems, groupLabels);
			const groupA = groups.find((g) => g.id === "group-a");
			expect(groupA?.label).toBe("Group A");
		});

		it("should place items without groupId in ungrouped", () => {
			const groups = groupItems(mockItems);
			const ungrouped = groups.find((g) => g.id === "ungrouped");
			expect(ungrouped).toBeDefined();
			expect(ungrouped?.items.length).toBe(1);
			expect(ungrouped?.items[0].id).toBe("item-4");
		});

		it("should return empty array for empty input", () => {
			const groups = groupItems([]);
			expect(groups).toEqual([]);
		});

		it("should handle all items in same group", () => {
			const sameGroupItems: SelectorItem[] = [
				{ id: "1", name: "Item 1", groupId: "group-a" },
				{ id: "2", name: "Item 2", groupId: "group-a" },
			];
			const groups = groupItems(sameGroupItems);
			expect(groups.length).toBe(1);
			expect(groups[0].items.length).toBe(2);
		});
	});

	describe("filterItems", () => {
		it("should filter items by predicate", () => {
			const filtered = filterItems(mockItems, (item) => item.groupId === "group-a");
			expect(filtered.length).toBe(2);
			expect(filtered.every((item) => item.groupId === "group-a")).toBe(true);
		});

		it("should return empty array when no items match", () => {
			const filtered = filterItems(mockItems, (item) => item.groupId === "nonexistent");
			expect(filtered).toEqual([]);
		});

		it("should return all items when predicate always true", () => {
			const filtered = filterItems(mockItems, () => true);
			expect(filtered.length).toBe(mockItems.length);
		});

		it("should handle empty array", () => {
			const filtered = filterItems([], () => true);
			expect(filtered).toEqual([]);
		});
	});

	describe("isItemSelected", () => {
		it("should return true when item is selected", () => {
			const result = isItemSelected(mockItems[0], "item-1");
			expect(result).toBe(true);
		});

		it("should return false when item is not selected", () => {
			const result = isItemSelected(mockItems[0], "item-2");
			expect(result).toBe(false);
		});

		it("should return false when selectedId is null", () => {
			const result = isItemSelected(mockItems[0], null);
			expect(result).toBe(false);
		});
	});

	describe("validateItems", () => {
		it("should return ok for valid items", () => {
			const result = validateItems(mockItems);
			expect(result.isOk()).toBe(true);
		});

		it("should return error for duplicate IDs", () => {
			const duplicateItems: SelectorItem[] = [
				{ id: "1", name: "Item 1" },
				{ id: "1", name: "Item 2" },
			];
			const result = validateItems(duplicateItems);
			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.code).toBe("INVALID_ITEM");
			}
		});

		it("should return ok for empty array", () => {
			const result = validateItems([]);
			expect(result.isOk()).toBe(true);
		});

		it("should handle items with different types of IDs", () => {
			const mixedItems: SelectorItem<number | string>[] = [
				{ id: 1, name: "Item 1" },
				{ id: "2", name: "Item 2" },
			];
			const result = validateItems(mixedItems);
			expect(result.isOk()).toBe(true);
		});
	});
});
