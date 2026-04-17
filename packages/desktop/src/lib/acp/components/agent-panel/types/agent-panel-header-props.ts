import type { SessionStatusUI } from "./session-status-ui";

/**
 * Props for the AgentPanelHeader component.
 *
 * @property pendingProjectSelection - Whether project selection is pending
 * @property sessionId - Session ID (null if no session)
 * @property sessionTitle - Session title (null if no session)
 * @property sessionAgentId - Agent ID for status indicator
 * @property agentIconSrc - URL/path to agent icon
 * @property agentName - Display name of the agent
 * @property isFullscreen - Whether panel is in fullscreen mode
 * @property sessionStatus - Mapped session status for UI display
 * @property projectName - Display name of the project for badge
 * @property projectColor - Color for the project badge
 * @property debugPanelState - Debug information about the panel state
 * @property onClose - Callback when close button is clicked
 * @property onToggleFullscreen - Callback when fullscreen is toggled
 * @property onCopyContent - Callback when copy content is selected
 * @property onOpenInFinder - Callback when open in finder is selected
 * @property displayTitle - Session display title (cleaned, with fallback) for Copy title / stats
 * @property entriesCount - Number of entries for View stats popover
 * @property insertions - Total lines added for View stats
 * @property deletions - Total lines removed for View stats
 * @property createdAt - Session created date for View stats
 * @property updatedAt - Session updated date for View stats
 * @property onOpenRawFile - Callback when open raw session file is selected
 * @property onOpenInAcepe - Callback when open raw session in Acepe is selected
 * @property onExportMarkdown - Callback when export as Markdown is selected
 * @property onExportJson - Callback when export as JSON is selected
 */
export interface AgentPanelHeaderProps {
	readonly pendingProjectSelection: boolean;
	readonly isConnecting: boolean;
	readonly sessionId: string | null;
	readonly sessionTitle: string | null;
	readonly sessionAgentId: string | null;
	readonly currentAgentId: string | null;
	readonly availableAgents: readonly { id: string; name: string }[];
	readonly agentIconSrc: string;
	readonly agentName: string | null;
	readonly isFullscreen: boolean;
	readonly sessionStatus: SessionStatusUI;
	readonly projectName: string;
	readonly projectColor: string;
	readonly projectIconSrc?: string | null;
	readonly sequenceId?: number | null;
	readonly hideProjectBadge?: boolean;
	readonly debugPanelState?: unknown;
	readonly onClose?: () => void;
	readonly onToggleFullscreen?: () => void;
	readonly onCopyContent?: () => Promise<void>;
	readonly onOpenInFinder?: () => Promise<void>;
	readonly onCopyStreamingLogPath?: () => Promise<void>;
	readonly onExportRawStreaming?: () => Promise<void>;
	// Session menu (same as session-item dropdown)
	readonly displayTitle?: string | null;
	readonly entriesCount?: number;
	readonly insertions?: number;
	readonly deletions?: number;
	readonly createdAt?: Date | null;
	readonly updatedAt?: Date | null;
	readonly onOpenRawFile?: () => Promise<void>;
	readonly onOpenInAcepe?: () => Promise<void>;
	readonly onExportMarkdown?: () => Promise<void>;
	readonly onExportJson?: () => Promise<void>;
	readonly onAgentChange?: (agentId: string) => void;
	readonly onScrollToTop?: () => void;
}
