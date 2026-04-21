/**
 * Unified store types.
 *
 * Session types are imported from the canonical location in application/dto/session.ts.
 * This file contains store-specific types like panels, agents, and workspace persistence.
 */

// Import SessionEntry for use within this file (PanelHotState)
import type { SessionEntry as _SessionEntry } from "../application/dto/session";

/**
 * Resume session result from ACP.
 * This type is now imported from generated ACP types for consistency with Rust backend.
 */
export type { NewSessionResponse as ResumeSessionResult } from "../../services/acp-types.js";
// Re-export session types from canonical location
export type {
	Mode,
	Model,
	Session,
	SessionCapabilities,
	SessionCold,
	SessionEntry,
	SessionIdentity,
	SessionMetadata,
	SessionStatus,
	SessionSummary,
	TaskProgress,
} from "../application/dto/session";

// ============================================
// STORE-SPECIFIC TYPES
// ============================================

import type { ProviderMetadataProjection } from "../../services/acp-types.js";
import type { ConfigOptionData } from "../../services/converted-session-types.js";
import type { Mode, Model, SessionStatus } from "../application/dto/session";
import type { ComposerRestoreSnapshot } from "../components/agent-input/logic/first-send-recovery.js";
import type { ModifiedFilesState } from "../components/modified-files/types/modified-files-state";
import type { ActiveTurnFailure } from "../types/turn-error.js";
import type { PreparedWorktreeLaunch } from "../types/worktree-info.js";
import type { AvailableCommand } from "../types/available-command";
import type { ModifiedFileEntry } from "../types/modified-file-entry.js";

/**
 * Turn state for streaming sessions.
 * Explicitly encodes the state of the current turn to avoid boolean blindness.
 *
 * - idle: No active turn, ready for user input
 * - streaming: Agent is actively generating a response
 * - completed: Turn completed successfully
 * - interrupted: User manually interrupted the turn
 * - error: Turn ended due to an error
 */
export type TurnState = "idle" | "streaming" | "completed" | "interrupted" | "error";

/**
 * Usage telemetry state for a session (adapter-agnostic).
 * Updated from UsageTelemetryUpdate session updates.
 */
export type SessionContextBudgetSource =
	| "provider-explicit"
	| "provider-model-capability"
	| "catalog-fallback"
	| "unknown";

export interface SessionContextBudget {
	readonly maxTokens: number;
	readonly source: SessionContextBudgetSource;
	readonly scope: string;
	readonly updatedAt: number;
}

export interface SessionUsageTelemetry {
	readonly sessionSpendUsd: number;
	readonly latestStepCostUsd: number | null;
	readonly latestTokensTotal: number | null;
	readonly latestTokensInput: number | null;
	readonly latestTokensOutput: number | null;
	readonly latestTokensCacheRead: number | null;
	readonly latestTokensCacheWrite: number | null;
	readonly latestTokensReasoning: number | null;
	readonly lastTelemetryEventId: string | null;
	readonly contextBudget: SessionContextBudget | null;
	readonly updatedAt: number;
}

/**
 * Hot state for session - properties that change frequently.
 * Separated from Session to avoid array recomputation on status changes.
 *
 * Includes: status, connection state, current model/mode, and available commands.
 * These change often (e.g., on every model switch) and should NOT trigger
 * full sessions array recreation.
 *
 * modelPerMode: Tracks which model was selected per mode within this session.
 * Used to restore user's previous model choice when switching between modes.
 * Format: { modeId → modelId }
 */
export interface SessionHotState {
	readonly status: SessionStatus;
	readonly isConnected: boolean;
	readonly turnState: TurnState;
	readonly acpSessionId: string | null;
	readonly connectionError: string | null;
	readonly activeTurnFailure?: ActiveTurnFailure | null;
	readonly lastTerminalTurnId?: string | null;
	readonly autonomousEnabled: boolean;
	readonly autonomousTransition: "idle" | "enabling" | "disabling";
	readonly currentModel: Model | null;
	readonly currentMode: Mode | null;
	readonly availableCommands: ReadonlyArray<AvailableCommand>;
	readonly modelPerMode?: Record<string, string>;
	/** Config options from agents that use configOptionUpdate (e.g., Codex) */
	readonly configOptions?: ReadonlyArray<ConfigOptionData>;
	/** Timestamp when status last changed (for urgency sorting) */
	readonly statusChangedAt: number;
	/** Usage/cost and token telemetry (adapter-agnostic). */
	readonly usageTelemetry?: SessionUsageTelemetry;
}

