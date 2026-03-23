import type { SelectorItem } from "./selector-item.js";

/**
 * Represents a group of selector items.
 *
 * @template T - The type of the item's unique identifier
 */
export interface SelectorGroup<T = string> {
	/**
	 * Unique identifier for the group.
	 */
	id: string;

	/**
	 * Display label for the group.
	 */
	label: string;

	/**
	 * Items belonging to this group.
	 */
	items: SelectorItem<T>[];
}
