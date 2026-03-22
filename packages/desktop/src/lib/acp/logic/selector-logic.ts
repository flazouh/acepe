import { err, ok, type Result } from "neverthrow";
import { SelectorError } from "../errors/selector-error.js";
import type { SelectorGroup } from "../types/selector-group.js";
import type { SelectorItem } from "../types/selector-item.js";

/**
 * Finds an item by its ID.
 *
 * @template T - The type of the item's unique identifier
 * @param items - Array of items to search
 * @param id - The ID to search for
 * @returns Result containing the item or an error if not found
 *
 * @example
 * ```typescript
 * const result = findItemById(items, "item-1");
 * result
 *   .map(item => console.log('Found:', item))
 *   .mapErr(error => console.error('Error:', error));
 * ```
 */
export function findItemById<T = string>(
	items: SelectorItem<T>[],
	id: T | null
): Result<SelectorItem<T> | null, SelectorError> {
	if (id === null) {
		return ok(null);
	}

	const item = items.find((item) => item.id === id);
	if (!item) {
		return err(new SelectorError(`Item with id "${String(id)}" not found`, "ITEM_NOT_FOUND"));
	}

	return ok(item);
}

/**
 * Groups items by their groupId.
 *
 * Items without a groupId are placed in a default "ungrouped" group.
 *
 * @template T - The type of the item's unique identifier
 * @param items - Array of items to group
 * @param groupLabels - Optional map of group IDs to labels
 * @returns Array of groups containing the items
 *
 * @example
 * ```typescript
 * const groups = groupItems(items, {
 *   "built-in": "Built-in Items",
 *   "custom": "Custom Items"
 * });
 * ```
 */
export function groupItems<T = string>(
	items: SelectorItem<T>[],
	groupLabels?: Record<string, string>
): SelectorGroup<T>[] {
	if (items.length === 0) {
		return [];
	}

	const groupsMap = new Map<string, SelectorItem<T>[]>();

	// Group items by their groupId
	for (const item of items) {
		const groupId = item.groupId ?? "ungrouped";
		const groupItems = groupsMap.get(groupId) ?? [];
		groupItems.push(item);
		groupsMap.set(groupId, groupItems);
	}

	// Convert map to array of groups
	const groups: SelectorGroup<T>[] = [];
	for (const [groupId, groupItems] of groupsMap.entries()) {
		const label = groupLabels?.[groupId] ?? (groupId === "ungrouped" ? "" : groupId);
		groups.push({
			id: groupId,
			label,
			items: groupItems,
		});
	}

	return groups;
}

/**
 * Filters items based on a predicate function.
 *
 * @template T - The type of the item's unique identifier
 * @param items - Array of items to filter
 * @param predicate - Function that returns true for items to include
 * @returns Filtered array of items
 *
 * @example
 * ```typescript
 * const builtInItems = filterItems(items, item => item.groupId === "built-in");
 * ```
 */
export function filterItems<T = string>(
	items: SelectorItem<T>[],
	predicate: (item: SelectorItem<T>) => boolean
): SelectorItem<T>[] {
	return items.filter(predicate);
}

/**
 * Checks if an item is selected.
 *
 * @template T - The type of the item's unique identifier
 * @param item - The item to check
 * @param selectedId - The currently selected ID
 * @returns True if the item is selected, false otherwise
 *
 * @example
 * ```typescript
 * const isSelected = isItemSelected(item, currentId);
 * ```
 */
export function isItemSelected<T = string>(item: SelectorItem<T>, selectedId: T | null): boolean {
	return item.id === selectedId;
}

/**
 * Validates that all items have unique IDs.
 *
 * @template T - The type of the item's unique identifier
 * @param items - Array of items to validate
 * @returns Result containing void on success or an error if duplicates found
 *
 * @example
 * ```typescript
 * const result = validateItems(items);
 * result
 *   .map(() => console.log('Valid'))
 *   .mapErr(error => console.error('Error:', error));
 * ```
 */
export function validateItems<T = string>(items: SelectorItem<T>[]): Result<void, SelectorError> {
	const ids = new Set<T>();
	for (const item of items) {
		if (ids.has(item.id)) {
			return err(new SelectorError(`Duplicate item ID found: ${String(item.id)}`, "INVALID_ITEM"));
		}
		ids.add(item.id);
	}
	return ok(undefined);
}
