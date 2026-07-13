/**
 * Panel Store - Manages panel lifecycle, layout, and focus.
 *
 * This store handles all panel-related operations including:
 * - Opening/closing panels
 * - Managing panel focus and fullscreen state
 * - Resizing panels
 * - Panel-session associations
 */

import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import type { PreparedWorktreeLaunch } from "../types/worktree-info.js";
import { createLogger } from "../utils/logger.js";
import type { AgentStore } from "./agent-store.svelte.js";
import type { BrowserPanel } from "./browser-panel-type.js";
import { EmbeddedTerminalStore } from "./embedded-terminal-store.svelte.js";
import type { OpenFilePanelOptions } from "./file-panel-ownership.js";
import type { FilePanel } from "./file-panel-type.js";
import {
	createAppendedItemArray,
	createArrayLikeOwnKeys,
	createPatchedItemArray,
	createPrependedItemArray,
	createRemovedItemArray,
	findItemIndexById,
	selectPrependedItem,
	selectRemovedItem,
	toArrayIndex,
} from "./panel-store-array-patches.js";
import {
	arePanelProjectRefListsEqual,
	areWorkspacePanelListsEqual,
	type TopLevelPanelProjectRef,
} from "./panel-store-equality.js";
import { PanelAgentState } from "./panel-agent-state.svelte.js";
import { PanelBrowserState } from "./panel-browser-state.svelte.js";
import { PanelFileState } from "./panel-file-state.svelte.js";
import {
	PanelGitState,
	type GitDialogState,
} from "./panel-git-state.svelte.js";
import { PanelHotStateStore } from "./panel-hot-state.svelte.js";
import { PanelReviewState } from "./panel-review-state.svelte.js";
import { PanelTerminalState } from "./panel-terminal-state.svelte.js";
import type {
	OpenProjectFileSystemDialogOptions,
	ProjectFileSystemDialogState,
} from "./project-file-system-dialog-state.js";
import type { GitPanel, GitPanelInitialTarget } from "./git-panel-type.js";
import type { ReviewPanel } from "./review-panel-type.js";
import type { SessionStore } from "./session-store.svelte.js";
import type {
	BrowserWorkspacePanel,
	FileWorkspacePanel,
	Panel,
	PanelHotState,
	PersistedBrowserPanelState,
	PersistedEmbeddedTerminalState,
	PersistedFilePanelState,
	PersistedPanelState,
	PersistedTerminalPanelGroupState,
	PersistedTerminalTabState,
	PersistedWorkspacePanelState,
	SessionEntry,
	TerminalPanelGroup,
	TerminalTab,
	TerminalWorkspacePanel,
	ViewMode,
	WorkspacePanel,
	WorkspacePanelKind,
} from "./types.js";

const PANEL_STORE_KEY = Symbol("panel-store");
let currentPanelStore: PanelStore | null = null;
const logger = createLogger({ id: "panel-store", name: "PanelStore" });

export interface PanelClosePerformanceTrace {
	readonly panelId: string;
	readonly kind: WorkspacePanelKind;
	readonly captureStateMs: number;
	readonly suppressionMs: number;
	readonly clearOpeningSessionMs: number;
	readonly removePanelMs: number;
	readonly hotStateCleanupMs: number;
	readonly fileOwnershipCleanupMs: number;
	readonly embeddedTerminalCleanupMs: number;
	readonly focusStateApplyMs: number;
	readonly persistMs: number;
	readonly totalMs: number;
}

function isPersistableWorkspacePanel(panel: WorkspacePanel): boolean {
	return panel.kind !== "agent" || panel.autoCreated !== true;
}

function roundPanelClosePerformanceMs(value: number): number {
	return Math.round(value * 100) / 100;
}

export interface PanelWorkspacePersistenceSnapshotOptions {
	readonly getPanelScrollTop?: (panelId: string) => number;
}

export interface PanelWorkspacePersistenceSnapshot {
	readonly workspacePanels: PersistedWorkspacePanelState[];
	readonly panels: PersistedPanelState[];
	readonly filePanels: PersistedFilePanelState[];
	readonly activeFilePanelIdByOwnerPanelId: Record<string, string>;
	readonly focusedPanelIndex: number | null;
	readonly panelContainerScrollX: number;
	readonly fullscreenPanelIndex: number | null;
	readonly terminalPanelGroups: PersistedTerminalPanelGroupState[];
	readonly terminalTabs: PersistedTerminalTabState[];
	readonly browserPanels: PersistedBrowserPanelState[];
	readonly embeddedTerminalTabs: PersistedEmbeddedTerminalState[];
	readonly viewMode: ViewMode | undefined;
	readonly focusedViewProjectPath: string | undefined;
}

export class PanelStore {
	workspacePanels = $state<WorkspacePanel[]>([]);
	focusedPanelId = $state<string | null>(null);
	fullscreenPanelId = $state<string | null>(null);
	scrollX = $state<number>(0);

	// View mode: "single" (one session), "project" (one project), "multi" (all projects)
	viewMode = $state<ViewMode>("multi");
	focusedViewProjectPath = $state<string | null>(null);
	projectFileSystemDialog = $state<ProjectFileSystemDialogState | null>(null);

	private topLevelWorkspacePanelList = $state<WorkspacePanel[]>([]);
	private topLevelNonAgentPanelProjectRefList = $state<TopLevelPanelProjectRef[]>([]);
	private readonly agentState: PanelAgentState;
	private readonly terminalState: PanelTerminalState;
	private readonly fileState: PanelFileState;
	private readonly reviewState: PanelReviewState;
	private readonly gitState: PanelGitState;
	private readonly browserState: PanelBrowserState;
	private readonly hotStateStore: PanelHotStateStore;
	private lastClosePerformanceTrace: PanelClosePerformanceTrace | null = null;

	private isTopLevelFullscreenTarget(panelId: string | null): boolean {
		if (panelId === null) return false;
		if (this.findTopLevelWorkspacePanel(panelId) !== undefined) return true;
		// Terminal and browser panels are stored outside workspacePanels but are
		// valid top-level fullscreen targets.
		if (this.terminalState.hasTerminalPanelGroup(panelId)) return true;
		if (this.browserState.hasBrowserPanel(panelId)) return true;
		return false;
	}

	private setFullscreenPanelTarget(panelId: string | null): void {
		if (panelId === null) {
			this.fullscreenPanelId = null;
			return;
		}

		if (this.isTopLevelFullscreenTarget(panelId)) {
			this.focusedPanelId = panelId;
			this.viewMode = "single";
			this.fullscreenPanelId = null;
			return;
		}

		this.fullscreenPanelId = panelId;
	}

	ensureSingleViewForAgentFullscreen(): void {
		if (!this.isTopLevelFullscreenTarget(this.fullscreenPanelId)) {
			return;
		}

		const panelId = this.fullscreenPanelId;
		this.fullscreenPanelId = null;
		this.focusedPanelId = panelId;
		this.viewMode = "single";
	}

	private getSelectedSingleModePanelId(): string | null {
		if (this.viewMode !== "single") {
			return null;
		}

		if (this.focusedPanelId !== null && this.findTopLevelWorkspacePanel(this.focusedPanelId)) {
			return this.focusedPanelId;
		}

		const firstTopLevelPanel = this.getFirstTopLevelPanel();
		return firstTopLevelPanel ? firstTopLevelPanel.id : null;
	}

	private getPostSingleModeFallbackViewMode(): ViewMode {
		return this.focusedViewProjectPath !== null ? "project" : "multi";
	}

	private captureTopLevelPanelCloseState(closedPanelId: string): {
		readonly nextTopLevelPanelId: string | null;
		readonly wasFocusedPanel: boolean;
		readonly wasVisibleSingleModePanel: boolean;
		readonly wasLegacyFullscreenPanel: boolean;
	} {
		return {
			nextTopLevelPanelId: this.getNextTopLevelPanelId(closedPanelId),
			wasFocusedPanel: this.focusedPanelId === closedPanelId,
			wasVisibleSingleModePanel: this.getSelectedSingleModePanelId() === closedPanelId,
			wasLegacyFullscreenPanel: this.fullscreenPanelId === closedPanelId,
		};
	}

