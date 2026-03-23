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
import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import { extractProjectName } from "../utils/path-utils.js";
import { generateFallbackProjectColor } from "../utils/project-utils.js";
import type { PanelStore } from "./panel-store.svelte.js";
import type { PermissionStore } from "./permission-store.svelte.js";
import type { QuestionStore } from "./question-store.svelte.js";
import type { SessionStore } from "./session-store.svelte.js";

import { groupTabsByProject, panelToTab, type TabBarTab } from "./tab-bar-utils.js";
import type { Panel } from "./types.js";
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
		private readonly questionStore: QuestionStore,
		private readonly permissionStore: PermissionStore,
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
		const { panels, focusedPanelId } = this.panelStore;
		return panels.map((panel) => this.buildTab(panel, focusedPanelId));
	}

	/**
	 * Gather state for a panel and delegate to pure panelToTab().
	 */
	private buildTab(panel: Panel, focusedPanelId: string | null): TabBarTab {
		const { sessionId } = panel;

		const sessionIdentity = sessionId ? this.sessionStore.getSessionIdentity(sessionId) : null;
		const sessionMetadata = sessionId ? this.sessionStore.getSessionMetadata(sessionId) : null;
		const hotState = sessionId ? this.sessionStore.getHotState(sessionId) : null;
		const entries = sessionId ? this.sessionStore.getEntries(sessionId) : [];

		const pendingQuestion = sessionId ? this.getPendingQuestionForSession(sessionId) : null;
		const pendingPermission = sessionId ? this.getPendingPermissionForSession(sessionId) : null;
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
			pendingPermission,
			isUnseen: this.unseenStore.isUnseen(panel.id),
			projectName,
			projectColor,
			projectPath,
		});
	}

	/**
	 * Get the first pending question for a session.
	 *
	 * Uses the O(1) `pendingBySession` index from QuestionStore rather than
	 * iterating the full `pending` map on every panel build.
	 */
	private getPendingQuestionForSession(sessionId: string): QuestionRequest | null {
		return this.questionStore.pendingBySession.get(sessionId) ?? null;
	}

	/**
	 * Get the first pending permission for a session.
	 */
	private getPendingPermissionForSession(sessionId: string): PermissionRequest | null {
		for (const permission of this.permissionStore.pending.values()) {
			if (permission.sessionId === sessionId) {
				return permission;
			}
		}
		return null;
	}
}

/**
 * Create and set the tab bar store in Svelte context.
 */
export function createTabBarStore(
	panelStore: PanelStore,
	sessionStore: SessionStore,
	questionStore: QuestionStore,
	permissionStore: PermissionStore,
	unseenStore: UnseenStore
): TabBarStore {
	const store = new TabBarStore(
		panelStore,
		sessionStore,
		questionStore,
		permissionStore,
		unseenStore
	);
	setContext(TAB_BAR_STORE_KEY, store);
	return store;
}

/**
 * Get the tab bar store from Svelte context.
 */
export function getTabBarStore(): TabBarStore {
	return getContext<TabBarStore>(TAB_BAR_STORE_KEY);
}
