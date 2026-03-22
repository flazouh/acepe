/**
 * Highlighter Pool Service
 *
 * Re-exports the singleton WorkerPoolManager for syntax highlighting.
 * This module exists for backward compatibility and provides a consistent
 * import path for components that need the highlighter pool.
 *
 * The actual worker pool is managed by worker-pool-singleton.ts.
 */

export {
	disposeWorkerPool as terminateHighlighter,
	ensureWorkerPoolInitialized as initializeHighlighter,
	getWorkerPool as getHighlighterPool,
	getWorkerPool,
} from "../utils/worker-pool-singleton.js";
