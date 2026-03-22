/**
 * Workspace Store - Manages workspace persistence coordination.
 *
 * This store handles saving and restoring workspace state (panels, focus, scroll position)
 * to/from persistent storage.
 */

import type { ResultAsync } from "neverthrow";

import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "../errors/app-error.js";
import { createLogger } from "../utils/logger.js";
import { api } from "./api.js";
import type { BrowserPanel } from "./browser-panel-type.js";
import { remapOwnerPanelId } from "./file-panel-ownership.js";
import type { FilePanel } from "./file-panel-type.js";
import type { PanelStore } from "./panel-store.svelte.js";
import type { SessionStore } from "./session-store.svelte.js";
import type { TerminalPanel } from "./terminal-panel-type.js";
import type {
	PersistedBrowserPanelState,
	PersistedFilePanelState,
	PersistedReviewFullscreenState,
	PersistedSqlStudioState,
	PersistedTerminalPanelState,
	PersistedWorkspaceState,
} from "./types.js";

const WORKSPACE_STORE_KEY = Symbol("workspace-store");
const logger = createLogger({ id: "workspace-store", name: "WorkspaceStore" });

/**
 * Convert runtime file panels to persisted format.
 */
export function serializeFilePanels(
	filePanels: ReadonlyArray<FilePanel>
): PersistedFilePanelState[] {
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

/**
 * Hydrate persisted file panels with fresh runtime IDs.
 */
export function hydratePersistedFilePanels(
	persistedFilePanels: ReadonlyArray<PersistedFilePanelState>,
	createId: () => string = () => crypto.randomUUID()
): FilePanel[] {
	return persistedFilePanels.map((panel) => ({
		id: panel.id ?? createId(),
		filePath: panel.filePath,
		projectPath: panel.projectPath,
		ownerPanelId: panel.ownerPanelId ?? null,
		width: panel.width,
		targetLine: panel.targetLine,
		targetColumn: panel.targetColumn,
	}));
}

/**
 * Convert runtime terminal panels to persisted format.
 * Runtime-only fields (ptyId, shell) are stripped.
 */
export function serializeTerminalPanels(
	terminalPanels: ReadonlyArray<TerminalPanel>
): PersistedTerminalPanelState[] {
	return terminalPanels.map((panel) => ({
		id: panel.id,
		projectPath: panel.projectPath,
		width: panel.width,
	}));
}

/**
 * Hydrate persisted terminal panels with fresh runtime state.
 */
export function hydratePersistedTerminalPanels(
	persisted: ReadonlyArray<PersistedTerminalPanelState>
): TerminalPanel[] {
	return persisted.map((panel) => ({
		id: panel.id ?? crypto.randomUUID(),
		projectPath: panel.projectPath,
		width: panel.width,
		ptyId: null,
		shell: null,
	}));
}

/**
 * Convert runtime browser panels to persisted format.
 */
export function serializeBrowserPanels(
	browserPanels: ReadonlyArray<BrowserPanel>
): PersistedBrowserPanelState[] {
	return browserPanels.map((panel) => ({
		projectPath: panel.projectPath,
		url: panel.url,
		title: panel.title,
		width: panel.width,
	}));
}

/**
 * Hydrate persisted browser panels with fresh runtime IDs.
 */
export function hydratePersistedBrowserPanels(
	persisted: ReadonlyArray<PersistedBrowserPanelState>
): BrowserPanel[] {
	return persisted.map((panel) => ({
		id: crypto.randomUUID(),
		// Backward compat: panels persisted before projectPath field was added
		projectPath: "projectPath" in panel ? panel.projectPath : "",
		url: panel.url,
		title: panel.title,
		width: panel.width,
	}));
}

/**
 * Configuration for additional workspace state that can be persisted.
 * These are optional getters/setters that allow external components
 * to participate in workspace persistence without tight coupling.
 */
export interface WorkspaceStateProviders {
	/** Get current sidebar open state */
	getSidebarOpen?: () => boolean;
	/** Set sidebar open state on restore */
	setSidebarOpen?: (open: boolean) => void;
	/** Get current top bar visibility state */
	getTopBarVisible?: () => boolean;
	/** Set top bar visibility state on restore */
	setTopBarVisible?: (visible: boolean) => void;
	/** Get file tree expansion state (projectPath -> expanded folder paths) */
	getFileTreeExpansion?: () => Record<string, string[]>;
	/** Set file tree expansion state on restore */
	setFileTreeExpansion?: (expansion: Record<string, string[]>) => void;
	/** Get project file view modes (projectPath -> "sessions" | "files") */
	getProjectFileViewModes?: () => Record<string, "sessions" | "files">;
	/** Set project file view modes on restore */
	setProjectFileViewModes?: (modes: Record<string, "sessions" | "files">) => void;
	/** Get scroll position for a panel */
	getPanelScrollTop?: (panelId: string) => number;
	/** Set scroll position for a panel on restore */
	setPanelScrollTop?: (panelId: string, scrollTop: number) => void;
	/** Get SQL Studio state */
	getSqlStudioState?: () => PersistedSqlStudioState;
	/** Set SQL Studio state on restore */
	setSqlStudioState?: (state: PersistedSqlStudioState) => void;
	/** Get full-screen review overlay state */
	getReviewFullscreenState?: () => PersistedReviewFullscreenState;
	/** Set full-screen review overlay state on restore */
	setReviewFullscreenState?: (state: PersistedReviewFullscreenState) => void;
	/** Get collapsed project paths */
	getCollapsedProjectPaths?: () => string[];
	/** Set collapsed project paths on restore */
	setCollapsedProjectPaths?: (paths: string[]) => void;
	/** Get attention queue expanded state */
	getQueueExpanded?: () => boolean;
	/** Set attention queue expanded state on restore */
	setQueueExpanded?: (expanded: boolean) => void;
}

export class WorkspaceStore {
	private persistDebounce: ReturnType<typeof setTimeout> | null = null;
	private providers: WorkspaceStateProviders = {};

	constructor(
		private panelStore: PanelStore,
		private sessionStore: SessionStore
	) {}

	/**
	 * Register state providers for additional workspace state.
	 * Call this after construction to enable persistence of sidebar, file tree, etc.
	 */
	registerProviders(providers: WorkspaceStateProviders): void {
		this.providers = { ...this.providers, ...providers };
	}

	/**
	 * Persist workspace state (debounced).
	 */
	persist(immediate = false): void {
		const saveState = () => {
			this.persistDebounce = null;
			const state: PersistedWorkspaceState = {
				version: 9,
				panels: this.panelStore.panels.map((p) => {
					// Use immutable session identity when possible to avoid reconstructing full session objects.
					const sessionIdentity = p.sessionId
						? this.sessionStore.getSessionIdentity(p.sessionId)
						: undefined;
					const sessionMetadata = p.sessionId
						? this.sessionStore.getSessionMetadata(p.sessionId)
						: undefined;
					// Get plan sidebar state from PanelStore hot state
					const hotState = this.panelStore.getHotState(p.id);
					return {
						id: p.id,
						sessionId: p.sessionId,
						width: p.width,
						pendingProjectSelection: p.pendingProjectSelection,
						selectedAgentId: p.selectedAgentId,
						projectPath: sessionIdentity?.projectPath ?? p.projectPath ?? null,
						agentId: sessionIdentity?.agentId ?? p.agentId ?? null,
						sessionTitle: sessionMetadata?.title || undefined,
						scrollTop: this.providers.getPanelScrollTop?.(p.id) ?? 0,
						planSidebarExpanded: hotState.planSidebarExpanded,
						messageDraft: hotState.messageDraft || undefined,
						reviewMode: hotState.reviewMode ? true : undefined,
						reviewFileIndex:
							hotState.reviewMode && hotState.reviewFileIndex !== undefined
								? hotState.reviewFileIndex
								: undefined,
						// Embedded terminal drawer state (version 9+)
						embeddedTerminalDrawerOpen: hotState.embeddedTerminalDrawerOpen ? true : undefined,
						selectedEmbeddedTerminalTabId:
							this.panelStore.embeddedTerminals.getSelectedTabId(p.id) || undefined,
					};
				}),
				filePanels: serializeFilePanels(this.panelStore.filePanels),
				activeFilePanelIdByOwnerPanelId: this.panelStore.getActiveFilePanelIdByOwnerPanelIdRecord(),
				focusedPanelIndex: this.panelStore.focusedPanelId
					? this.panelStore.panels.findIndex((p) => p.id === this.panelStore.focusedPanelId)
					: null,
				panelContainerScrollX: this.panelStore.scrollX,
				savedAt: new Date().toISOString(),
				// Additional state from providers
				sidebarOpen: this.providers.getSidebarOpen?.() ?? true,
				topBarVisible: this.providers.getTopBarVisible?.() ?? true,
				fileTreeExpansion: this.providers.getFileTreeExpansion?.() ?? {},
				projectFileViewModes: this.providers.getProjectFileViewModes?.() ?? {},
				// Fullscreen state
				fullscreenPanelIndex: this.panelStore.fullscreenPanelId
					? this.panelStore.panels.findIndex((p) => p.id === this.panelStore.fullscreenPanelId)
					: null,
				// SQL Studio state
				sqlStudio: this.providers.getSqlStudioState?.(),
				// Full-screen review state
				reviewFullscreen: this.providers.getReviewFullscreenState?.(),
				// Terminal + browser panels (version 7+)
				terminalPanels: serializeTerminalPanels(this.panelStore.terminalPanels),
				browserPanels: serializeBrowserPanels(this.panelStore.browserPanels),
				fullscreenAuxPanel: this.panelStore.fullscreenAuxPanel ?? undefined,
				// Embedded terminal tabs per panel (version 9+)
				embeddedTerminalTabs: this.panelStore.embeddedTerminals.serialize(),
				// View mode state (version 8+)
				viewMode: this.panelStore.viewMode !== "multi" ? this.panelStore.viewMode : undefined,
				focusedViewProjectPath: this.panelStore.focusedViewProjectPath ?? undefined,
				// Sidebar card collapse state
				collapsedProjectPaths: this.providers.getCollapsedProjectPaths?.() ?? [],
				queueExpanded: this.providers.getQueueExpanded?.(),
			};
			api.saveWorkspaceState(state).mapErr((error) => {
				logger.error("Failed to persist workspace state", { error });
			});
		};

		if (this.persistDebounce) {
			clearTimeout(this.persistDebounce);
			this.persistDebounce = null;
		}

		if (immediate) {
			saveState();
			return;
		}

		this.persistDebounce = setTimeout(saveState, 300);
	}

	/**
	 * Restore workspace state from persisted data.
	 * Returns list of session IDs that need to be loaded.
	 */
	restore(state: PersistedWorkspaceState): string[] {
		logger.debug("Restoring workspace", {
			panelCount: state.panels.length,
			version: state.version,
		});

		// Restore panels with new IDs, preserving hot state for later
		const panelScrollPositions: Array<{ id: string; scrollTop: number }> = [];
		const panelPlanSidebarStates: Array<{ id: string; expanded: boolean }> = [];
		const panelMessageDrafts: Array<{ id: string; draft: string }> = [];
		const restoredPanelIdByPersistedPanelId = new SvelteMap<string, string>();
		const restoredPanels = state.panels.map((p, index) => {
			const id = crypto.randomUUID();
			if (p.id) {
				restoredPanelIdByPersistedPanelId.set(p.id, id);
			}
			if (p.scrollTop !== undefined && p.scrollTop > 0) {
				panelScrollPositions.push({ id, scrollTop: p.scrollTop });
			}
			if (p.planSidebarExpanded !== undefined) {
				panelPlanSidebarStates.push({ id, expanded: p.planSidebarExpanded });
			}
			// Support both new per-panel draft and legacy index-based drafts
			const draft = p.messageDraft ?? state.messageDrafts?.[index];
			if (draft) {
				panelMessageDrafts.push({ id, draft });
			}
			return {
				id,
				sessionId: p.sessionId,
				width: p.width,
				pendingProjectSelection: p.pendingProjectSelection || false,
				// For panels without a session, don't restore agent - let user select via buttons
				selectedAgentId: p.sessionId ? (p.selectedAgentId ?? null) : null,
				projectPath: p.projectPath ?? null,
				agentId: p.agentId ?? null,
				sessionTitle: p.sessionTitle ?? null,
			};
		});

		this.panelStore.panels = restoredPanels;
		const hydratedFilePanels = hydratePersistedFilePanels(state.filePanels ?? []).filter(
			(panel) => {
				const ownerPanelId = remapOwnerPanelId(
					panel.ownerPanelId,
					restoredPanelIdByPersistedPanelId
				);
				if (ownerPanelId === null) {
					return true;
				}
				return restoredPanels.some((restoredPanel) => restoredPanel.id === ownerPanelId);
			}
		);
		this.panelStore.filePanels = hydratedFilePanels.map((panel) => ({
			...panel,
			ownerPanelId: remapOwnerPanelId(panel.ownerPanelId, restoredPanelIdByPersistedPanelId),
		}));

		const nextActiveFilePanelIdByOwnerPanelId = new SvelteMap<string, string>();
		for (const [ownerPanelId, filePanelId] of Object.entries(
			state.activeFilePanelIdByOwnerPanelId ?? {}
		)) {
			const resolvedOwnerPanelId =
				restoredPanelIdByPersistedPanelId.get(ownerPanelId) ?? ownerPanelId;
			const activeFilePanel = this.panelStore.filePanels.find(
				(panel) =>
					panel.id === filePanelId &&
					panel.ownerPanelId !== null &&
					panel.ownerPanelId === resolvedOwnerPanelId
			);
			if (activeFilePanel) {
				nextActiveFilePanelIdByOwnerPanelId.set(resolvedOwnerPanelId, activeFilePanel.id);
			}
		}
		this.panelStore.setActiveFilePanelMap(nextActiveFilePanelIdByOwnerPanelId);

		// Restore focus
		if (
			state.focusedPanelIndex !== null &&
			state.focusedPanelIndex >= 0 &&
			state.focusedPanelIndex < restoredPanels.length
		) {
			this.panelStore.focusedPanelId = restoredPanels[state.focusedPanelIndex].id;
		} else if (restoredPanels.length > 0) {
			this.panelStore.focusedPanelId = restoredPanels[0].id;
		}

		// Restore scroll position
		this.panelStore.scrollX = state.panelContainerScrollX;

		// Restore additional state via providers (version 2+)
		if (state.sidebarOpen !== undefined) {
			this.providers.setSidebarOpen?.(state.sidebarOpen);
		}
		if (state.topBarVisible !== undefined) {
			this.providers.setTopBarVisible?.(state.topBarVisible);
		}
		if (state.fileTreeExpansion) {
			this.providers.setFileTreeExpansion?.(state.fileTreeExpansion);
		}
		if (state.projectFileViewModes && Object.keys(state.projectFileViewModes).length > 0) {
			this.providers.setProjectFileViewModes?.(state.projectFileViewModes);
		}

		// Restore panel scroll positions (deferred to allow DOM to render)
		if (panelScrollPositions.length > 0) {
			// Use requestAnimationFrame to ensure DOM is ready
			requestAnimationFrame(() => {
				for (const { id, scrollTop } of panelScrollPositions) {
					this.providers.setPanelScrollTop?.(id, scrollTop);
				}
			});
		}

		// Restore plan sidebar states via PanelStore (no DOM dependency)
		for (const { id, expanded } of panelPlanSidebarStates) {
			this.panelStore.setPlanSidebarExpanded(id, expanded);
		}

		// Restore message drafts via PanelStore
		for (const { id, draft } of panelMessageDrafts) {
			this.panelStore.setMessageDraft(id, draft);
		}

		// Restore fullscreen state
		if (
			state.fullscreenPanelIndex !== undefined &&
			state.fullscreenPanelIndex !== null &&
			state.fullscreenPanelIndex >= 0 &&
			state.fullscreenPanelIndex < restoredPanels.length
		) {
			this.panelStore.fullscreenPanelId = restoredPanels[state.fullscreenPanelIndex].id;
		}

		// Restore SQL Studio state (version 4+)
		if (state.sqlStudio) {
			this.providers.setSqlStudioState?.(state.sqlStudio);
		}

		// Restore panel review mode (deferred until session loads)
		const panelReviewRestores: Array<{ id: string; reviewFileIndex: number }> = [];
		for (let i = 0; i < state.panels.length; i++) {
			const p = state.panels[i];
			if (p.reviewMode && p.sessionId) {
				panelReviewRestores.push({
					id: restoredPanels[i].id,
					reviewFileIndex: p.reviewFileIndex ?? 0,
				});
			}
		}
		for (const { id, reviewFileIndex } of panelReviewRestores) {
			this.panelStore.setPendingReviewRestore(id, reviewFileIndex);
		}

		// Restore full-screen review overlay (version 5+)
		if (state.reviewFullscreen) {
			this.providers.setReviewFullscreenState?.(state.reviewFullscreen);
		}

		// Restore terminal panels (version 7+)
		if (state.terminalPanels && state.terminalPanels.length > 0) {
			this.panelStore.terminalPanels = hydratePersistedTerminalPanels(state.terminalPanels);
		}

		// Restore browser panels (version 7+)
		if (state.browserPanels && state.browserPanels.length > 0) {
			this.panelStore.browserPanels = hydratePersistedBrowserPanels(state.browserPanels);
		}

		// Restore embedded terminal tabs (version 9+)
		if (state.embeddedTerminalTabs && state.embeddedTerminalTabs.length > 0) {
			const selectedTabByPanelId = new SvelteMap<string, string>();
			for (const p of state.panels) {
				if (p.id && p.selectedEmbeddedTerminalTabId) {
					selectedTabByPanelId.set(p.id, p.selectedEmbeddedTerminalTabId);
				}
				if (p.id && p.embeddedTerminalDrawerOpen) {
					const newPanelId = restoredPanelIdByPersistedPanelId.get(p.id) || p.id;
					this.panelStore.setEmbeddedTerminalDrawerOpen(newPanelId, true);
				}
			}
			this.panelStore.embeddedTerminals.restore(
				state.embeddedTerminalTabs,
				restoredPanelIdByPersistedPanelId,
				selectedTabByPanelId
			);
		}

		// Restore fullscreen aux panel selection (version 7+)
		if (state.fullscreenAuxPanel) {
			this.panelStore.fullscreenAuxPanel =
				state.fullscreenAuxPanel as typeof this.panelStore.fullscreenAuxPanel;
		}

		// Restore sidebar card collapse state
		if (state.collapsedProjectPaths !== undefined) {
			this.providers.setCollapsedProjectPaths?.(Array.from(state.collapsedProjectPaths));
		}
		if (state.queueExpanded !== undefined) {
			this.providers.setQueueExpanded?.(state.queueExpanded);
		}

		// Restore view mode (version 8+), with backward compat for focusedViewEnabled
		if (state.viewMode !== undefined) {
			this.panelStore.viewMode = state.viewMode;
		} else if (state.focusedViewEnabled) {
			this.panelStore.viewMode = "project";
		}
		if (state.focusedViewProjectPath !== undefined) {
			this.panelStore.focusedViewProjectPath = state.focusedViewProjectPath;
		}

		// Return session IDs that need loading
		const sessionIds = restoredPanels
			.map((p) => p.sessionId)
			.filter((id): id is string => id !== null);

		logger.debug("Workspace restored", { sessionIds });
		return sessionIds;
	}

	/**
	 * Load workspace state from persistent storage.
	 */
	load(): ResultAsync<PersistedWorkspaceState | null, AppError> {
		return api.loadWorkspaceState();
	}
}

/**
 * Create and set the workspace store in Svelte context.
 */
export function createWorkspaceStore(
	panelStore: PanelStore,
	sessionStore: SessionStore
): WorkspaceStore {
	const store = new WorkspaceStore(panelStore, sessionStore);
	setContext(WORKSPACE_STORE_KEY, store);
	return store;
}

/**
 * Get the workspace store from Svelte context.
 */
export function getWorkspaceStore(): WorkspaceStore {
	return getContext<WorkspaceStore>(WORKSPACE_STORE_KEY);
}
