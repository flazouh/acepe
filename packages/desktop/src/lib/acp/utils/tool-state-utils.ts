import type { SessionTurnState } from "../../services/acp-types.js";
import type { TurnState } from "../store/types.js";
import type { ToolCall } from "../types/tool-call.js";

export type ToolStatusTurnState = TurnState | SessionTurnState;

/**
 * Comprehensive tool status result
 */
export interface ToolStatusResult {
	isPending: boolean;
	isError: boolean;
	isSuccess: boolean;
	isInterrupted: boolean;
	isInputStreaming: boolean;
}

/**
 * Get comprehensive tool status based on tool call and turn state.
 *
 * Adapted from 1code's getToolStatus pattern.
 *
 * @param toolCall - The tool call data
 * @param turnState - Current turn state (idle, streaming, completed, interrupted, error)
 * @returns Comprehensive status flags
 */
function isStreamingTurnState(turnState: ToolStatusTurnState | undefined): boolean {
	return turnState === "streaming" || turnState === "Running";
}

export function getToolStatus(
	toolCall: ToolCall,
	turnState?: ToolStatusTurnState
): ToolStatusResult {
	const status = toolCall.status;

	// Error state: explicitly failed
	const isError = status === "failed";

	// Success state: explicitly completed (and not failed)
	const isSuccess = status === "completed" && !isError;

	// Base pending state: prioritize status field over result presence
	// A tool is pending if its status is "pending" or "in_progress"
	const basePending = status === "pending" || status === "in_progress";

	// Input streaming: tool arguments are still being streamed
	// In Acepe, this is when status is "pending" and we're actively streaming
	const isInputStreaming = status === "pending" && isStreamingTurnState(turnState);

	// Interrupted: tool was pending but the turn is no longer actively streaming.
	// This covers: explicit cancel (turnState "interrupted"), turn completed without
	// the tool finishing ("completed"), session idle after cancel ("idle"), or error.
	const isInterrupted = basePending && turnState !== undefined && !isStreamingTurnState(turnState);

	// Pending: tool is still in progress AND the turn is actively streaming.
	// Once the turn ends (completed, interrupted, idle, error), pending tools
	// should show as interrupted, not shimmer indefinitely.
	const isPending = basePending && !isInterrupted;

	return {
		isPending,
		isError,
		isSuccess,
		isInterrupted,
		isInputStreaming,
	};
}

/**
 * Strip sandbox/project prefixes from file paths for cleaner display.
 *
 * Adapted from 1code's getDisplayPath utility.
 *
 * @param filePath - Full file path
 * @returns Cleaned display path
 */
export function getDisplayPath(filePath: string): string {
	if (!filePath) return "";

	// Common sandbox prefixes to strip
	const prefixes = [
		"/project/sandbox/repo/",
		"/project/sandbox/",
		"/project/",
		"/sandbox/repo/",
		"/sandbox/",
	];

	for (const prefix of prefixes) {
		if (filePath.startsWith(prefix)) {
			return filePath.slice(prefix.length);
		}
	}

	// Try to find common project roots and trim to there
	const parts = filePath.split("/");
	const rootIndicators = ["apps", "packages", "src", "lib", "components"];
	const rootIndex = parts.findIndex((p) => rootIndicators.includes(p));

	if (rootIndex > 0) {
		return parts.slice(rootIndex).join("/");
	}

	return filePath;
}

/**
 * Calculate diff statistics from old and new strings.
 *
 * @param oldString - Original content
 * @param newString - New content
 * @returns Object with added and removed line counts
 */
export function calculateDiffStats(
	oldString: string,
	newString: string
): { added: number; removed: number } {
	const oldLines = oldString.split("\n");
	const newLines = newString.split("\n");

	// Simple line-based diff counting
	// For more accurate diffs, we'd use a proper diff algorithm
	const oldSet = new Set(oldLines);
	const newSet = new Set(newLines);

	let added = 0;
	let removed = 0;

	for (const line of newLines) {
		if (!oldSet.has(line)) {
			added++;
		}
	}

	for (const line of oldLines) {
		if (!newSet.has(line)) {
			removed++;
		}
	}

	return { added, removed };
}

/**
 * Extract command summary from bash command.
 * Shows first words of pipeline commands.
 *
 * Adapted from 1code's extractCommandSummary.
 *
 * @param command - Full bash command
 * @returns Shortened summary (e.g., "cd, npm, build")
 */
export function extractCommandSummary(command: string): string {
	if (!command) return "";

	// Normalize line continuations
	const normalized = command.replace(/\\\s*\n\s*/g, " ");

	// Split on pipeline operators
	const parts = normalized.split(/\s*(?:&&|\|\||;|\|)\s*/);

	// Extract first word from each part
	const firstWords = parts.map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);

	// Show max 4 commands
	const summary = firstWords.slice(0, 4).join(", ");
	return firstWords.length > 4 ? `${summary}...` : summary;
}

/**
 * Truncate text to a maximum length with ellipsis.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default 50)
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength: number = 50): string {
	if (!text || text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Format elapsed time in human-readable format.
 *
 * @param startTime - Start timestamp in milliseconds
 * @param endTime - End timestamp in milliseconds (defaults to now)
 * @returns Formatted time string (e.g., "1m 23s", "45s")
 */
export function formatElapsedTime(startTime: number, endTime?: number): string {
	const elapsed = (endTime ?? Date.now()) - startTime;
	const seconds = Math.floor(elapsed / 1000);

	if (seconds < 60) {
		return `${seconds}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	return `${minutes}m ${remainingSeconds}s`;
}

interface ToolElapsedLabelParams {
	startedAtMs?: number | null;
	completedAtMs?: number | null;
	isRunning: boolean;
	nowMs?: number;
}

/**
 * Format a tool elapsed label for UI badges.
 *
 * Running tools show whole seconds; completed tools show seconds with 2 decimals.
 */
export function formatToolElapsedLabel({
	startedAtMs,
	completedAtMs,
	isRunning,
	nowMs = Date.now(),
}: ToolElapsedLabelParams): string | null {
	if (startedAtMs === null || startedAtMs === undefined) {
		return null;
	}

	if (!isRunning && (completedAtMs === null || completedAtMs === undefined)) {
		return null;
	}

	const endMs = isRunning ? nowMs : (completedAtMs ?? nowMs);
	const elapsedMs = Math.max(0, endMs - startedAtMs);
	const elapsed = isRunning
		? `${Math.floor(elapsedMs / 1000)}s`
		: `${(elapsedMs / 1000).toFixed(2)}s`;

	return elapsed;
}
