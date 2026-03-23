import { err, ok, type Result } from "neverthrow";

/**
 * Default width for new panels in pixels.
 */
export const DEFAULT_PANEL_WIDTH = 400;

/**
 * Minimum width for panels in pixels.
 */
export const MIN_PANEL_WIDTH = 280;

/**
 * Represents an open panel displaying a session.
 */
export interface OpenPanel {
	/**
	 * Unique identifier for this panel instance.
	 */
	id: string;

	/**
	 * ID of the session being displayed in this panel.
	 * Null when the panel is pending project selection.
	 */
	sessionId: string | null;

	/**
	 * Width of the panel in pixels.
	 */
	width: number;

	/**
	 * Whether the panel is waiting for the user to select a project.
	 * When true, shows project selection UI instead of session view.
	 */
	pendingProjectSelection?: boolean;
}

/**
 * Layout configuration for panels.
 * Uses a flat array of panels with horizontal scrolling.
 */
export type PanelLayout = { panels: OpenPanel[] };

/**
 * State for the panel manager.
 */
export interface PanelManagerState {
	/**
	 * Current layout configuration.
	 */
	layout: PanelLayout;

	/**
	 * Currently focused panel ID (for keyboard navigation).
	 */
	focusedPanelId: string | null;
}

/**
 * Error types for panel operations.
 */
export class PanelError extends Error {
	constructor(
		message: string,
		public readonly code: PanelErrorCode
	) {
		super(message);
		this.name = "PanelError";
	}
}

export type PanelErrorCode =
	| "PANEL_NOT_FOUND"
	| "INVALID_LAYOUT"
	| "MAX_PANELS_REACHED"
	| "CANNOT_CLOSE_LAST_PANEL";

/**
 * Creates an empty panel layout.
 */
export function createEmptyLayout(): PanelLayout {
	return { panels: [] };
}

/**
 * Creates a new panel for a session.
 */
export function createPanel(sessionId: string, width = DEFAULT_PANEL_WIDTH): OpenPanel {
	return {
		id: crypto.randomUUID(),
		sessionId,
		width,
	};
}

/**
 * Creates a new panel pending project selection.
 * Used when spawning a new panel via cmd+t with multiple projects.
 */
export function createPendingPanel(width = DEFAULT_PANEL_WIDTH): OpenPanel {
	return {
		id: crypto.randomUUID(),
		sessionId: null,
		width,
		pendingProjectSelection: true,
	};
}

/**
 * Finds a panel by ID in the layout.
 */
export function findPanelById(layout: PanelLayout, panelId: string): Result<OpenPanel, PanelError> {
	const panel = layout.panels.find((p) => p.id === panelId);
	if (panel) {
		return ok(panel);
	}
	return err(new PanelError(`Panel not found: ${panelId}`, "PANEL_NOT_FOUND"));
}

/**
 * Gets all panels in the layout.
 */
export function getAllPanels(layout: PanelLayout): OpenPanel[] {
	return layout.panels;
}

/**
 * Counts the number of panels in the layout.
 */
export function countPanels(layout: PanelLayout): number {
	return layout.panels.length;
}

/**
 * Checks if a session is already open in any panel.
 */
export function findPanelBySessionId(
	layout: PanelLayout,
	sessionId: string
): Result<OpenPanel, PanelError> {
	const panel = layout.panels.find((p) => p.sessionId === sessionId);
	if (panel) {
		return ok(panel);
	}
	return err(new PanelError(`No panel found for session: ${sessionId}`, "PANEL_NOT_FOUND"));
}