	private applyTopLevelPanelCloseState(closeState: {
		readonly nextTopLevelPanelId: string | null;
		readonly wasFocusedPanel: boolean;
		readonly wasVisibleSingleModePanel: boolean;
		readonly wasLegacyFullscreenPanel: boolean;
	}): void {
		if (closeState.wasFocusedPanel) {
			this.focusedPanelId = closeState.nextTopLevelPanelId;
		}

		if (closeState.wasVisibleSingleModePanel) {
			if (closeState.nextTopLevelPanelId !== null) {
				this.focusedPanelId = closeState.nextTopLevelPanelId;
				this.viewMode = "single";
				this.fullscreenPanelId = null;
				return;
			}

			this.focusedPanelId = null;
			this.fullscreenPanelId = null;
			this.viewMode = this.getPostSingleModeFallbackViewMode();
			return;
		}

		if (closeState.wasLegacyFullscreenPanel) {
			if (closeState.nextTopLevelPanelId !== null) {
				this.switchFullscreen(closeState.nextTopLevelPanelId);
				return;
			}

			this.exitFullscreen();
		}
	}

	private focusOpenedTopLevelPanel(panelId: string): void {
		this.focusedPanelId = panelId;
		if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
			this.switchFullscreen(panelId);
		}
		if (this.viewMode !== "multi") {
			const projectPath = this.resolveTopLevelPanelProjectPath(panelId);
			if (projectPath) {
				this.focusedViewProjectPath = projectPath;
				this.scrollX = 0;
			}
		}
	}

	/**
	 * Resolve the project path for any top-level panel (workspace, terminal, or browser).
	 */
	private resolveTopLevelPanelProjectPath(panelId: string): string | null {
		const workspacePanel = this.findTopLevelWorkspacePanel(panelId);
		if (workspacePanel) return workspacePanel.projectPath;
		const terminalGroup = this.terminalState.getTerminalPanelGroup(panelId);
		if (terminalGroup) return terminalGroup.projectPath;
		return this.browserState.getBrowserPanelProjectPath(panelId);
	}

	/** Optional callback invoked when a panel is focused. */
	onPanelFocused: ((panelId: string) => void) | null = null;

	private duplicatePanelDisposalHandler: ((panelId: string) => void) | null = null;

	setDuplicatePanelDisposalHandler(handler: (panelId: string) => void): void {
		this.duplicatePanelDisposalHandler = handler;
	}

	/** Embedded terminal state per agent panel (bottom drawer tabs). */
	readonly embeddedTerminals: EmbeddedTerminalStore;

	// Dependencies injected via constructor
	constructor(
		private sessionStore: SessionStore,
		_agentStore: AgentStore,
		private onPersist: () => void
	) {
		this.embeddedTerminals = new EmbeddedTerminalStore(onPersist);
		this.hotStateStore = new PanelHotStateStore({
			onPersist: () => this.onPersist(),
			getEmbeddedTerminalTabCount: (panelId) => this.embeddedTerminals.getTabs(panelId).length,
			addEmbeddedTerminalTab: (panelId, cwd) => {
				this.embeddedTerminals.addTab(panelId, cwd);
			},
		});
		this.agentState = new PanelAgentState({
			getWorkspacePanels: () => this.workspacePanels,
			replaceAgentPanelsInWorkspace: (nextAgentPanels) => {
				this.replaceWorkspacePanels("agent", nextAgentPanels);
			},
			insertAgentPanelInWorkspace: (panel, placement) => {
				this.workspacePanels =
					placement === "prepend"
						? createPrependedItemArray<WorkspacePanel>(panel, this.workspacePanels)
						: createAppendedItemArray<WorkspacePanel>(this.workspacePanels, panel);
				this.topLevelWorkspacePanelList =
					placement === "prepend"
						? createPrependedItemArray<WorkspacePanel>(panel, this.topLevelWorkspacePanelList)
						: createAppendedItemArray<WorkspacePanel>(this.topLevelWorkspacePanelList, panel);
			},
			patchAgentPanelInWorkspace: (panel) => {
				this.workspacePanels = createPatchedItemArray(this.workspacePanels, panel);
				this.topLevelWorkspacePanelList = createPatchedItemArray(
					this.topLevelWorkspacePanelList,
					panel
				);
			},
			getSessionIdentity: (sessionId) => {
				const identity = this.sessionStore.read.getSessionIdentity(sessionId);
				if (identity === undefined) {
					return undefined;
				}
				return {
					agentId: identity.agentId,
					projectPath: identity.projectPath,
					worktreePath: identity.worktreePath ?? null,
				};
			},
			getSessionMetadata: (sessionId) => {
				const metadata = this.sessionStore.read.getSessionMetadata(sessionId);
				if (metadata === undefined) {
					return undefined;
				}
				return {
					sourcePath: metadata.sourcePath ?? null,
					title: metadata.title ?? null,
					sequenceId: metadata.sequenceId ?? null,
				};
			},
			hasPendingCreationSession: (sessionId) =>
				typeof this.sessionStore.connection.hasPendingCreationSession === "function" &&
				this.sessionStore.connection.hasPendingCreationSession(sessionId),
			getPendingCreationSession: (sessionId) =>
				this.sessionStore.getPendingCreationSession(sessionId),
			resolveCanonicalSessionId: (requestedId) =>
				this.sessionStore.read.resolveCanonicalSessionId(requestedId),
			focusOpenedTopLevelPanel: (panelId) => this.focusOpenedTopLevelPanel(panelId),
			onSpawnedPanelFocused: (panel) => {
				this.focusedPanelId = panel.id;
				if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
					this.switchFullscreen(panel.id);
				}
				if (this.viewMode !== "multi" && panel.projectPath) {
					this.focusedViewProjectPath = panel.projectPath;
					this.scrollX = 0;
				}
			},
			onExistingSessionOpened: (panel) => {
				this.focusedPanelId = panel.id;
				if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
					this.switchFullscreen(panel.id);
				}
			},
			onDuplicatePanelDisposed: (panelId) => {
				this.duplicatePanelDisposalHandler?.(panelId);
			},
			clearAutoSessionSuppression: (sessionId) =>
				this.hotStateStore.clearAutoSessionSuppression(sessionId),
			onPersist: () => this.onPersist(),
		});
		this.terminalState = new PanelTerminalState({
			getWorkspacePanels: () => this.workspacePanels,
			setWorkspacePanels: (panels) => this.setWorkspacePanels(panels),
			focusOpenedTopLevelPanel: (panelId) => this.focusOpenedTopLevelPanel(panelId),
			onPersist: () => this.onPersist(),
			getFullscreenPanelId: () => this.fullscreenPanelId,
			getSelectedSingleModePanelId: () => this.getSelectedSingleModePanelId(),
			switchFullscreen: (panelId) => this.switchFullscreen(panelId),
			setFocusedPanelId: (panelId) => {
				this.focusedPanelId = panelId;
			},
			captureTopLevelPanelCloseState: (closedPanelId) =>
				this.captureTopLevelPanelCloseState(closedPanelId),
			applyTopLevelPanelCloseState: (closeState) =>
				this.applyTopLevelPanelCloseState(closeState),
		});
		this.fileState = new PanelFileState({
			getWorkspacePanels: () => this.workspacePanels,
			setWorkspacePanels: (panels) => this.setWorkspacePanels(panels),
			prependWorkspacePanel: (panel) => {
				this.workspacePanels = createPrependedItemArray(panel, this.workspacePanels);
				if (panel.ownerPanelId === null) {
					this.topLevelWorkspacePanelList = createPrependedItemArray(
						panel,
						this.topLevelWorkspacePanelList
					);
					this.topLevelNonAgentPanelProjectRefList = createPrependedItemArray(
						{ id: panel.id, projectPath: panel.projectPath },
						this.topLevelNonAgentPanelProjectRefList
					);
				}
			},
			removeWorkspacePanelById: (panelId) => {
				this.workspacePanels = createRemovedItemArray(this.workspacePanels, panelId);
			},
			getOwnerPanel: (ownerPanelId) => this.agentState.getTopLevelAgentPanel(ownerPanelId),
			patchOwnerPanel: (updatedPanel) => this.agentState.patchTopLevelAgentPanel(updatedPanel),
			focusOpenedTopLevelPanel: (panelId) => this.focusOpenedTopLevelPanel(panelId),
			onPersist: () => this.onPersist(),
			captureTopLevelPanelCloseState: (closedPanelId) =>
				this.captureTopLevelPanelCloseState(closedPanelId),
			applyTopLevelPanelCloseState: (closeState) =>
				this.applyTopLevelPanelCloseState(closeState),
		});
		this.reviewState = new PanelReviewState({
			getWorkspacePanels: () => this.workspacePanels,
			setWorkspacePanels: (panels) => this.setWorkspacePanels(panels),
			focusOpenedTopLevelPanel: (panelId) => this.focusOpenedTopLevelPanel(panelId),
			onPersist: () => this.onPersist(),
			captureTopLevelPanelCloseState: (closedPanelId) =>
				this.captureTopLevelPanelCloseState(closedPanelId),
			applyTopLevelPanelCloseState: (closeState) =>
				this.applyTopLevelPanelCloseState(closeState),
		});
		this.gitState = new PanelGitState({
			getWorkspacePanels: () => this.workspacePanels,
			setWorkspacePanels: (panels) => this.setWorkspacePanels(panels),
			onPersist: () => this.onPersist(),
			getViewMode: () => this.viewMode,
			setFocusedViewProjectPath: (projectPath) => {
				this.focusedViewProjectPath = projectPath;
			},
			setScrollX: (scrollX) => {
				this.scrollX = scrollX;
			},
			captureTopLevelPanelCloseState: (closedPanelId) =>
				this.captureTopLevelPanelCloseState(closedPanelId),
			applyTopLevelPanelCloseState: (closeState) =>
				this.applyTopLevelPanelCloseState(closeState),
		});
		this.browserState = new PanelBrowserState({
			getWorkspacePanels: () => this.workspacePanels,
			setWorkspacePanels: (panels) => this.setWorkspacePanels(panels),
			focusOpenedTopLevelPanel: (panelId) => this.focusOpenedTopLevelPanel(panelId),
			onPersist: () => this.onPersist(),
			captureTopLevelPanelCloseState: (closedPanelId) =>
				this.captureTopLevelPanelCloseState(closedPanelId),
			applyTopLevelPanelCloseState: (closeState) =>
				this.applyTopLevelPanelCloseState(closeState),
		});
	}

	get panels(): Panel[] {
		return this.agentState.panels;
	}

	set panels(nextPanels: Panel[]) {
		this.agentState.panels = nextPanels;
	}

	get filePanels(): FilePanel[] {
		return this.fileState.filePanels;
	}

	set filePanels(nextPanels: FilePanel[]) {
		this.fileState.filePanels = nextPanels;
	}

	private replaceWorkspacePanels(
		kind: WorkspacePanelKind,
		nextPanels: readonly WorkspacePanel[]
	): void {
		const remainingPanels = this.workspacePanels.filter((panel) => panel.kind !== kind);
		this.setWorkspacePanels(Array.from(nextPanels).concat(remainingPanels));
	}

	get terminalPanels(): TerminalWorkspacePanel[] {
		return this.workspacePanels.filter(
			(panel): panel is TerminalWorkspacePanel => panel.kind === "terminal"
		);
	}

	set terminalPanels(nextPanels: TerminalWorkspacePanel[]) {
		this.replaceWorkspacePanels("terminal", nextPanels);
	}

	get browserPanels(): BrowserPanel[] {
		return this.browserState.browserPanels;
	}

	set browserPanels(nextPanels: BrowserPanel[]) {
		this.browserState.browserPanels = nextPanels;
	}

	get reviewPanels(): ReviewPanel[] {
		return this.reviewState.reviewPanels;
	}

	set reviewPanels(nextPanels: ReviewPanel[]) {
		this.reviewState.reviewPanels = nextPanels;
	}

	get gitPanels(): GitPanel[] {
		return this.gitState.gitPanels;
	}

	set gitPanels(nextPanels: GitPanel[]) {
		this.gitState.gitPanels = nextPanels;
	}

	private setWorkspacePanels(nextPanels: readonly WorkspacePanel[]): void {
		this.workspacePanels = Array.from(nextPanels);
		const topLevelPanels = this.workspacePanels.filter((panel) => this.isTopLevelWorkspacePanel(panel));
		if (!areWorkspacePanelListsEqual(this.topLevelWorkspacePanelList, topLevelPanels)) {
			this.topLevelWorkspacePanelList = topLevelPanels;
		}
		const topLevelNonAgentProjectRefs = topLevelPanels
			.filter((panel) => panel.kind !== "agent" && panel.kind !== "git")
			.map((panel) => ({ id: panel.id, projectPath: panel.projectPath }));
		if (
			!arePanelProjectRefListsEqual(
				this.topLevelNonAgentPanelProjectRefList,
				topLevelNonAgentProjectRefs
			)
		) {
			this.topLevelNonAgentPanelProjectRefList = topLevelNonAgentProjectRefs;
		}
	}

	removeWorkspacePanelsForProject(projectPath: string): void {
		const nextWorkspacePanels = this.workspacePanels.filter(
			(panel) => panel.projectPath !== projectPath
		);
		if (nextWorkspacePanels.length === this.workspacePanels.length) {
			return;
		}

		const nextAgentPanels = nextWorkspacePanels.filter(
			(panel): panel is Panel => panel.kind === "agent"
		);
		const nextFilePanels = nextWorkspacePanels.filter(
			(panel): panel is FileWorkspacePanel => panel.kind === "file"
		);
		const nextReviewPanels = nextWorkspacePanels.filter(
			(panel): panel is ReviewPanel => panel.kind === "review"
		);
		const nextGitPanels = nextWorkspacePanels.filter(
			(panel): panel is GitPanel => panel.kind === "git"
		);
		const nextBrowserPanels = nextWorkspacePanels.filter(
			(panel): panel is BrowserWorkspacePanel => panel.kind === "browser"
		);

		this.agentState.syncTopLevelAgentPanelIndex(nextAgentPanels);
		this.agentState.clearRemovedTopLevelAgentPanelRefs(nextAgentPanels);
		this.fileState.syncFilePanelIndexes(nextFilePanels);
		this.reviewState.syncReviewPanelIndexes(nextReviewPanels);
		this.gitState.syncGitPanelIndexes(nextGitPanels);
		this.browserState.syncBrowserPanelIndexes(nextBrowserPanels);
		this.setWorkspacePanels(nextWorkspacePanels);
	}

	restoreWorkspacePanels(nextWorkspacePanels: readonly WorkspacePanel[]): void {
		const nextAgentPanels = nextWorkspacePanels.filter(
			(panel): panel is Panel => panel.kind === "agent"
		);
		const nextFilePanels = nextWorkspacePanels.filter(
			(panel): panel is FileWorkspacePanel => panel.kind === "file"
		);
		const nextReviewPanels = nextWorkspacePanels.filter(
			(panel): panel is ReviewPanel => panel.kind === "review"
		);
		const nextGitPanels = nextWorkspacePanels.filter(
			(panel): panel is GitPanel => panel.kind === "git"
		);
		const nextBrowserPanels = nextWorkspacePanels.filter(
			(panel): panel is BrowserWorkspacePanel => panel.kind === "browser"
		);

		this.agentState.syncTopLevelAgentPanelIndex(nextAgentPanels);
		this.agentState.clearRemovedTopLevelAgentPanelRefs(nextAgentPanels);
		this.fileState.syncFilePanelIndexes(nextFilePanels);
		this.reviewState.syncReviewPanelIndexes(nextReviewPanels);
		this.gitState.syncGitPanelIndexes(nextGitPanels);
		this.browserState.syncBrowserPanelIndexes(nextBrowserPanels);
		this.setWorkspacePanels(nextWorkspacePanels);
	}

	private isTopLevelWorkspacePanel(panel: WorkspacePanel): boolean {
		if (panel.kind === "agent") {
			return true;
		}
		return panel.ownerPanelId === null;
	}

	private findTopLevelWorkspacePanel(panelId: string): WorkspacePanel | undefined {
		const agentPanel = this.agentState.getTopLevelAgentPanel(panelId);
		if (agentPanel !== undefined) {
			return agentPanel;
		}
		const filePanel = this.fileState.getTopLevelFilePanelForLookup(panelId);
		if (filePanel !== undefined) {
			return filePanel;
		}
		return this.workspacePanels.find(
			(panel) => panel.id === panelId && this.isTopLevelWorkspacePanel(panel)
		);
	}

	private getTopLevelWorkspacePanels(): WorkspacePanel[] {
		return this.topLevelWorkspacePanelList;
	}

	getFirstTopLevelPanel(): WorkspacePanel | undefined {
		return this.topLevelWorkspacePanelList[0];
	}

	getTopLevelNonAgentPanelProjectRefs(): readonly TopLevelPanelProjectRef[] {
		return this.topLevelNonAgentPanelProjectRefList;
	}

	getPersistableWorkspacePanels(): WorkspacePanel[] {
		const persistableTopLevelPanelIds = new Set<string>();
		const persistablePanels: WorkspacePanel[] = [];
		for (const panel of this.getPersistableTopLevelWorkspacePanels()) {
			persistableTopLevelPanelIds.add(panel.id);
			persistablePanels.push(panel);
		}

		for (const ownerPanelId of persistableTopLevelPanelIds) {
			const attachedPanels = this.fileState.getAttachedFilePanelsForOwner(ownerPanelId);
			if (attachedPanels.length === 0) {
				continue;
			}
			for (const attachedPanel of attachedPanels) {
				if (isPersistableWorkspacePanel(attachedPanel)) {
					persistablePanels.push(attachedPanel);
				}
			}
		}

		return persistablePanels;
	}

	getPersistableTopLevelWorkspacePanels(): WorkspacePanel[] {
		const persistablePanels: WorkspacePanel[] = [];
		for (const panel of this.topLevelWorkspacePanelList) {
			if (isPersistableWorkspacePanel(panel)) {
				persistablePanels.push(panel);
			}
		}
		return persistablePanels;
	}

	getPersistableTopLevelWorkspacePanelIndex(panelId: string | null): number | null {
		if (panelId === null) {
			return null;
		}
		let persistableIndex = 0;
		for (const panel of this.topLevelWorkspacePanelList) {
			if (!isPersistableWorkspacePanel(panel)) {
				continue;
			}
			if (panel.id === panelId) {
				return persistableIndex;
			}
			persistableIndex += 1;
		}
		return -1;
	}

	createWorkspacePersistenceSnapshot(
		options: PanelWorkspacePersistenceSnapshotOptions = {}
	): PanelWorkspacePersistenceSnapshot {
		const persistableWorkspacePanels = this.getPersistableWorkspacePanels();
		const persistableAgentPanels: Panel[] = [];
		const persistableFilePanels: FilePanel[] = [];

		for (const panel of persistableWorkspacePanels) {
			if (panel.kind === "agent") {
				persistableAgentPanels.push(panel);
				continue;
			}
			if (panel.kind === "file") {
				persistableFilePanels.push(panel);
			}
		}

		return {
			workspacePanels: this.serializeWorkspacePanels(persistableWorkspacePanels),
			panels: persistableAgentPanels.map((panel) =>
				this.serializeLegacyAgentPanel(panel, options.getPanelScrollTop)
			),
			filePanels: this.serializeFilePanels(persistableFilePanels),
			activeFilePanelIdByOwnerPanelId: this.getActiveFilePanelIdByOwnerPanelIdRecord(),
			focusedPanelIndex: this.focusedPanelId
				? this.getPersistableTopLevelWorkspacePanelIndex(this.focusedPanelId)
				: null,
			panelContainerScrollX: this.scrollX,
			fullscreenPanelIndex: this.fullscreenPanelId
				? this.getPersistableTopLevelWorkspacePanelIndex(this.fullscreenPanelId)
				: null,
			terminalPanelGroups: this.serializeTerminalPanelGroups(this.terminalPanelGroups),
			terminalTabs: this.serializeTerminalTabs(this.terminalTabs),
			browserPanels: this.serializeBrowserPanels(this.browserPanels),
			embeddedTerminalTabs: this.embeddedTerminals.serialize(),
			viewMode: this.viewMode !== "multi" ? this.viewMode : undefined,
			focusedViewProjectPath: this.focusedViewProjectPath ?? undefined,
		};
	}

	private serializeLegacyAgentPanel(
		panel: Panel,
		getPanelScrollTop: ((panelId: string) => number) | undefined
	): PersistedPanelState {
		const sessionIdentity =
			panel.sessionId !== null
				? this.sessionStore.read.getSessionIdentity(panel.sessionId)
				: undefined;
		const sessionMetadata =
			panel.sessionId !== null
				? this.sessionStore.read.getSessionMetadata(panel.sessionId)
				: undefined;
		const hotState = this.getHotState(panel.id);
		return {
			id: panel.id,
			sessionId: panel.sessionId,
			autoCreated: panel.autoCreated === true ? true : undefined,
			width: panel.width,
			pendingProjectSelection: panel.pendingProjectSelection,
			selectedAgentId: panel.selectedAgentId,
			projectPath:
				panel.sessionId !== null
					? (sessionIdentity?.projectPath ?? null)
					: (panel.projectPath ?? null),
			agentId:
				panel.sessionId !== null ? (sessionIdentity?.agentId ?? null) : (panel.agentId ?? null),
			sourcePath:
				panel.sessionId !== null
					? (sessionMetadata?.sourcePath ?? undefined)
					: (panel.sourcePath ? panel.sourcePath : undefined),
			worktreePath:
				panel.sessionId !== null
					? (sessionIdentity?.worktreePath ?? undefined)
					: (panel.worktreePath ? panel.worktreePath : undefined),
			sessionTitle:
				panel.sessionId !== null
					? (sessionMetadata?.title ?? undefined)
					: (panel.sessionTitle ?? undefined),
			scrollTop: getPanelScrollTop?.(panel.id) ?? 0,
			planSidebarExpanded: hotState.planSidebarExpanded,
			messageDraft: hotState.messageDraft || undefined,
			embeddedTerminalDrawerOpen: hotState.embeddedTerminalDrawerOpen ? true : undefined,
			selectedEmbeddedTerminalTabId:
				this.embeddedTerminals.getSelectedTabId(panel.id) || undefined,
			sequenceId:
				panel.sessionId !== null ? (sessionMetadata?.sequenceId ?? undefined) : undefined,
			pendingWorktreeEnabled:
				panel.pendingWorktreeEnabled === null || panel.pendingWorktreeEnabled === undefined
					? undefined
					: panel.pendingWorktreeEnabled,
			preparedWorktreeLaunch: panel.preparedWorktreeLaunch ?? null,
		};
	}

	private serializeWorkspacePanels(
		workspacePanels: ReadonlyArray<WorkspacePanel>
	): PersistedWorkspacePanelState[] {
		const persistedPanels: PersistedWorkspacePanelState[] = [];
		for (const panel of workspacePanels) {
			const persistedPanel = this.serializeWorkspacePanel(panel);
			if (persistedPanel !== null) {
				persistedPanels.push(persistedPanel);
			}
		}
		return persistedPanels;
	}

	private serializeWorkspacePanel(panel: WorkspacePanel): PersistedWorkspacePanelState | null {
		if (panel.kind === "agent") {
			return {
				id: panel.id,
				kind: "agent",
				projectPath: panel.projectPath,
				width: panel.width,
				ownerPanelId: panel.ownerPanelId,
				sessionId: panel.sessionId,
				autoCreated: panel.autoCreated === true ? true : undefined,
				pendingProjectSelection: panel.pendingProjectSelection,
				pendingWorktreeEnabled:
					panel.pendingWorktreeEnabled === null || panel.pendingWorktreeEnabled === undefined
						? undefined
						: panel.pendingWorktreeEnabled,
				preparedWorktreeLaunch: panel.preparedWorktreeLaunch ?? null,
				selectedAgentId: panel.selectedAgentId,
				agentId: panel.agentId,
				sourcePath: panel.sourcePath ? panel.sourcePath : undefined,
				worktreePath: panel.worktreePath ? panel.worktreePath : undefined,
				sessionTitle: panel.sessionTitle ?? undefined,
				sequenceId: panel.sequenceId ?? undefined,
			};
		}

		if (panel.kind === "file") {
			return {
				id: panel.id,
				kind: "file",
				projectPath: panel.projectPath,
				width: panel.width,
				ownerPanelId: panel.ownerPanelId,
				filePath: panel.filePath,
				targetLine: panel.targetLine,
				targetColumn: panel.targetColumn,
			};
		}

		if (panel.kind === "terminal") {
			return {
				id: panel.id,
				kind: "terminal",
				projectPath: panel.projectPath,
				width: panel.width,
				ownerPanelId: panel.ownerPanelId,
				groupId: panel.groupId,
			};
		}

		if (panel.kind === "review") {
			return {
				id: panel.id,
				kind: "review",
				projectPath: panel.projectPath,
				width: panel.width,
				ownerPanelId: panel.ownerPanelId,
				files: panel.modifiedFilesState.files,
				totalEditCount: panel.modifiedFilesState.totalEditCount,
				selectedFileIndex: panel.selectedFileIndex,
			};
		}

		if (panel.kind === "git") {
			return null;
		}

		return {
			id: panel.id,
			kind: "browser",
			projectPath: panel.projectPath,
			width: panel.width,
			ownerPanelId: panel.ownerPanelId,
			url: panel.url,
			title: panel.title,
		};
	}

	private serializeFilePanels(filePanels: ReadonlyArray<FilePanel>): PersistedFilePanelState[] {
		return filePanels.map((panel) => ({
			id: panel.id,
			filePath: panel.filePath,
			projectPath: panel.projectPath,
			ownerPanelId: panel.ownerPanelId,
			width: panel.width,
			targetLine: panel.targetLine,
			targetColumn: panel.targetColumn,
		}));
	}

	private serializeTerminalPanelGroups(
		terminalPanelGroups: ReadonlyArray<TerminalPanelGroup>
	): PersistedTerminalPanelGroupState[] {
		return terminalPanelGroups.map((group) => ({
			id: group.id,
			projectPath: group.projectPath,
			width: group.width,
			selectedTabId: group.selectedTabId,
			order: group.order,
		}));
	}

	private serializeTerminalTabs(terminalTabs: ReadonlyArray<TerminalTab>): PersistedTerminalTabState[] {
		return terminalTabs.map((tab) => ({
			id: tab.id,
			groupId: tab.groupId,
			projectPath: tab.projectPath,
			createdAt: tab.createdAt,
		}));
	}

	private serializeBrowserPanels(browserPanels: ReadonlyArray<BrowserPanel>): PersistedBrowserPanelState[] {
		return browserPanels.map((panel) => ({
			projectPath: panel.projectPath,
			url: panel.url,
			title: panel.title,
			width: panel.width,
		}));
	}

	private getNextTopLevelPanelId(closedPanelId: string): string | null {
		const topLevelPanels = this.getTopLevelWorkspacePanels();
		const closedIndex = topLevelPanels.findIndex((panel) => panel.id === closedPanelId);
		if (closedIndex === -1) {
			return this.focusedPanelId;
		}

		const remainingPanels = topLevelPanels.filter((panel) => panel.id !== closedPanelId);
		if (remainingPanels.length === 0) {
			return null;
		}

		const nextIndex = Math.min(closedIndex, remainingPanels.length - 1);
		const nextPanel = remainingPanels[nextIndex];
		return nextPanel ? nextPanel.id : null;
	}

	// Derived lookups
	get panelBySessionId() {
		return this.agentState.panelBySessionId;
	}

	get panelCount(): number {
		return this.agentState.panelCount;
	}

	readonly focusedTopLevelPanel = $derived(
		this.focusedPanelId ? (this.findTopLevelWorkspacePanel(this.focusedPanelId) ?? null) : null
	);

	get focusedPanel(): Panel | null {
		return this.focusedPanelId
			? (this.agentState.getTopLevelAgentPanel(this.focusedPanelId) ?? null)
			: null;
	}

	get filePanelByPath(): SvelteMap<string, FilePanel> {
		return this.fileState.filePanelByPath;
	}

	get filePanelCount(): number {
		return this.fileState.filePanelCount;
	}

	get reviewPanelById() {
		return this.reviewState.reviewPanelById;
	}

	get reviewPanelCount(): number {
		return this.reviewState.reviewPanelCount;
	}

	get terminalPanelGroups(): TerminalPanelGroup[] {
		return this.terminalState.terminalPanelGroups;
	}

	get terminalTabs(): TerminalTab[] {
		return this.terminalState.terminalTabs;
	}

	get terminalPanelCount(): number {
		return this.terminalState.terminalPanelCount;
	}

	get gitPanelByProjectPath() {
		return this.gitState.gitPanelByProjectPath;
	}

	get gitPanelCount(): number {
		return this.gitState.gitPanelCount;
	}

	get gitDialog(): GitDialogState | null {
		return this.gitState.gitDialog;
	}

	get browserPanelCount(): number {
		return this.browserState.browserPanelCount;
	}

	// ============================================
	// HOT STATE MANAGEMENT
	// ============================================

	/**
	 * Get hot state for a panel.
	 */
	getHotState(panelId: string): PanelHotState {
		return this.hotStateStore.getHotState(panelId);
	}

	getTopLevelPanel(panelId: string): WorkspacePanel | undefined {
		return this.findTopLevelWorkspacePanel(panelId);
	}

	getTopLevelAgentPanel(panelId: string): Panel | undefined {
		return this.agentState.getTopLevelAgentPanel(panelId);
	}

	getTopLevelAgentPanelsForProject(projectPath: string): readonly Panel[] {
		return this.agentState.getTopLevelAgentPanelsForProject(projectPath);
	}

	getFirstSessionAgentPanelForProject(projectPath: string): Panel | undefined {
		return this.agentState.getFirstSessionAgentPanelForProject(projectPath);
	}

	getTopLevelAgentPanels(): readonly Panel[] {
		return this.agentState.getTopLevelAgentPanels();
	}

	getTopLevelAgentPanelRef(panelId: string) {
		return this.agentState.getTopLevelAgentPanelRef(panelId);
	}

	getTopLevelAgentPanelIds(): string[] {
		return this.agentState.getTopLevelAgentPanelIds();
	}

	getTopLevelAgentPanelProjectRefs(): Array<{
		readonly id: string;
		readonly sessionProjectPath: string | null;
		readonly sessionSequenceId: number | null;
	}> {
		return this.agentState.getTopLevelAgentPanelProjectRefs();
	}

	getPanel(panelId: string): (Panel & PanelHotState) | undefined {
		const panel = this.agentState.getPanelCore(panelId);
		if (!panel) return undefined;
		const hot = this.hotStateStore.getHotState(panelId);
		return { ...panel, ...hot };
	}

	clearAutoSessionSuppression(sessionId: string): void {
		this.hotStateStore.clearAutoSessionSuppression(sessionId);
	}

	syncAutoSessionSuppression(sessionId: string, signal: string): boolean {
		return this.hotStateStore.syncAutoSessionSuppression(sessionId, signal);
	}

	/**
	 * Open a session in a panel.
	 * If already open, focuses the existing panel.
	 */
	openSession(sessionId: string, width: number): Panel | null {
		return this.agentState.openSession(sessionId, width);
	}

	/**
	 * Ensure a session has a backing panel without changing focus or layout.
	 * If already open, returns the existing panel.
	 */
	materializeSessionPanel(sessionId: string, width: number): Panel | null {
		return this.agentState.materializeSessionPanel(sessionId, width);
	}

	/**
	 * Spawn a new empty panel (for project selection or eager session creation).
	 */
	spawnPanel(
		options: {
			requireProjectSelection?: boolean;
			projectPath?: string;
			id?: string;
			selectedAgentId?: string | null;
			pendingWorktreeEnabled?: boolean | null;
		} = {}
	): Panel {
		return this.agentState.spawnPanel(options);
	}

	/**
	 * Close a panel by ID.
	 *
	 * Cleans up all panel state including:
	 * - Panel from panels array
	 * - Hot state (review mode, drafts, etc.)
	 * - Pending session creations
	 * - Focus/fullscreen state
	 */
	closePanel(panelId: string): void {
		const closeStartedAtMs = performance.now();
		const panel = this.findTopLevelWorkspacePanel(panelId);
		if (!panel) return;
		const captureStateStartedAtMs = performance.now();
		const closeState = this.captureTopLevelPanelCloseState(panelId);
		const captureStateMs = roundPanelClosePerformanceMs(
			performance.now() - captureStateStartedAtMs
		);

		if (panel.kind === "file") {
			this.closeFilePanel(panelId);
			return;
		}

		if (panel.kind === "review") {
			this.closeReviewPanel(panelId);
			return;
		}

		if (panel.kind === "terminal") {
			this.closeTerminalPanel(panelId);
			return;
		}

		if (panel.kind === "git") {
			this.gitState.closeLegacyGitPanel(panelId);
			return;
		}

		if (panel.kind === "browser") {
			this.closeBrowserPanel(panelId);
			return;
		}

		const suppressionStartedAtMs = performance.now();
		if (panel.kind === "agent" && panel.autoCreated === true && panel.sessionId) {
			this.hotStateStore.recordAutoSessionSuppressionOnClose(panel.sessionId, panel.autoCreated);
		}
		const suppressionMs = roundPanelClosePerformanceMs(performance.now() - suppressionStartedAtMs);

		const clearOpeningSessionStartedAtMs = performance.now();
		if (panel.kind === "agent" && panel.sessionId) {
			this.agentState.clearOpeningSessionId(panel.sessionId);
		}
		const clearOpeningSessionMs = roundPanelClosePerformanceMs(
			performance.now() - clearOpeningSessionStartedAtMs
		);

		const removePanelStartedAtMs = performance.now();
		const removedAgentPanel = this.agentState.removeAgentPanel(panelId);
		const removePanelMs = roundPanelClosePerformanceMs(performance.now() - removePanelStartedAtMs);
		if (removedAgentPanel === null) return;

		// Clean up hot state to prevent memory leaks
		const hotStateCleanupStartedAtMs = performance.now();
		this.hotStateStore.deleteHotState(panelId);
		const hotStateCleanupMs = roundPanelClosePerformanceMs(
			performance.now() - hotStateCleanupStartedAtMs
		);

		const fileOwnershipCleanupStartedAtMs = performance.now();
		this.fileState.onOwnerPanelClosed(panelId);
		const fileOwnershipCleanupMs = roundPanelClosePerformanceMs(
			performance.now() - fileOwnershipCleanupStartedAtMs
		);

		// Clean up embedded terminal state (belt-and-suspenders with component onDestroy)
		const embeddedTerminalCleanupStartedAtMs = performance.now();
		this.embeddedTerminals.cleanup(panelId);
		const embeddedTerminalCleanupMs = roundPanelClosePerformanceMs(
			performance.now() - embeddedTerminalCleanupStartedAtMs
		);

		const focusStateApplyStartedAtMs = performance.now();
		this.applyTopLevelPanelCloseState(closeState);
		const focusStateApplyMs = roundPanelClosePerformanceMs(
			performance.now() - focusStateApplyStartedAtMs
		);

		const persistStartedAtMs = performance.now();
		this.onPersist();
		const persistMs = roundPanelClosePerformanceMs(performance.now() - persistStartedAtMs);
		this.lastClosePerformanceTrace = {
			panelId,
			kind: panel.kind,
			captureStateMs,
			suppressionMs,
			clearOpeningSessionMs,
			removePanelMs,
			hotStateCleanupMs,
			fileOwnershipCleanupMs,
			embeddedTerminalCleanupMs,
			focusStateApplyMs,
			persistMs,
			totalMs: roundPanelClosePerformanceMs(performance.now() - closeStartedAtMs),
		};
		logger.debug("Closed panel", { panelId });
	}

	getLastClosePerformanceTrace(): PanelClosePerformanceTrace | null {
		return this.lastClosePerformanceTrace;
	}

	/**
	 * Close a panel by session ID.
	 */
	closePanelBySessionId(sessionId: string): void {
		const panel = this.agentState.getPanelBySessionId(sessionId);
		if (panel) {
			this.closePanel(panel.id);
		}
	}

	/**
	 * Focus a panel.
	 */
	focusPanel(panelId: string): void {
		if (this.findTopLevelWorkspacePanel(panelId)) {
			this.focusedPanelId = panelId;
			this.onPanelFocused?.(panelId);
			this.onPersist();
		}
	}

	/**
	 * Focus a panel and switch fullscreen to it when fullscreen is active.
	 */
	focusAndSwitchToPanel(panelId: string): void {
		this.focusPanel(panelId);
		if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
			this.switchFullscreen(panelId);
		}
		// In focused view, switch to the panel's project so it becomes visible
		if (this.viewMode !== "multi") {
			const panel = this.findTopLevelWorkspacePanel(panelId);
			if (panel?.projectPath) {
				this.focusedViewProjectPath = panel.projectPath;
			}
		}
	}

	/**
	 * Move a panel to the front (leftmost position) of the panels array.
	 * No-op if panel is already first or not found.
	 */
	movePanelToFront(panelId: string): void {
		this.agentState.movePanelToFront(panelId);
	}

	/**
	 * Toggle fullscreen for a panel.
	 */
	toggleFullscreen(panelId: string): void {
		if (this.fullscreenPanelId === panelId) {
			this.exitFullscreen();
			return;
		}
		this.switchFullscreen(panelId);
	}

	/**
	 * Exit fullscreen (clear main fullscreen panel). Aux panel selection is left as-is.
	 */
	exitFullscreen(): void {
		this.setFullscreenPanelTarget(null);
	}

	/**
	 * Enter fullscreen with the given terminal as the aux panel.
	 * If no panel is fullscreen yet, sets fullscreen to focused or first panel.
	 * When there are no agent panels, enters aux-only fullscreen mode.
	 */
	enterTerminalFullscreen(terminalPanelId: string): void {
		this.setFullscreenPanelTarget(terminalPanelId);
	}

	/**
	 * Switch to a different fullscreen panel.
	 */
	switchFullscreen(panelId: string): void {
		this.setFullscreenPanelTarget(panelId);
	}

	/**
	 * Update panel with a session ID.
	 * Pass null to clear the session (e.g., when session doesn't exist on disk).
	 */
	updatePanelSession(panelId: string, sessionId: string | null): void {
		this.agentState.updatePanelSession(panelId, sessionId);
	}

	/**
	 * Resize a panel.
	 */
	resizePanel(panelId: string, delta: number): void {
		this.agentState.resizePanel(panelId, delta);
	}

	/**
	 * Set the selected agent for a panel.
	 */
	setPanelAgent(panelId: string, agentId: string | null): void {
		this.agentState.setPanelAgent(panelId, agentId);
	}

	/**
	 * Set the project path for a panel and clear pending project selection.
	 */
	setPanelProjectPath(panelId: string, projectPath: string): void {
		this.agentState.setPanelProjectPath(panelId, projectPath);
	}

	setPendingWorktreeEnabled(panelId: string, pendingWorktreeEnabled: boolean): void {
		this.agentState.setPendingWorktreeEnabled(panelId, pendingWorktreeEnabled);
	}

	setPreparedWorktreeLaunch(panelId: string, preparedWorktreeLaunch: PreparedWorktreeLaunch): void {
		this.agentState.setPreparedWorktreeLaunch(panelId, preparedWorktreeLaunch);
	}

	clearPreparedWorktreeLaunch(panelId: string): void {
		this.agentState.clearPreparedWorktreeLaunch(panelId);
	}

	/**
	 * Clear all panels.
	 */
	clearPanels(): void {
		this.agentState.clearAllAgentPanels();
		this.fileState.clearAttachedFilePanelState();
		this.browserState.clearAllBrowserPanels();
		this.focusedPanelId = null;
		this.setFullscreenPanelTarget(null);
		this.onPersist();
	}

	setViewMode(mode: ViewMode): void {
		this.viewMode = mode;
		// Reset fullscreen state — each view mode manages its own layout.
		this.setFullscreenPanelTarget(null);
		this.onPersist();
	}

	setFocusedViewProjectPath(path: string): void {
		this.focusedViewProjectPath = path;
		this.onPersist();
	}

	/**
	 * Get panel by session ID (O(1) lookup).
	 */
	getPanelBySessionId(sessionId: string): Panel | undefined {
		return this.agentState.getPanelBySessionId(sessionId);
	}

	/**
	 * Check if a session is open in a panel.
	 */
	isSessionOpen(sessionId: string): boolean {
		return this.agentState.isSessionOpen(sessionId);
	}

	// ============================================
	// SESSION CREATION STATE
	// ============================================

	// ============================================
	// PLAN SIDEBAR MANAGEMENT
	// ============================================

	/**
	 * Set the plan sidebar expanded state for a panel.
	 */
	setPlanSidebarExpanded(panelId: string, expanded: boolean): void {
		this.hotStateStore.setPlanSidebarExpanded(panelId, expanded);
	}

	togglePlanSidebar(panelId: string): void {
		this.hotStateStore.togglePlanSidebar(panelId);
	}

	isPlanSidebarExpanded(panelId: string): boolean {
		return this.hotStateStore.isPlanSidebarExpanded(panelId);
	}

	// ============================================
	// BROWSER SIDEBAR MANAGEMENT
	// ============================================

	/**
	 * Set the browser sidebar expanded state for a panel.
	 */
	setBrowserSidebarExpanded(panelId: string, expanded: boolean, url?: string): void {
		this.hotStateStore.setBrowserSidebarExpanded(panelId, expanded, url);
	}

	toggleBrowserSidebar(panelId: string): void {
		this.hotStateStore.toggleBrowserSidebar(panelId);
	}

	isBrowserSidebarExpanded(panelId: string): boolean {
		return this.hotStateStore.isBrowserSidebarExpanded(panelId);
	}

	// ============================================
	// MESSAGE DRAFT MANAGEMENT
	// ============================================

	/**
	 * Set the message draft for a panel.
	 */
	setMessageDraft(panelId: string, draft: string): void {
		this.hotStateStore.setMessageDraft(panelId, draft);
	}

	getMessageDraft(panelId: string): string {
		return this.hotStateStore.getMessageDraft(panelId);
	}

	setProvisionalAutonomousEnabled(panelId: string, enabled: boolean): void {
		this.hotStateStore.setProvisionalAutonomousEnabled(panelId, enabled);
	}

	setPendingComposerRestore(
		panelId: string,
		restore: NonNullable<PanelHotState["pendingComposerRestore"]>
	): void {
		this.hotStateStore.setPendingComposerRestore(panelId, restore);
	}

	consumePendingComposerRestore(panelId: string): PanelHotState["pendingComposerRestore"] {
		return this.hotStateStore.consumePendingComposerRestore(panelId);
	}

	// ============================================
	// EMBEDDED TERMINAL DRAWER MANAGEMENT
	// ============================================

	/**
	 * Check if the embedded terminal drawer is open for a panel.
	 */
	isEmbeddedTerminalDrawerOpen(panelId: string): boolean {
		return this.hotStateStore.isEmbeddedTerminalDrawerOpen(panelId);
	}

	setEmbeddedTerminalDrawerOpen(panelId: string, open: boolean): void {
		this.hotStateStore.setEmbeddedTerminalDrawerOpen(panelId, open);
	}

	toggleEmbeddedTerminalDrawer(panelId: string, cwd: string): void {
		this.hotStateStore.toggleEmbeddedTerminalDrawer(panelId, cwd);
	}

	// ============================================
	// PENDING USER ENTRY (OPTIMISTIC FIRST MESSAGE)
	// ============================================

	/**
	 * Set a pending user entry for optimistic display before session creation.
	 * This entry is transient (not persisted) and cleared once the real session sends.
	 * Intentionally no onPersist() — this is transient optimistic state, not workspace data.
	 */
	setPendingUserEntry(panelId: string, entry: SessionEntry): void {
		this.hotStateStore.setPendingUserEntry(panelId, entry);
	}

	clearPendingUserEntry(panelId: string): void {
		this.hotStateStore.clearPendingUserEntry(panelId);
	}

	setPendingWorktreeSetup(panelId: string, setup: PanelHotState["pendingWorktreeSetup"]): void {
		this.hotStateStore.setPendingWorktreeSetup(panelId, setup);
	}

	clearPendingWorktreeSetup(panelId: string): void {
		this.hotStateStore.clearPendingWorktreeSetup(panelId);
	}

	setSignInRequirement(panelId: string, requirement: PanelHotState["signInRequirement"]): void {
		this.hotStateStore.setSignInRequirement(panelId, requirement);
	}

	clearSignInRequirement(panelId: string): void {
		this.hotStateStore.clearSignInRequirement(panelId);
	}

	// ============================================
	// PROJECT FILE SYSTEM DIALOG
	// ============================================

	openProjectFileSystemDialog(
		projectPath: string,
		filePath: string,
		options: OpenProjectFileSystemDialogOptions = {}
	): ProjectFileSystemDialogState {
		const dialog = {
			id: crypto.randomUUID(),
			projectPath,
			filePath,
			projectName: options.projectName ?? null,
			projectColor: options.projectColor ?? null,
			projectIconSrc: options.projectIconSrc ?? null,
			title: options.title ?? null,
			targetLine: options.targetLine ?? null,
			targetColumn: options.targetColumn ?? null,
		};
		this.projectFileSystemDialog = dialog;
		logger.debug("Opened project file system dialog", { projectPath, filePath });
		return dialog;
	}

	closeProjectFileSystemDialog(): void {
		if (this.projectFileSystemDialog === null) {
			return;
		}
		const dialogId = this.projectFileSystemDialog.id;
		this.projectFileSystemDialog = null;
		logger.debug("Closed project file system dialog", { dialogId });
	}

	// ============================================
	// FILE PANEL MANAGEMENT
	// ============================================

	openFilePanel(
		filePath: string,
		projectPath: string,
		options?: OpenFilePanelOptions | number
	): FilePanel {
		return this.fileState.openFilePanel(filePath, projectPath, options);
	}

	closeFilePanel(panelId: string): void {
		this.fileState.closeFilePanel(panelId);
	}

	isFileOpen(filePath: string, projectPath: string): boolean {
		return this.fileState.isFileOpen(filePath, projectPath);
	}

	resizeFilePanel(panelId: string, delta: number): void {
		this.fileState.resizeFilePanel(panelId, delta);
	}

	getFilePanel(panelId: string): FilePanel | undefined {
		return this.fileState.getFilePanel(panelId);
	}

	getFilePanelByPath(filePath: string, projectPath: string): FilePanel | undefined {
		return this.fileState.getFilePanelByPath(filePath, projectPath);
	}

	getFilePanelsForProject(projectPath: string): FilePanel[] {
		return this.fileState.getFilePanelsForProject(projectPath);
	}

	getAttachedFilePanels(ownerPanelId: string): FilePanel[] {
		return this.fileState.getAttachedFilePanels(ownerPanelId);
	}

	hasAttachedFilePanels(ownerPanelId: string): boolean {
		return this.fileState.hasAttachedFilePanels(ownerPanelId);
	}

	getActiveFilePanelId(ownerPanelId: string): string | null {
		return this.fileState.getActiveFilePanelId(ownerPanelId);
	}

	getActiveAttachedFilePanel(ownerPanelId: string): FilePanel | null {
		return this.fileState.getActiveAttachedFilePanel(ownerPanelId);
	}

	setActiveAttachedFilePanel(ownerPanelId: string, filePanelId: string): void {
		this.fileState.setActiveAttachedFilePanel(ownerPanelId, filePanelId);
	}

	getActiveTopLevelFilePanelId(projectPath: string): string | null {
		return this.fileState.getActiveTopLevelFilePanelId(projectPath);
	}

	getTopLevelFilePanels(): FilePanel[] {
		return this.fileState.getTopLevelFilePanels();
	}

	setActiveTopLevelFilePanel(projectPath: string, filePanelId: string): void {
		this.fileState.setActiveTopLevelFilePanel(projectPath, filePanelId);
	}

	getTopLevelFilePanelsForProject(projectPath: string): FilePanel[] {
		return this.fileState.getTopLevelFilePanelsForProject(projectPath);
	}

	getActiveFilePanelIdByOwnerPanelIdRecord(): Record<string, string> {
		return this.fileState.getActiveFilePanelIdByOwnerPanelIdRecord();
	}

	setActiveFilePanelMap(activeMap: Map<string, string>): void {
		this.fileState.setActiveFilePanelMap(activeMap);
	}

	// ============================================
	// REVIEW PANEL MANAGEMENT
	// ============================================

	/**
	 * Open a review panel for modified files.
	 * If a review panel with the same projectPath already exists, returns the existing one.
	 */
	openReviewPanel(
		projectPath: string,
		modifiedFilesState: ModifiedFilesState,
		initialFileIndex?: number,
		width?: number
	): ReviewPanel {
		return this.reviewState.openReviewPanel(
			projectPath,
			modifiedFilesState,
			initialFileIndex,
			width
		);
	}

	/**
	 * Close a review panel by ID.
	 */
	closeReviewPanel(panelId: string): void {
		this.reviewState.closeReviewPanel(panelId);
	}

	/**
	 * Update the selected file index in a review panel.
	 */
	updateReviewPanelFileIndex(panelId: string, fileIndex: number): void {
		this.reviewState.updateReviewPanelFileIndex(panelId, fileIndex);
	}

	/**
	 * Update the modified files state in a review panel.
	 * Used after accept/reject actions that modify the state.
	 */
	updateReviewPanelState(panelId: string, modifiedFilesState: ModifiedFilesState): void {
		this.reviewState.updateReviewPanelState(panelId, modifiedFilesState);
	}

	/**
	 * Resize a review panel.
	 */
	resizeReviewPanel(panelId: string, delta: number): void {
		this.reviewState.resizeReviewPanel(panelId, delta);
	}

	/**
	 * Get a review panel by ID.
	 */
	getReviewPanel(panelId: string): ReviewPanel | undefined {
		return this.reviewState.getReviewPanel(panelId);
	}

	/**
	 * Get a review panel by project path.
	 */
	getReviewPanelByProjectPath(projectPath: string): ReviewPanel | undefined {
		return this.reviewState.getReviewPanelByProjectPath(projectPath);
	}

	// ============================================
	// TERMINAL PANEL MANAGEMENT
	// ============================================

	restoreTerminalPanelState(
		groups: readonly TerminalPanelGroup[],
		tabs: readonly TerminalTab[]
	): void {
		this.terminalState.restoreTerminalPanelState(groups, tabs);
	}

	getTerminalPanelsForProject(projectPath: string): TerminalPanelGroup[] {
		return this.terminalState.getTerminalPanelsForProject(projectPath);
	}

	setSelectedTerminalPanel(projectPath: string, panelId: string): void {
		this.terminalState.setSelectedTerminalPanel(projectPath, panelId);
	}

	getTerminalPanelGroup(groupId: string): TerminalPanelGroup | undefined {
		return this.terminalState.getTerminalPanelGroup(groupId);
	}

	getTerminalPanelGroupsForProject(projectPath: string): TerminalPanelGroup[] {
		return this.terminalState.getTerminalPanelGroupsForProject(projectPath);
	}

	getTerminalTabsForGroup(groupId: string): TerminalTab[] {
		return this.terminalState.getTerminalTabsForGroup(groupId);
	}

	getSelectedTerminalTabId(groupId: string): string | null {
		return this.terminalState.getSelectedTerminalTabId(groupId);
	}

	getSelectedTerminalTab(groupId: string): TerminalTab | null {
		return this.terminalState.getSelectedTerminalTab(groupId);
	}

	canMoveTerminalTabToNewPanel(tabId: string): boolean {
		return this.terminalState.canMoveTerminalTabToNewPanel(tabId);
	}

	openTerminalPanel(projectPath: string, width?: number): TerminalPanelGroup {
		return this.terminalState.openTerminalPanel(projectPath, width);
	}

	openTerminalTab(groupId: string): TerminalTab | null {
		return this.terminalState.openTerminalTab(groupId);
	}

	setSelectedTerminalTab(groupId: string, tabId: string): void {
		this.terminalState.setSelectedTerminalTab(groupId, tabId);
	}

	moveTerminalTabToNewPanel(tabId: string): TerminalPanelGroup | null {
		return this.terminalState.moveTerminalTabToNewPanel(tabId);
	}

	closeTerminalPanel(panelId: string): void {
		this.terminalState.closeTerminalPanel(panelId);
	}

	updateTerminalPtyId(tabId: string, ptyId: number, shell: string): void {
		this.terminalState.updateTerminalPtyId(tabId, ptyId, shell);
	}

	closeTerminalTab(tabId: string): void {
		this.terminalState.closeTerminalTab(tabId);
	}

	resizeTerminalPanel(groupId: string, delta: number): void {
		this.terminalState.resizeTerminalPanel(groupId, delta);
	}

	getTerminalPanel(panelId: string): TerminalPanelGroup | undefined {
		return this.terminalState.getTerminalPanel(panelId);
	}

	toggleTerminalPanel(projectPath: string, width?: number): void {
		this.terminalState.toggleTerminalPanel(projectPath, width);
	}

	isTerminalOpenForProject(projectPath: string): boolean {
		return this.terminalState.isTerminalOpenForProject(projectPath);
	}

	// ============================================
	// GIT DIALOG MANAGEMENT
	// ============================================

	/**
	 * Open source control in a single dialog for a project.
	 */
	openGitDialog(
		projectPath: string,
		width?: number,
		initialTarget?: GitPanelInitialTarget
	): GitDialogState {
		return this.gitState.openGitDialog(projectPath, width, initialTarget);
	}

	/**
	 * Close the source control dialog.
	 */
	closeGitDialog(): void {
		this.gitState.closeGitDialog();
	}

	// ============================================
	// BROWSER PANEL MANAGEMENT
	// ============================================

	/**
	 * Open a browser panel for a URL, scoped to a project.
	 * If already open for the same project+URL, focuses the existing panel.
	 */
	openBrowserPanel(projectPath: string, url: string, title?: string): BrowserPanel {
		return this.browserState.openBrowserPanel(projectPath, url, title);
	}

	/**
	 * Close a browser panel by ID.
	 */
	closeBrowserPanel(panelId: string): void {
		this.browserState.closeBrowserPanel(panelId);
	}

	/**
	 * Resize a browser panel.
	 */
	resizeBrowserPanel(panelId: string, delta: number): void {
		this.browserState.resizeBrowserPanel(panelId, delta);
	}

	/**
	 * Get a browser panel by ID.
	 */
	getBrowserPanel(panelId: string): BrowserPanel | undefined {
		return this.browserState.getBrowserPanel(panelId);
	}

	getBrowserPanelsForProject(projectPath: string): BrowserPanel[] {
		return this.browserState.getBrowserPanelsForProject(projectPath);
	}
}

/**
 * Create and set the panel store in Svelte context.
 */
export function createPanelStore(
	sessionStore: SessionStore,
	agentStore: AgentStore,
	onPersist: () => void
): PanelStore {
	const store = new PanelStore(sessionStore, agentStore, onPersist);
	currentPanelStore = store;
	setContext(PANEL_STORE_KEY, store);
	return store;
}

/**
 * Get the panel store from Svelte context.
 */
export function getPanelStore(): PanelStore {
	return getContext<PanelStore | undefined>(PANEL_STORE_KEY) ?? currentPanelStore!;
}
