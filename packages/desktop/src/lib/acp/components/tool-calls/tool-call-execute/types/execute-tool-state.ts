/**
 * State for the execute tool component.
 *
 * Tracks the collapsed/expanded state and content availability.
 */
export interface ExecuteToolState {
	/**
	 * Whether the entire tool UI is collapsed (showing only header).
	 * Controlled by header chevron.
	 */
	readonly isCollapsed: boolean;

	/**
	 * Whether the content is collapsed to a few lines view.
	 * Controlled by footer chevron.
	 */
	readonly isContentCollapsed: boolean;

	/**
	 * Whether the tool call has content to display.
	 */
	readonly hasContent: boolean;
}
