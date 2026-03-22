/**
 * Memoization utilities for performance optimization.
 *
 * Provides caching for expensive computations like:
 * - Extension to language mapping
 * - HTML escaping
 * - Content hashing
 */

/**
 * Simple LRU cache implementation.
 */
export class LRUCache<K, V> {
	private cache = new Map<K, V>();
	private readonly maxSize: number;
	private lastKey: K | undefined = undefined;

	constructor(maxSize = 100) {
		this.maxSize = maxSize;
	}

	get(key: K): V | undefined {
		// Use has() for hit detection so stored undefined is treated as a hit
		if (this.cache.has(key)) {
			const value = this.cache.get(key);
			// Move to end (most recently used) - only if not already at end
			if (this.lastKey !== key) {
				// Entry exists (even if value is undefined)
				this.cache.delete(key);
				this.cache.set(key, value as V);
				this.lastKey = key;
			}
			return value;
		}
		return undefined;
	}

	set(key: K, value: V): void {
		// Delete if exists to update position
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxSize) {
			// Delete oldest entry (first in map)
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
				// Update lastKey if we deleted it
				if (this.lastKey === firstKey) {
					this.lastKey = undefined;
				}
			}
		}
		this.cache.set(key, value);
		this.lastKey = key;
	}

	has(key: K): boolean {
		return this.cache.has(key);
	}

	clear(): void {
		this.cache.clear();
		this.lastKey = undefined;
	}

	get size(): number {
		return this.cache.size;
	}
}

/**
 * Memoize a function with a simple cache.
 * Useful for pure functions with primitive arguments.
 */
export function memoize<T extends (...args: string[]) => unknown>(fn: T, maxCacheSize = 100): T {
	const cache = new LRUCache<string, ReturnType<T>>(maxCacheSize);

	return ((...args: string[]) => {
		const key = args.join("\0");
		const cached = cache.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const result = fn(...args) as ReturnType<T>;
		cache.set(key, result);
		return result;
	}) as T;
}

/**
 * HTML escape cache - common patterns are cached.
 */
const htmlEscapeCache = new LRUCache<string, string>(500);

/**
 * Escape HTML special characters with caching.
 * Cached because the same code patterns appear repeatedly.
 */
export function escapeHtml(text: string): string {
	// Skip cache for very long strings (>1000 chars)
	if (text.length > 1000) {
		return escapeHtmlUncached(text);
	}

	const cached = htmlEscapeCache.get(text);
	if (cached !== undefined) {
		return cached;
	}

	const escaped = escapeHtmlUncached(text);
	htmlEscapeCache.set(text, escaped);
	return escaped;
}

/**
 * Escape HTML without caching.
 */
function escapeHtmlUncached(text: string): string {
	// Fast path: no special characters
	if (!/[&<>"']/.test(text)) {
		return text;
	}

	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Fast hash function for content (FNV-1a).
 * Used for cache keys, not cryptographic purposes.
 */
export function hashContent(content: string): string {
	let hash = 2_166_136_261;
	for (let i = 0; i < content.length; i += 1) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 16_777_619);
	}
	// Convert to base36 for shorter string
	return (hash >>> 0).toString(36);
}

/**
 * Create a cache key from multiple strings.
 */
export function createCacheKey(...parts: (string | null | undefined)[]): string {
	return parts.map((p) => hashContent(p ?? "")).join("-");
}

/**
 * Extension to language mapping with memoization.
 */
const extensionToLanguageMap: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	mts: "typescript",
	cts: "typescript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	yml: "yaml",
	md: "markdown",
	htm: "html",
	svelte: "svelte",
	vue: "vue",
	gql: "graphql",
};

const supportedLanguages = new Set([
	"typescript",
	"javascript",
	"python",
	"html",
	"css",
	"json",
	"markdown",
	"rust",
	"go",
	"java",
	"cpp",
	"c",
	"php",
	"ruby",
	"swift",
	"text",
	"bash",
	"sh",
	"shell",
	"svelte",
	"tsx",
	"jsx",
	"vue",
	"yaml",
	"toml",
	"sql",
	"graphql",
]);

/**
 * Normalize file extension or language to a Shiki-compatible language.
 * Memoized for repeated calls with same extension.
 */
export const normalizeLanguage = memoize((extensionOrLang: string): string => {
	const lower = extensionOrLang.toLowerCase();

	// Already a supported language
	if (supportedLanguages.has(lower)) {
		return lower;
	}

	// Map extension to language
	const mapped = extensionToLanguageMap[lower];
	if (mapped && supportedLanguages.has(mapped)) {
		return mapped;
	}

	return "text";
}, 50);

/**
 * Get file extension from path (memoized).
 */
export const getFileExtension = memoize((filePath: string | null | undefined): string => {
	if (!filePath) return "";
	const parts = filePath.split(".");
	return parts.length > 1 ? parts[parts.length - 1] : "";
}, 100);

/**
 * Clear all memoization caches.
 * Useful for testing or memory pressure situations.
 */
export function clearMemoizationCaches(): void {
	htmlEscapeCache.clear();
}
