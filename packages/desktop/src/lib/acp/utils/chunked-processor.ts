/**
 * Chunked Processor - Process large arrays without blocking the UI thread.
 *
 * Uses requestIdleCallback (with setTimeout fallback) to yield to the browser
 * between chunks, allowing the UI to remain responsive during heavy operations.
 */

/**
 * Process items in chunks, yielding to the browser between each chunk.
 * This prevents UI freezes when processing large arrays.
 *
 * @param items - The array of items to process
 * @param processor - Function to process each item
 * @param chunkSize - Number of items to process before yielding (default: 100)
 * @returns Promise resolving to array of processed results
 */
export async function processInChunks<T, R>(
	items: T[],
	processor: (item: T, index: number) => R,
	chunkSize: number = 100
): Promise<R[]> {
	const results: R[] = [];

	for (let i = 0; i < items.length; i += chunkSize) {
		const chunk = items.slice(i, i + chunkSize);

		// Process this chunk synchronously
		for (let j = 0; j < chunk.length; j++) {
			results.push(processor(chunk[j], i + j));
		}

		// Yield to the browser if there are more chunks
		if (i + chunkSize < items.length) {
			await yieldToMain();
		}
	}

	return results;
}

/**
 * Build a Map from an array in chunks, yielding between chunks.
 *
 * @param items - The array of items to process
 * @param keyExtractor - Function to extract the key from each item
 * @param valueExtractor - Optional function to extract the value (defaults to index)
 * @param filter - Optional filter function to include only certain items
 * @param chunkSize - Number of items to process before yielding (default: 200)
 * @returns Promise resolving to the built Map
 */
export async function buildMapInChunks<T, K, V = number>(
	items: T[],
	keyExtractor: (item: T, index: number) => K | null,
	valueExtractor?: (item: T, index: number) => V,
	filter?: (item: T) => boolean,
	chunkSize: number = 200
): Promise<Map<K, V>> {
	const map = new Map<K, V>();

	for (let i = 0; i < items.length; i += chunkSize) {
		const endIdx = Math.min(i + chunkSize, items.length);

		// Process this chunk synchronously
		for (let j = i; j < endIdx; j++) {
			const item = items[j];
			if (filter && !filter(item)) continue;

			const key = keyExtractor(item, j);
			if (key === null) continue;

			const value = valueExtractor ? valueExtractor(item, j) : (j as unknown as V);
			map.set(key, value);
		}

		// Yield to the browser if there are more chunks
		if (endIdx < items.length) {
			await yieldToMain();
		}
	}

	return map;
}

/**
 * Yield execution back to the main thread.
 * Uses requestIdleCallback if available, falls back to setTimeout.
 */
function yieldToMain(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestIdleCallback !== "undefined") {
			requestIdleCallback(() => resolve(), { timeout: 16 }); // ~1 frame
		} else {
			setTimeout(resolve, 0);
		}
	});
}

/**
 * Schedule work to run during idle time.
 * Returns immediately, work executes in background.
 *
 * @param work - Function to execute during idle time
 * @param timeout - Maximum time to wait before forcing execution (default: 50ms)
 */
export function scheduleIdleWork(work: () => void, timeout: number = 50): void {
	if (typeof requestIdleCallback !== "undefined") {
		requestIdleCallback(() => work(), { timeout });
	} else {
		setTimeout(work, 0);
	}
}
