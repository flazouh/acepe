declare module "tinykeys" {
	export type KeyBindingMap = Record<string, (event: KeyboardEvent) => void>;

	export type KeyBindingOptions = {
		/**
		 * Key presses will listen to this event (default: "keydown").
		 */
		event?: "keydown" | "keyup";
		/**
		 * Keybinding sequences will wait this long between key presses before
		 * cancelling (default: 1000).
		 */
		timeout?: number;
		/**
		 * Use capture phase for event listener.
		 */
		capture?: boolean;
	};

	/**
	 * Subscribes to keybindings.
	 *
	 * Returns an unsubscribe function.
	 */
	export function tinykeys(
		target: Window | HTMLElement,
		keyBindingMap: KeyBindingMap,
		options?: KeyBindingOptions
	): () => void;

	/**
	 * Creates a keybindings handler function.
	 */
	export function createKeybindingsHandler(
		keyBindingMap: KeyBindingMap,
		options?: { timeout?: number }
	): (event: KeyboardEvent) => void;

	/**
	 * Parse a keybinding string into its components.
	 */
	export function parseKeybinding(keybinding: string): Array<[string[], string | RegExp]>;

	/**
	 * Check if a keyboard event matches a parsed keybinding.
	 */
	export function matchKeyBindingPress(
		event: KeyboardEvent,
		keybinding: [string[], string | RegExp]
	): boolean;
}