/**
 * Default hot state for new sessions.
 */
export const DEFAULT_HOT_STATE: SessionHotState = {
	status: "idle",
	isConnected: false,
	turnState: "idle",
	acpSessionId: null,
	connectionError: null,
	activeTurnFailure: null,
	lastTerminalTurnId: null,
	autonomousEnabled: false,
	autonomousTransition: "idle",
	currentModel: null,
	currentMode: null,
	availableCommands: [],
	modelPerMode: {},
	statusChangedAt: Date.now(),
};

export type { StoreComposerState } from "../logic/composer-ui-state.js";

// ============================================
// PANEL TYPES
// ============================================

/**
 * Panel hot state - transient properties that change frequently.
 * Separated from Panel to avoid array recomputation on status changes.
 * Follows SessionHotState pattern.
 */
export interface PanelHotState {
	/** True when the panel is in review mode (showing diff review UI) */
	readonly reviewMode: boolean;
	/** Modified files state for review mode */
	readonly reviewFilesState: ModifiedFilesState | null;
	/** Initial file index for review mode */
	readonly reviewFileIndex: number;
	/** True when the plan sidebar is expanded for this panel */
	readonly planSidebarExpanded: boolean;
	/** Draft message text in the input field */
	readonly messageDraft: string;
	/** Provisional autonomous state used before a real session exists. */
	readonly provisionalAutonomousEnabled: boolean;
	/** Pending full composer restore after a failed first-send handoff. */
	readonly pendingComposerRestore: ComposerRestoreSnapshot | null;
	/** Monotonic version used to remount the composer when restore data is queued. */
	readonly composerRestoreVersion: number;
	/** True when the embedded terminal drawer is open for this panel */
	readonly embeddedTerminalDrawerOpen: boolean;
	/** Optimistic user entry displayed before session creation completes (transient, not persisted) */
	readonly pendingUserEntry: _SessionEntry | null;
	/** True when the browser sidebar is expanded for this panel */
	readonly browserSidebarExpanded: boolean;
	/** URL to display in the embedded browser sidebar */
	readonly browserSidebarUrl: string | null;
	/** Transient worktree setup indicator used during empty-state first-send handoff. */
	readonly pendingWorktreeSetup: {
		readonly projectPath: string;
		readonly worktreePath: string | null;
		readonly phase: "creating-worktree" | "running";
	} | null;
}

/**
 * Default hot state for new panels.
 */
export const DEFAULT_PANEL_HOT_STATE: PanelHotState = {
	reviewMode: false,
	reviewFilesState: null,
	reviewFileIndex: 0,
	planSidebarExpanded: false,
	browserSidebarExpanded: false,
	browserSidebarUrl: null,
	messageDraft: "",
	provisionalAutonomousEnabled: false,
	pendingComposerRestore: null,
	composerRestoreVersion: 0,
	embeddedTerminalDrawerOpen: false,
	pendingUserEntry: null,
	pendingWorktreeSetup: null,
};

/**
 * Panel - a UI container that displays a session.
 * This type is directly serializable (no transient fields).
 */
export interface Panel {
	readonly id: string;
	readonly kind: "agent";
	readonly ownerPanelId: null;
	readonly sessionId: string | null;
	readonly autoCreated?: boolean;
	readonly width: number;
	readonly pendingProjectSelection: boolean;
	readonly pendingWorktreeEnabled?: boolean | null;
	readonly preparedWorktreeLaunch?: PreparedWorktreeLaunch | null;
	readonly selectedAgentId: string | null;
	/** Session loading context (enables direct loading without history lookup) */
	readonly projectPath: string | null;
	readonly agentId: string | null;
	readonly sourcePath?: string | null;
	readonly worktreePath?: string | null;
	/** Persisted session title for instant display before IPC load completes */
	readonly sessionTitle: string | null;
}

export type WorkspacePanelKind = "agent" | "file" | "terminal" | "browser" | "review" | "git";

export interface WorkspacePanelBase {
	readonly id: string;
	readonly kind: WorkspacePanelKind;
	readonly projectPath: string | null;
	readonly width: number;
	readonly ownerPanelId: string | null;
}

