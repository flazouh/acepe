/**
 * Represents a selectable item in the selector component.
 *
 * @template T - The type of the item's unique identifier
 */
export interface SelectorItem<T = string> {
	/**
	 * Unique identifier for the item.
	 */
	id: T;

	/**
	 * Display name for the item.
	 */
	name: string;

	/**
	 * Optional icon source (URL or path).
	 */
	icon?: string;

	/**
	 * Optional icon CSS classes.
	 */
	iconClass?: string;

	/**
	 * Optional group identifier for categorizing items.
	 */
	groupId?: string;

	/**
	 * Optional metadata for custom rendering or logic.
	 */
	metadata?: Record<string, unknown>;
}
