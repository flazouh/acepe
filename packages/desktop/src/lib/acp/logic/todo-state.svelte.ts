import { err, ok, type Result } from "neverthrow";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import type { TodoItem, TodoSnapshot, TodoState, TodoStatus } from "../types/todo.js";
import type { ToolCall } from "../types/tool-call.js";
import { createLogger } from "../utils/logger.js";

/**
 * Minimal entry interface that both StoredEntry and ThreadEntryDTO satisfy.
 * This allows the todo state logic to work with either type.
 */
export interface EntryWithMessage {
	readonly id: string;
	readonly type: string;
	readonly message: unknown;
	readonly timestamp?: Date;
}

/**
 * Minimal thread interface that both StoredThread and ThreadDTO satisfy.
 * This allows the todo state logic to work with either type.
 */
export interface ThreadWithEntries {
	readonly entries: ReadonlyArray<EntryWithMessage>;
	// Optional properties for live detection (present in both StoredThread and ThreadDTO)
	readonly connection?: {
		readonly sessionId?: string;
		readonly acpSessionId?: string;
	} | null;
	readonly status?: string;
	readonly isStreaming?: boolean;
	readonly isConnected?: boolean;
}

const logger = createLogger({
	id: LOGGER_IDS.TODO_STATE,
	name: "Todo State",
});

/**
 * Valid todo statuses - used for validation.
 */
const VALID_TODO_STATUSES: readonly TodoStatus[] = [
	"pending",
	"in_progress",
	"completed",
	"cancelled",
] as const;

/**
 * Error type for todo state operations.
 */
export class TodoStateError extends Error {
	constructor(
		message: string,
		public readonly code?: string
	) {
		super(message);
		this.name = "TodoStateError";
	}
}

/**
 * Validates that a status string is a valid TodoStatus.
 */
function validateStatus(status: string): Result<TodoStatus, TodoStateError> {
	if (VALID_TODO_STATUSES.includes(status as TodoStatus)) {
		return ok(status as TodoStatus);
	}
	return err(new TodoStateError(`Invalid todo status: "${status}"`, "INVALID_STATUS"));
}

/**
 * Validates and sanitizes a timestamp.
 * Returns undefined if timestamp is missing or invalid (no fallback to current time).
 */
function validateTimestamp(timestamp: Date | undefined): Date | undefined {
	if (!timestamp) {
		return;
	}

	// Check if it's a valid Date object
	if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
		logger.warn("Invalid timestamp detected:", timestamp);
		return;
	}

	return timestamp;
}

/**
 * Calculates duration between two timestamps with validation.
 * Returns undefined if timestamps are missing or duration is negative (data corruption).
 */
function calculateDuration(
	startedAt: Date | undefined,
	completedAt: Date | undefined
): number | undefined {
	if (!(startedAt && completedAt)) {
		return;
	}

	const duration = completedAt.getTime() - startedAt.getTime();

	if (duration < 0) {
		logger.warn("Negative duration detected (data corruption):", {
			startedAt,
			completedAt,
			duration,
		});
		return;
	}

	// Sanity check: duration shouldn't be more than 24 hours for a single task
	const MAX_REASONABLE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
	if (duration > MAX_REASONABLE_DURATION) {
		logger.warn("Unreasonably long duration detected:", {
			duration,
			durationHours: duration / (60 * 60 * 1000),
		});
	}

	return duration;
}

/**
 * Creates aggregated todo state from a thread's entries.
 *
 * Processes all TodoWrite tool calls in order to build:
 * - Current todo list with accumulated timing
 * - Duration calculations for completed tasks
 */
/**
 * Type guard to check if an entry has normalized todos.
 * Works with both StoredEntry and ThreadEntryDTO.
 */
function hasTodos(entry: EntryWithMessage): entry is EntryWithMessage & { message: ToolCall } {
	if (entry.type !== "tool_call") return false;
	const message = entry.message as ToolCall | undefined;
	return message?.normalizedTodos != null && message.normalizedTodos.length > 0;
}