export interface AgentWorkspacePanel extends WorkspacePanelBase {
	readonly kind: "agent";
	readonly ownerPanelId: null;
	readonly sessionId: string | null;
	readonly autoCreated?: boolean;
	readonly pendingProjectSelection: boolean;
	readonly pendingWorktreeEnabled?: boolean | null;
	readonly preparedWorktreeLaunch?: PreparedWorktreeLaunch | null;
	readonly selectedAgentId: string | null;
	readonly agentId: string | null;
	readonly sourcePath?: string | null;
	readonly worktreePath?: string | null;
	readonly sessionTitle: string | null;
	readonly sequenceId?: number | null;
}

export interface FileWorkspacePanel extends WorkspacePanelBase {
	readonly kind: "file";
	readonly projectPath: string;
	readonly filePath: string;
	readonly targetLine?: number;
	readonly targetColumn?: number;
}

export interface TerminalPanelGroup {
	readonly id: string;
	readonly projectPath: string;
	readonly width: number;
	readonly selectedTabId: string | null;
	readonly order: number;
}

export interface TerminalTab {
	readonly id: string;
	readonly groupId: string;
	readonly projectPath: string;
	readonly createdAt: number;
	readonly ptyId: number | null;
	readonly shell: string | null;
}

export interface TerminalWorkspacePanel extends WorkspacePanelBase {
	readonly kind: "terminal";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly groupId: string;
}

export interface BrowserWorkspacePanel extends WorkspacePanelBase {
	readonly kind: "browser";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly url: string;
	readonly title: string;
}

export interface ReviewWorkspacePanel extends WorkspacePanelBase {
	readonly kind: "review";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly modifiedFilesState: ModifiedFilesState;
	readonly selectedFileIndex: number;
}

export interface GitWorkspacePanel extends WorkspacePanelBase {
	readonly kind: "git";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly initialTarget?: {
		readonly section: "commits" | "prs";
		readonly commitSha?: string;
		readonly prNumber?: number;
	};
}

export type WorkspacePanel =
	| AgentWorkspacePanel
	| FileWorkspacePanel
	| TerminalWorkspacePanel
	| BrowserWorkspacePanel
	| ReviewWorkspacePanel
	| GitWorkspacePanel;

export interface PersistedWorkspacePanelBase {
	readonly id?: string;
	readonly kind: WorkspacePanelKind;
	readonly projectPath: string | null;
	readonly width: number;
	readonly ownerPanelId: string | null;
}

export interface PersistedAgentWorkspacePanelState extends PersistedWorkspacePanelBase {
	readonly kind: "agent";
	readonly ownerPanelId: null;
	readonly sessionId: string | null;
	readonly autoCreated?: boolean;
	readonly pendingProjectSelection: boolean;
	readonly pendingWorktreeEnabled?: boolean;
	readonly preparedWorktreeLaunch?: PreparedWorktreeLaunch | null;
	readonly selectedAgentId: string | null;
	readonly agentId: string | null;
	readonly sourcePath?: string;
	readonly worktreePath?: string;
	readonly sessionTitle?: string;
	readonly scrollTop?: number;
	readonly planSidebarExpanded?: boolean;
	readonly messageDraft?: string;
	readonly reviewMode?: boolean;
	readonly reviewFileIndex?: number;
	readonly embeddedTerminalDrawerOpen?: boolean;
	readonly selectedEmbeddedTerminalTabId?: string;
	readonly sequenceId?: number;
}

export interface PersistedFileWorkspacePanelState extends PersistedWorkspacePanelBase {
	readonly kind: "file";
	readonly projectPath: string;
	readonly filePath: string;
	readonly targetLine?: number;
	readonly targetColumn?: number;
}

export interface PersistedTerminalPanelGroupState {
	readonly id: string;
	readonly projectPath: string;
	readonly width: number;
	readonly selectedTabId?: string | null;
	readonly order: number;
}

export interface PersistedTerminalTabState {
	readonly id: string;
	readonly groupId: string;
	readonly projectPath: string;
	readonly createdAt: number;
}

export interface PersistedTerminalWorkspacePanelState extends PersistedWorkspacePanelBase {
	readonly kind: "terminal";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly groupId: string;
}

export interface PersistedBrowserWorkspacePanelState extends PersistedWorkspacePanelBase {
	readonly kind: "browser";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly url: string;
	readonly title: string;
}

export interface PersistedReviewWorkspacePanelState extends PersistedWorkspacePanelBase {
	readonly kind: "review";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly files: ReadonlyArray<ModifiedFileEntry>;
	readonly totalEditCount: number;
	readonly selectedFileIndex: number;
}

