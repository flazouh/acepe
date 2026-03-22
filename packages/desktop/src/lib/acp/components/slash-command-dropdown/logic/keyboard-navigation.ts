/**
 * Navigation direction for keyboard navigation.
 */
export type NavigationDirection = "up" | "down";

/**
 * Calculate next selected index when navigating down.
 *
 * @param currentIndex - Current selected index
 * @param totalItems - Total number of items
 * @returns Next index (wraps to 0 if at end)
 */
export function navigateDown(currentIndex: number, totalItems: number): number {
	if (totalItems === 0) {
		return 0;
	}
	return (currentIndex + 1) % totalItems;
}

/**
 * Calculate next selected index when navigating up.
 *
 * @param currentIndex - Current selected index
 * @param totalItems - Total number of items
 * @returns Previous index (wraps to end if at start)
 */
export function navigateUp(currentIndex: number, totalItems: number): number {
	if (totalItems === 0) {
		return 0;
	}
	return currentIndex <= 0 ? totalItems - 1 : currentIndex - 1;
}

/**
 * Check if a keyboard event is a navigation key.
 *
 * @param event - Keyboard event
 * @returns True if the key is ArrowDown or ArrowUp
 */
export function isNavigationKey(event: KeyboardEvent): boolean {
	return event.key === "ArrowDown" || event.key === "ArrowUp";
}

/**
 * Check if a keyboard event is a selection key.
 *
 * @param event - Keyboard event
 * @returns True if the key is Enter or Tab
 */
export function isSelectionKey(event: KeyboardEvent): boolean {
	return event.key === "Enter" || event.key === "Tab";
}

/**
 * Check if a keyboard event is the escape key.
 *
 * @param event - Keyboard event
 * @returns True if the key is Escape
 */
export function isEscapeKey(event: KeyboardEvent): boolean {
	return event.key === "Escape";
}
