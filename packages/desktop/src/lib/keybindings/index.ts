/**
 * Keybindings Module - Production-grade keyboard shortcut system.
 *
 * Features:
 * - Action registry for command definitions
 * - Keybinding registry with tinykeys integration
 * - Context manager for conditional shortcuts
 * - Conflict detection
 * - Cross-platform key formatting
 *
 * Usage:
 * ```typescript
 * import { getKeybindingsService } from '$lib/keybindings';
 *
 * const kb = getKeybindingsService();
 *
 * // Register an action
 * kb.upsertAction({
 *   id: 'myAction',
 *   label: 'My Action',
 *   category: 'general',
 *   handler: () => console.log('Action triggered!'),
 * });
 *
 * // Register a keybinding
 * kb.registerKeybinding({
 *   key: '$mod+m',
 *   command: 'myAction',
 * });
 *
 * // Install on window
 * kb.install(window);
 *
 * // Set context for conditional shortcuts
 * kb.setContext('modalOpen', true);
 * ```
 */

// Action Registry
export { ActionRegistry, createActionRegistry } from "./actions/registry.js";
// Default Keybindings
export { DEFAULT_KEYBINDINGS, getKeybindingsByCategory } from "./bindings/defaults.js";
// Keybinding Registry
export { createKeybindingRegistry, KeybindingRegistry } from "./bindings/registry.svelte.js";
// Constants
export { KEYBINDING_ACTIONS, type KeybindingActionId } from "./constants.js";
// Context Manager
export { ContextManager, createContextManager } from "./context/manager.svelte.js";
// Main Service
export {
	createKeybindingsService,
	getKeybindingsService,
	KeybindingsService,
	resetKeybindingsService,
} from "./service.svelte.js";
// Types
export type {
	Action,
	ActionCategory,
	ContextValue,
	Keybinding,
	KeybindingConflict,
	KeybindingErrorCode,
	ParsedKey,
	Platform,
} from "./types.js";
export { KeybindingError } from "./types.js";
// Formatter Utilities
export {
	detectPlatform,
	formatKey,
	formatKeyString,
	formatKeyStringToArray,
	getModKey,
	isMac,
	keyboardEventToKeyString,
	parseKeyString,
} from "./utils/formatter.js";
