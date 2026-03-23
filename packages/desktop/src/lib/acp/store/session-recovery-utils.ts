/**
 * Session recovery utilities.
 *
 * Detects sessions that were interrupted on app restart (e.g., force quit during
 * streaming) and ensures tool states are correctly marked as interrupted.
 */

import type { ToolCall } from "../types/tool-call.js";
import type { SessionEntry, TurnState } from "./types.js";

import { isToolCallEntry } from "./types.js";

function hasPendingToolStatus(toolCall: ToolCall): boolean {
	const status = toolCall.status;
	return status === "pending" || status === "in_progress";
}

function collectToolCallsRecursive(toolCall: ToolCall, result: ToolCall[]): void {
	result.push(toolCall);
	const taskChildren = toolCall.taskChildren;
	if (taskChildren && taskChildren.length > 0) {
		for (const child of taskChildren) {
			collectToolCallsRecursive(child, result);
		}
	}
}

function collectToolCalls(entry: SessionEntry): ToolCall[] {
	if (!isToolCallEntry(entry)) {
		return [];
	}

	const result: ToolCall[] = [];
	collectToolCallsRecursive(entry.message, result);
	return result;
}

/**
 * Detects if a session should be marked as interrupted after restoration.
 *
 * When the app restarts, tool entries persisted with status "in_progress" or
 * "pending" indicate the session was interrupted (crash, force quit). If
 * turnState is "idle" (the default on restore) while such tools exist, the
 * session is effectively stuck — tools show shimmer instead of "Interrupted".
 *
 * @param entries - Session entries (from entry store)
 * @param turnState - Current turn state from hot state
 * @returns true if session has pending/in_progress tools while turnState is idle
 */
export function shouldMarkSessionInterrupted(
	entries: SessionEntry[] | undefined | null,
	turnState: TurnState
): boolean {
	if (turnState !== "idle" || !entries || entries.length === 0) {
		return false;
	}

	for (const entry of entries) {
		for (const toolCall of collectToolCalls(entry)) {
			if (hasPendingToolStatus(toolCall)) {
				return true;
			}
		}
	}

	return false;
}
