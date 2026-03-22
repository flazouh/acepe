/**
 * UI state manager for selector component.
 *
 * Manages only local UI state (dropdown open/closed).
 * Props (items, selectedId, isLoading, groups) are managed by the component
 * using $derived and config directly, following Svelte 5 best practices.
 *
 * @template T - The type of the item's unique identifier (unused but kept for API compatibility)
 */
export class SelectorState<_T = string> {
	/**
	 * Whether the dropdown is open.
	 * This is the only state managed here - it's UI-only state.
	 */
	isOpen = $state(false);

	/**
	 * Toggle the dropdown open/closed state.
	 *
	 * @param callback - Optional callback to invoke with the new state
	 */
	toggle(callback?: (isOpen: boolean) => void): void {
		this.isOpen = !this.isOpen;
		callback?.(this.isOpen);
	}

	/**
	 * Open the dropdown.
	 */
	open(): void {
		this.isOpen = true;
	}

	/**
	 * Close the dropdown.
	 */
	close(): void {
		this.isOpen = false;
	}

	/**
	 * Set the dropdown open state directly.
	 *
	 * @param isOpen - Whether the dropdown should be open
	 * @param callback - Optional callback to invoke with the new state
	 */
	setOpen(isOpen: boolean, callback?: (isOpen: boolean) => void): void {
		this.isOpen = isOpen;
		callback?.(isOpen);
	}
}
