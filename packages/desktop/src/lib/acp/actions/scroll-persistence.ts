/**
 * Svelte action for persisting scroll position.
 * Handles debounced saving and restoration on mount.
 *
 * Usage:
 *   <div use:scrollPersistence={{ get, set, direction: 'vertical' }}>
 */

export interface ScrollPersistenceOptions {
	/** Function to get the saved scroll position */
	get: () => number;
	/** Function to save the scroll position */
	set: (value: number) => void;
	/** Scroll direction to track */
	direction: "horizontal" | "vertical";
	/** Debounce delay in ms (default: 300) */
	debounceMs?: number;
}

export function scrollPersistence(node: HTMLElement, options: ScrollPersistenceOptions) {
	const { direction, debounceMs = 300 } = options;
	let { get, set } = options;

	const scrollProp = direction === "horizontal" ? "scrollLeft" : "scrollTop";

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let isRestoring = false;

	function handleScroll() {
		if (isRestoring) return;

		const scrollValue = node[scrollProp];

		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		debounceTimer = setTimeout(() => {
			set(scrollValue);
			debounceTimer = null;
		}, debounceMs);
	}

	function restore() {
		const savedValue = get();
		if (savedValue > 0) {
			isRestoring = true;
			requestAnimationFrame(() => {
				node[scrollProp] = savedValue;
				// Allow scroll event to fire before re-enabling persistence
				setTimeout(() => {
					isRestoring = false;
				}, 50);
			});
		}
	}

	// Attach listener and restore on mount
	node.addEventListener("scroll", handleScroll, { passive: true });
	restore();

	return {
		// Update handler when options change (for reactive params like threadId)
		update(newOptions: ScrollPersistenceOptions) {
			get = newOptions.get;
			set = newOptions.set;
			// Re-restore when key changes (e.g., threadId changes)
			restore();
		},

		destroy() {
			node.removeEventListener("scroll", handleScroll);
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
		},
	};
}
