/**
 * OptimizedThreadStorage - Storage with O(1) indices for fast lookups.
 *
 * This storage maintains multiple indices for efficient queries:
 * - byId: O(1) lookup by thread ID
 * - byProject: O(k) lookup by project (k = threads in project)
 * - byAgent: O(k) lookup by agent (k = threads for agent)
 *
 * Key features:
 * - All lookups are O(1) or O(k) where k is result size
 * - Indices are automatically maintained on insert/update/delete
 * - Thread list sorted by updatedAt for display
 * - Reactive state for Svelte 5 compatibility
 */

/**
 * Stored thread data structure.
 * This is the serialized form of ThreadAggregate for persistence.
 */
export interface StoredThread {
	readonly id: string;
	readonly projectPath: string;
	readonly agentId: string;
	readonly title: string;
	readonly status: string;
	readonly entries: ReadonlyArray<StoredEntry>;
	readonly plan: StoredPlan | null;
	readonly connection: StoredConnection | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly source: string;
	/** Optional for backward compatibility, derived from projectPath */
	readonly projectName?: string;
}

export interface StoredEntry {
	readonly id: string;
	readonly type: string;
	readonly message: unknown;
	readonly timestamp: Date;
}

export interface StoredPlanStep {
	readonly description: string;
	readonly status: "pending" | "in_progress" | "completed" | "failed";
}

export interface StoredPlan {
	readonly steps: ReadonlyArray<StoredPlanStep>;
	readonly currentStep?: number;
	readonly createdAt?: Date;
}

export interface StoredCapabilities {
	readonly canResume?: boolean;
	readonly canFork?: boolean;
	readonly supportedModes?: readonly string[];
	readonly supportedModels?: readonly string[];
	readonly availableModes?: ReadonlyArray<{
		id: string;
		name: string;
		description?: string;
	}>;
	readonly availableModels?: ReadonlyArray<{
		modelId: string;
		name: string;
		description?: string;
	}>;
	readonly currentModeId?: string | null;
	readonly currentModelId?: string | null;
}

export interface StoredConnection {
	readonly acpSessionId: string;
	readonly projectPath: string;
	readonly capabilities?: StoredCapabilities;
}

/**
 * Thread storage with optimized O(1) indices.
 */
export class OptimizedThreadStorage {
	// Primary storage
	private readonly byId = new Map<string, StoredThread>();

	// Secondary indices for O(1) lookups
	private readonly byProject = new Map<string, Set<string>>();
	private readonly byAgent = new Map<string, Set<string>>();

	// Sorted list cache for reactive display
	private sortedThreads: StoredThread[] = [];
	private sortedThreadIds: string[] = [];
	private listVersion = 0;

	// Binary search insertion: maintain sorted order on writes for O(log n) instead of O(n log n)

	/**
	 * Get a thread by ID. O(1).
	 */
	get(id: string): StoredThread | undefined {
		return this.byId.get(id);
	}

	/**
	 * Check if a thread exists. O(1).
	 */
	has(id: string): boolean {
		return this.byId.has(id);
	}

	/**
	 * Get threads by project path. O(k) where k = result size.
	 */
	getByProject(projectPath: string): StoredThread[] {
		const ids = this.byProject.get(projectPath);
		if (!ids) return [];
		return [...ids].map((id) => this.byId.get(id)!).filter(Boolean);
	}

	/**
	 * Get threads by agent ID. O(k) where k = result size.
	 */
	getByAgent(agentId: string): StoredThread[] {
		const ids = this.byAgent.get(agentId);
		if (!ids) return [];
		return [...ids].map((id) => this.byId.get(id)!).filter(Boolean);
	}

	/**
	 * Get threads by project and agent. O(k) where k = result size.
	 */
	getByProjectAndAgent(projectPath: string, agentId: string): StoredThread[] {
		const projectIds = this.byProject.get(projectPath);
		const agentIds = this.byAgent.get(agentId);

		if (!projectIds || !agentIds) return [];

		// Find intersection
		const smallerSet = projectIds.size < agentIds.size ? projectIds : agentIds;
		const largerSet = projectIds.size < agentIds.size ? agentIds : projectIds;

		const result: StoredThread[] = [];
		for (const id of smallerSet) {
			if (largerSet.has(id)) {
				const thread = this.byId.get(id);
				if (thread) result.push(thread);
			}
		}

		return result;
	}

	/**
	 * Get all threads sorted by updatedAt (most recent first).
	 * O(1) - sorted order maintained on insertion.
	 */
	getAll(): ReadonlyArray<StoredThread> {
		return this.sortedThreads;
	}

	/**
	 * Get all thread IDs sorted by updatedAt.
	 * O(1) - sorted order maintained on insertion.
	 */
	getAllIds(): ReadonlyArray<string> {
		return this.sortedThreadIds;
	}

	/**
	 * Get the current list version (increments on any change).
	 */
	getVersion(): number {
		return this.listVersion;
	}

	/**
	 * Get total thread count. O(1).
	 */
	get size(): number {
		return this.byId.size;
	}

