/**
 * Centralized logic for determining what tool to display.
 * Used by both queue items and session list items to avoid duplication.
 */

import type { LastToolInfo } from "../components/session-list/session-list-types.js";

/**
 * Display state for a tool - what should be shown in the UI.
 * Components use this to decide what message/content to render.
 */
export type ToolDisplayState = { type: "current"; tool: LastToolInfo } | { type: "idle" };

/**
 * Determines what tool information to display.
 *
 * Falls back to the last completed tool when no tool is actively streaming,
 * matching the queue item behavior (currentStreamingToolCall ?? lastToolCall).
 */
export function getToolDisplayState(
	currentTool: LastToolInfo | null,
	lastTool: LastToolInfo | null
): ToolDisplayState {
	const effectiveTool = currentTool ?? lastTool;
	if (effectiveTool) {
		return { type: "current", tool: effectiveTool };
	}
	return { type: "idle" };
}
