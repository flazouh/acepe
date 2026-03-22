/**
 * State manager for Execute Tool UI component.
 *
 * Manages local UI state for the execute tool display:
 * - Modal open/closed state
 * - Content collapse state
 *
 * Follows idiomatic Svelte 5 pattern: classes manage local state only.
 * Props and derived values belong in the component.
 *
 * @example
 * ```ts
 * const state = new ExecuteToolUIState();
 *
 * // Access state
 * state.isModalOpen
 * state.isCollapsed
 *
 * // Call methods
 * state.toggleCollapse();
 * state.openModal();
 * ```
 */
export class ExecuteToolUIState {
	/**
	 * Whether the output modal is open.
	 */
	isModalOpen = $state(false);

	/**
	 * Whether the content is collapsed.
	 */
	isCollapsed = $state(false);

	/**
	 * Toggle the collapse state of the content.
	 */
	toggleCollapse(): void {
		this.isCollapsed = !this.isCollapsed;
	}

	/**
	 * Open the output modal.
	 */
	openModal(): void {
		this.isModalOpen = true;
	}

	/**
	 * Close the output modal.
	 */
	closeModal(): void {
		this.isModalOpen = false;
	}
}