export interface PersistedGitWorkspacePanelState extends PersistedWorkspacePanelBase {
	readonly kind: "git";
	readonly projectPath: string;
	readonly ownerPanelId: null;
	readonly initialTarget?: {
		readonly section: "commits" | "prs";
		readonly commitSha?: string;
		readonly prNumber?: number;
	};
}

export type PersistedWorkspacePanelState =
	| PersistedAgentWorkspacePanelState
	| PersistedFileWorkspacePanelState
	| PersistedTerminalWorkspacePanelState
	| PersistedBrowserWorkspacePanelState
	| PersistedReviewWorkspacePanelState
	| PersistedGitWorkspacePanelState;

/**
 * Panel layout state.
 */
export interface PanelLayout {
	readonly panels: ReadonlyArray<Panel>;
}

// ============================================
// AGENT TYPES
// ============================================

/**
 * Current setup state for an agent.
 */
export type AgentAvailabilityKind = { kind: "installable"; installed: boolean };

/**
 * Agent - represents an AI agent provider.
 * Compatible with AgentInfo from agent-manager for UI components.
 */
export interface Agent {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	/** Icon path for the agent */
	readonly icon: string;
	/** Current setup state for this agent (set by store when loading from API) */
	readonly availability_kind?: AgentAvailabilityKind;
	/** Visible UI modes that support wrapper-managed Autonomous execution. */
	readonly autonomous_supported_mode_ids?: ReadonlyArray<string>;
	/** Registry-owned precedence for default selection. */
	readonly default_selection_rank?: number;
	/** Canonical provider metadata projection for shared frontend surfaces. */
	readonly providerMetadata?: ProviderMetadataProjection;
	/** Whether the agent can discover persisted projects from existing session history. */
	readonly supportsProjectDiscovery?: boolean;
}

// ============================================
// API RESPONSE TYPES
// ============================================

/**
 * History entry from Tauri backend.
 * Represents a session from any agent (Claude Code, Cursor, etc.).
 */
export interface HistoryEntry {
	readonly sessionId: string;
	readonly project: string;
	readonly display: string;
	readonly timestamp: string;
	readonly agentId: string; // Identifies which agent created this session
}

export { isToolCallEntry } from "../application/dto/session";

// ============================================
// VIEW MODE
// ============================================

/** Layout view mode: how panels are displayed */
export type ViewMode = "single" | "project" | "multi" | "kanban";

// ============================================
// WORKSPACE PERSISTENCE TYPES
// ============================================

/**
 * Persisted workspace state.
 */
export interface PersistedWorkspaceState {
	readonly version: number;
	readonly workspacePanels?: ReadonlyArray<PersistedWorkspacePanelState>;
	readonly panels: ReadonlyArray<PersistedPanelState>;
	/** Open file panels persisted across app restarts (added in version 3) */
	readonly filePanels?: ReadonlyArray<PersistedFilePanelState>;
	/** Active attached file tab per owner panel ID (added in version 6) */
	readonly activeFilePanelIdByOwnerPanelId?: Record<string, string>;
	readonly focusedPanelIndex: number | null;
	readonly panelContainerScrollX: number;
	readonly savedAt: string;
	/** Whether the sidebar is open (added in version 2) */
	readonly sidebarOpen?: boolean;
	/** Whether the top bar is visible (added in version 7) */
	readonly topBarVisible?: boolean;
	/** File tree expansion state per project (added in version 2) */
	readonly fileTreeExpansion?: Record<string, string[]>;
	/** Project view mode: "sessions" or "files" per projectPath (added in version 3) */
	readonly projectFileViewModes?: Record<string, "sessions" | "files">;
	/** Index of the fullscreen panel, or null if no panel is fullscreen (added in version 2) */
	readonly fullscreenPanelIndex?: number | null;
	/** SQL Studio state (added in version 4) */
	readonly sqlStudio?: PersistedSqlStudioState;
	/** Full-screen review overlay state (added in version 5) */
	readonly reviewFullscreen?: PersistedReviewFullscreenState;
	/** Open terminal panels persisted across app restarts (added in version 7, legacy flat shape) */
	readonly terminalPanels?: ReadonlyArray<PersistedTerminalPanelState>;
	/** Explicit top-level terminal groups persisted across app restarts (added in version 10). */
	readonly terminalPanelGroups?: ReadonlyArray<PersistedTerminalPanelGroupState>;
	/** Terminal tabs persisted separately from runtime PTY state (added in version 10). */
	readonly terminalTabs?: ReadonlyArray<PersistedTerminalTabState>;
	/** Open browser panels persisted across app restarts (added in version 7) */
	readonly browserPanels?: ReadonlyArray<PersistedBrowserPanelState>;
	/** View mode: "single", "project", or "multi" (added in version 8) */
	readonly viewMode?: ViewMode;
	/** Embedded terminal tabs per agent panel (added in version 9) */
	readonly embeddedTerminalTabs?: ReadonlyArray<PersistedEmbeddedTerminalState>;
	/** @deprecated Use viewMode instead. Kept for backward-compatible restore. */
	readonly focusedViewEnabled?: boolean;
	/** Which project path is focused in focused view */
	readonly focusedViewProjectPath?: string | null;
	/** Project paths whose sidebar cards are collapsed */
	readonly collapsedProjectPaths?: readonly string[];
	/** Whether the attention queue card is expanded (defaults to true) */
	readonly queueExpanded?: boolean;
	/**
	 * @deprecated Use PersistedPanelState.messageDraft instead. Kept for backward compatibility.
	 */
	readonly messageDrafts?: Record<number, string>;
}

