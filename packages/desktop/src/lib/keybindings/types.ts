/**
 * Core types for the keybinding system.
 */

/**
 * Represents an executable action in the application.
 */
export type Action = {
	/** Unique identifier for the action (e.g., "agent.select", "project.open") */
	id: string;
	/** Human-readable label for display in command palette */
	label: string;
	/** Optional description for additional context */
	description?: string;
	/** Category for grouping actions */
	category: ActionCategory;
	/** The function to execute when action is triggered */
	handler: () => void | Promise<void>;
	/** Optional context expression - action only available when this evaluates to true */
	when?: string;
	/** Optional icon identifier */
	icon?: string;
};

/**
 * Categories for organizing actions.
 */
export type ActionCategory =
	| "navigation"
	| "selection"
	| "selector"
	| "edit"
	| "view"
	| "file"
	| "thread"
	| "session"
	| "agent"
	| "project"
	| "general";

/**
 * Represents a keyboard shortcut binding to an action.
 */
export type Keybinding = {
	/** Key combination (e.g., "$mod+p", "g c" for sequence) */
	key: string;
	/** Action ID to execute */
	command: string;
	/** Optional context expression - binding only active when this evaluates to true */
	when?: string;
	/** Source of the binding (for override management) */
	source?: "default" | "user";
};

/**
 * Context value types supported by the context manager.
 */
export type ContextValue = boolean | string | number;

/**
 * Represents a conflict between keybindings.
 */
export type KeybindingConflict = {
	/** The conflicting key combination */
	key: string;
	/** All bindings that share this key */
	bindings: Keybinding[];
};

/**
 * Platform detection result.
 */
export type Platform = "mac" | "windows" | "linux" | "unknown";

/**
 * Parsed key combination for display.
 */
export type ParsedKey = {
	modifiers: string[];
	key: string;
};

/**
 * Error codes for keybinding operations.
 */
export type KeybindingErrorCode =
	| "ACTION_NOT_FOUND"
	| "ACTION_ALREADY_EXISTS"
	| "CONTEXT_CHECK_FAILED"
	| "EXECUTION_FAILED"
	| "INVALID_EXPRESSION"
	| "BINDING_CONFLICT"
	| "INSTALL_FAILED";

/**
 * Keybinding system error.
 */
export class KeybindingError extends Error {
	constructor(
		public readonly code: KeybindingErrorCode,
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = "KeybindingError";
	}
}
