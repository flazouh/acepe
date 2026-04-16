/**
 * Urgency Tabs Store - Derives urgency-sorted tabs from panel/session state.
 *
 * Used for Cmd+J attention queue jump and project color lookup.
 * Tab bar rendering is now handled by TabBarStore.
 *
 * Uses $derived runes to ensure consistent snapshots during renders,
 * preventing race conditions when state changes mid-render.
 */

import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { TAG_COLORS } from "../utils/colors.js";
import { generateFallbackProjectColor } from "../utils/project-utils.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import { buildSessionOperationInteractionSnapshot } from "./operation-association.js";
import type { PanelStore } from "./panel-store.svelte.js";
import type { SessionStore } from "./session-store.svelte.js";
import type { Panel } from "./types.js";
import {
	compareUrgency,
	deriveUrgency,
	getUrgencyPriority,
	type UrgencyInfo,
	type UrgencyLevel,
} from "./urgency.js";

const URGENCY_TABS_STORE_KEY = Symbol("urgency-tabs-store");

/**
 * Tab data for rendering in UrgencyTabBar.
 */
export interface UrgencyTab {
	/** Panel ID */
	readonly panelId: string;
	/** Session ID (null for empty panels) */
	readonly sessionId: string | null;
	/** Project path */
	readonly projectPath: string | null;
	/** Agent ID */
	readonly agentId: string | null;
	/** Session title */
	readonly title: string | null;
	/** Urgency information */
	readonly urgency: UrgencyInfo;
	/** Whether this tab is focused */
	readonly isFocused: boolean;
	/** Whether this tab has a pending question */
	readonly hasPendingQuestion: boolean;
	/** Pending question text (first question if multiple) */
	readonly pendingQuestionText: string | null;
	/** Whether the session is currently streaming */
	readonly isStreaming: boolean;
	/** Whether the session has an error */
	readonly hasError: boolean;
	/** Whether the session is connecting */
	readonly isConnecting: boolean;
	/** Whether the session is idle or ready (completed/waiting for input) */
	readonly isIdle: boolean;
}

/**
 * Grouped tabs by project for rendering.
 */
export interface ProjectTabGroup {
	/** Project path (null for orphan tabs) */
	readonly projectPath: string | null;
	/** Project name for display */
	readonly projectName: string;
	/** Project color */
	readonly projectColor: string;
	/** Tabs in this project, sorted by urgency */
	readonly tabs: UrgencyTab[];
	/** Highest urgency level in this group */
	readonly maxUrgency: UrgencyLevel;
}

/**
 * Project color lookup function type.
 */
export type ProjectColorLookup = (projectPath: string) => string | null;

/**
 * Store for urgency-sorted tabs.
 * Uses $derived for consistent reactive snapshots.
 */
export class UrgencyTabsStore {
	// Use $derived.by for all computed properties to ensure consistent snapshots
	// and proper dependency tracking (expressions in $derived() are evaluated once)
	readonly tabs = $derived.by(() => this.computeTabs());
	readonly firstTab = $derived.by<UrgencyTab | null>(() =>
		this.tabs.length > 0 ? this.tabs[0] : null
	);
	readonly highUrgencyCount = $derived.by(
		() => this.tabs.filter((tab) => tab.urgency.level === "high").length
	);
	readonly groupedTabs = $derived.by(() => this.computeGroupedTabs());

	private getProjectColor: ProjectColorLookup | null = null;

	constructor(
		private readonly panelStore: PanelStore,
		private readonly sessionStore: SessionStore,
		private readonly interactions: InteractionStore
	) {}

	/**
	 * Set the project color lookup function.
	 * This allows the store to use actual project colors instead of hash-based fallbacks.
	 */
	setProjectColorLookup(lookup: ProjectColorLookup): void {
		this.getProjectColor = lookup;
	}

	/**
	 * Get tabs filtered by urgency level.
	 */
	getTabsByUrgency(level: UrgencyLevel): UrgencyTab[] {
		return this.tabs.filter((tab) => tab.urgency.level === level);
	}

	/**
	 * Compute urgency-sorted tabs from current state.
	 */
	private computeTabs(): UrgencyTab[] {
		const { panels, focusedPanelId } = this.panelStore;

		// Map panels to tabs with urgency info
		const tabs: UrgencyTab[] = panels.map((panel) => this.panelToTab(panel, focusedPanelId));

		// Sort by urgency (high first, then by time within tier)
		tabs.sort((a, b) => compareUrgency(a.urgency, b.urgency));

		return tabs;
	}

