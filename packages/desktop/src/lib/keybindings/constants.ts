/**
 * Keybinding Action IDs - Centralized constants for all keyboard shortcuts.
 *
 * These constants define the action IDs used throughout the application.
 * Components should reference these constants instead of using magic strings.
 *
 * Usage:
 * ```typescript
 * import { KEYBINDING_ACTIONS } from '$lib/keybindings/constants';
 * import { getKeybindingsService } from '$lib/keybindings';
 *
 * const kb = getKeybindingsService();
 *
 * // Register action
 * kb.upsertAction({
 *   id: KEYBINDING_ACTIONS.SELECTOR_AGENT_TOGGLE,
 *   label: 'Toggle Agent Selector',
 *   category: 'selector',
 *   handler: () => doSomething(),
 * });
 *
 * // Get shortcut for UI display
 * const keys = kb.getShortcutArray(KEYBINDING_ACTIONS.SELECTOR_AGENT_TOGGLE);
 * ```
 */

/**
 * All keybinding action IDs used in the application.
 */
export const KEYBINDING_ACTIONS = {
	// Selector Actions
	SELECTOR_AGENT_TOGGLE: "selector.agent.toggle",
	SELECTOR_AGENT_SELECT_1: "selector.agent.select.1",
	SELECTOR_AGENT_SELECT_2: "selector.agent.select.2",
	SELECTOR_AGENT_SELECT_3: "selector.agent.select.3",
	SELECTOR_AGENT_SELECT_4: "selector.agent.select.4",
	SELECTOR_AGENT_SELECT_5: "selector.agent.select.5",
	SELECTOR_AGENT_SELECT_6: "selector.agent.select.6",
	SELECTOR_AGENT_SELECT_7: "selector.agent.select.7",
	SELECTOR_AGENT_SELECT_8: "selector.agent.select.8",
	SELECTOR_AGENT_SELECT_9: "selector.agent.select.9",
	SELECTOR_PROJECT_TOGGLE: "selector.project.toggle",
	SELECTOR_MODE_TOGGLE: "selector.mode.toggle",
	SELECTOR_MODEL_TOGGLE: "selector.model.toggle",

	// Navigation
	COMMAND_PALETTE_TOGGLE: "commandPalette.toggle",
	SIDEBAR_TOGGLE: "sidebar.toggle",
	TOP_BAR_TOGGLE: "topbar.toggle",
	SETTINGS_OPEN: "settings.open",
	SQL_STUDIO_OPEN: "sqlStudio.open",
	DEBUG_TOGGLE: "debug.toggle",

	// Thread Actions
	THREAD_CREATE: "thread.create",
	THREAD_CLOSE: "thread.close",

	// Panel Actions
	PANEL_FULLSCREEN_TOGGLE: "panel.fullscreen.toggle",

	// Sync Actions
	SYNC_REFRESH: "sync.refresh",

	// Modal Actions
	MODAL_CLOSE: "modal.close",

	// View/Zoom Actions
	ZOOM_IN: "view.zoom.in",
	ZOOM_OUT: "view.zoom.out",
	ZOOM_RESET: "view.zoom.reset",

	// Urgency Actions
	URGENCY_JUMP_FIRST: "urgency.jump.first",
} as const;

/**
 * Type for keybinding action IDs.
 */
export type KeybindingActionId = (typeof KEYBINDING_ACTIONS)[keyof typeof KEYBINDING_ACTIONS];
