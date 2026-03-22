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
import type { TerminalPanel } from "./terminal-panel-type.js";
import { DEFAULT_TERMINAL_PANEL_WIDTH, MIN_TERMINAL_PANEL_WIDTH } from "./terminal-panel-type.js";
import type { Panel, PanelHotState, SessionEntry, ViewMode } from "./types.js";
import { DEFAULT_PANEL_HOT_STATE, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./types.js";

const PANEL_STORE_KEY = Symbol("panel-store");
const logger = createLogger({ id: "panel-store", name: "PanelStore" });
const DEFAULT_ATTACHED_FILE_PANEL_WIDTH = DEFAULT_FILE_PANEL_WIDTH;

type FullscreenAuxPanelRef = {
	kind: "file" | "review" | "terminal" | "git" | "browser";
	id: string;
};

export class PanelStore {
	panels = $state<Panel[]>([]);
	filePanels = $state<FilePanel[]>([]);
	reviewPanels = $state<ReviewPanel[]>([]);
	terminalPanels = $state<TerminalPanel[]>([]);
	gitPanels = $state<GitPanel[]>([]);
	browserPanels = $state<BrowserPanel[]>([]);
	focusedPanelId = $state<string | null>(null);
	fullscreenPanelId = $state<string | null>(null);
	fullscreenAuxPanel = $state<FullscreenAuxPanelRef | null>(null);
	fullscreenAuxOnly = $state(false);
	scrollX = $state<number>(0);

	// View mode: "single" (one session), "project" (one project), "multi" (all projects)
	viewMode = $state<ViewMode>("multi");
	focusedViewProjectPath = $state<string | null>(null);

	// Hot state (transient, frequently changing)
	private hotState = new SvelteMap<string, PanelHotState>();

	// Track in-flight opens
	private openingSessionIds = new SvelteSet<string>();
	private activeFilePanelIdByOwnerPanelId = new SvelteMap<string, string>();

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

	// Derived lookups
	readonly panelBySessionId = $derived.by(
		() =>
			new SvelteMap(this.panels.filter((p) => p.sessionId !== null).map((p) => [p.sessionId!, p]))
	);

	readonly panelCount = $derived(this.panels.length);

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

	readonly terminalPanelCount = $derived(this.terminalPanels.length);

	/** Selected terminal panel id per project path (for tab switching). */
	selectedTerminalPanelIdByProject = $state<Record<string, string>>({});

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
			if (this.fullscreenPanelId !== null) {
				this.fullscreenPanelId = existing.id;
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
			sessionId,
			width,
			pendingProjectSelection: false,
			selectedAgentId,
			projectPath: session?.projectPath ?? null,
			agentId: session?.agentId ?? null,
			sessionTitle: session?.title ?? null,
		};

		this.panels = [panel, ...this.panels];
		this.focusedPanelId = panel.id;

		// If in fullscreen mode, switch fullscreen to the new panel
		if (this.fullscreenPanelId !== null) {
			this.fullscreenPanelId = panel.id;
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
			sessionId: null,
			width: DEFAULT_PANEL_WIDTH,
			pendingProjectSelection: options.requireProjectSelection ?? false,
			selectedAgentId: options.selectedAgentId ?? null,
			projectPath: options.projectPath ?? null,
			agentId: null,
			sessionTitle: null,
		};

		this.panels = [panel, ...this.panels];
		this.focusedPanelId = panel.id;

		// If in fullscreen mode, switch fullscreen to the new panel
		if (this.fullscreenPanelId !== null) {
			this.fullscreenPanelId = panel.id;
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
		const index = this.panels.findIndex((p) => p.id === panelId);
		if (index === -1) return;

		this.panels = this.panels.filter((p) => p.id !== panelId);

		// Clean up hot state to prevent memory leaks
		this.hotState.delete(panelId);

		this.activeFilePanelIdByOwnerPanelId.delete(panelId);
		this.filePanels = this.filePanels.filter((filePanel) => filePanel.ownerPanelId !== panelId);

		// Clean up embedded terminal state (belt-and-suspenders with component onDestroy)
		this.embeddedTerminals.cleanup(panelId);

		// Clean up worktree localStorage for this panel
		clearWorktreeEnabled(panelId);

		if (this.focusedPanelId === panelId) {
			const newIndex = Math.min(index, this.panels.length - 1);
			this.focusedPanelId = this.panels[newIndex]?.id ?? null;
		}

		if (this.fullscreenPanelId === panelId) {
			// If there are remaining panels, fullscreen the newly focused one
			if (this.panels.length > 0 && this.focusedPanelId) {
				this.fullscreenPanelId = this.focusedPanelId;
			} else {
				this.fullscreenPanelId = null;
			}
		}

		this.reconcileFullscreenAuxPanel();

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
		if (this.panels.some((p) => p.id === panelId)) {
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
		if (this.fullscreenPanelId !== null) {
			this.switchFullscreen(panelId);
		}
		// In focused view, switch to the panel's project so it becomes visible
		if (this.viewMode !== "multi") {
			const panel = this.panels.find((p) => p.id === panelId);
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
		this.fullscreenAuxOnly = false;
		this.fullscreenPanelId = this.fullscreenPanelId === panelId ? null : panelId;
	}

	/**
	 * Exit fullscreen (clear main fullscreen panel). Aux panel selection is left as-is.
	 */
	exitFullscreen(): void {
		this.fullscreenAuxOnly = false;
		this.fullscreenPanelId = null;
	}

	/**
	 * Enter fullscreen with the given terminal as the aux panel.
	 * If no panel is fullscreen yet, sets fullscreen to focused or first panel.
	 * When there are no agent panels, enters aux-only fullscreen mode.
	 */
	enterTerminalFullscreen(terminalPanelId: string): void {
		this.fullscreenAuxPanel = { kind: "terminal", id: terminalPanelId };
		if (this.fullscreenPanelId === null) {
			const fallbackPanelId = this.focusedPanelId ?? this.panels[0]?.id ?? null;
			if (fallbackPanelId !== null) {
				this.fullscreenAuxOnly = false;
				this.fullscreenPanelId = fallbackPanelId;
				return;
			}
			this.fullscreenAuxOnly = true;
			return;
		}
		this.fullscreenAuxOnly = false;
	}

	/**
	 * Switch to a different fullscreen panel.
	 */
	switchFullscreen(panelId: string): void {
		this.fullscreenAuxOnly = false;
		this.fullscreenPanelId = panelId;
	}

	/**
	 * Update panel with a session ID.
	 * Pass null to clear the session (e.g., when session doesn't exist on disk).
	 */
	updatePanelSession(panelId: string, sessionId: string | null): void {
		logger.info("[worktree-flow] updatePanelSession", { panelId, sessionId });
		this.panels = this.panels.map((p) =>
			p.id === panelId ? { ...p, sessionId, pendingProjectSelection: false } : p
		);
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
		this.fullscreenPanelId = null;
		this.fullscreenAuxPanel = null;
		this.fullscreenAuxOnly = false;
		this.onPersist();
	}

	setViewMode(mode: ViewMode): void {
		this.viewMode = mode;
		// Reset fullscreen state — each view mode manages its own layout.
		this.fullscreenPanelId = null;
		this.fullscreenAuxPanel = null;
		this.fullscreenAuxOnly = false;
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
				this.fullscreenAuxPanel = { kind: "file", id: existing.id };
			}
			logger.debug("File already open, focusing existing panel", { filePath, projectPath });
			return existing;
		}

		const panel: FilePanel = {
			id: crypto.randomUUID(),
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
			this.fullscreenAuxPanel = { kind: "file", id: panel.id };
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
		this.reconcileFullscreenAuxPanel();
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
			this.fullscreenAuxPanel = { kind: "review", id: existing.id };
			logger.debug("Review panel already open, returning existing", { projectPath });
			return existing;
		}

		const panel: ReviewPanel = {
			id: crypto.randomUUID(),
			projectPath,
			width: width ?? DEFAULT_REVIEW_PANEL_WIDTH,
			modifiedFilesState,
			selectedFileIndex: initialFileIndex ?? 0,
		};

		this.reviewPanels = [panel, ...this.reviewPanels];
		this.fullscreenAuxPanel = { kind: "review", id: panel.id };
		this.onPersist();

		logger.debug("Opened review panel", { projectPath, panelId: panel.id });
		return panel;
	}

	/**
	 * Close a review panel by ID.
	 */
	closeReviewPanel(panelId: string): void {
		this.reviewPanels = this.reviewPanels.filter((p) => p.id !== panelId);
		this.reconcileFullscreenAuxPanel();
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

	/**
	 * Get all terminal panels for a project (supports multiple terminals per project).
	 */
	getTerminalPanelsForProject(projectPath: string): TerminalPanel[] {
		return this.terminalPanels.filter((p) => p.projectPath === projectPath);
	}

	/**
	 * Set the selected terminal panel for a project (tab switching).
	 * When in fullscreen with a terminal for this project, updates fullscreen aux to the selected panel.
	 */
	setSelectedTerminalPanel(projectPath: string, panelId: string): void {
		this.selectedTerminalPanelIdByProject = {
			...this.selectedTerminalPanelIdByProject,
			[projectPath]: panelId,
		};
		if (
			this.fullscreenPanelId !== null &&
			this.fullscreenAuxPanel?.kind === "terminal" &&
			this.getTerminalPanelsForProject(projectPath).some((p) => p.id === panelId)
		) {
			this.fullscreenAuxPanel = { kind: "terminal", id: panelId };
		}
	}

	/**
	 * Open a new terminal panel for a project (always creates; use for "New terminal").
	 */
	openTerminalPanel(projectPath: string, width?: number): TerminalPanel {
		const panel: TerminalPanel = {
			id: crypto.randomUUID(),
			projectPath,
			width: width ?? DEFAULT_TERMINAL_PANEL_WIDTH,
			ptyId: null,
			shell: null,
		};

		this.terminalPanels = [panel, ...this.terminalPanels];
		this.fullscreenAuxPanel = { kind: "terminal", id: panel.id };
		this.selectedTerminalPanelIdByProject = {
			...this.selectedTerminalPanelIdByProject,
			[projectPath]: panel.id,
		};
		this.onPersist();

		logger.debug("Opened terminal panel", { projectPath, panelId: panel.id });
		return panel;
	}

	/**
	 * Close a terminal panel by ID.
	 */
	closeTerminalPanel(panelId: string): void {
		const closed = this.terminalPanels.find((p) => p.id === panelId);
		this.terminalPanels = this.terminalPanels.filter((p) => p.id !== panelId);
		if (closed) {
			const forProject = this.terminalPanels.filter((p) => p.projectPath === closed.projectPath);
			const currentSelected = this.selectedTerminalPanelIdByProject[closed.projectPath];
			if (currentSelected === panelId) {
				const next = forProject[0];
				if (next) {
					this.selectedTerminalPanelIdByProject = {
						...this.selectedTerminalPanelIdByProject,
						[closed.projectPath]: next.id,
					};
				} else {
					const { [closed.projectPath]: _, ...rest } = this.selectedTerminalPanelIdByProject;
					this.selectedTerminalPanelIdByProject = rest;
				}
			}
			// Keep fullscreen aux on same project's next terminal when closing the current aux
			if (this.fullscreenAuxPanel?.kind === "terminal" && this.fullscreenAuxPanel.id === panelId) {
				const nextForProject = this.selectedTerminalPanelIdByProject[closed.projectPath];
				const nextPanel =
					nextForProject && this.terminalPanels.find((p) => p.id === nextForProject);
				if (nextPanel) {
					this.fullscreenAuxPanel = { kind: "terminal", id: nextPanel.id };
				}
			}
		}
		this.reconcileFullscreenAuxPanel();
		this.onPersist();
		logger.debug("Closed terminal panel", { panelId });
	}

	/**
	 * Update the PTY ID and shell for a terminal panel.
	 * Called after the PTY is spawned.
	 */
	updateTerminalPtyId(panelId: string, ptyId: number, shell: string): void {
		this.terminalPanels = this.terminalPanels.map((p) =>
			p.id === panelId ? { ...p, ptyId, shell } : p
		);
	}

	/**
	 * Resize a terminal panel.
	 */
	resizeTerminalPanel(panelId: string, delta: number): void {
		this.terminalPanels = this.terminalPanels.map((p) =>
			p.id === panelId ? { ...p, width: Math.max(p.width + delta, MIN_TERMINAL_PANEL_WIDTH) } : p
		);
		this.onPersist();
	}

	/**
	 * Get a terminal panel by ID.
	 */
	getTerminalPanel(panelId: string): TerminalPanel | undefined {
		return this.terminalPanels.find((p) => p.id === panelId);
	}

	/**
	 * Toggle terminal for a project: if none open, open one; if any open, focus first (show in fullscreen aux).
	 */
	toggleTerminalPanel(projectPath: string, width?: number): void {
		const forProject = this.getTerminalPanelsForProject(projectPath);
		if (forProject.length > 0) {
			const first = forProject[0];
			this.fullscreenAuxPanel = { kind: "terminal", id: first.id };
			if (this.fullscreenPanelId === null) {
				this.fullscreenPanelId = this.focusedPanelId ?? this.panels[0]?.id ?? null;
			}
			this.selectedTerminalPanelIdByProject = {
				...this.selectedTerminalPanelIdByProject,
				[projectPath]: first.id,
			};
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
		this.fullscreenAuxPanel = { kind: "git", id: activePanel.id };
		this.onPersist();

		logger.debug("Opened git panel", { projectPath, panelId: activePanel.id });
		return activePanel;
	}

	/**
	 * Close a git panel by ID.
	 */
	closeGitPanel(panelId: string): void {
		this.gitPanels = this.gitPanels.filter((p) => p.id !== panelId);
		this.reconcileFullscreenAuxPanel();
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
			this.fullscreenAuxPanel = { kind: "browser", id: existing.id };
			logger.debug("Browser panel already open for URL, focusing", { url, projectPath });
			return existing;
		}

		const panel: BrowserPanel = {
			id: crypto.randomUUID(),
			projectPath,
			url,
			title: title ?? url,
			width: DEFAULT_BROWSER_PANEL_WIDTH,
		};

		this.browserPanels = [panel, ...this.browserPanels];
		this.fullscreenAuxPanel = { kind: "browser", id: panel.id };
		this.onPersist();

		logger.debug("Opened browser panel", { url, panelId: panel.id });
		return panel;
	}

	/**
	 * Close a browser panel by ID.
	 */
	closeBrowserPanel(panelId: string): void {
		// Close the native webview before removing panel from state.
		// This ensures cleanup even if the component's onDestroy doesn't fire in time.
		const label = `browser-${panelId}`;
		browserWebview.close(label);

		this.browserPanels = this.browserPanels.filter((p) => p.id !== panelId);
		this.reconcileFullscreenAuxPanel();
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

	private reconcileFullscreenAuxPanel(): void {
		const current = this.fullscreenAuxPanel;
		if (
			current &&
			((current.kind === "file" && this.filePanels.some((p) => p.id === current.id)) ||
				(current.kind === "review" && this.reviewPanels.some((p) => p.id === current.id)) ||
				(current.kind === "terminal" && this.terminalPanels.some((p) => p.id === current.id)) ||
				(current.kind === "git" && this.gitPanels.some((p) => p.id === current.id)) ||
				(current.kind === "browser" && this.browserPanels.some((p) => p.id === current.id)))
		) {
			return;
		}

		if (this.filePanels.length > 0) {
			this.fullscreenAuxPanel = { kind: "file", id: this.filePanels[0].id };
			return;
		}
		if (this.reviewPanels.length > 0) {
			this.fullscreenAuxPanel = { kind: "review", id: this.reviewPanels[0].id };
			return;
		}
		if (this.terminalPanels.length > 0) {
			this.fullscreenAuxPanel = { kind: "terminal", id: this.terminalPanels[0].id };
			return;
		}
		if (this.gitPanels.length > 0) {
			this.fullscreenAuxPanel = { kind: "git", id: this.gitPanels[0].id };
			return;
		}
		if (this.browserPanels.length > 0) {
			this.fullscreenAuxPanel = { kind: "browser", id: this.browserPanels[0].id };
			return;
		}

		this.fullscreenAuxPanel = null;
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
