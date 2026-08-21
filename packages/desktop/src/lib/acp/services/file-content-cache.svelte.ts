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

import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
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

type FetchFileContent = (filePath: string, projectPath: string) => Effect.Effect<string, unknown>;

type FetchFileDiff = (
	filePath: string,
	projectPath: string
) => Effect.Effect<FileDiffResult, unknown>;

type FileContentCacheOptions = {
	readonly fetchFileContent?: FetchFileContent;
	readonly fetchFileDiff?: FetchFileDiff;
};

function toFileContentCacheError(prefix: string, code: string) {
	return (error: unknown): FileContentCacheError => {
		if (error instanceof FileContentCacheError) {
			return error;
		}
		return new FileContentCacheError(`${prefix}${error}`, code);
	};
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
	private readonly contentInflightByKey = new Map<string, Promise<string>>();
	private readonly diffInflightByKey = new Map<string, Promise<FileDiffResult>>();
	private readonly fetchFileContent: FetchFileContent;
	private readonly fetchFileDiff: FetchFileDiff;

	constructor(options?: FileContentCacheOptions) {
		// 50 files max, 60 second TTL
		this.contentCache = new LRUCache<string>(50, 60000);
		this.diffCache = new LRUCache<FileDiffResult>(50, 60000);
		this.fetchFileContent =
			options?.fetchFileContent ??
			((filePath, projectPath) => fileIndex.readFileContent(filePath, projectPath));
		this.fetchFileDiff =
			options?.fetchFileDiff ??
			((filePath, projectPath) => fileIndex.getFileDiff(filePath, projectPath));
	}

	/**
	 * Get file content, using cache if available.
	 */
	getFileContent(
		filePath: string,
		projectPath: string
	): Effect.Effect<string, FileContentCacheError> {
		const cacheKey = `${projectPath}:${filePath}`;
		const cached = this.contentCache.get(cacheKey);

		if (cached !== null) {
			return Effect.succeed(cached);
		}

		const existingRequest = this.contentInflightByKey.get(cacheKey);
		if (existingRequest !== undefined) {
			return fromPromise(
				() => existingRequest,
				toFileContentCacheError(`Failed to read file ${filePath}: `, "READ_ERROR")
			);
		}

		const pending = Effect.runPromise(this.fetchFileContent(filePath, projectPath)).then(
			(content) => {
				this.contentCache.set(cacheKey, content);
				this.contentInflightByKey.delete(cacheKey);
				return content;
			},
			(error: unknown) => {
				this.contentInflightByKey.delete(cacheKey);
				throw error;
			}
		);
		this.contentInflightByKey.set(cacheKey, pending);
		return fromPromise(
			() => pending,
			toFileContentCacheError(`Failed to read file ${filePath}: `, "READ_ERROR")
		);
	}

	peekFileContent(filePath: string, projectPath: string): string | null {
		const cacheKey = `${projectPath}:${filePath}`;
		return this.contentCache.get(cacheKey);
	}

	/**
	 * Get file diff, using cache if available.
	 */
	getFileDiff(
		filePath: string,
		projectPath: string
	): Effect.Effect<FileDiffResult, FileContentCacheError> {
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
			return Effect.succeed(cached);
		}

		const existingRequest = this.diffInflightByKey.get(cacheKey);
		if (existingRequest !== undefined) {
			return fromPromise(
				() => existingRequest,
				toFileContentCacheError(`Failed to get diff for ${filePath}: `, "DIFF_ERROR")
			);
		}

		logger.info("Diff cache miss, invoking get_file_diff", {
			filePath,
			projectPath,
		});

		const pending = Effect.runPromise(this.fetchFileDiff(filePath, projectPath)).then(
			(diff) => {
				logger.info("Diff loaded from backend", {
					filePath,
					projectPath,
					hasOldContent: diff.oldContent !== null,
					oldLength: diff.oldContent?.length ?? 0,
					newLength: diff.newContent.length,
				});
				this.diffCache.set(cacheKey, diff);
				this.diffInflightByKey.delete(cacheKey);
				return diff;
			},
			(error: unknown) => {
				this.diffInflightByKey.delete(cacheKey);
				throw error;
			}
		);
		this.diffInflightByKey.set(cacheKey, pending);
		return fromPromise(
			() => pending,
			toFileContentCacheError(`Failed to get diff for ${filePath}: `, "DIFF_ERROR")
		);
	}

	/**
	 * Revert file content by writing new content to disk.
	 * Used by the review panel to reject changes by writing the original content back.
	 */
	revertFileContent(
		filePath: string,
		projectPath: string,
		content: string
	): Effect.Effect<void, FileContentCacheError> {
		return fileIndex.revertFileContent(filePath, projectPath, content).pipe(
			Effect.mapError(
				toFileContentCacheError(`Failed to revert file ${filePath}: `, "WRITE_ERROR")
			),
			Effect.map(() => {
				// Invalidate caches for this file after reverting
				this.invalidateFile(filePath, projectPath);
			})
		);
	}

	/**
	 * Invalidate cache for a specific file.
	 */
	invalidateFile(filePath: string, projectPath: string): void {
		const contentKey = `${projectPath}:${filePath}`;
		const diffKey = `diff:${projectPath}:${filePath}`;
		this.contentCache.invalidate(contentKey);
		this.diffCache.invalidate(diffKey);
		this.contentInflightByKey.delete(contentKey);
		this.diffInflightByKey.delete(diffKey);
	}

	/**
	 * Clear all caches.
	 */
	clear(): void {
		this.contentCache.clear();
		this.diffCache.clear();
		this.contentInflightByKey.clear();
		this.diffInflightByKey.clear();
	}
}

export function createFileContentCache(options?: FileContentCacheOptions): FileContentCache {
	return new FileContentCache(options);
}

/**
 * Singleton file content cache instance.
 */
export const fileContentCache = createFileContentCache();
