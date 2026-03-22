/**
 * ReactiveBox - A container that ensures Svelte 5 reactivity
 * propagates correctly through getter chains.
 *
 * Problem: When using factory functions that return objects with getters,
 * Svelte 5's fine-grained reactivity doesn't track dependencies through
 * nested getter calls across module boundaries.
 *
 * Solution: Wrap mutable state in a reactive container. Getters that return
 * `box.value` will properly track the underlying $state dependency.
 *
 * Performance: O(1) read, O(1) write
 *
 * @example
 * ```typescript
 * // In a factory function
 * const threadsBox = new ReactiveBox<ThreadState[]>([]);
 *
 * return {
 *   get threads() {
 *     return threadsBox.value; // Svelte tracks this read
 *   },
 *   addThread(thread: ThreadState) {
 *     threadsBox.value = [...threadsBox.value, thread]; // Triggers reactivity
 *   }
 * };
 * ```
 */
export class ReactiveBox<T> {
	#value = $state<T>() as T;

	constructor(initialValue: T) {
		this.#value = initialValue;
	}

	/**
	 * Get the current value. Reading this in a reactive context
	 * (component, $effect, $derived) establishes a dependency.
	 */
	get value(): T {
		return this.#value;
	}

	/**
	 * Set a new value. This triggers reactivity for all readers.
	 */
	set value(newValue: T) {
		this.#value = newValue;
	}

	/**
	 * Update value using a function (for immutable updates).
	 * Useful for arrays and objects where you want to derive from current value.
	 *
	 * @example
	 * ```typescript
	 * threadsBox.update(threads => [...threads, newThread]);
	 * versionBox.update(v => v + 1);
	 * ```
	 */
	update(fn: (current: T) => T): void {
		this.#value = fn(this.#value);
	}

	/**
	 * Get a snapshot of the current value (non-reactive read).
	 * Use this when you need the value but don't want to establish a dependency.
	 */
	peek(): T {
		return this.#value;
	}
}

/**
 * Factory function for creating reactive boxes.
 * Provides a more functional API alternative to `new ReactiveBox()`.
 *
 * @example
 * ```typescript
 * const count = createBox(0);
 * const items = createBox<string[]>([]);
 * ```
 */
export function createBox<T>(initialValue: T): ReactiveBox<T> {
	return new ReactiveBox(initialValue);
}

/**
 * Type helper for extracting the value type from a ReactiveBox.
 */
export type Unbox<T> = T extends ReactiveBox<infer U> ? U : never;
