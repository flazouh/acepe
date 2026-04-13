/**
 * File Content Cache Service
 *
 * LRU cache for file contents fetched from the backend.
 * Prevents re-fetching the same file when navigating back and forth
 * in the file picker.
 *
 * Features:
 * - LRU eviction when cache is full
 * - TTL-based expiration for stale content
 * - Separate caches for file content and diff content
 */

import { okAsync, ResultAsync } from "neverthrow";
import { fileIndex } from "$lib/utils/tauri-client/file-index.js";

import { FileContentCacheError } from "../errors/file-content-cache-error.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ id: "file-content-cache", name: "FileContentCache" });

/**
 * Cached file content entry.
 */
interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

/**
 * File diff result from backend.
 */
interface FileDiffResult {
	oldContent: string | null;
	newContent: string;
	fileName: string;
}

/**
 * LRU Cache implementation with TTL support.
 */
class LRUCache<T> {
	private cache = new Map<string, CacheEntry<T>>();
	private readonly maxSize: number;
	private readonly ttlMs: number;

	constructor(maxSize: number, ttlMs: number) {
		this.maxSize = maxSize;
		this.ttlMs = ttlMs;
	}

	get(key: string): T | null {
		const entry = this.cache.get(key);
		if (!entry) {
			return null;
		}

		// Check TTL
		if (Date.now() - entry.timestamp > this.ttlMs) {
			this.cache.delete(key);
			return null;
		}

		// Move to end (most recently used)
		this.cache.delete(key);
		this.cache.set(key, entry);

		return entry.data;
	}

	set(key: string, data: T): void {
		// Remove oldest if at capacity
		if (this.cache.size >= this.maxSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		});
	}

	invalidate(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}
}

/**
 * File content cache with LRU eviction.
 */
class FileContentCache {
	private readonly contentCache: LRUCache<string>;
	private readonly diffCache: LRUCache<FileDiffResult>;

	constructor() {
		// 50 files max, 60 second TTL
		this.contentCache = new LRUCache<string>(50, 60000);
		this.diffCache = new LRUCache<FileDiffResult>(50, 60000);
	}

	/**
	 * Get file content, using cache if available.
	 */
	getFileContent(
		filePath: string,
		projectPath: string
	): ResultAsync<string, FileContentCacheError> {
		const cacheKey = `${projectPath}:${filePath}`;
		const cached = this.contentCache.get(cacheKey);

		if (cached !== null) {
			return okAsync(cached);
		}

		return fileIndex.readFileContent(filePath, projectPath).mapErr((error) => {
			return new FileContentCacheError(`Failed to read file ${filePath}: ${error}`, "READ_ERROR");
		}).map((content) => {
			this.contentCache.set(cacheKey, content);
			return content;
		});
	}

	/**
	 * Get file diff, using cache if available.
	 */
	getFileDiff(
		filePath: string,
		projectPath: string
	): ResultAsync<FileDiffResult, FileContentCacheError> {
		const cacheKey = `diff:${projectPath}:${filePath}`;
		const cached = this.diffCache.get(cacheKey);

		if (cached !== null) {
			logger.info("Diff cache hit", {
				filePath,
				projectPath,
				hasOldContent: cached.oldContent !== null,
				oldLength: cached.oldContent?.length ?? 0,
				newLength: cached.newContent.length,
			});
			return okAsync(cached);
		}

		logger.info("Diff cache miss, invoking get_file_diff", {
			filePath,
			projectPath,
		});

		return fileIndex.getFileDiff(filePath, projectPath).mapErr((error) => {
			return new FileContentCacheError(`Failed to get diff for ${filePath}: ${error}`, "DIFF_ERROR");
		}).map((diff) => {
			logger.info("Diff loaded from backend", {
				filePath,
				projectPath,
				hasOldContent: diff.oldContent !== null,
				oldLength: diff.oldContent?.length ?? 0,
				newLength: diff.newContent.length,
			});
			this.diffCache.set(cacheKey, diff);
			return diff;
		});
	}

	/**
	 * Revert file content by writing new content to disk.
	 * Used by the review panel to reject changes by writing the original content back.
	 */
	revertFileContent(
		filePath: string,
		projectPath: string,
		content: string
	): ResultAsync<void, FileContentCacheError> {
		return fileIndex.revertFileContent(filePath, projectPath, content).mapErr((error) => {
			return new FileContentCacheError(
				`Failed to revert file ${filePath}: ${error}`,
				"WRITE_ERROR"
			);
		}).map(() => {
			// Invalidate caches for this file after reverting
			this.invalidateFile(filePath, projectPath);
		});
	}

	/**
	 * Invalidate cache for a specific file.
	 */
	invalidateFile(filePath: string, projectPath: string): void {
		const contentKey = `${projectPath}:${filePath}`;
		const diffKey = `diff:${projectPath}:${filePath}`;
		this.contentCache.invalidate(contentKey);
		this.diffCache.invalidate(diffKey);
	}

	/**
	 * Clear all caches.
	 */
	clear(): void {
		this.contentCache.clear();
		this.diffCache.clear();
	}
}

/**
 * Singleton file content cache instance.
 */
export const fileContentCache = new FileContentCache();
