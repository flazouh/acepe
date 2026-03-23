import { SvelteMap } from "svelte/reactivity";

import type { ToolCall, ToolCallStatus } from "../types/tool-call.js";

/**
 * Cached tool state for detecting in-place mutations.
 *
 * AI SDKs sometimes mutate objects in-place during streaming,
 * so we cache JSON-stringified versions for deep comparison.
 *
 * Adapted from 1code's tool-state-cache pattern.
 */
interface CachedToolState {
	status: ToolCallStatus;
	argumentsJson: string;
	resultJson: string;
}

/**
 * Tool state cache for optimizing render decisions during streaming.
 *
 * This helps detect when tool calls have actually changed vs when
 * the same object reference is being reused with mutations.
 */
export class ToolStateCache {
	private cache = new SvelteMap<string, CachedToolState>();

	/**
	 * Check if a tool call's state has changed since last check.
	 *
	 * @param toolCallId - Unique tool call ID
	 * @param toolCall - Current tool call data
	 * @returns true if state has changed, false if identical
	 */
	hasStateChanged(toolCallId: string, toolCall: ToolCall): boolean {
		const cached = this.cache.get(toolCallId);
		if (!cached) {
			// First time seeing this tool call
			this.updateCache(toolCallId, toolCall);
			return true;
		}

		const currentArgumentsJson = JSON.stringify(toolCall.arguments);
		const currentResultJson = JSON.stringify(toolCall.result ?? null);

		// Check if any field has changed
		const changed =
			cached.status !== toolCall.status ||
			cached.argumentsJson !== currentArgumentsJson ||
			cached.resultJson !== currentResultJson;

		if (changed) {
			this.updateCache(toolCallId, toolCall);
		}

		return changed;
	}

	/**
	 * Update the cached state for a tool call.
	 *
	 * @param toolCallId - Unique tool call ID
	 * @param toolCall - Current tool call data
	 */
	updateCache(toolCallId: string, toolCall: ToolCall): void {
		this.cache.set(toolCallId, {
			status: toolCall.status,
			argumentsJson: JSON.stringify(toolCall.arguments),
			resultJson: JSON.stringify(toolCall.result ?? null),
		});
	}

	/**
	 * Remove a tool call from the cache.
	 * Useful when a tool call is removed from the UI.
	 *
	 * @param toolCallId - Unique tool call ID
	 */
	remove(toolCallId: string): void {
		this.cache.delete(toolCallId);
	}

	/**
	 * Clear all cached tool states.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get the number of cached tool states.
	 */
	get size(): number {
		return this.cache.size;
	}
}

/**
 * Global tool state cache instance.
 * Shared across all tool components for consistent state tracking.
 */
export const globalToolStateCache = new ToolStateCache();
