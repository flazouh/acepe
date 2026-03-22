import { LRUCache } from "lru-cache";
import { ok, type Result } from "neverthrow";
import { untrack } from "svelte";
import type { TodoState } from "../types/todo.js";
import type { ToolCall } from "../types/tool-call.js";

import {
	createTodoSnapshotFromToolCall,
	createTodoState,
	type EntryWithMessage,
	type ThreadWithEntries,
	type TodoStateError,
} from "./todo-state.svelte.js";

/**
 * Cache entry with metadata for tracking performance.
 */
interface CacheEntry {
	state: TodoState | null;
	signature: string;
	computedAt: number;
	computationTime: number;
	entryCount: number;
}

/**
 * Performance metrics for monitoring cache effectiveness.
 */
export interface PerformanceMetrics {
	cacheHits: number;
	cacheMisses: number;
	totalComputations: number;
	averageComputationTime: number;
	cacheSize: number;
	hitRate: number;
}

/**
 * Type guard to check if an entry has normalized todos.
 * Works with both StoredEntry and ThreadEntryDTO.
 */
function hasTodos(entry: EntryWithMessage): entry is EntryWithMessage & { message: ToolCall } {
	if (entry.type !== "tool_call") return false;
	const message = entry.message as ToolCall | undefined;
	return message?.normalizedTodos != null && message.normalizedTodos.length > 0;
}

/**
 * Computes a fast signature for TodoWrite entries.
 * Only includes TodoWrite entries and their IDs to detect changes.
 *
 * NOTE: We use only entry IDs (not timestamps) because:
 * 1. Entry IDs are stable and unique
 * 2. Timestamps are Date objects that get recreated on each load
 * 3. Using getTime() should work but adds unnecessary complexity
 * 4. The combination of entry IDs is sufficient to detect todo changes
 */
function computeTodoSignature(entries: ReadonlyArray<EntryWithMessage>): string {
	const todoWrites = entries.filter(hasTodos);

	if (todoWrites.length === 0) {
		return "empty";
	}

	// Create signature from entry IDs only - stable across loads
	// IDs are UUIDs and unique per entry, so this is sufficient
	return todoWrites.map((entry) => entry.id).join("|");
}

/**
 * Singleton TodoStateManager with LRU caching and performance tracking.
 *
 * Features:
 * - Signature-based memoization (O(1) cache lookup)
 * - LRU eviction for bounded memory usage
 * - Performance metrics tracking
 * - Separate caching strategy for active vs historical threads
 */
class TodoStateManager {
	private cache: LRUCache<string, CacheEntry>;
	private metrics: PerformanceMetrics;
	private computationTimes: number[] = [];

	constructor() {
		// Configure LRU cache
		this.cache = new LRUCache<string, CacheEntry>({
			max: 100, // Max 100 thread states cached
			ttl: 1000 * 60 * 10, // 10 minute TTL
			updateAgeOnGet: true, // Reset TTL on access
			// Optional: track cache size
			maxSize: 50_000_000, // ~50MB limit
			sizeCalculation: (entry) => {
				// Rough size estimation
				return JSON.stringify(entry).length;
			},
		});

		this.metrics = {
			cacheHits: 0,
			cacheMisses: 0,
			totalComputations: 0,
			averageComputationTime: 0,
			cacheSize: 0,
			hitRate: 0,
		};
	}

	/**
	 * Gets todo state for a thread with caching.
	 *
	 * Performance:
	 * - Cache hit: O(1)
	 * - Cache miss: O(n) where n = number of TodoWrite entries
	 */
	getTodoState(
		threadId: string,
		thread: ThreadWithEntries | null
	): Result<TodoState | null, TodoStateError> {
		if (!thread) {
			return ok(null);
		}

		// Compute signature for cache key
		const signature = computeTodoSignature(thread.entries);
		const cacheKey = `${threadId}:${signature}`;

		// Check cache first
		const cached = this.cache.get(cacheKey);
		if (cached) {
			// Use untrack to prevent Svelte from detecting state mutations inside $derived
			untrack(() => {
				this.metrics.cacheHits++;
				this.updateMetrics();
			});
			return ok(cached.state);
		}

		// Cache miss - compute state
		const startTime = performance.now();

		const result = createTodoState(thread);

		const computationTime = performance.now() - startTime;

		// Use untrack to prevent Svelte from detecting state mutations inside $derived
		untrack(() => {
			this.metrics.cacheMisses++;
			this.recordComputationTime(computationTime);

			// Store in cache if successful
			if (result.isOk()) {
				this.cache.set(cacheKey, {
					state: result.value,
					signature,
					computedAt: Date.now(),
					computationTime,
					entryCount: thread.entries.length,
				});
			}

			this.updateMetrics();
		});

		return result;
	}

