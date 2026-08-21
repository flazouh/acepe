import { fromPromise } from "@acepe/effect-result/fromPromise";
import {
	type WorkerInitializationRenderOptions,
	WorkerPoolManager,
	type WorkerPoolOptions,
} from "@pierre/diffs/worker";
import * as Effect from "effect/Effect";

import { workerFactory } from "./worker-factory.js";

let workerPool: WorkerPoolManager | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Keep startup light. Pierre queues highlighting until the pool is initialized,
 * so eager-loading many languages here delays the first visible highlighted diff.
 * Missing languages are resolved per task by WorkerPoolManager.
 */
const EAGER_WORKER_LANGS: readonly string[] = [];

function reportWorkerPoolInitFailure(pending: Promise<void>): void {
	void Effect.runPromise(
		fromPromise(
			() => pending,
			(e) => (e instanceof Error ? e : new Error(String(e)))
		).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: (error) => {
					console.error("Worker pool initialization failed:", error);
					// Pool will fall back to main thread rendering if initialization fails
					// This is handled gracefully by FileDiff
				},
			})
		)
	);
}

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
			poolSize: 4,
		};

		const initOptions: WorkerInitializationRenderOptions = {
			langs: Array.from(EAGER_WORKER_LANGS),
			theme: { dark: "Cursor Dark", light: "pierre-light" },
			lineDiffType: "word-alt",
			tokenizeMaxLineLength: 1000,
		};

		workerPool = new WorkerPoolManager(options, initOptions);

		// Start initialization immediately in background
		// This is non-blocking - pool can be used immediately
		const pending = workerPool.initialize(Array.from(EAGER_WORKER_LANGS));
		initPromise = pending;
		reportWorkerPoolInitFailure(pending);
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
	const pending = pool.initialize(Array.from(EAGER_WORKER_LANGS));
	initPromise = pending;
	reportWorkerPoolInitFailure(pending);
	return pending;
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
