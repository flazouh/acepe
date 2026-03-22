/**
 * Key Formatter - Utilities for formatting keyboard shortcuts for display.
 *
 * Handles platform-specific key symbols and formatting.
 */

import type { ParsedKey, Platform } from "../types.js";

/**
 * Detect the current platform.
 */
export function detectPlatform(): Platform {
	if (typeof navigator === "undefined") {
		return "unknown";
	}

	const platform = navigator.platform.toLowerCase();

	if (platform.includes("mac")) {
		return "mac";
	}
	if (platform.includes("win")) {
		return "windows";
	}
	if (platform.includes("linux")) {
		return "linux";
	}

	return "unknown";
}

/**
 * Check if the current platform is Mac.
 */
export function isMac(): boolean {
	return detectPlatform() === "mac";
}

/**
 * Mac-specific key symbols.
 */
const MAC_SYMBOLS: Record<string, string> = {
	$mod: "⌘",
	Meta: "⌘",
	Command: "⌘",
	Control: "⌃",
	Ctrl: "⌃",
	Alt: "⌥",
	Option: "⌥",
	Shift: "⇧",
	Enter: "↵",
	Return: "↵",
	Escape: "⎋",
	Esc: "⎋",
	Backspace: "⌫",
	Delete: "⌦",
	Tab: "⇥",
	Space: "␣",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	PageUp: "⇞",
	PageDown: "⇟",
	Home: "↖",
	End: "↘",
	CapsLock: "⇪",
};

/**
 * Windows/Linux key symbols.
 */
const OTHER_SYMBOLS: Record<string, string> = {
	$mod: "Ctrl",
	Meta: "Win",
	Command: "Win",
	Control: "Ctrl",
	Ctrl: "Ctrl",
	Alt: "Alt",
	Option: "Alt",
	Shift: "Shift",
	Enter: "Enter",
	Return: "Enter",
	Escape: "Esc",
	Esc: "Esc",
	Backspace: "Backspace",
	Delete: "Del",
	Tab: "Tab",
	Space: "Space",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	PageUp: "PgUp",
	PageDown: "PgDn",
	Home: "Home",
	End: "End",
	CapsLock: "CapsLock",
};

/**
 * Get the symbol map for the current platform.
 */
function getSymbolMap(): Record<string, string> {
	return isMac() ? MAC_SYMBOLS : OTHER_SYMBOLS;
}

/**
 * Format a single key for display.
 */
export function formatKey(key: string): string {
	const symbols = getSymbolMap();

	// Check for exact match first
	if (symbols[key]) {
		return symbols[key];
	}

	// Check case-insensitive
	const lowerKey = key.toLowerCase();
	for (const [k, v] of Object.entries(symbols)) {
		if (k.toLowerCase() === lowerKey) {
			return v;
		}
	}

	// Return as-is, but capitalize single letters
	if (key.length === 1) {
		return key.toUpperCase();
	}

	return key;
}

/**
 * Parse a tinykeys-style key string into components.
 *
 * Examples:
 * - "$mod+s" -> { modifiers: ["$mod"], key: "s" }
 * - "Shift+Alt+Delete" -> { modifiers: ["Shift", "Alt"], key: "Delete" }
 * - "g c" -> { modifiers: [], key: "g c" } (sequence)
 */
export function parseKeyString(keyString: string): ParsedKey {
	// Handle sequences (space-separated)
	if (keyString.includes(" ") && !keyString.includes("+")) {
		return {
			modifiers: [],
			key: keyString,
		};
	}

	const parts = keyString.split("+");
	const modifiers: string[] = [];
	let key = "";

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i].trim();
		if (i === parts.length - 1) {
			key = part;
		} else {
			modifiers.push(part);
		}
	}

	return { modifiers, key };
}

/**
 * Format a tinykeys-style key string for display.
 *
 * Examples (on Mac):
 * - "$mod+s" -> "⌘S"
 * - "Shift+$mod+p" -> "⇧⌘P"
 * - "$mod+Shift+f" -> "⌘⇧F"
 *
 * Examples (on Windows/Linux):
 * - "$mod+s" -> "Ctrl+S"
 * - "Shift+$mod+p" -> "Shift+Ctrl+P"
 */
export function formatKeyString(keyString: string): string {
	const parsed = parseKeyString(keyString);

	// Handle sequences
	if (parsed.modifiers.length === 0 && parsed.key.includes(" ")) {
		const parts = parsed.key.split(" ");
		return parts.map((p) => formatKey(p)).join(" ");
	}

	const formattedModifiers = parsed.modifiers.map(formatKey);
	const formattedKey = formatKey(parsed.key);

	if (isMac()) {
		// Mac uses no separator between modifiers and key
		return [...formattedModifiers, formattedKey].join("");
	}

	// Windows/Linux uses + separator
	return [...formattedModifiers, formattedKey].join("+");
}

/**
 * Format a key string into an array of individual key symbols.
 * Useful for rendering with <Kbd> components.
 *
 * Examples (on Mac):
 * - "$mod+s" -> ["⌘", "S"]
 * - "Shift+$mod+p" -> ["⇧", "⌘", "P"]
 */
export function formatKeyStringToArray(keyString: string): string[] {
	const parsed = parseKeyString(keyString);

	// Handle sequences
	if (parsed.modifiers.length === 0 && parsed.key.includes(" ")) {
		const parts = parsed.key.split(" ");
		return parts.map((p) => formatKey(p));
	}

	const formattedModifiers = parsed.modifiers.map(formatKey);
	const formattedKey = formatKey(parsed.key);

	return [...formattedModifiers, formattedKey];
}

/**
 * Convert a native KeyboardEvent to a tinykeys-style key string.
 * Useful for capturing custom keybindings from user input.
 */
export function keyboardEventToKeyString(event: KeyboardEvent): string {
	const parts: string[] = [];

	if (event.metaKey || event.ctrlKey) {
		parts.push("$mod");
	}
	if (event.shiftKey) {
		parts.push("Shift");
	}
	if (event.altKey) {
		parts.push("Alt");
	}

	// Use event.key for the main key
	let key = event.key;

	// Normalize some keys
	if (key === " ") {
		key = "Space";
	}

	// Don't add modifier keys as the main key
	if (!["Control", "Meta", "Shift", "Alt"].includes(key)) {
		parts.push(key);
	}

	return parts.join("+");
}

/**
 * Get the modifier key name for the current platform.
 * Returns "⌘" on Mac, "Ctrl" on Windows/Linux.
 */
export function getModKey(): string {
	return formatKey("$mod");
}