/**
 * Persisted SQL Studio state.
 */
export interface PersistedSqlStudioState {
	readonly open: boolean;
	readonly selectedConnectionId: string | null;
	readonly selectedSchemaName: string | null;
	readonly selectedTableName: string | null;
}

/**
 * Persisted full-screen review overlay state.
 */
export interface PersistedReviewFullscreenState {
	readonly open: boolean;
	readonly sessionId: string | null;
	readonly fileIndex: number;
}

/**
 * Persisted panel state (subset of Panel for persistence).
 */
export interface PersistedPanelState {
	readonly id?: string;
	readonly sessionId: string | null;
	readonly autoCreated?: boolean;
	readonly width: number;
	readonly pendingProjectSelection: boolean;
	readonly pendingWorktreeEnabled?: boolean;
	readonly preparedWorktreeLaunch?: PreparedWorktreeLaunch | null;
	readonly selectedAgentId: string | null;
	readonly projectPath: string | null;
	readonly agentId: string | null;
	readonly sourcePath?: string;
	readonly worktreePath?: string;
	/** Scroll position within the panel (pixels from top) */
	readonly scrollTop?: number;
	/** Whether the plan sidebar is expanded for this panel */
	readonly planSidebarExpanded?: boolean;
	/** Draft message text in the input field */
	readonly messageDraft?: string;
	/** Session title for instant display before IPC load completes */
	readonly sessionTitle?: string;
	/** Whether the panel was in review mode (restored when session loads) */
	readonly reviewMode?: boolean;
	/** Selected file index in review mode */
	readonly reviewFileIndex?: number;
	/** Whether the embedded terminal drawer is open (added in version 9) */
	readonly embeddedTerminalDrawerOpen?: boolean;
	/** Selected embedded terminal tab ID (added in version 9) */
	readonly selectedEmbeddedTerminalTabId?: string;
	/** Per-project session sequence ID for instant #N display before IPC load */
	readonly sequenceId?: number;
}

/**
 * Persisted file panel state.
 */
export interface PersistedFilePanelState {
	readonly id?: string;
	readonly filePath: string;
	readonly projectPath: string;
	readonly ownerPanelId?: string | null;
	readonly width: number;
	readonly targetLine?: number;
	readonly targetColumn?: number;
}

/**
 * Persisted terminal panel state (version 7+).
 * Runtime-only fields (ptyId, shell) are omitted — recreated on mount.
 * Optional id (version 8+) allows stable restore and fullscreen aux selection.
 */
export interface PersistedTerminalPanelState {
	readonly id?: string;
	readonly projectPath: string;
	readonly width: number;
}

/**
 * Persisted browser panel state (version 7+).
 * Native webview is recreated on mount.
 */
export interface PersistedBrowserPanelState {
	readonly projectPath: string;
	readonly url: string;
	readonly title: string;
	readonly width: number;
}

/**
 * Persisted embedded terminal state per agent panel (version 9+).
 * Associates terminal tabs with their owning agent panel.
 */
export interface PersistedEmbeddedTerminalState {
	/** Agent panel ID this terminal state belongs to (remapped on restore) */
	readonly panelId: string;
	/** Tab descriptors (id + cwd only, no runtime PTY state) */
	readonly tabs: ReadonlyArray<{ readonly id: string; readonly cwd: string }>;
}

// ============================================
// CONSTANTS
// ============================================

export const DEFAULT_PANEL_WIDTH = 450;
export const MIN_PANEL_WIDTH = 400;
