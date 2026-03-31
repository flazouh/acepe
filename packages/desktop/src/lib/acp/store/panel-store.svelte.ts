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
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { browserWebview } from "../../utils/tauri-client/browser-webview.js";
import type { ModifiedFilesState } from "../components/modified-files/types/modified-files-state.js";
import { clearWorktreeEnabled } from "../components/worktree-toggle/worktree-storage.js";
import { areReviewFileSnapshotsEqual } from "../review/review-file-revision.js";
import { createLogger } from "../utils/logger.js";
import type { AgentStore } from "./agent-store.svelte.js";
import type { BrowserPanel } from "./browser-panel-type.js";
import { DEFAULT_BROWSER_PANEL_WIDTH, MIN_BROWSER_PANEL_WIDTH } from "./browser-panel-type.js";
import { EmbeddedTerminalStore } from "./embedded-terminal-store.svelte.js";

import {
	createFilePanelCacheKey,
	getFirstAttachedFilePanelId,
	normalizeOpenFilePanelOptions,
	type OpenFilePanelOptions,
} from "./file-panel-ownership.js";
import type { FilePanel } from "./file-panel-type.js";
import { DEFAULT_FILE_PANEL_WIDTH, MIN_FILE_PANEL_WIDTH } from "./file-panel-type.js";
import { openGitModalPanel } from "./git-modal-state.js";
import type { GitPanel, GitPanelInitialTarget } from "./git-panel-type.js";
import { DEFAULT_GIT_PANEL_WIDTH, MIN_GIT_PANEL_WIDTH } from "./git-panel-type.js";
import type { ReviewPanel } from "./review-panel-type.js";
import { DEFAULT_REVIEW_PANEL_WIDTH, MIN_REVIEW_PANEL_WIDTH } from "./review-panel-type.js";
import type { SessionStore } from "./session-store.svelte.js";
import { DEFAULT_TERMINAL_PANEL_WIDTH, MIN_TERMINAL_PANEL_WIDTH } from "./terminal-panel-type.js";
import type {
	AgentWorkspacePanel,
	BrowserWorkspacePanel,
	FileWorkspacePanel,
	Panel,
	PanelHotState,
	SessionEntry,
	TerminalPanelGroup,
	TerminalTab,
	TerminalWorkspacePanel,
	ViewMode,
	WorkspacePanel,
	WorkspacePanelKind,
} from "./types.js";
import { DEFAULT_PANEL_HOT_STATE, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./types.js";

const PANEL_STORE_KEY = Symbol("panel-store");
const logger = createLogger({ id: "panel-store", name: "PanelStore" });
const DEFAULT_ATTACHED_FILE_PANEL_WIDTH = DEFAULT_FILE_PANEL_WIDTH;

export class PanelStore {
	workspacePanels = $state<WorkspacePanel[]>([]);
	focusedPanelId = $state<string | null>(null);
	fullscreenPanelId = $state<string | null>(null);
	scrollX = $state<number>(0);

	// View mode: "single" (one session), "project" (one project), "multi" (all projects)
	viewMode = $state<ViewMode>("multi");
	focusedViewProjectPath = $state<string | null>(null);

	// Hot state (transient, frequently changing)
	private hotState = new SvelteMap<string, PanelHotState>();

	// Track in-flight opens
	private openingSessionIds = new SvelteSet<string>();
	private activeFilePanelIdByOwnerPanelId = new SvelteMap<string, string>();
	private nextTerminalTabCreatedAt = 1;

	private isTopLevelFullscreenTarget(panelId: string | null): boolean {
		if (panelId === null) return false;
		return this.findTopLevelWorkspacePanel(panelId) !== undefined;
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

		const firstTopLevelPanel = this.getTopLevelWorkspacePanels()[0];
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
	}

	private ensureOwnerPanelWidth(ownerPanelId: string, attachedWidth: number): void {
		const requiredWidth = Math.max(MIN_PANEL_WIDTH, attachedWidth);
		this.panels = this.panels.map((panel) =>
			panel.id === ownerPanelId ? { ...panel, width: Math.max(panel.width, requiredWidth) } : panel
		);
	}

	private resetOwnerPanelWidthIfNoAttached(ownerPanelId: string): void {
		const hasAttachedPanels = this.filePanels.some((panel) => panel.ownerPanelId === ownerPanelId);
		if (hasAttachedPanels) return;
		this.panels = this.panels.map((panel) =>
			panel.id === ownerPanelId ? { ...panel, width: DEFAULT_PANEL_WIDTH } : panel
		);
	}

	/**
	 * Pending review mode restores by panel ID (reviewFileIndex).
	 * Set during workspace restore when a panel had reviewMode; consumed when session loads.
	 */
	private pendingReviewRestores = new Map<string, number>();

	/** Optional callback invoked when a panel is focused. */
	onPanelFocused: ((panelId: string) => void) | null = null;

	/** Embedded terminal state per agent panel (bottom drawer tabs). */
	readonly embeddedTerminals: EmbeddedTerminalStore;

	// Dependencies injected via constructor
	constructor(
		private sessionStore: SessionStore,
		private agentStore: AgentStore,
		private onPersist: () => void
	) {
		this.embeddedTerminals = new EmbeddedTerminalStore(onPersist);
	}

	get panels(): Panel[] {
		return this.workspacePanels.filter(
			(panel): panel is Panel => panel.kind === "agent" && panel.ownerPanelId === null
		);
	}

	set panels(nextPanels: Panel[]) {
		this.replaceWorkspacePanels("agent", nextPanels);
	}

	get filePanels(): FilePanel[] {
		return this.workspacePanels.filter((panel): panel is FileWorkspacePanel => panel.kind === "file");
	}

	set filePanels(nextPanels: FilePanel[]) {
		this.replaceWorkspacePanels("file", nextPanels);
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
		return this.workspacePanels.filter(
			(panel): panel is BrowserWorkspacePanel => panel.kind === "browser"
		);
	}

	set browserPanels(nextPanels: BrowserPanel[]) {
		this.replaceWorkspacePanels("browser", nextPanels);
	}

	get reviewPanels(): ReviewPanel[] {
		return this.workspacePanels.filter((panel): panel is ReviewPanel => panel.kind === "review");
	}

	set reviewPanels(nextPanels: ReviewPanel[]) {
		this.replaceWorkspacePanels("review", nextPanels);
	}

	get gitPanels(): GitPanel[] {
		return this.workspacePanels.filter((panel): panel is GitPanel => panel.kind === "git");
	}

	set gitPanels(nextPanels: GitPanel[]) {
		this.replaceWorkspacePanels("git", nextPanels);
	}

	private replaceWorkspacePanels(kind: WorkspacePanelKind, nextPanels: readonly WorkspacePanel[]): void {
		const remainingPanels = this.workspacePanels.filter((panel) => panel.kind !== kind);
		this.workspacePanels = Array.from(nextPanels).concat(remainingPanels);
	}

	private isTopLevelWorkspacePanel(panel: WorkspacePanel): boolean {
		if (panel.kind === "agent") {
			return true;
		}
		return panel.ownerPanelId === null;
	}

	private findTopLevelWorkspacePanel(panelId: string): WorkspacePanel | undefined {
		return this.workspacePanels.find(
			(panel) => panel.id === panelId && this.isTopLevelWorkspacePanel(panel)
		);
	}

	private getTopLevelWorkspacePanels(): WorkspacePanel[] {
		return this.workspacePanels.filter((panel) => this.isTopLevelWorkspacePanel(panel));
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
	readonly panelBySessionId = $derived.by(
		() =>
			new SvelteMap(this.panels.filter((p) => p.sessionId !== null).map((p) => [p.sessionId!, p]))
	);

	readonly panelCount = $derived(this.panels.length);

	readonly focusedTopLevelPanel = $derived(
		this.focusedPanelId ? (this.findTopLevelWorkspacePanel(this.focusedPanelId) ?? null) : null
	);

	readonly focusedPanel = $derived(
		this.focusedPanelId ? (this.panels.find((p) => p.id === this.focusedPanelId) ?? null) : null
	);

	readonly filePanelByPath = $derived.by(
		() =>
			new SvelteMap(
				this.filePanels.map((p) => [
					createFilePanelCacheKey(p.filePath, p.projectPath, p.ownerPanelId),
					p,
				])
			)
	);

	readonly filePanelCount = $derived(this.filePanels.length);

	readonly reviewPanelById = $derived.by(
		() => new SvelteMap(this.reviewPanels.map((p) => [p.id, p]))
	);

	readonly reviewPanelCount = $derived(this.reviewPanels.length);

	terminalPanelGroups = $state<TerminalPanelGroup[]>([]);
	terminalTabs = $state<TerminalTab[]>([]);

	readonly terminalPanelCount = $derived(this.terminalPanelGroups.length);

	readonly gitPanelByProjectPath = $derived.by(
		() => new SvelteMap(this.gitPanels.map((p) => [p.projectPath, p]))
	);

	readonly gitPanelCount = $derived(this.gitPanels.length);

	readonly browserPanelCount = $derived(this.browserPanels.length);

	// ============================================
	// HOT STATE MANAGEMENT
	// ============================================

	/**
	 * Get hot state for a panel.
	 */
	getHotState(panelId: string): PanelHotState {
		return this.hotState.get(panelId) ?? DEFAULT_PANEL_HOT_STATE;
	}

	getTopLevelPanel(panelId: string): WorkspacePanel | undefined {
		return this.findTopLevelWorkspacePanel(panelId);
	}

	/**
	 * Update hot state for a panel (O(1) - no array recreation).
	 */
	private updateHotState(panelId: string, updates: Partial<PanelHotState>): void {
		const current = this.hotState.get(panelId) ?? DEFAULT_PANEL_HOT_STATE;
		const updated = { ...current, ...updates };
		this.hotState.set(panelId, updated);
	}

	/**
	 * Get panel with merged hot state.
	 */
	getPanel(panelId: string): (Panel & PanelHotState) | undefined {
		const panel = this.panels.find((p) => p.id === panelId);
		if (!panel) return undefined;
		const hot = this.getHotState(panelId);
		return { ...panel, ...hot };
	}

	/**
	 * Open a session in a panel.
	 * If already open, focuses the existing panel.
	 */
	openSession(sessionId: string, width: number): Panel | null {
		const t0 = performance.now();
		// Check if already open
		const existing = this.panelBySessionId.get(sessionId);
		if (existing) {
			this.focusedPanelId = existing.id;
			if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
				this.switchFullscreen(existing.id);
			}
			return existing;
		}

		// Guard against duplicate opens
		if (this.openingSessionIds.has(sessionId)) {
			logger.debug("Panel already being opened, skipping duplicate", { sessionId });
			return null;
		}
		this.openingSessionIds.add(sessionId);

		// Get agent ID from session if available, otherwise use default
		const session = this.sessionStore.getSessionCold(sessionId);
		const selectedAgentId = session?.agentId ?? this.agentStore.getDefaultAgentId();

		const panel: Panel = {
			id: crypto.randomUUID(),
			kind: "agent",
			ownerPanelId: null,
			sessionId,
			width,
			pendingProjectSelection: false,
			selectedAgentId,
			projectPath: session?.projectPath ?? null,
			agentId: session?.agentId ?? null,
			sourcePath: session?.sourcePath ?? null,
			worktreePath: session?.worktreePath ?? null,
			sessionTitle: session?.title ?? null,
		};

		this.panels = [panel, ...this.panels];
		this.focusedPanelId = panel.id;

		// If in fullscreen mode, switch fullscreen to the new panel
		if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
			this.switchFullscreen(panel.id);
		}

		this.onPersist();

		queueMicrotask(() => {
			this.openingSessionIds.delete(sessionId);
		});

		logger.info("[PERF] openSession: panel added to store", {
			sessionId,
			panelId: panel.id,
			elapsed_ms: Math.round(performance.now() - t0),
		});
		return panel;
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
		} = {}
	): Panel {
		const panel: Panel = {
			id: options.id ?? crypto.randomUUID(),
			kind: "agent",
			ownerPanelId: null,
			sessionId: null,
			width: DEFAULT_PANEL_WIDTH,
			pendingProjectSelection: options.requireProjectSelection ?? false,
			selectedAgentId: options.selectedAgentId ?? null,
			projectPath: options.projectPath ?? null,
			agentId: null,
			sourcePath: null,
			worktreePath: null,
			sessionTitle: null,
		};

		this.panels = [panel, ...this.panels];
		this.focusedPanelId = panel.id;

		// If in fullscreen mode, switch fullscreen to the new panel
		if (this.viewMode === "single" || this.fullscreenPanelId !== null) {
			this.switchFullscreen(panel.id);
		}

		// In focused view, switch to the panel's project so it's visible
		if (this.viewMode !== "multi" && panel.projectPath) {
			this.focusedViewProjectPath = panel.projectPath;
			this.scrollX = 0;
		}
		this.onPersist();

		logger.debug("Spawned new panel", { panelId: panel.id });
		return panel;
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
		const panel = this.findTopLevelWorkspacePanel(panelId);
		if (!panel) return;
		const closeState = this.captureTopLevelPanelCloseState(panelId);

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
			this.closeGitPanel(panelId);
			return;
		}

		if (panel.kind === "browser") {
			this.closeBrowserPanel(panelId);
			return;
		}

		if (!this.panels.some((candidate) => candidate.id === panelId)) return;

		this.panels = this.panels.filter((p) => p.id !== panelId);

		// Clean up hot state to prevent memory leaks
		this.hotState.delete(panelId);

		this.activeFilePanelIdByOwnerPanelId.delete(panelId);
		this.filePanels = this.filePanels.filter((filePanel) => filePanel.ownerPanelId !== panelId);

		// Clean up embedded terminal state (belt-and-suspenders with component onDestroy)
		this.embeddedTerminals.cleanup(panelId);

		// Clean up worktree localStorage for this panel
		clearWorktreeEnabled(panelId);

		this.applyTopLevelPanelCloseState(closeState);

		this.onPersist();
		logger.debug("Closed panel", { panelId });
	}

	/**
	 * Close a panel by session ID.
	 */
	closePanelBySessionId(sessionId: string): void {
		const panel = this.panelBySessionId.get(sessionId);
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
		const index = this.panels.findIndex((p) => p.id === panelId);
		if (index <= 0) return;
		const panel = this.panels[index];
		this.panels = [panel, ...this.panels.slice(0, index), ...this.panels.slice(index + 1)];
		this.onPersist();
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
		logger.info("[worktree-flow] updatePanelSession", { panelId, sessionId });
		const session = sessionId ? this.sessionStore.getSessionCold(sessionId) : null;
		logger.info("[worktree-debug] updatePanelSession resolved session", {
			panelId,
			sessionId,
			sessionProjectPath: session?.projectPath ?? null,
			sessionWorktreePath: session?.worktreePath ?? null,
			panelProjectPathBefore:
				this.panels.find((p) => p.id === panelId)?.projectPath ?? null,
		});
		this.panels = this.panels.map((p) =>
			p.id === panelId
				? {
					...p,
					sessionId,
					pendingProjectSelection: false,
					projectPath: session?.projectPath ?? p.projectPath,
					agentId: session?.agentId ?? p.agentId,
					sourcePath: session?.sourcePath ?? p.sourcePath,
					worktreePath: session?.worktreePath ?? p.worktreePath,
					sessionTitle: session?.title ?? p.sessionTitle,
				}
				: p
		);
		logger.info("[worktree-debug] updatePanelSession applied", {
			panelId,
			sessionId,
			panelProjectPathAfter:
				this.panels.find((p) => p.id === panelId)?.projectPath ?? null,
		});
		this.onPersist();
	}

	/**
	 * Resize a panel.
	 */
	resizePanel(panelId: string, delta: number): void {
		this.panels = this.panels.map((p) =>
			p.id === panelId ? { ...p, width: Math.max(p.width + delta, MIN_PANEL_WIDTH) } : p
		);
		this.onPersist();
	}

	/**
	 * Set the selected agent for a panel.
	 */
	setPanelAgent(panelId: string, agentId: string | null): void {
		this.panels = this.panels.map((p) =>
			p.id === panelId ? { ...p, selectedAgentId: agentId } : p
		);
		this.onPersist();
		logger.debug("Panel agent set", { panelId, agentId });
	}

	/**
	 * Set the project path for a panel and clear pending project selection.
	 */
	setPanelProjectPath(panelId: string, projectPath: string): void {
		this.panels = this.panels.map((p) =>
			p.id === panelId ? { ...p, projectPath, pendingProjectSelection: false } : p
		);
		this.onPersist();
		logger.debug("Panel project path set", { panelId, projectPath });
	}

	/**
	 * Clear all panels.
	 */
	clearPanels(): void {
		this.panels = [];
		this.filePanels = this.filePanels.filter((panel) => panel.ownerPanelId === null);
		this.activeFilePanelIdByOwnerPanelId = new SvelteMap();
		for (const bp of this.browserPanels) {
			browserWebview.close(`browser-${bp.id}`);
		}
		this.browserPanels = [];
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
		return this.panelBySessionId.get(sessionId);
	}

	/**
	 * Check if a session is open in a panel.
	 */
	isSessionOpen(sessionId: string): boolean {
		return this.panelBySessionId.has(sessionId);
	}

	// ============================================
	// SESSION CREATION STATE
	// ============================================

	// ============================================
	// REVIEW MODE MANAGEMENT
	// ============================================

	/**
	 * Enter review mode for a panel.
	 * Shows the diff review UI instead of the conversation.
	 *
	 * If the panel already has review state with the same files,
	 * reuse it so that hunk accept/reject decisions are preserved.
	 */
	enterReviewMode(
		panelId: string,
		modifiedFilesState: ModifiedFilesState,
		initialFileIndex: number = 0
	): void {
		const existing = this.getHotState(panelId).reviewFilesState;
		const canReuse = existing !== null && this.reviewFilesMatch(existing, modifiedFilesState);

		if (canReuse) {
			// Same files — just toggle review mode on and update file index
			this.updateHotState(panelId, {
				reviewMode: true,
				reviewFileIndex: initialFileIndex,
			});
		} else {
			// New or changed files — replace with fresh state
			this.updateHotState(panelId, {
				reviewMode: true,
				reviewFilesState: modifiedFilesState,
				reviewFileIndex: initialFileIndex,
			});
		}

		this.onPersist();
		logger.debug("Entered review mode", {
			panelId,
			fileCount: modifiedFilesState.fileCount,
			reusedState: canReuse,
		});
	}

	/**
	 * Checks whether two ModifiedFilesState objects have the same files
	 * (same paths and same file snapshots in the same order), meaning existing review decisions
	 * can safely be preserved.
	 */
	private reviewFilesMatch(a: ModifiedFilesState, b: ModifiedFilesState): boolean {
		if (a.fileCount !== b.fileCount) return false;
		for (let i = 0; i < a.files.length; i++) {
			if (!areReviewFileSnapshotsEqual(a.files[i], b.files[i])) return false;
		}
		return true;
	}

	/**
	 * Exit review mode for a panel.
	 * Returns to the normal conversation view.
	 * Preserves reviewFilesState and reviewFileIndex so hunk
	 * accept/reject decisions survive panel toggles.
	 */
	exitReviewMode(panelId: string): void {
		this.updateHotState(panelId, {
			reviewMode: false,
		});
		this.onPersist();
		logger.debug("Exited review mode", { panelId });
	}

	/**
	 * Clear review state for a panel.
	 * Called when the session changes or the panel is closed
	 * to discard stale review data.
	 */
	clearReviewState(panelId: string): void {
		this.updateHotState(panelId, {
			reviewMode: false,
			reviewFilesState: null,
			reviewFileIndex: 0,
		});
		this.onPersist();
		logger.debug("Cleared review state", { panelId });
	}

	/**
	 * Update the selected file index in review mode.
	 */
	setReviewFileIndex(panelId: string, fileIndex: number): void {
		this.updateHotState(panelId, { reviewFileIndex: fileIndex });
		this.onPersist();
	}

	/**
	 * Check if a panel is in review mode.
	 */
	isPanelInReviewMode(panelId: string): boolean {
		return this.getHotState(panelId).reviewMode;
	}

	/**
	 * Set pending review restore for a panel (used during workspace restore).
	 * Will be applied when the session loads and has entries.
	 */
	setPendingReviewRestore(panelId: string, reviewFileIndex: number): void {
		this.pendingReviewRestores.set(panelId, reviewFileIndex);
	}

	/**
	 * Consume pending review restore for a panel.
	 * Returns the reviewFileIndex if there was a pending restore, null otherwise.
	 */
	consumePendingReviewRestore(panelId: string): number | null {
		const fileIndex = this.pendingReviewRestores.get(panelId);
		if (fileIndex === undefined) return null;
		this.pendingReviewRestores.delete(panelId);
		return fileIndex;
	}

	// ============================================
	// PLAN SIDEBAR MANAGEMENT
	// ============================================

	/**
	 * Set the plan sidebar expanded state for a panel.
	 */
	setPlanSidebarExpanded(panelId: string, expanded: boolean): void {
		this.updateHotState(panelId, { planSidebarExpanded: expanded });
		this.onPersist();
		logger.debug("Plan sidebar state updated", { panelId, expanded });
	}

	/**
	 * Toggle the plan sidebar expanded state for a panel.
	 */
	togglePlanSidebar(panelId: string): void {
		const current = this.getHotState(panelId).planSidebarExpanded;
		this.setPlanSidebarExpanded(panelId, !current);
	}

	/**
	 * Check if the plan sidebar is expanded for a panel.
	 */
	isPlanSidebarExpanded(panelId: string): boolean {
		return this.getHotState(panelId).planSidebarExpanded;
	}

	// ============================================
	// BROWSER SIDEBAR MANAGEMENT
	// ============================================

	/**
	 * Set the browser sidebar expanded state for a panel.
	 */
	setBrowserSidebarExpanded(panelId: string, expanded: boolean, url?: string): void {
		this.updateHotState(panelId, {
			browserSidebarExpanded: expanded,
			...(url != null ? { browserSidebarUrl: url } : {}),
		});
		this.onPersist();
		logger.debug("Browser sidebar state updated", { panelId, expanded, url });
	}

	/**
	 * Toggle the browser sidebar expanded state for a panel.
	 */
	toggleBrowserSidebar(panelId: string): void {
		const current = this.getHotState(panelId).browserSidebarExpanded;
		this.setBrowserSidebarExpanded(panelId, !current);
	}

	/**
	 * Check if the browser sidebar is expanded for a panel.
	 */
	isBrowserSidebarExpanded(panelId: string): boolean {
		return this.getHotState(panelId).browserSidebarExpanded;
	}

	// ============================================
	// MESSAGE DRAFT MANAGEMENT
	// ============================================

	/**
	 * Set the message draft for a panel.
	 */
	setMessageDraft(panelId: string, draft: string): void {
		this.updateHotState(panelId, { messageDraft: draft });
		this.onPersist();
	}

	/**
	 * Get the message draft for a panel.
	 */
	getMessageDraft(panelId: string): string {
		return this.getHotState(panelId).messageDraft;
	}

	setPendingComposerRestore(
		panelId: string,
		restore: NonNullable<PanelHotState["pendingComposerRestore"]>
	): void {
		const current = this.getHotState(panelId);
		this.updateHotState(panelId, {
			pendingComposerRestore: restore,
			composerRestoreVersion: current.composerRestoreVersion + 1,
		});
	}

	consumePendingComposerRestore(panelId: string): PanelHotState["pendingComposerRestore"] {
		const restore = this.getHotState(panelId).pendingComposerRestore;
		if (restore === null) {
			return null;
		}
		this.updateHotState(panelId, { pendingComposerRestore: null });
		return restore;
	}

	// ============================================
	// EMBEDDED TERMINAL DRAWER MANAGEMENT
	// ============================================

	/**
	 * Check if the embedded terminal drawer is open for a panel.
	 */
	isEmbeddedTerminalDrawerOpen(panelId: string): boolean {
		return this.getHotState(panelId).embeddedTerminalDrawerOpen;
	}

	/**
	 * Set the embedded terminal drawer open state for a panel.
	 */
	setEmbeddedTerminalDrawerOpen(panelId: string, open: boolean): void {
		this.updateHotState(panelId, { embeddedTerminalDrawerOpen: open });
		this.onPersist();
	}

	/**
	 * Toggle the embedded terminal drawer for a panel.
	 * If opening and no tabs exist, creates the first tab.
	 */
	toggleEmbeddedTerminalDrawer(panelId: string, cwd: string): void {
		const isOpen = this.isEmbeddedTerminalDrawerOpen(panelId);
		if (!isOpen) {
			// Opening: ensure at least one tab
			const tabs = this.embeddedTerminals.getTabs(panelId);
			if (tabs.length === 0) {
				this.embeddedTerminals.addTab(panelId, cwd);
			}
		}
		this.setEmbeddedTerminalDrawerOpen(panelId, !isOpen);
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
		this.updateHotState(panelId, { pendingUserEntry: entry });
	}

	/**
	 * Clear the pending user entry (on session creation success or failure).
	 * Intentionally no onPersist() — transient optimistic state only.
	 */
	clearPendingUserEntry(panelId: string): void {
		this.updateHotState(panelId, { pendingUserEntry: null });
	}

	setPendingWorktreeSetup(
		panelId: string,
		setup: PanelHotState["pendingWorktreeSetup"]
	): void {
		this.updateHotState(panelId, { pendingWorktreeSetup: setup });
	}

	clearPendingWorktreeSetup(panelId: string): void {
		this.updateHotState(panelId, { pendingWorktreeSetup: null });
	}

	// ============================================
	// FILE PANEL MANAGEMENT
	// ============================================

	/**
	 * Open a file in a panel.
	 * If already open, focuses the existing panel.
	 */
	openFilePanel(
		filePath: string,
		projectPath: string,
		options?: OpenFilePanelOptions | number
	): FilePanel {
		const normalizedOptions = normalizeOpenFilePanelOptions(options);
		const ownerPanelId = normalizedOptions?.ownerPanelId ?? null;
		const cacheKey = createFilePanelCacheKey(filePath, projectPath, ownerPanelId);

		// Check if already open
		const existing = this.filePanelByPath.get(cacheKey);
		if (existing) {
			if (ownerPanelId !== null) {
				this.ensureOwnerPanelWidth(ownerPanelId, existing.width);
				this.activeFilePanelIdByOwnerPanelId.set(ownerPanelId, existing.id);
			} else {
				this.focusOpenedTopLevelPanel(existing.id);
			}
			logger.debug("File already open, focusing existing panel", { filePath, projectPath });
			return existing;
		}

		const panel: FilePanel = {
			id: crypto.randomUUID(),
			kind: "file",
			filePath,
			projectPath,
			ownerPanelId,
			width:
				normalizedOptions?.width ??
				(ownerPanelId !== null ? DEFAULT_ATTACHED_FILE_PANEL_WIDTH : DEFAULT_FILE_PANEL_WIDTH),
		};

		this.filePanels = [panel, ...this.filePanels];
		if (ownerPanelId !== null) {
			this.ensureOwnerPanelWidth(ownerPanelId, panel.width);
			this.activeFilePanelIdByOwnerPanelId.set(ownerPanelId, panel.id);
		} else {
			this.focusOpenedTopLevelPanel(panel.id);
		}
		this.onPersist();

		logger.debug("Opened file in panel", { filePath, projectPath, panelId: panel.id });
		return panel;
	}

	/**
	 * Close a file panel by ID.
	 */
	closeFilePanel(panelId: string): void {
		const panelToClose = this.filePanels.find((p) => p.id === panelId);
		const closeState =
			panelToClose && panelToClose.ownerPanelId === null
				? this.captureTopLevelPanelCloseState(panelId)
				: null;
		this.filePanels = this.filePanels.filter((p) => p.id !== panelId);
		if (panelToClose?.ownerPanelId) {
			const ownerPanelId = panelToClose.ownerPanelId;
			const activePanelId = this.activeFilePanelIdByOwnerPanelId.get(panelToClose.ownerPanelId);
			if (activePanelId === panelId) {
				const replacementId = getFirstAttachedFilePanelId(
					this.filePanels,
					panelToClose.ownerPanelId
				);
				if (replacementId) {
					this.activeFilePanelIdByOwnerPanelId.set(panelToClose.ownerPanelId, replacementId);
				} else {
					this.activeFilePanelIdByOwnerPanelId.delete(panelToClose.ownerPanelId);
				}
			}
			this.resetOwnerPanelWidthIfNoAttached(ownerPanelId);
		}
		if (closeState) {
			this.applyTopLevelPanelCloseState(closeState);
		}
		this.onPersist();
		logger.debug("Closed file panel", { panelId });
	}

	/**
	 * Check if a file is open in a panel.
	 */
	isFileOpen(filePath: string, projectPath: string): boolean {
		const cacheKey = createFilePanelCacheKey(filePath, projectPath, null);
		return this.filePanelByPath.has(cacheKey);
	}

	/**
	 * Resize a file panel.
	 */
	resizeFilePanel(panelId: string, delta: number): void {
		let resizedAttachedOwnerPanelId: string | null = null;
		let resizedWidth = 0;
		this.filePanels = this.filePanels.map((p) => {
			if (p.id !== panelId) return p;
			const nextWidth = Math.max(p.width + delta, MIN_FILE_PANEL_WIDTH);
			if (p.ownerPanelId !== null) {
				resizedAttachedOwnerPanelId = p.ownerPanelId;
				resizedWidth = nextWidth;
			}
			return { ...p, width: nextWidth };
		});
		if (resizedAttachedOwnerPanelId !== null) {
			this.ensureOwnerPanelWidth(resizedAttachedOwnerPanelId, resizedWidth);
		}
		this.onPersist();
	}

	/**
	 * Get a file panel by ID.
	 */
	getFilePanel(panelId: string): FilePanel | undefined {
		return this.filePanels.find((p) => p.id === panelId);
	}

	/**
	 * Get a file panel by file path.
	 */
	getFilePanelByPath(filePath: string, projectPath: string): FilePanel | undefined {
		const cacheKey = createFilePanelCacheKey(filePath, projectPath, null);
		return this.filePanelByPath.get(cacheKey);
	}

	getAttachedFilePanels(ownerPanelId: string): FilePanel[] {
		return this.filePanels.filter((panel) => panel.ownerPanelId === ownerPanelId);
	}

	getActiveFilePanelId(ownerPanelId: string): string | null {
		return this.activeFilePanelIdByOwnerPanelId.get(ownerPanelId) ?? null;
	}

	getActiveAttachedFilePanel(ownerPanelId: string): FilePanel | null {
		const activeFilePanelId = this.activeFilePanelIdByOwnerPanelId.get(ownerPanelId);
		if (activeFilePanelId) {
			const panel = this.filePanels.find(
				(candidate) => candidate.id === activeFilePanelId && candidate.ownerPanelId === ownerPanelId
			);
			if (panel) return panel;
		}
		return this.filePanels.find((panel) => panel.ownerPanelId === ownerPanelId) ?? null;
	}

	setActiveAttachedFilePanel(ownerPanelId: string, filePanelId: string): void {
		const target = this.filePanels.find(
			(panel) => panel.id === filePanelId && panel.ownerPanelId === ownerPanelId
		);
		if (!target) return;
		this.activeFilePanelIdByOwnerPanelId.set(ownerPanelId, filePanelId);
		this.onPersist();
	}

	getActiveFilePanelIdByOwnerPanelIdRecord(): Record<string, string> {
		return Object.fromEntries(this.activeFilePanelIdByOwnerPanelId.entries());
	}

	setActiveFilePanelMap(activeMap: Map<string, string>): void {
		this.activeFilePanelIdByOwnerPanelId = new SvelteMap(activeMap);
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
		// Check if a review panel for this project already exists
		const existing = this.reviewPanels.find((p) => p.projectPath === projectPath);
		if (existing) {
			this.focusOpenedTopLevelPanel(existing.id);
			logger.debug("Review panel already open, returning existing", { projectPath });
			return existing;
		}

		const panel: ReviewPanel = {
			id: crypto.randomUUID(),
			kind: "review",
			projectPath,
			width: width ?? DEFAULT_REVIEW_PANEL_WIDTH,
			ownerPanelId: null,
			modifiedFilesState,
			selectedFileIndex: initialFileIndex ?? 0,
		};

		this.reviewPanels = [panel, ...this.reviewPanels];
		this.focusOpenedTopLevelPanel(panel.id);
		this.onPersist();

		logger.debug("Opened review panel", { projectPath, panelId: panel.id });
		return panel;
	}

	/**
	 * Close a review panel by ID.
	 */
	closeReviewPanel(panelId: string): void {
		const closeState = this.captureTopLevelPanelCloseState(panelId);
		this.reviewPanels = this.reviewPanels.filter((p) => p.id !== panelId);
		this.applyTopLevelPanelCloseState(closeState);
		this.onPersist();
		logger.debug("Closed review panel", { panelId });
	}

	/**
	 * Update the selected file index in a review panel.
	 */
	updateReviewPanelFileIndex(panelId: string, fileIndex: number): void {
		this.reviewPanels = this.reviewPanels.map((p) =>
			p.id === panelId ? { ...p, selectedFileIndex: fileIndex } : p
		);
		// Don't persist for simple index changes
	}

	/**
	 * Update the modified files state in a review panel.
	 * Used after accept/reject actions that modify the state.
	 */
	updateReviewPanelState(panelId: string, modifiedFilesState: ModifiedFilesState): void {
		this.reviewPanels = this.reviewPanels.map((p) =>
			p.id === panelId ? { ...p, modifiedFilesState } : p
		);
	}

	/**
	 * Resize a review panel.
	 */
	resizeReviewPanel(panelId: string, delta: number): void {
		this.reviewPanels = this.reviewPanels.map((p) =>
			p.id === panelId ? { ...p, width: Math.max(p.width + delta, MIN_REVIEW_PANEL_WIDTH) } : p
		);
		this.onPersist();
	}

	/**
	 * Get a review panel by ID.
	 */
	getReviewPanel(panelId: string): ReviewPanel | undefined {
		return this.reviewPanelById.get(panelId);
	}

	/**
	 * Get a review panel by project path.
	 */
	getReviewPanelByProjectPath(projectPath: string): ReviewPanel | undefined {
		return this.reviewPanels.find((p) => p.projectPath === projectPath);
	}

	// ============================================
	// TERMINAL PANEL MANAGEMENT
	// ============================================

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

		for (const panel of this.workspacePanels) {
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

		this.workspacePanels = nextWorkspacePanels;
	}

	private getAllTerminalPanelGroups(): TerminalPanelGroup[] {
		const groups = Array.from(this.terminalPanelGroups);
		groups.sort((left, right) => left.order - right.order);
		return groups;
	}

	private getTerminalTabsFromCollection(tabs: readonly TerminalTab[], groupId: string): TerminalTab[] {
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
		this.syncTerminalWorkspacePanels();
	}

	private updateTerminalGroup(groupId: string, updater: (group: TerminalPanelGroup) => TerminalPanelGroup): void {
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

	/**
	 * Get all terminal panels for a project (supports multiple terminals per project).
	 */
	getTerminalPanelsForProject(projectPath: string): TerminalPanelGroup[] {
		return this.getTerminalPanelGroupsForProject(projectPath);
	}

	/**
	 * Set the selected terminal panel for a project (tab switching).
	 * When in fullscreen with a terminal for this project, updates fullscreen aux to the selected panel.
	 */
	setSelectedTerminalPanel(projectPath: string, panelId: string): void {
		const group = this.getTerminalPanelGroup(panelId);
		if (!group) {
			console.warn("Attempted to select stale terminal group", { projectPath, panelId });
			return;
		}
		this.focusedPanelId = group.id;
		const selectedSingleModePanelId = this.getSelectedSingleModePanelId();
		if (selectedSingleModePanelId !== null) {
			const fullscreenGroup = this.getTerminalPanelGroup(selectedSingleModePanelId);
			if (fullscreenGroup && fullscreenGroup.projectPath === projectPath) {
				this.switchFullscreen(group.id);
			}
		} else if (this.fullscreenPanelId !== null) {
			const fullscreenGroup = this.getTerminalPanelGroup(this.fullscreenPanelId);
			if (fullscreenGroup && fullscreenGroup.projectPath === projectPath) {
				this.switchFullscreen(group.id);
			}
		}
		this.onPersist();
	}

	getTerminalPanelGroup(groupId: string): TerminalPanelGroup | undefined {
		return this.terminalPanelGroups.find((group) => group.id === groupId);
	}

	getTerminalPanelGroupsForProject(projectPath: string): TerminalPanelGroup[] {
		return this.getAllTerminalPanelGroups().filter((group) => group.projectPath === projectPath);
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
		const tab = this.getTerminalTabsForGroup(groupId).find((candidate) => candidate.id === selectedTabId);
		return tab ? tab : null;
	}

	canMoveTerminalTabToNewPanel(tabId: string): boolean {
		const tab = this.terminalTabs.find((candidate) => candidate.id === tabId);
		if (!tab) {
			return false;
		}
		return this.getTerminalTabsForGroup(tab.groupId).length > 1;
	}

	/**
	 * Open a new terminal panel for a project (always creates; use for "New terminal").
	 */
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
		this.focusOpenedTopLevelPanel(group.id);
		this.onPersist();

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
		this.focusedPanelId = groupId;
		this.onPersist();
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
		this.focusedPanelId = groupId;
		this.onPersist();
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
			console.warn("Attempted to move terminal tab missing from group", { tabId, groupId: sourceGroup.id });
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
		const previousFullscreenPanelId = this.fullscreenPanelId;
		const wasVisibleSingleModePanel = this.getSelectedSingleModePanelId() === sourceGroup.id;
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
		this.focusedPanelId = newGroup.id;
		if (wasVisibleSingleModePanel || previousFullscreenPanelId === sourceGroup.id) {
			this.switchFullscreen(newGroup.id);
		}
		this.onPersist();

		return this.getTerminalPanelGroup(newGroup.id) ?? newGroup;
	}

	/**
	 * Close a terminal panel by ID.
	 */
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

	/**
	 * Update the PTY ID and shell for a terminal panel.
	 * Called after the PTY is spawned.
	 */
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
			console.warn("Attempted to close terminal tab in stale group", { tabId, groupId: tab.groupId });
			return;
		}

		const sourceTabs = this.getTerminalTabsForGroup(group.id);
		const removedIndex = sourceTabs.findIndex((candidate) => candidate.id === tabId);
		const closeState = this.captureTopLevelPanelCloseState(group.id);
		this.terminalTabs = this.terminalTabs.filter((candidate) => candidate.id !== tabId);

		const remainingTabs = this.getTerminalTabsForGroup(group.id);
		if (remainingTabs.length === 0) {
			const groups = this.getAllTerminalPanelGroups().filter((candidate) => candidate.id !== group.id);
			this.setTerminalPanelGroupsInDisplayOrder(groups);
			this.applyTopLevelPanelCloseState(closeState);
			this.onPersist();
			return;
		}

		const selectedTabId = group.selectedTabId === tabId ? this.getFallbackSelectedTerminalTabId(group.id, removedIndex) : this.getSelectedTerminalTabId(group.id);
		this.updateTerminalGroup(group.id, (current) => ({
			id: current.id,
			projectPath: current.projectPath,
			width: current.width,
			selectedTabId,
			order: current.order,
		}));
		this.onPersist();
	}

	/**
	 * Resize a terminal panel.
	 */
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
		this.onPersist();
	}

	/**
	 * Get a terminal panel by ID.
	 */
	getTerminalPanel(panelId: string): TerminalPanelGroup | undefined {
		return this.getTerminalPanelGroup(panelId);
	}

	/**
	 * Toggle terminal for a project: if none open, open one; if any open, focus first (show in fullscreen aux).
	 */
	toggleTerminalPanel(projectPath: string, width?: number): void {
		const forProject = this.getTerminalPanelsForProject(projectPath);
		if (forProject.length > 0) {
			const first = forProject[0];
			this.focusOpenedTopLevelPanel(first.id);
			this.onPersist();
		} else {
			this.openTerminalPanel(projectPath, width);
		}
	}

	/**
	 * Check if any terminal is open for a project.
	 */
	isTerminalOpenForProject(projectPath: string): boolean {
		return this.getTerminalPanelsForProject(projectPath).length > 0;
	}

	// ============================================
	// GIT PANEL MANAGEMENT
	// ============================================

	/**
	 * Open a git panel for a project.
	 * If already open, returns the existing panel.
	 */
	openGitPanel(
		projectPath: string,
		width?: number,
		initialTarget?: GitPanelInitialTarget
	): GitPanel {
		const result = openGitModalPanel(
			this.gitPanels,
			projectPath,
			width ?? DEFAULT_GIT_PANEL_WIDTH,
			() => crypto.randomUUID()
		);

		const activePanelId = result.activePanel.id;
		const activePanel = initialTarget
			? { ...result.activePanel, initialTarget }
			: result.activePanel;

		this.gitPanels = result.panels.map((panel) =>
			panel.id === activePanelId ? activePanel : panel
		);
		this.focusOpenedTopLevelPanel(activePanel.id);
		this.onPersist();

		logger.debug("Opened git panel", { projectPath, panelId: activePanel.id });
		return activePanel;
	}

	/**
	 * Close a git panel by ID.
	 */
	closeGitPanel(panelId: string): void {
		const closeState = this.captureTopLevelPanelCloseState(panelId);
		this.gitPanels = this.gitPanels.filter((p) => p.id !== panelId);
		this.applyTopLevelPanelCloseState(closeState);
		this.onPersist();
		logger.debug("Closed git panel", { panelId });
	}

	/**
	 * Resize a git panel.
	 */
	resizeGitPanel(panelId: string, delta: number): void {
		this.gitPanels = this.gitPanels.map((p) =>
			p.id === panelId ? { ...p, width: Math.max(p.width + delta, MIN_GIT_PANEL_WIDTH) } : p
		);
		this.onPersist();
	}

	/**
	 * Get a git panel by ID.
	 */
	getGitPanel(panelId: string): GitPanel | undefined {
		return this.gitPanels.find((p) => p.id === panelId);
	}

	/**
	 * Check if a git panel is open for a project.
	 */
	isGitPanelOpenForProject(projectPath: string): boolean {
		return this.gitPanelByProjectPath.has(projectPath);
	}

	// ============================================
	// BROWSER PANEL MANAGEMENT
	// ============================================

	/**
	 * Open a browser panel for a URL, scoped to a project.
	 * If already open for the same project+URL, focuses the existing panel.
	 */
	openBrowserPanel(projectPath: string, url: string, title?: string): BrowserPanel {
		if (!projectPath) {
			logger.warn("openBrowserPanel called without projectPath", { url });
		}
		const existing = this.browserPanels.find((p) => p.projectPath === projectPath && p.url === url);
		if (existing) {
			this.focusOpenedTopLevelPanel(existing.id);
			logger.debug("Browser panel already open for URL, focusing", { url, projectPath });
			return existing;
		}

		const panel: BrowserPanel = {
			id: crypto.randomUUID(),
			kind: "browser",
			projectPath,
			url,
			title: title ?? url,
			width: DEFAULT_BROWSER_PANEL_WIDTH,
			ownerPanelId: null,
		};

		this.browserPanels = [panel, ...this.browserPanels];
		this.focusOpenedTopLevelPanel(panel.id);
		this.onPersist();

		logger.debug("Opened browser panel", { url, panelId: panel.id });
		return panel;
	}

	/**
	 * Close a browser panel by ID.
	 */
	closeBrowserPanel(panelId: string): void {
		const closeState = this.captureTopLevelPanelCloseState(panelId);
		// Close the native webview before removing panel from state.
		// This ensures cleanup even if the component's onDestroy doesn't fire in time.
		const label = `browser-${panelId}`;
		browserWebview.close(label);

		this.browserPanels = this.browserPanels.filter((p) => p.id !== panelId);
		this.applyTopLevelPanelCloseState(closeState);
		this.onPersist();
		logger.debug("Closed browser panel", { panelId });
	}

	/**
	 * Resize a browser panel.
	 */
	resizeBrowserPanel(panelId: string, delta: number): void {
		this.browserPanels = this.browserPanels.map((p) =>
			p.id === panelId ? { ...p, width: Math.max(p.width + delta, MIN_BROWSER_PANEL_WIDTH) } : p
		);
		this.onPersist();
	}

	/**
	 * Get a browser panel by ID.
	 */
	getBrowserPanel(panelId: string): BrowserPanel | undefined {
		return this.browserPanels.find((p) => p.id === panelId);
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
	setContext(PANEL_STORE_KEY, store);
	return store;
}

/**
 * Get the panel store from Svelte context.
 */
export function getPanelStore(): PanelStore {
	return getContext<PanelStore>(PANEL_STORE_KEY);
}
