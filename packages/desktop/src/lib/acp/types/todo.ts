/**
 * Status of a todo item.
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

/**
 * A single todo item with timing information.
 */
export interface TodoItem {
	/** Task description */
	content: string;
	/** Optional active form text for in-progress display (e.g., "Adding tests") */
	activeForm?: string;
	/** Current status */
	status: TodoStatus;
	/** When the task was started (marked in_progress) */
	startedAt?: Date;
	/** When the task was completed */
	completedAt?: Date;
	/** Calculated duration in milliseconds (completed - started) */
	duration?: number;
}

/**
 * Aggregated todo state for a thread.
 * Built by scanning all TodoWrite tool calls in order.
 */
export interface TodoState {
	/** All todo items from the most recent TodoWrite call */
	items: TodoItem[];
	/** Current in-progress task (if any) */
	currentTask: TodoItem | null;
	/** Number of completed tasks */
	completedCount: number;
	/** Total number of tasks */
	totalCount: number;
	/** Whether the thread is currently live/streaming */
	isLive: boolean;
	/** Most recent update timestamp */
	lastUpdatedAt: Date;
}

/**
 * Snapshot of todo state at a specific point in time.
 * Used for in-thread historical display.
 */
export interface TodoSnapshot {
	/** The task that was in progress at this point */
	inProgressTask: TodoItem | null;
	/** Task number (1-indexed) */
	taskNumber: number;
	/** Total tasks at this snapshot */
	totalTasks: number;
	/** Whether this is a final/completed state (all tasks done) */
	isFinal: boolean;
	/** Number of completed tasks at this snapshot */
	completedCount: number;
}