	/**
	 * Set (insert or update) a thread. O(log n) due to sorting.
	 */
	set(thread: StoredThread): void {
		const existing = this.byId.get(thread.id);

		// Remove from old indices if project/agent changed
		if (existing) {
			if (existing.projectPath !== thread.projectPath) {
				this.removeFromIndex(this.byProject, existing.projectPath, thread.id);
			}
			if (existing.agentId !== thread.agentId) {
				this.removeFromIndex(this.byAgent, existing.agentId, thread.id);
			}
		}

		// Update primary storage
		this.byId.set(thread.id, thread);

		// Update secondary indices
		this.addToIndex(this.byProject, thread.projectPath, thread.id);
		this.addToIndex(this.byAgent, thread.agentId, thread.id);

		// Update sorted list with binary search insertion - O(log n)
		this.insertSorted(thread);
		this.listVersion++;
	}

	/**
	 * Set multiple threads in batch. More efficient than individual sets.
	 */
	setAll(threads: readonly StoredThread[]): void {
		for (const thread of threads) {
			const existing = this.byId.get(thread.id);

			// Remove from old indices if project/agent changed
			if (existing) {
				if (existing.projectPath !== thread.projectPath) {
					this.removeFromIndex(this.byProject, existing.projectPath, thread.id);
				}
				if (existing.agentId !== thread.agentId) {
					this.removeFromIndex(this.byAgent, existing.agentId, thread.id);
				}
			}

			// Update primary storage
			this.byId.set(thread.id, thread);

			// Update secondary indices
			this.addToIndex(this.byProject, thread.projectPath, thread.id);
			this.addToIndex(this.byAgent, thread.agentId, thread.id);
		}

		// Rebuild sorted list once at the end - O(n log n) but only once
		this.rebuildSortedList();
		this.listVersion++;
	}

	/**
	 * Delete a thread. O(n) for removal from sorted list.
	 */
	delete(id: string): boolean {
		const existing = this.byId.get(id);
		if (!existing) return false;

		// Remove from all indices
		this.byId.delete(id);
		this.removeFromIndex(this.byProject, existing.projectPath, id);
		this.removeFromIndex(this.byAgent, existing.agentId, id);

		// Remove from sorted lists - O(n) scan + O(1) removal
		const sortedIndex = this.sortedThreadIds.indexOf(id);
		if (sortedIndex !== -1) {
			this.sortedThreads.splice(sortedIndex, 1);
			this.sortedThreadIds.splice(sortedIndex, 1);
		}
		this.listVersion++;

		return true;
	}

	/**
	 * Clear all storage.
	 */
	clear(): void {
		this.byId.clear();
		this.byProject.clear();
		this.byAgent.clear();
		this.sortedThreads = [];
		this.sortedThreadIds = [];
		this.listVersion++;
	}

	/**
	 * Get project paths that have threads.
	 */
	getProjectPaths(): string[] {
		return [...this.byProject.keys()];
	}

	/**
	 * Get agent IDs that have threads.
	 */
	getAgentIds(): string[] {
		return [...this.byAgent.keys()];
	}

	// --- Private helpers ---

	private addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
		let set = index.get(key);
		if (!set) {
			set = new Set();
			index.set(key, set);
		}
		set.add(id);
	}

	private removeFromIndex(index: Map<string, Set<string>>, key: string, id: string): void {
		const set = index.get(key);
		if (set) {
			set.delete(id);
			if (set.size === 0) {
				index.delete(key);
			}
		}
	}

	private rebuildSortedList(): void {
		this.sortedThreads = [...this.byId.values()].sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
		);
		this.sortedThreadIds = this.sortedThreads.map((t) => t.id);
		// Note: listVersion is incremented in set/delete, not here
	}

	/**
	 * Binary search to find insertion point for a thread by updatedAt.
	 * Returns the index where the thread should be inserted to maintain
	 * descending order by updatedAt (most recent first).
	 */
	private binarySearchInsertionPoint(updatedAt: Date): number {
		const timestamp = updatedAt.getTime();
		let low = 0;
		let high = this.sortedThreads.length;

		while (low < high) {
			const mid = (low + high) >>> 1;
			// Descending order: if mid.updatedAt > timestamp, search right
			if (this.sortedThreads[mid].updatedAt.getTime() > timestamp) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		return low;
	}

	/**
	 * Insert a thread into the sorted list at the correct position.
	 * Uses binary search for O(log n) find + O(n) insert = O(n) overall.
	 * But this is faster than O(n log n) sort for single insertions.
	 */
	private insertSorted(thread: StoredThread): void {
		// First, remove the thread if it already exists (for updates)
		const existingIndex = this.sortedThreadIds.indexOf(thread.id);
		if (existingIndex !== -1) {
			this.sortedThreads.splice(existingIndex, 1);
			this.sortedThreadIds.splice(existingIndex, 1);
		}

		// Find insertion point using binary search
		const insertIndex = this.binarySearchInsertionPoint(thread.updatedAt);

		// Insert at the correct position
		this.sortedThreads.splice(insertIndex, 0, thread);
		this.sortedThreadIds.splice(insertIndex, 0, thread.id);
	}
}

/**
 * Export type for the storage interface.
 */
export type { OptimizedThreadStorage as ThreadStorageType };
