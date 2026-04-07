/**
 * QueueStore - Active sessions that need user attention or are in progress.
 *
 * Shows sessions that are active or need input:
 * - Pending questions (user must answer)
 * - Pending permissions (user must approve/deny)
 * - Errors (user must acknowledge/fix)
 * - Ready + unseen completion (agent finished, user has not viewed panel yet)
 * - Streaming (agent working)
 *
 * Excludes: idle, connecting, loading, paused, ready-but-seen
 */

import { getContext, setContext } from "svelte";
import type { PlanApprovalInteraction } from "../../types/interaction.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { QuestionRequest } from "../../types/question.js";
import type { QueueItem } from "./types.js";
import type { ProjectColorLookup, QueueSectionGroup, QueueSessionSnapshot } from "./utils.js";

import { buildQueueItem, calculateSessionUrgency, groupIntoSections } from "./utils.js";

export type { QueueSectionGroup, QueueSectionId } from "./utils.js";

const QUEUE_STORE_KEY = Symbol("queue-store");

/**
 * Input data for updating the queue.
 */
export interface QueueUpdateInput {
	readonly session: QueueSessionSnapshot;
	readonly hasPendingQuestion: boolean;
	readonly hasPendingPermission: boolean;
	readonly hasUnseenCompletion: boolean;
	readonly pendingQuestionText: string | null;
	readonly pendingQuestion: QuestionRequest | null;
	readonly pendingPlanApproval: PlanApprovalInteraction | null;
	readonly pendingPermission: PermissionRequest | null;
}

/**
 * Check if a session is active and should be shown in the queue.
 * Uses the unified session state model for consistent classification.
 */
function isActiveSession(item: QueueItem): boolean {
	const { state } = item;

	// Has pending input - user must respond
	if (state.pendingInput.kind !== "none") return true;

	// Has error - user must acknowledge/fix
	if (state.connection === "error") return true;

	// Agent finished and unseen - user should review
	if (state.activity.kind === "idle" && state.attention.hasUnseenCompletion) return true;

	// Agent working (streaming, thinking) - user may want to monitor
	if (state.activity.kind === "streaming" || state.activity.kind === "thinking") return true;

	// Paused - still active
	if (state.activity.kind === "paused") return true;

	// Everything else: not active (idle + seen, connecting)
	return false;
}

/**
 * Get sort priority for queue items.
 * Lower number = higher priority (sorted first).
 * Uses the unified session state model for consistent classification.
 */
function getItemPriority(item: QueueItem): number {
	const { state } = item;

	// Pending input (questions and permissions) are highest priority
	if (state.pendingInput.kind !== "none") return 0;

	// Errors next
	if (state.connection === "error") return 1;

	// Ready and unseen - user should review
	if (state.activity.kind === "idle" && state.attention.hasUnseenCompletion) return 2;

	// Active work (streaming, thinking, paused) - lowest priority in queue
	if (
		state.activity.kind === "streaming" ||
		state.activity.kind === "thinking" ||
		state.activity.kind === "paused"
	)
		return 3;

	// Anything else (shouldn't happen due to filter)
	return 4;
}

/**
 * Create a reactive queue store and set it in Svelte context.
 */
export function createQueueStore(): QueueStore {
	// Internal state
	let items = $state<QueueItem[]>([]);

	// Derived: filtered to only active sessions
	const activeItems = $derived.by(() => {
		return items.filter(isActiveSession);
	});

	// Derived: sorted items by priority then time
	const sortedItems = $derived.by(() => {
		return [...activeItems].sort((a, b) => {
			// Sort by priority first
			const priorityDiff = getItemPriority(a) - getItemPriority(b);
			if (priorityDiff !== 0) return priorityDiff;

			// Then by last activity (more recent = higher priority)
			return b.lastActivityAt - a.lastActivityAt;
		});
	});

	// Derived: total count
	const totalCount = $derived(activeItems.length);

	// Derived: count of items needing immediate action (pending input or errors)
	const actionRequiredCount = $derived(
		activeItems.filter(
			(item) => item.state.pendingInput.kind !== "none" || item.state.connection === "error"
		).length
	);

	// Derived: top item (most urgent)
	const topItem = $derived<QueueItem | null>(sortedItems[0] ?? null);

	// Derived: items grouped into labeled sections (empty sections omitted)
	const sections = $derived.by(() => groupIntoSections(activeItems));

	const store = {
		// Reactive getters
		get items() {
			return sortedItems;
		},
		get totalCount() {
			return totalCount;
		},
		get actionRequiredCount() {
			return actionRequiredCount;
		},
		get topItem() {
			return topItem;
		},
		get sections() {
			return sections;
		},

		/**
		 * Update the queue from sessions and panel mappings.
		 */
		updateFromSessions(
			inputs: readonly QueueUpdateInput[],
			sessionToPanelMap: ReadonlyMap<string, string>,
			getProjectColor?: ProjectColorLookup
		): void {
			items = inputs.map((input) => {
				const panelId = sessionToPanelMap.get(input.session.id) ?? null;
				const urgency = calculateSessionUrgency(
					input.session,
					input.hasPendingQuestion,
					input.pendingQuestionText
				);
				return buildQueueItem(
					input.session,
					panelId,
					urgency,
					input.hasPendingQuestion,
					input.hasPendingPermission,
					input.hasUnseenCompletion,
					input.pendingQuestionText,
					input.pendingQuestion,
					input.pendingPlanApproval,
					input.pendingPermission,
					getProjectColor
				);
			});
		},

		/**
		 * Get item by session ID.
		 */
		getItem(sessionId: string): QueueItem | undefined {
			return items.find((item) => item.sessionId === sessionId);
		},

		/**
		 * Clear all items.
		 */
		clear(): void {
			items = [];
		},
	};

	setContext(QUEUE_STORE_KEY, store);
	return store;
}

/**
 * Interface for QueueStore - must be defined before the function for type reference.
 */
export interface QueueStore {
	readonly items: readonly QueueItem[];
	readonly totalCount: number;
	readonly actionRequiredCount: number;
	readonly topItem: QueueItem | null;
	readonly sections: readonly QueueSectionGroup[];
	updateFromSessions(
		inputs: readonly QueueUpdateInput[],
		sessionToPanelMap: ReadonlyMap<string, string>,
		getProjectColor?: ProjectColorLookup
	): void;
	getItem(sessionId: string): QueueItem | undefined;
	clear(): void;
}

/**
 * Get the queue store from Svelte context.
 */
export function getQueueStore(): QueueStore {
	return getContext<QueueStore>(QUEUE_STORE_KEY);
}
