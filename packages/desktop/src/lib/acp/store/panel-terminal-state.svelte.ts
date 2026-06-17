/**
 * PanelTerminalState — the terminal-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns terminal panel groups, per-project indexes, tabs, and the methods that mutate
 * them. Cross-slice workspace chrome (focus, fullscreen, workspace panel sync) flows
 * through accessor-closure dependencies; the parent `PanelStore` holds one instance
 * and delegates its terminal-domain reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import { areTerminalPanelGroupListsEqual } from "./panel-store-equality.js";
import { createLogger } from "../utils/logger.js";
import type {
	TerminalPanelGroup,
	TerminalTab,
	TerminalWorkspacePanel,
	WorkspacePanel,
} from "./types.js";

const logger = createLogger({ id: "panel-terminal-state", name: "PanelTerminalState" });
const DEFAULT_TERMINAL_PANEL_WIDTH = 500;
const MIN_TERMINAL_PANEL_WIDTH = 300;

export interface TopLevelPanelCloseState {
	readonly nextTopLevelPanelId: string | null;
	readonly wasFocusedPanel: boolean;
	readonly wasVisibleSingleModePanel: boolean;
	readonly wasLegacyFullscreenPanel: boolean;
}

export interface PanelTerminalStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	setWorkspacePanels: (panels: readonly WorkspacePanel[]) => void;
	focusOpenedTopLevelPanel: (panelId: string) => void;
	onPersist: () => void;
	getFullscreenPanelId: () => string | null;
	getSelectedSingleModePanelId: () => string | null;
	switchFullscreen: (panelId: string) => void;
	setFocusedPanelId: (panelId: string) => void;
	captureTopLevelPanelCloseState: (closedPanelId: string) => TopLevelPanelCloseState;
	applyTopLevelPanelCloseState: (closeState: TopLevelPanelCloseState) => void;
}

export class PanelTerminalState {
	private terminalPanelGroupById = new SvelteMap<string, TerminalPanelGroup>();
	private terminalPanelGroupsByProject = new SvelteMap<string, TerminalPanelGroup[]>();
	private nextTerminalTabCreatedAt = 1;

	terminalPanelGroups = $state<TerminalPanelGroup[]>([]);
	terminalTabs = $state<TerminalTab[]>([]);

	readonly terminalPanelCount = $derived(this.terminalPanelGroups.length);

	constructor(private readonly deps: PanelTerminalStateDeps) {}

	hasTerminalPanelGroup(panelId: string): boolean {
		return this.terminalPanelGroupById.has(panelId);
	}

	private getNextTerminalCreatedAt(): number {
		const createdAt = this.nextTerminalTabCreatedAt;
		this.nextTerminalTabCreatedAt += 1;
		return createdAt;
	}

	private createTerminalWorkspacePanel(group: TerminalPanelGroup): TerminalWorkspacePanel {
		return {
			id: group.id,
			kind: "terminal",
			projectPath: group.projectPath,
			ownerPanelId: null,
			width: group.width,
			groupId: group.id,
		};
	}

	private syncTerminalWorkspacePanels(): void {
		const groups = this.getAllTerminalPanelGroups();
		const groupsById = new Map(groups.map((group) => [group.id, group]));
		const nextWorkspacePanels: WorkspacePanel[] = [];
		const insertedGroupIds = new Set<string>();

		for (const panel of this.deps.getWorkspacePanels()) {
			if (panel.kind !== "terminal") {
				nextWorkspacePanels.push(panel);
				continue;
			}

			const group = groupsById.get(panel.id);
			if (!group) {
				continue;
			}

			nextWorkspacePanels.push(this.createTerminalWorkspacePanel(group));
			insertedGroupIds.add(group.id);
		}

		for (const group of groups) {
			if (insertedGroupIds.has(group.id)) {
				continue;
			}
			nextWorkspacePanels.push(this.createTerminalWorkspacePanel(group));
		}

		this.deps.setWorkspacePanels(nextWorkspacePanels);
	}

	private getAllTerminalPanelGroups(): TerminalPanelGroup[] {
		const groups = Array.from(this.terminalPanelGroups);
		groups.sort((left, right) => left.order - right.order);
		return groups;
	}

	private getTerminalTabsFromCollection(
		tabs: readonly TerminalTab[],
		groupId: string
	): TerminalTab[] {
		const groupTabs = tabs.filter((tab) => tab.groupId === groupId);
		groupTabs.sort((left, right) => left.createdAt - right.createdAt);
		return groupTabs;
	}

	private setTerminalPanelGroupsInDisplayOrder(groups: readonly TerminalPanelGroup[]): void {
		this.terminalPanelGroups = groups.map((group, index) => ({
			id: group.id,
			projectPath: group.projectPath,
			width: group.width,
			selectedTabId: group.selectedTabId,
			order: index,
		}));
		this.rebuildTerminalPanelGroupIndexes();
		this.syncTerminalWorkspacePanels();
	}

	restoreTerminalPanelState(
		groups: readonly TerminalPanelGroup[],
		tabs: readonly TerminalTab[]
	): void {
		this.terminalTabs = Array.from(tabs);
		this.setTerminalPanelGroupsInDisplayOrder(groups);
	}

	private rebuildTerminalPanelGroupIndexes(): void {
		const groupsById = new SvelteMap<string, TerminalPanelGroup>();
		const groupsByProject = new Map<string, TerminalPanelGroup[]>();

		for (const group of this.terminalPanelGroups) {
			groupsById.set(group.id, group);
			const projectGroups = groupsByProject.get(group.projectPath);
			if (projectGroups === undefined) {
				groupsByProject.set(group.projectPath, [group]);
			} else {
				projectGroups.push(group);
			}
		}

		for (const projectGroups of groupsByProject.values()) {
			projectGroups.sort((left, right) => left.order - right.order);
		}

		this.terminalPanelGroupById = groupsById;
		for (const [projectPath, groups] of groupsByProject) {
			const existingGroups = this.terminalPanelGroupsByProject.get(projectPath);
			if (areTerminalPanelGroupListsEqual(existingGroups, groups)) {
				groupsByProject.set(projectPath, existingGroups ?? groups);
			}
		}
		this.terminalPanelGroupsByProject = new SvelteMap(groupsByProject);
	}

	private updateTerminalGroup(
		groupId: string,
		updater: (group: TerminalPanelGroup) => TerminalPanelGroup
	): void {
		const groups = this.getAllTerminalPanelGroups();
		const nextGroups = groups.map((group) => (group.id === groupId ? updater(group) : group));
		this.setTerminalPanelGroupsInDisplayOrder(nextGroups);
	}

	private createTerminalTab(groupId: string, projectPath: string): TerminalTab {
		return {
			id: crypto.randomUUID(),
			groupId,
			projectPath,
			createdAt: this.getNextTerminalCreatedAt(),
			ptyId: null,
			shell: null,
		};
	}

	private getFallbackSelectedTerminalTabId(groupId: string, removedIndex: number): string | null {
		const remainingTabs = this.getTerminalTabsForGroup(groupId);
		if (remainingTabs.length === 0) {
			return null;
		}

		const nextIndex = removedIndex < remainingTabs.length ? removedIndex : remainingTabs.length - 1;
		const nextTab = remainingTabs[nextIndex];
		return nextTab ? nextTab.id : null;
	}

	getTerminalPanelsForProject(projectPath: string): TerminalPanelGroup[] {
		return this.getTerminalPanelGroupsForProject(projectPath);
	}

	setSelectedTerminalPanel(projectPath: string, panelId: string): void {
		const group = this.getTerminalPanelGroup(panelId);
		if (!group) {
			console.warn("Attempted to select stale terminal group", { projectPath, panelId });
			return;
		}
		this.deps.setFocusedPanelId(group.id);
		const selectedSingleModePanelId = this.deps.getSelectedSingleModePanelId();
		if (selectedSingleModePanelId !== null) {
			const fullscreenGroup = this.getTerminalPanelGroup(selectedSingleModePanelId);
			if (fullscreenGroup && fullscreenGroup.projectPath === projectPath) {
				this.deps.switchFullscreen(group.id);
			}
		} else if (this.deps.getFullscreenPanelId() !== null) {
			const fullscreenGroup = this.getTerminalPanelGroup(this.deps.getFullscreenPanelId() as string);
			if (fullscreenGroup && fullscreenGroup.projectPath === projectPath) {
				this.deps.switchFullscreen(group.id);
			}
		}
		this.deps.onPersist();
	}

	getTerminalPanelGroup(groupId: string): TerminalPanelGroup | undefined {
		return this.terminalPanelGroupById.get(groupId);
	}

	getTerminalPanelGroupsForProject(projectPath: string): TerminalPanelGroup[] {
		return this.terminalPanelGroupsByProject.get(projectPath) ?? [];
	}

	getTerminalTabsForGroup(groupId: string): TerminalTab[] {
		return this.getTerminalTabsFromCollection(this.terminalTabs, groupId);
	}

	getSelectedTerminalTabId(groupId: string): string | null {
		const group = this.getTerminalPanelGroup(groupId);
		if (!group) {
			return null;
		}

		const tabs = this.getTerminalTabsForGroup(groupId);
		const selectedTab = tabs.find((tab) => tab.id === group.selectedTabId);
		if (selectedTab) {
			return selectedTab.id;
		}

		const firstTab = tabs[0];
		return firstTab ? firstTab.id : null;
	}

	getSelectedTerminalTab(groupId: string): TerminalTab | null {
		const selectedTabId = this.getSelectedTerminalTabId(groupId);
		if (!selectedTabId) {
			return null;
		}
		const tab = this.getTerminalTabsForGroup(groupId).find(
			(candidate) => candidate.id === selectedTabId
		);
		return tab ? tab : null;
	}

	canMoveTerminalTabToNewPanel(tabId: string): boolean {
		const tab = this.terminalTabs.find((candidate) => candidate.id === tabId);
		if (!tab) {
			return false;
		}
		return this.getTerminalTabsForGroup(tab.groupId).length > 1;
	}

	openTerminalPanel(projectPath: string, width?: number): TerminalPanelGroup {
		const groupId = crypto.randomUUID();
		const normalizedWidth = width ? width : DEFAULT_TERMINAL_PANEL_WIDTH;
		const firstTab = this.createTerminalTab(groupId, projectPath);
		const group: TerminalPanelGroup = {
			id: groupId,
			projectPath,
			width: normalizedWidth,
			selectedTabId: firstTab.id,
			order: 0,
		};

		const groups = this.getAllTerminalPanelGroups();
		let insertIndex = groups.length;
		for (let index = 0; index < groups.length; index += 1) {
			if (groups[index]?.projectPath === projectPath) {
				insertIndex = index + 1;
			}
		}

		const nextGroups = groups.slice(0, insertIndex).concat([group], groups.slice(insertIndex));
		this.terminalTabs = this.terminalTabs.concat([firstTab]);
		this.setTerminalPanelGroupsInDisplayOrder(nextGroups);
		this.deps.focusOpenedTopLevelPanel(group.id);
		this.deps.onPersist();

		logger.debug("Opened terminal panel", { projectPath, panelId: group.id });
		return group;
	}

	openTerminalTab(groupId: string): TerminalTab | null {
		const group = this.getTerminalPanelGroup(groupId);
		if (!group) {
			console.warn("Attempted to open terminal tab for stale group", { groupId });
			return null;
		}

		const tab = this.createTerminalTab(groupId, group.projectPath);
		this.terminalTabs = this.terminalTabs.concat([tab]);
		this.updateTerminalGroup(groupId, (current) => ({
			id: current.id,
			projectPath: current.projectPath,
			width: current.width,
			selectedTabId: tab.id,
			order: current.order,
		}));
		this.deps.setFocusedPanelId(groupId);
		this.deps.onPersist();
		return tab;
	}

	setSelectedTerminalTab(groupId: string, tabId: string): void {
		const group = this.getTerminalPanelGroup(groupId);
		if (!group) {
			console.warn("Attempted to select terminal tab for stale group", { groupId, tabId });
			return;
		}
		const tabExists = this.getTerminalTabsForGroup(groupId).some((tab) => tab.id === tabId);
		if (!tabExists) {
			console.warn("Attempted to select stale terminal tab", { groupId, tabId });
			return;
		}

		this.updateTerminalGroup(groupId, (current) => ({
			id: current.id,
			projectPath: current.projectPath,
			width: current.width,
			selectedTabId: tabId,
			order: current.order,
		}));
		this.deps.setFocusedPanelId(groupId);
		this.deps.onPersist();
	}

	moveTerminalTabToNewPanel(tabId: string): TerminalPanelGroup | null {
		const tab = this.terminalTabs.find((candidate) => candidate.id === tabId);
		if (!tab) {
			console.warn("Attempted to move stale terminal tab", { tabId });
			return null;
		}
		if (!this.canMoveTerminalTabToNewPanel(tabId)) {
			console.warn("Attempted to move non-movable terminal tab", { tabId, groupId: tab.groupId });
			return null;
		}

		const sourceGroup = this.getTerminalPanelGroup(tab.groupId);
		if (!sourceGroup) {
			console.warn("Attempted to move terminal tab from stale group", {
				tabId,
				groupId: tab.groupId,
			});
			return null;
		}

		const sourceTabs = this.getTerminalTabsForGroup(sourceGroup.id);
		const movedTabIndex = sourceTabs.findIndex((candidate) => candidate.id === tabId);
		if (movedTabIndex === -1) {
			console.warn("Attempted to move terminal tab missing from group", {
				tabId,
				groupId: sourceGroup.id,
			});
			return null;
		}

		const newGroup: TerminalPanelGroup = {
			id: crypto.randomUUID(),
			projectPath: sourceGroup.projectPath,
			width: DEFAULT_TERMINAL_PANEL_WIDTH,
			selectedTabId: tab.id,
			order: sourceGroup.order + 1,
		};

		this.terminalTabs = this.terminalTabs.map((candidate) =>
			candidate.id === tabId
				? {
						id: candidate.id,
						groupId: newGroup.id,
						projectPath: candidate.projectPath,
						createdAt: candidate.createdAt,
						ptyId: candidate.ptyId,
						shell: candidate.shell,
					}
				: candidate
		);

		const remainingSourceTabs = sourceTabs.filter((candidate) => candidate.id !== tabId);
		const previousFullscreenPanelId = this.deps.getFullscreenPanelId();
		const wasVisibleSingleModePanel = this.deps.getSelectedSingleModePanelId() === sourceGroup.id;
		const groups = this.getAllTerminalPanelGroups();
		const nextGroups: TerminalPanelGroup[] = [];
		for (const group of groups) {
			if (group.id !== sourceGroup.id) {
				nextGroups.push(group);
				continue;
			}

			if (remainingSourceTabs.length > 0) {
				nextGroups.push({
					id: group.id,
					projectPath: group.projectPath,
					width: group.width,
					selectedTabId: this.getFallbackSelectedTerminalTabId(group.id, movedTabIndex),
					order: group.order,
				});
			}
			nextGroups.push(newGroup);
		}

		this.setTerminalPanelGroupsInDisplayOrder(nextGroups);
		this.deps.setFocusedPanelId(newGroup.id);
		if (wasVisibleSingleModePanel || previousFullscreenPanelId === sourceGroup.id) {
			this.deps.switchFullscreen(newGroup.id);
		}
		this.deps.onPersist();

		return this.getTerminalPanelGroup(newGroup.id) ?? newGroup;
	}

	closeTerminalPanel(panelId: string): void {
		const group = this.getTerminalPanelGroup(panelId);
		if (!group) {
			console.warn("Attempted to close stale terminal group", { panelId });
			return;
		}
		const tabIds = this.getTerminalTabsForGroup(panelId).map((tab) => tab.id);
		for (const tabId of tabIds) {
			this.closeTerminalTab(tabId);
		}
	}

	updateTerminalPtyId(tabId: string, ptyId: number, shell: string): void {
		const tab = this.terminalTabs.find((candidate) => candidate.id === tabId);
		if (!tab) {
			console.warn("Attempted to update PTY for stale terminal tab", { tabId, ptyId, shell });
			return;
		}
		this.terminalTabs = this.terminalTabs.map((tab) =>
			tab.id === tabId
				? {
						id: tab.id,
						groupId: tab.groupId,
						projectPath: tab.projectPath,
						createdAt: tab.createdAt,
						ptyId,
						shell,
					}
				: tab
		);
	}

	closeTerminalTab(tabId: string): void {
		const tab = this.terminalTabs.find((candidate) => candidate.id === tabId);
		if (!tab) {
			console.warn("Attempted to close stale terminal tab", { tabId });
			return;
		}

		const group = this.getTerminalPanelGroup(tab.groupId);
		if (!group) {
			console.warn("Attempted to close terminal tab in stale group", {
				tabId,
				groupId: tab.groupId,
			});
			return;
		}

		const sourceTabs = this.getTerminalTabsForGroup(group.id);
		const removedIndex = sourceTabs.findIndex((candidate) => candidate.id === tabId);
		const closeState = this.deps.captureTopLevelPanelCloseState(group.id);
		this.terminalTabs = this.terminalTabs.filter((candidate) => candidate.id !== tabId);

		const remainingTabs = this.getTerminalTabsForGroup(group.id);
		if (remainingTabs.length === 0) {
			const groups = this.getAllTerminalPanelGroups().filter(
				(candidate) => candidate.id !== group.id
			);
			this.setTerminalPanelGroupsInDisplayOrder(groups);
			this.deps.applyTopLevelPanelCloseState(closeState);
			this.deps.onPersist();
			return;
		}

		const selectedTabId =
			group.selectedTabId === tabId
				? this.getFallbackSelectedTerminalTabId(group.id, removedIndex)
				: this.getSelectedTerminalTabId(group.id);
		this.updateTerminalGroup(group.id, (current) => ({
			id: current.id,
			projectPath: current.projectPath,
			width: current.width,
			selectedTabId,
			order: current.order,
		}));
		this.deps.onPersist();
	}

	resizeTerminalPanel(groupId: string, delta: number): void {
		const group = this.getTerminalPanelGroup(groupId);
		if (!group) {
			console.warn("Attempted to resize stale terminal group", { groupId, delta });
			return;
		}
		this.updateTerminalGroup(groupId, (current) => ({
			id: current.id,
			projectPath: current.projectPath,
			width: Math.max(current.width + delta, MIN_TERMINAL_PANEL_WIDTH),
			selectedTabId: current.selectedTabId,
			order: current.order,
		}));
		this.deps.onPersist();
	}

	getTerminalPanel(panelId: string): TerminalPanelGroup | undefined {
		return this.getTerminalPanelGroup(panelId);
	}

	toggleTerminalPanel(projectPath: string, width?: number): void {
		const forProject = this.getTerminalPanelsForProject(projectPath);
		if (forProject.length > 0) {
			const first = forProject[0];
			this.deps.focusOpenedTopLevelPanel(first.id);
			this.deps.onPersist();
		} else {
			this.openTerminalPanel(projectPath, width);
		}
	}

	isTerminalOpenForProject(projectPath: string): boolean {
		return this.getTerminalPanelsForProject(projectPath).length > 0;
	}
}
