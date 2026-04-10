/**
 * Tab Bar Store - Derives flat, panel-ordered tabs for the tab bar.
 *
 * Replaces UrgencyTabsStore with a simpler model:
 * - Tabs follow panel array order, grouped by project creation date
 * - No project grouping
 * - Each tab includes mode, state flags, current tool kind, and unseen state
 *
 * Uses $derived runes for consistent reactive snapshots.
 */

import { getContext, setContext } from "svelte";
import { extractProjectName } from "../utils/path-utils.js";
import { generateFallbackProjectColor } from "../utils/project-utils.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import { buildSessionOperationInteractionSnapshot } from "./operation-association.js";
import type { PanelStore } from "./panel-store.svelte.js";
import type { SessionStore } from "./session-store.svelte.js";

import {
	groupTabsByProject,
	nonAgentPanelToTab,
	panelToTab,
	type TabBarTab,
} from "./tab-bar-utils.js";
import type { WorkspacePanel } from "./types.js";
import type { UnseenStore } from "./unseen-store.svelte.js";

export type { TabBarTab, TabBarTabGroup } from "./tab-bar-utils.js";

const TAB_BAR_STORE_KEY = Symbol("tab-bar-store");

/**
 * Store for flat, panel-ordered tabs.
 */
/** Optional lookup for project color (from ProjectManager). */
export type ProjectColorLookup = (projectPath: string) => string | null;
/** Optional lookup for project creation date (from ProjectManager). */
export type ProjectCreatedAtLookup = (projectPath: string) => Date | null;

export class TabBarStore {
	readonly tabs = $derived.by(() => this.computeTabs());
	readonly groupedTabs = $derived.by(() => groupTabsByProject(this.tabs, this.getProjectCreatedAt));

	private getProjectColor: ProjectColorLookup | null = null;
	private getProjectCreatedAt: ProjectCreatedAtLookup | null = null;

	constructor(
		private readonly panelStore: PanelStore,
		private readonly sessionStore: SessionStore,
		private readonly interactions: InteractionStore,
		private readonly unseenStore: UnseenStore
	) {}

	/** Set project color lookup (from ProjectManager) for consistent badge colors. */
	setProjectColorLookup(lookup: ProjectColorLookup): void {
		this.getProjectColor = lookup;
	}

	/** Set project creation date lookup (from ProjectManager) for group ordering. */
	setProjectCreatedAtLookup(lookup: ProjectCreatedAtLookup): void {
		this.getProjectCreatedAt = lookup;
	}

	/**
	 * Compute tabs in panel array order.
	 * Project group ordering is handled by groupTabsByProject.
	 */
	private computeTabs(): TabBarTab[] {
		const { workspacePanels, focusedPanelId } = this.panelStore;
		return workspacePanels
			.filter((panel) => panel.kind === "agent" || panel.ownerPanelId === null)
			.map((panel) => this.buildTab(panel, focusedPanelId));
	}

	/**
	 * Gather state for a panel and delegate to pure panelToTab().
	 */
	private buildTab(panel: WorkspacePanel, focusedPanelId: string | null): TabBarTab {
		if (panel.kind !== "agent") {
			const projectPath = panel.projectPath;
			const projectName = projectPath ? extractProjectName(projectPath) : null;
			const projectColor = projectPath
				? (this.getProjectColor?.(projectPath) ?? generateFallbackProjectColor(projectPath))
				: null;

			return nonAgentPanelToTab({
				panel,
				focusedPanelId,
				projectName,
				projectColor,
			});
		}

		const { sessionId } = panel;

		const sessionIdentity = sessionId ? this.sessionStore.getSessionIdentity(sessionId) : null;
		const sessionMetadata = sessionId ? this.sessionStore.getSessionMetadata(sessionId) : null;
		const hotState = sessionId ? this.sessionStore.getHotState(sessionId) : null;
		const entries = sessionId ? this.sessionStore.getEntries(sessionId) : [];

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
		const pendingPermission = interactionSnapshot?.pendingPermission ?? null;
		const agentId = sessionIdentity?.agentId ?? panel.agentId ?? panel.selectedAgentId ?? null;
		const title = sessionMetadata?.title ?? null;

		const projectPath = sessionIdentity?.projectPath ?? panel.projectPath ?? null;
		const projectName = projectPath ? extractProjectName(projectPath) : null;
		const projectColor = projectPath
			? (this.getProjectColor?.(projectPath) ?? generateFallbackProjectColor(projectPath))
			: null;

		return panelToTab({
			panel,
			focusedPanelId,
			agentId,
			title,
			hotState,
			entries,
			pendingQuestion,
			pendingPlanApproval,
			pendingPermission,
			isUnseen: this.unseenStore.isUnseen(panel.id),
			projectName,
			projectColor,
			projectPath,
		});
	}
}

/**
 * Create and set the tab bar store in Svelte context.
 */
export function createTabBarStore(
	panelStore: PanelStore,
	sessionStore: SessionStore,
	interactions: InteractionStore,
	unseenStore: UnseenStore
): TabBarStore {
	const store = new TabBarStore(panelStore, sessionStore, interactions, unseenStore);
	setContext(TAB_BAR_STORE_KEY, store);
	return store;
}

/**
 * Get the tab bar store from Svelte context.
 */
export function getTabBarStore(): TabBarStore {
	return getContext<TabBarStore>(TAB_BAR_STORE_KEY);
}
