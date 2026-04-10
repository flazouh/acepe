/**
 * Primary top-level terminal model.
 * A visible terminal panel is a TerminalPanelGroup with one or more TerminalTab records.
 */
/**
 * @deprecated Prefer TerminalPanelGroup for the visible top-level terminal panel model.
 * This compatibility alias exists only while store implementation still imports TerminalPanel.
 */
export type {
	PersistedTerminalPanelGroupState,
	PersistedTerminalTabState,
	PersistedTerminalWorkspacePanelState,
	TerminalPanelGroup,
	TerminalTab,
	TerminalWorkspacePanel,
	TerminalWorkspacePanel as TerminalPanel,
} from "./types.js";

export const DEFAULT_TERMINAL_PANEL_WIDTH = 500;
export const MIN_TERMINAL_PANEL_WIDTH = 300;
