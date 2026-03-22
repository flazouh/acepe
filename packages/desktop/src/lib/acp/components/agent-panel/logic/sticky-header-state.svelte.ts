import type { SessionEntry } from "../../../application/dto/session.js";

import { buildSegments, type ConversationSegment, findSegmentForIndex } from "./segment-tracker.js";

/**
 * Pure logic for computing sticky header state.
 * This class is testable without Svelte runes.
 */
export class StickyHeaderLogic {
	/** The user message to show in sticky header (null = hide header) */
	stickyUserMessage: SessionEntry | null = null;

	/** Cached segments (rebuilt when entries change) */
	private segments: ConversationSegment[] = [];

	/** Last known entries length for cache invalidation */
	private lastEntriesLength = 0;

	/**
	 * Update segments when entries change.
	 * Only rebuilds if the entry count has changed.
	 *
	 * @param entries - Current session entries
	 */
	updateEntries(entries: readonly SessionEntry[]): void {
		if (entries.length !== this.lastEntriesLength) {
			this.segments = buildSegments(entries);
			this.lastEntriesLength = entries.length;
		}
	}

	/**
	 * Called when scroll position changes.
	 * Updates the sticky user message based on which segment is currently
	 * in view and whether the user message for that segment is visible.
	 *
	 * @param firstVisibleIndex - Index of the first visible entry in viewport
	 * @param visibleIndices - Set of all visible entry indices
	 */
	onScroll(firstVisibleIndex: number, visibleIndices: Set<number>): void {
		if (this.segments.length === 0) {
			this.stickyUserMessage = null;
			return;
		}

		// Find which segment we're in based on first visible index
		const currentSegment = findSegmentForIndex(this.segments, firstVisibleIndex);

		if (!currentSegment) {
			this.stickyUserMessage = null;
			return;
		}

		// Check if the user message for this segment is visible
		const userMsgVisible = visibleIndices.has(currentSegment.userMessageIndex);

		if (userMsgVisible) {
			// User message is visible, hide sticky header
			this.stickyUserMessage = null;
		} else {
			// User message is not visible, show it in sticky header
			this.stickyUserMessage = currentSegment.userMessage;
		}
	}
}

/**
 * Reactive wrapper for StickyHeaderLogic using Svelte 5 runes.
 * Use this in Svelte components.
 */
export class StickyHeaderState {
	/** The user message to show in sticky header (null = hide header) */
	stickyUserMessage = $state<SessionEntry | null>(null);

	/** Internal logic handler */
	private logic = new StickyHeaderLogic();

	/**
	 * Update segments when entries change.
	 */
	updateEntries(entries: readonly SessionEntry[]): void {
		this.logic.updateEntries(entries);
	}

	/**
	 * Called when scroll position changes.
	 */
	onScroll(firstVisibleIndex: number, visibleIndices: Set<number>): void {
		this.logic.onScroll(firstVisibleIndex, visibleIndices);
		this.stickyUserMessage = this.logic.stickyUserMessage;
	}
}
