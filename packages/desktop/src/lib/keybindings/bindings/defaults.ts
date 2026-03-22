/**
 * Default Keybindings - Built-in keyboard shortcuts for the application.
 *
 * These can be overridden by user keybindings.
 */

import { KEYBINDING_ACTIONS } from "../constants.js";
import type { Keybinding } from "../types.js";

/**
 * Default keybindings for the application.
 * Uses tinykeys syntax:
 * - "$mod" = Cmd on Mac, Ctrl on Windows/Linux
 * - "+" separates key combinations
 * - " " (space) creates key sequences (e.g., "g c" = press g, then c)
 */
export const DEFAULT_KEYBINDINGS: Keybinding[] = [
	// ============================================
	// Selector Actions (suppressed when settings is open)
	// ============================================
	{
		key: "$mod+l",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_TOGGLE,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+1",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_1,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+2",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_2,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+3",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_3,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+4",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_4,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+5",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_5,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+6",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_6,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+7",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_7,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+8",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_8,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+9",
		command: KEYBINDING_ACTIONS.SELECTOR_AGENT_SELECT_9,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+Shift+p",
		command: KEYBINDING_ACTIONS.SELECTOR_PROJECT_TOGGLE,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+.",
		command: KEYBINDING_ACTIONS.SELECTOR_MODE_TOGGLE,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+/",
		command: KEYBINDING_ACTIONS.SELECTOR_MODEL_TOGGLE,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},

	// ============================================
	// Navigation (suppressed when settings is open)
	// ============================================
	{
		key: "$mod+p",
		command: KEYBINDING_ACTIONS.COMMAND_PALETTE_TOGGLE,
		when: "!settingsOpen",
		source: "default",
	},
	{
		key: "$mod+b",
		command: KEYBINDING_ACTIONS.SIDEBAR_TOGGLE,
		when: "!settingsOpen",
		source: "default",
	},
	{
		key: "$mod+Shift+b",
		command: KEYBINDING_ACTIONS.TOP_BAR_TOGGLE,
		when: "!settingsOpen",
		source: "default",
	},
	{
		key: "$mod+\\",
		command: "panel.split",
		when: "!settingsOpen",
		source: "default",
	},

	// ============================================
	// Thread Actions (suppressed when settings is open)
	// ============================================
	{
		key: "$mod+t",
		command: KEYBINDING_ACTIONS.THREAD_CREATE,
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+w",
		command: KEYBINDING_ACTIONS.THREAD_CLOSE,
		when: "threadActive && !settingsOpen",
		source: "default",
	},
	{
		key: "$mod+Shift+t",
		command: "thread.reopen",
		when: "!settingsOpen",
		source: "default",
	},

	// ============================================
	// Input Actions (always active)
	// ============================================
	{
		key: "Escape",
		command: "input.cancel",
		when: "inputFocused",
		source: "default",
	},
	{
		key: "$mod+Enter",
		command: "input.submit",
		when: "inputFocused",
		source: "default",
	},

	// ============================================
	// Modal/Dialog Actions (always active)
	// ============================================
	{
		key: "Escape",
		command: KEYBINDING_ACTIONS.MODAL_CLOSE,
		when: "modalOpen",
		source: "default",
	},

	// ============================================
	// View Actions (suppressed when settings is open)
	// ============================================
	{
		key: "$mod+Shift+d",
		command: KEYBINDING_ACTIONS.DEBUG_TOGGLE,
		when: "!settingsOpen",
		source: "default",
	},

	// ============================================
	// Quick Actions (vim-style sequences)
	// ============================================
	{
		key: "g h",
		command: "navigation.home",
		when: "!inputFocused && !settingsOpen",
		source: "default",
	},
	// Settings toggle - always active (for Cmd+, to close settings too)
	{
		key: "$mod+,",
		command: KEYBINDING_ACTIONS.SETTINGS_OPEN,
		source: "default",
	},

	// ============================================
	// Zoom Actions (always active)
	// ============================================
	{
		key: "$mod+=",
		command: KEYBINDING_ACTIONS.ZOOM_IN,
		source: "default",
	},
	{
		key: "$mod+-",
		command: KEYBINDING_ACTIONS.ZOOM_OUT,
		source: "default",
	},
	{
		key: "$mod+0",
		command: KEYBINDING_ACTIONS.ZOOM_RESET,
		source: "default",
	},

	// ============================================
	// Urgency Actions (suppressed when settings is open)
	// ============================================
	{
		key: "$mod+j",
		command: KEYBINDING_ACTIONS.URGENCY_JUMP_FIRST,
		when: "threadActive && !settingsOpen",
		source: "default",
	},
];

/**
 * Get a subset of keybindings by category prefix.
 */
export function getKeybindingsByCategory(category: string): Keybinding[] {
	return DEFAULT_KEYBINDINGS.filter((b) => b.command.startsWith(`${category}.`));
}
