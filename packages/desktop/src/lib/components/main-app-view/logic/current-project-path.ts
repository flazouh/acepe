export type CurrentProjectPathInput = {
	/** Project of the focused project view, when the layout groups by project. */
	readonly focusedViewProjectPath: string | null;
	/** Project of the focused top-level panel. */
	readonly focusedPanelProjectPath: string | null;
	/** First project in the sidebar order, used when nothing is focused. */
	readonly firstProjectPath: string | null;
};

/**
 * The project a workspace-wide action applies to: what the user looks at, then
 * what they have focused, then the first project they own.
 */
export function resolveCurrentProjectPath(input: CurrentProjectPathInput): string | null {
	return input.focusedViewProjectPath ?? input.focusedPanelProjectPath ?? input.firstProjectPath;
}
