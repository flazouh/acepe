/**
 * Urgency - Types and logic for session urgency-based tab ordering.
 *
 * Maps session states to urgency tiers for automatic tab reordering:
 * - HIGH: Agent asking question / error state (needs immediate attention)
 * - MEDIUM: Idle / waiting for input / task complete (ready for review)
 * - LOW: Streaming / connecting / working (in progress, no action needed)
 */

import type { SessionStatus } from "../application/dto/session.js";

/**
 * Urgency level for tab ordering.
 * Tabs are sorted by urgency tier, then by time waiting (longest first).
 */
export type UrgencyLevel = "high" | "medium" | "low";

/**
 * Urgency information for a session.
 */
export interface UrgencyInfo {
	/** Urgency level determining sort order */
	readonly level: UrgencyLevel;
	/** Human-readable reason for this urgency */
	readonly reason: string;
	/** Timestamp when this urgency state began (for sorting within tier) */
	readonly timestamp: number;
	/** Optional detail text (e.g., question text for high urgency) */
	readonly detail: string | null;
}

/**
 * Input for urgency derivation.
 */
export interface UrgencyInput {
	/** Session status */
	readonly status: SessionStatus;
	/** Whether there's a pending question for this session */
	readonly hasPendingQuestion: boolean;
	/** Text of the pending question (if any) */
	readonly pendingQuestionText: string | null;
	/** Timestamp when status last changed */
	readonly statusChangedAt: number;
	/** Connection error message (if any) */
	readonly connectionError: string | null;
}

/**
 * Derive urgency from session state.
 *
 * Urgency tiers:
 * - HIGH: Agent asking question or error state
 * - MEDIUM: Idle/ready/paused (waiting for user input or review)
 * - LOW: Streaming/connecting/loading (in progress)
 */
export function deriveUrgency(input: UrgencyInput): UrgencyInfo {
	const { status, hasPendingQuestion, pendingQuestionText, statusChangedAt, connectionError } =
		input;

	// HIGH: Question pending or error state
	if (hasPendingQuestion) {
		return {
			level: "high",
			reason: "Agent asking question",
			timestamp: statusChangedAt,
			detail: pendingQuestionText,
		};
	}

	if (status === "error") {
		return {
			level: "high",
			reason: "Error occurred",
			timestamp: statusChangedAt,
			detail: connectionError,
		};
	}

	// LOW: In-progress states (agent is working)
	if (status === "streaming" || status === "connecting" || status === "loading") {
		const reasonMap: Record<string, string> = {
			streaming: "Agent is responding",
			connecting: "Connecting to agent",
			loading: "Loading session",
		};
		return {
			level: "low",
			reason: reasonMap[status] ?? "Working",
			timestamp: statusChangedAt,
			detail: null,
		};
	}

	// MEDIUM: Idle/ready/paused (waiting for user)
	const mediumReasonMap: Record<string, string> = {
		idle: "Waiting for input",
		ready: "Ready for input",
		paused: "Stream paused",
	};
	return {
		level: "medium",
		reason: mediumReasonMap[status] ?? "Waiting",
		timestamp: statusChangedAt,
		detail: null,
	};
}

/**
 * Get numeric sort priority for urgency level.
 * Lower number = higher priority (sorted first).
 */
export function getUrgencyPriority(level: UrgencyLevel): number {
	const priorities: Record<UrgencyLevel, number> = {
		high: 0,
		medium: 1,
		low: 2,
	};
	return priorities[level];
}

/**
 * Compare two urgency infos for sorting.
 * Sorts by: urgency level (high first), then by timestamp (oldest first within tier).
 */
export function compareUrgency(a: UrgencyInfo, b: UrgencyInfo): number {
	const priorityDiff = getUrgencyPriority(a.level) - getUrgencyPriority(b.level);
	if (priorityDiff !== 0) {
		return priorityDiff;
	}
	// Within same tier, oldest (lowest timestamp) comes first
	return a.timestamp - b.timestamp;
}
