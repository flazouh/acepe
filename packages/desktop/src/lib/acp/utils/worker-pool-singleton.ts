import {
	type WorkerInitializationRenderOptions,
	WorkerPoolManager,
	type WorkerPoolOptions,
} from "@pierre/diffs/worker";
import { ResultAsync } from "neverthrow";

import { workerFactory } from "./worker-factory.js";

let workerPool: WorkerPoolManager | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Languages to preload for faster initial diff rendering.
 * Comprehensive list covering common programming languages.
 */
const PRELOAD_LANGS = [
	"typescript",
	"javascript",
	"svelte",
	"rust",
	"json",
	"css",
	"html",
	"markdown",
	"python",
	"go",
	"yaml",
	"toml",
	"bash",
	"sql",
] as const;

/**
 * Gets the singleton worker pool instance.
 *
 * The pool is created on first access and initialization starts immediately
 * in the background. The pool can be used immediately, but workers may not
 * be ready until initialization completes. FileDiff handles uninitialized
 * pools gracefully by falling back to main thread rendering.
 *
 * @returns The worker pool instance (may not be initialized yet)
 */
export function getWorkerPool(): WorkerPoolManager {
	if (!workerPool) {
		const options: WorkerPoolOptions = {
			workerFactory,
			poolSize: 8,
		};

		const initOptions: WorkerInitializationRenderOptions = {
			langs: [...PRELOAD_LANGS],
			theme: { dark: "Cursor Dark", light: "pierre-light" },
			lineDiffType: "word-alt",
			tokenizeMaxLineLength: 1000,
		};

		workerPool = new WorkerPoolManager(options, initOptions);

		// Start initialization immediately in background
		// This is non-blocking - pool can be used immediately
		initPromise = workerPool.initialize([...PRELOAD_LANGS]);
		// Handle errors with neverthrow while preserving promise for awaiting
		ResultAsync.fromPromise(initPromise, (e) => e as Error).mapErr((error) => {
			console.error("Worker pool initialization failed:", error);
			// Pool will fall back to main thread rendering if initialization fails
			// This is handled gracefully by FileDiff
		});
	}
	return workerPool;
}

/**
 * Ensures the worker pool is initialized before returning.
 *
 * If initialization is already in progress, waits for it to complete.
 * If initialization hasn't started, starts it and waits.
 *
 * This is optional - FileDiff can use the pool immediately and will
 * automatically use workers once they're ready.
 *
 * @returns Promise that resolves when the pool is initialized
 */
export function ensureWorkerPoolInitialized(): Promise<void> {
	const pool = getWorkerPool();
	if (pool.isInitialized()) {
		return Promise.resolve();
	}
	if (initPromise) {
		return initPromise;
	}
	// If we get here, pool exists but initPromise is null (shouldn't happen)
	// Start initialization now
	initPromise = pool.initialize([...PRELOAD_LANGS]);
	// Handle errors with neverthrow while preserving promise for awaiting
	ResultAsync.fromPromise(initPromise, (e) => e as Error).mapErr((error) => {
		console.error("Worker pool initialization failed:", error);
	});
	return initPromise;
}

/**
 * Disposes of the worker pool and cleans up resources.
 *
 * Terminates all workers and resets the singleton state.
 */
export function disposeWorkerPool(): void {
	workerPool?.terminate();
	workerPool = null;
	initPromise = null;
}
