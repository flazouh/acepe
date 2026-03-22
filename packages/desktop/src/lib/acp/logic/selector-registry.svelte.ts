/**
 * Selector Registry - Manages model/mode selector component references.
 *
 * This module implements the Registry pattern to solve the problem of
 * keybinding dispatch to the correct (focused) panel's selector.
 *
 * Instead of each selector registering its own keybinding handler (which
 * causes the last-mounted to win), we:
 * 1. Register a single global keybinding handler per selector type
 * 2. Selectors register themselves with their panelId on mount
 * 3. When keybinding fires, we look up the focused panel and call its selector
 *
 * Benefits:
 * - O(1) lookup and dispatch
 * - No handler churn on focus changes
 * - Single source of truth for keybinding handlers
 * - Clean component lifecycle (register on mount, unregister on destroy)
 */

import { getContext, hasContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";

type SelectorType = "model" | "mode";

interface SelectorRef {
	toggle: () => void;
	cycle?: () => void;
}

const SELECTOR_REGISTRY_KEY = Symbol.for("selector-registry");

/**
 * Creates a new SelectorRegistry instance.
 * Should be created once at app initialization and provided via context.
 */
export function createSelectorRegistry() {
	// Separate registries for model and mode selectors
	const registries = new SvelteMap<SelectorType, SvelteMap<string, SelectorRef>>([
		["model", new SvelteMap()],
		["mode", new SvelteMap()],
	]);

	/**
	 * Register a selector component for a specific panel.
	 * Called by selector components on mount.
	 *
	 * @param type - The type of selector ("model" or "mode")
	 * @param panelId - The unique ID of the panel containing this selector
	 * @param ref - Object with toggle method to call when keybinding fires
	 * @returns Cleanup function to call on component destroy
	 */
	function register(type: SelectorType, panelId: string, ref: SelectorRef): () => void {
		const registry = registries.get(type);
		if (registry) {
			registry.set(panelId, ref);
		}

		// Return cleanup function for onDestroy
		return () => {
			const registry = registries.get(type);
			if (registry) {
				registry.delete(panelId);
			}
		};
	}

	/**
	 * Toggle the selector for the currently focused panel.
	 * Called by the global keybinding handler.
	 *
	 * @param type - The type of selector to toggle
	 * @param focusedPanelId - The ID of the currently focused panel
	 */
	function toggleFocused(type: SelectorType, focusedPanelId: string | null): void {
		if (!focusedPanelId) {
			return;
		}

		const registry = registries.get(type);
		const selector = registry?.get(focusedPanelId);

		if (selector) {
			selector.toggle();
		}
	}

	/**
	 * Cycle the selector for the currently focused panel.
	 * Called by the global keybinding handler (e.g., Cmd+. for mode cycling).
	 *
	 * @param type - The type of selector to cycle
	 * @param focusedPanelId - The ID of the currently focused panel
	 */
	function cycleFocused(type: SelectorType, focusedPanelId: string | null): void {
		if (!focusedPanelId) {
			return;
		}

		const registry = registries.get(type);
		const selector = registry?.get(focusedPanelId);

		if (selector?.cycle) {
			selector.cycle();
		}
	}

	/**
	 * Check if a selector is registered for a panel.
	 * Useful for debugging.
	 */
	function has(type: SelectorType, panelId: string): boolean {
		return registries.get(type)?.has(panelId) ?? false;
	}

	/**
	 * Get the count of registered selectors.
	 * Useful for debugging.
	 */
	function count(type: SelectorType): number {
		return registries.get(type)?.size ?? 0;
	}

	return {
		register,
		toggleFocused,
		cycleFocused,
		has,
		count,
	};
}

export type SelectorRegistry = ReturnType<typeof createSelectorRegistry>;

/**
 * Set the SelectorRegistry in Svelte context.
 * Should be called once at app root level.
 */
export function setSelectorRegistryContext(): SelectorRegistry {
	const registry = createSelectorRegistry();
	setContext(SELECTOR_REGISTRY_KEY, registry);
	return registry;
}

/**
 * Get the SelectorRegistry from Svelte context.
 * Returns null if not in context (for SSR safety).
 */
export function getSelectorRegistry(): SelectorRegistry | null {
	if (!hasContext(SELECTOR_REGISTRY_KEY)) {
		return null;
	}
	return getContext<SelectorRegistry>(SELECTOR_REGISTRY_KEY);
}

/**
 * Get the SelectorRegistry, throwing if not available.
 * Use this in components that require the registry.
 */
export function useSelectorRegistry(): SelectorRegistry {
	const registry = getSelectorRegistry();
	if (!registry) {
		throw new Error(
			"SelectorRegistry not found in context. " +
				"Make sure setSelectorRegistryContext() is called at app root."
		);
	}
	return registry;
}