	/**
	 * Compute tabs grouped by project, sorted by max urgency within each group.
	 */
	private computeGroupedTabs(): ProjectTabGroup[] {
		const tabs = this.tabs;

		// Group tabs by project path
		const groupMap = new SvelteMap<string | null, UrgencyTab[]>();
		for (const tab of tabs) {
			const key = tab.projectPath;
			const group = groupMap.get(key);
			if (group) {
				group.push(tab);
			} else {
				groupMap.set(key, [tab]);
			}
		}

		// Convert to ProjectTabGroup array
		const groups: ProjectTabGroup[] = [];
		for (const [projectPath, groupTabs] of groupMap) {
			// Find max urgency in group
			const maxUrgency = groupTabs.reduce<UrgencyLevel>((max, tab) => {
				return getUrgencyPriority(tab.urgency.level) < getUrgencyPriority(max)
					? tab.urgency.level
					: max;
			}, "low");

			// Extract project name from path
			const projectName = projectPath?.split("/").pop() ?? "Unknown";

			// Get actual project color if lookup is available, otherwise use fallback
			const projectColor = projectPath
				? (this.getProjectColor?.(projectPath) ?? generateFallbackProjectColor(projectPath))
				: (TAG_COLORS[1] ?? "#FF8D20");

			groups.push({
				projectPath,
				projectName,
				projectColor,
				tabs: groupTabs, // Already sorted by urgency from computeTabs()
				maxUrgency,
			});
		}

		// Sort groups by max urgency (most urgent groups first)
		groups.sort((a, b) => getUrgencyPriority(a.maxUrgency) - getUrgencyPriority(b.maxUrgency));

		return groups;
	}

	/**
	 * Convert a panel to a tab with urgency info.
	 */
	private panelToTab(panel: Panel, focusedPanelId: string | null): UrgencyTab {
		const { sessionId } = panel;

		const sessionIdentity = sessionId ? this.sessionStore.getSessionIdentity(sessionId) : null;
		const sessionMetadata = sessionId ? this.sessionStore.getSessionMetadata(sessionId) : null;
		const hotState = sessionId
			? this.sessionStore.getHotState(sessionId)
			: {
					status: "idle" as const,
					statusChangedAt: Date.now(),
					connectionError: null,
					activeTurnFailure: null,
				};

		// Get pending question for this session
		const interactionSnapshot =
			sessionId !== null
				? buildSessionOperationInteractionSnapshot(
						sessionId,
						this.sessionStore.getOperationStore(),
						this.interactions
					)
				: null;
		const pendingQuestion = interactionSnapshot?.pendingQuestion ?? null;
		const pendingPlanApproval = interactionSnapshot?.pendingPlanApproval ?? null;

		// Derive project path from session or panel
		const projectPath = sessionIdentity?.projectPath ?? panel.projectPath ?? null;
		const agentId = sessionIdentity?.agentId ?? panel.agentId ?? panel.selectedAgentId ?? null;
		const title = sessionMetadata?.title ?? null;

		// Derive urgency
		const urgency = deriveUrgency({
			status: hotState.status,
			hasPendingQuestion: pendingQuestion !== null || pendingPlanApproval !== null,
			pendingQuestionText: pendingQuestion?.questions[0]?.question ?? null,
			statusChangedAt: hotState.statusChangedAt,
			connectionError: hotState.connectionError,
			activeTurnFailure: hotState.activeTurnFailure ?? null,
		});

		return {
			panelId: panel.id,
			sessionId,
			projectPath,
			agentId,
			title,
			urgency,
			isFocused: panel.id === focusedPanelId,
			hasPendingQuestion: pendingQuestion !== null || pendingPlanApproval !== null,
			pendingQuestionText: pendingQuestion?.questions[0]?.question ?? null,
			isStreaming: hotState.status === "streaming",
			hasError: hotState.status === "error",
			isConnecting: hotState.status === "connecting" || hotState.status === "loading",
			isIdle: hotState.status === "idle" || hotState.status === "ready",
		};
	}
}

/**
 * Create and set the urgency tabs store in Svelte context.
 */
export function createUrgencyTabsStore(
	panelStore: PanelStore,
	sessionStore: SessionStore,
	interactions: InteractionStore
): UrgencyTabsStore {
	const store = new UrgencyTabsStore(panelStore, sessionStore, interactions);
	setContext(URGENCY_TABS_STORE_KEY, store);
	return store;
}

/**
 * Get the urgency tabs store from Svelte context.
 */
export function getUrgencyTabsStore(): UrgencyTabsStore {
	return getContext<UrgencyTabsStore>(URGENCY_TABS_STORE_KEY);
}