export function createTodoState(
	thread: ThreadWithEntries | null
): Result<TodoState | null, TodoStateError> {
	// Null thread is a valid empty state
	if (!thread) {
		return ok(null);
	}

	const todoWrites = thread.entries.filter(hasTodos);

	// No todos is a valid empty state, not an error
	if (todoWrites.length === 0) {
		return ok(null);
	}

	// Track timing for each task by content
	// NOTE: Must use regular Map, not SvelteMap, because this function
	// is called from $derived and reactive state mutations are forbidden there
	const taskTimings = new Map<string, { startedAt?: Date; completedAt?: Date }>();

	// Process each TodoWrite in order to track state transitions
	let previousTodos: Array<{ content: string; status: string }> = [];

	for (const entry of todoWrites) {
		const toolCall = entry.message as ToolCall;
		const todos = toolCall.normalizedTodos;
		if (!todos || todos.length === 0) continue;

		// Validate timestamp - don't use fallback!
		const entryTimestamp = validateTimestamp(entry.timestamp);
		if (!entryTimestamp) {
			// Skip timing for entries without valid timestamps
			logger.warn("Skipping timing for TodoWrite entry without valid timestamp:", entry.id);
			// Still update previousTodos for state tracking
			previousTodos = todos;
			continue;
		}

		for (const todo of todos) {
			// Validate status before processing
			const statusResult = validateStatus(todo.status);
			if (statusResult.isErr()) {
				logger.warn("Skipping todo with invalid status:", todo.content, statusResult.error);
				continue;
			}

			const validStatus = statusResult.value;
			const timing = taskTimings.get(todo.content) ?? {};
			const prevTodo = previousTodos.find((p) => p.content === todo.content);

			// Track when task transitioned to in_progress
			if (validStatus === "in_progress" && prevTodo?.status !== "in_progress") {
				timing.startedAt = entryTimestamp;
			}

			// Track when task transitioned to completed
			if (validStatus === "completed" && prevTodo?.status !== "completed") {
				timing.completedAt = entryTimestamp;
			}

			taskTimings.set(todo.content, timing);
		}

		previousTodos = todos;
	}

	// Get the most recent TodoWrite for current state
	const lastTodoWrite = todoWrites[todoWrites.length - 1];
	const lastToolCall = lastTodoWrite.message as ToolCall;
	const currentTodos = lastToolCall.normalizedTodos ?? [];

	// Build items with timing - filter out invalid todos
	const items: TodoItem[] = [];

	for (const todo of currentTodos) {
		// Validate status
		const statusResult = validateStatus(todo.status);
		if (statusResult.isErr()) {
			logger.warn("Skipping invalid todo in final state:", todo.content, statusResult.error);
			continue;
		}

		const timing = taskTimings.get(todo.content) ?? {};

		// Calculate duration with validation
		const duration = calculateDuration(timing.startedAt, timing.completedAt);

		items.push({
			content: todo.content,
			activeForm: todo.activeForm,
			status: statusResult.value,
			startedAt: timing.startedAt,
			completedAt: timing.completedAt,
			duration,
		});
	}

	const currentTask = items.find((item) => item.status === "in_progress") ?? null;
	const completedCount = items.filter((item) => item.status === "completed").length;
	// Check if thread is live (has connection, is connected, or is streaming)
	// Works with both StoredThread (connection.acpSessionId) and Session/ThreadDTO (connection.sessionId, isStreaming, isConnected)
	const isLive =
		thread.connection != null ||
		thread.isConnected === true ||
		thread.status === "streaming" ||
		thread.isStreaming === true;

	// Validate last updated timestamp
	const lastUpdatedAt = validateTimestamp(lastTodoWrite.timestamp);

	// If we have no valid items and no valid timestamp, return null
	if (items.length === 0) {
		return ok(null);
	}

	return ok({
		items,
		currentTask,
		completedCount,
		totalCount: items.length,
		isLive,
		lastUpdatedAt: lastUpdatedAt ?? new Date(0), // Epoch if no timestamp
	});
}

/**
 * Creates a snapshot for a specific TodoWrite tool call.
 * Used for in-thread historical display.
 */
export function createTodoSnapshotFromToolCall(
	toolCall: ToolCall
): Result<TodoSnapshot | null, TodoStateError> {
	const todos = toolCall.normalizedTodos;
	if (!todos || todos.length === 0) {
		// No todos is a valid empty state
		return ok(null);
	}

	// Validate and filter todos
	const validTodos = todos.filter((t) => {
		const statusResult = validateStatus(t.status);
		if (statusResult.isErr()) {
			logger.warn("Skipping invalid todo in snapshot:", t.content, statusResult.error);
			return false;
		}
		return true;
	});

	if (validTodos.length === 0) {
		return ok(null);
	}

	const inProgressTodo = validTodos.find((t) => t.status === "in_progress");
	const inProgressIndex = inProgressTodo
		? validTodos.findIndex((t) => t.content === inProgressTodo.content)
		: -1;

	const completedCount = validTodos.filter((t) => t.status === "completed").length;
	const allCompleted = completedCount === validTodos.length;

	return ok({
		inProgressTask: inProgressTodo
			? {
					content: inProgressTodo.content,
					activeForm: inProgressTodo.activeForm,
					status: "in_progress",
				}
			: null,
		taskNumber: inProgressIndex >= 0 ? inProgressIndex + 1 : completedCount,
		totalTasks: validTodos.length,
		isFinal: allCompleted,
		completedCount,
	});
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(durationMs: number): string {
	const seconds = Math.floor(durationMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}