	/**
	 * Gets todo snapshot for a single tool call (used in-thread).
	 * These are typically not cached as they're lightweight.
	 */
	getTodoSnapshot(
		toolCall: ToolCall
	): Result<import("../types/todo.js").TodoSnapshot | null, TodoStateError> {
		return createTodoSnapshotFromToolCall(toolCall);
	}

	/**
	 * Invalidates cache for a specific thread.
	 * Use when thread entries are modified externally.
	 */
	invalidateThread(threadId: string): void {
		let invalidatedCount = 0;

		// Remove all cache entries for this thread
		for (const key of this.cache.keys()) {
			if (key.startsWith(`${threadId}:`)) {
				this.cache.delete(key);
				invalidatedCount++;
			}
		}

		if (import.meta.env.DEV && invalidatedCount > 0) {
			console.debug(
				`[TodoStateManager] Invalidated ${invalidatedCount} cache entries for thread ${threadId.slice(0, 8)}`
			);
		}

		// Use untrack to prevent Svelte from detecting state mutations inside $derived
		untrack(() => {
			this.updateMetrics();
		});
	}

	/**
	 * Clears entire cache (useful for testing or memory pressure).
	 */
	clearCache(): void {
		const size = this.cache.size;
		this.cache.clear();

		if (import.meta.env.DEV) {
			console.debug(`[TodoStateManager] Cleared cache (${size} entries)`);
		}

		// Use untrack to prevent Svelte from detecting state mutations inside $derived
		untrack(() => {
			this.updateMetrics();
		});
	}

	/**
	 * Gets current performance metrics.
	 */
	getMetrics(): PerformanceMetrics {
		return { ...this.metrics };
	}

	/**
	 * Records computation time for average calculation.
	 * NOTE: This method mutates internal state and should be called within untrack()
	 * when called from $derived contexts to avoid Svelte 5 state mutation errors.
	 */
	private recordComputationTime(time: number): void {
		this.computationTimes.push(time);

		// Keep only last 100 measurements for rolling average
		if (this.computationTimes.length > 100) {
			this.computationTimes.shift();
		}

		this.metrics.totalComputations++;
	}

	/**
	 * Updates metrics snapshot.
	 */
	private updateMetrics(): void {
		const total = this.metrics.cacheHits + this.metrics.cacheMisses;
		this.metrics.hitRate = total > 0 ? this.metrics.cacheHits / total : 0;
		this.metrics.cacheSize = this.cache.size;
		this.metrics.averageComputationTime =
			this.computationTimes.length > 0
				? this.computationTimes.reduce((a, b) => a + b, 0) / this.computationTimes.length
				: 0;
	}

	/**
	 * Logs performance summary (useful for debugging).
	 */
	logPerformanceSummary(): void {
		console.group("[TodoStateManager] Performance Summary");
		console.table({
			"Cache Hits": this.metrics.cacheHits,
			"Cache Misses": this.metrics.cacheMisses,
			"Hit Rate": `${(this.metrics.hitRate * 100).toFixed(1)}%`,
			"Cache Size": this.metrics.cacheSize,
			"Avg Computation": `${this.metrics.averageComputationTime.toFixed(2)}ms`,
			"Total Computations": this.metrics.totalComputations,
		});
		console.groupEnd();
	}
}

/**
 * Singleton instance of TodoStateManager.
 */
let managerInstance: TodoStateManager | null = null;

/**
 * Gets or creates the singleton TodoStateManager.
 */
export function getTodoStateManager(): TodoStateManager {
	if (!managerInstance) {
		managerInstance = new TodoStateManager();

		// Log performance summary every 5 minutes in dev mode
		if (import.meta.env.DEV) {
			setInterval(
				() => {
				const metrics = managerInstance?.getMetrics();
				if (metrics && metrics.totalComputations > 0) {
						managerInstance?.logPerformanceSummary();
					}
				},
				5 * 60 * 1000
			);
		}
	}

	return managerInstance;
}

/**
 * Computes a signature for a set of thread entries.
 * Exported for testing and external use.
 */
export { computeTodoSignature };
