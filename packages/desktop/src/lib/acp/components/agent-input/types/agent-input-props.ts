import type { Snippet } from "svelte";

import type { SessionStatus } from "../../../application/dto/session-status.js";
import type { AgentInfo } from "../../../logic/agent-manager.js";

/**
 * Props for the AgentInput component.
 *
 * All props are optional to support different usage scenarios:
 * - With existing session (sessionId + granular session state)
 * - Without session (projectPath + projectName for new session creation)
 */
export interface AgentInputProps {
	/**
	 * Existing session ID to use for sending messages.
	 */
	readonly sessionId?: string | null;

	/**
	 * Session status for UI state derivation.
	 */
	readonly sessionStatus?: SessionStatus | null;

	/**
	 * Whether the session is connected.
	 */
	readonly sessionIsConnected?: boolean;

	/**
	 * Whether the session is currently streaming.
	 */
	readonly sessionIsStreaming?: boolean;

	/**
	 * Canonical runtime state: whether submit is currently allowed.
	 */
	readonly sessionCanSubmit?: boolean;

	/**
	 * Canonical runtime state: whether stop/cancel should be shown.
	 */
	readonly sessionShowStop?: boolean;

	/**
	 * Panel ID for tracking and persistence.
	 */
	readonly panelId?: string;

	/**
	 * Project path for creating new sessions.
	 */
	readonly projectPath?: string;

	/**
	 * Project name for display and session creation.
	 */
	readonly projectName?: string;

	/**
	 * Optional worktree path for sessions operating in git worktrees.
	 * Used for correct path conversion when creating checkpoints.
	 */
	readonly worktreePath?: string;

	/**
	 * Whether the worktree toggle is pending (enabled but no worktree created yet).
	 * When true, the first message send will create a worktree + run setup in parallel.
	 */
	readonly worktreePending?: boolean;

	/**
	 * Callback when a worktree is auto-created on first send (worktree default on).
	 * Allows the parent to update its own worktree path state.
	 */
	readonly onWorktreeCreated?: (worktreePath: string) => void;

	/**
	 * Callback fired when first-send worktree creation starts.
	 * Allows the panel to show a transient creating-worktree widget before setup begins.
	 */
	readonly onWorktreeCreating?: () => void;

	/**
	 * Selected agent ID for this panel (used when creating new sessions).
	 */
	readonly selectedAgentId?: string | null;

	/**
	 * Optional voice session identifier for dictation outside a real ACP session.
	 */
	readonly voiceSessionId?: string | null;

	/**
	 * Available agents for selection.
	 */
	readonly availableAgents?: AgentInfo[];

	/**
	 * Callback when agent selection changes.
	 */
	readonly onAgentChange?: (agentId: string) => void;

	/**
	 * Force-disable sending even if the input has content.
	 */
	readonly disableSend?: boolean;

	/**
	 * Whether the panel is in project selection mode.
	 * When true, shows the agent selector even if an agent is already selected.
	 */
	readonly pendingProjectSelection?: boolean;

	/**
	 * Callback when a new session is created.
	 *
	 * @param sessionId - The ID of the newly created session
	 */
	readonly onSessionCreated?: (sessionId: string, panelId?: string | null) => void;

	/**
	 * Callback fired immediately before a send/steer action starts.
	 * Used for explicit UI intents like priming scroll reveal or choosing the
	 * panel that should own optimistic pre-session state.
	 */
	readonly onWillSend?: () => string | null | void;

	/**
	 * Callback fired when a pre-session send fails after optimistic UI state has
	 * been attached to a panel.
	 */
	readonly onSendError?: (panelId: string | null) => void;

	/**
	 * Optional agent/project picker snippet to render in the left side of the footer (empty state).
	 */
	readonly agentProjectPicker?: Snippet;

	/**
	 * Optional checkpoint button snippet to render in the right side of the controls row.
	 */
	readonly checkpointButton?: Snippet;

	/**
	 * Reports the intrinsic (natural) width of the toolbar row.
	 * Used by the parent panel to enforce a dynamic minimum width
	 * that prevents toolbar content from overflowing.
	 */
	readonly onToolbarWidthChange?: (width: number) => void;
}
