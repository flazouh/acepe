import type { AgentInfo } from "../../../logic/agent-manager.js";
import type { Project } from "../../../logic/project-manager.svelte";
import type { FilePanel } from "../../../store/file-panel-type.js";
import type { ModifiedFilesState } from "../../modified-files/types/modified-files-state.js";

/**
 * Props for the AgentPanel component.
 *
 * Defines all inputs that the agent panel accepts from its parent.
 * UI state is managed internally via XState PanelUiMachine.
 *
 * Note: Session data is resolved internally using granular accessors
 * (getSessionIdentity, getEntries, getHotState) to enable fine-grained
 * reactivity - only re-renders when specific data changes.
 */
export interface AgentPanelProps {
	/**
	 * Unique panel ID for tracking and persistence.
	 */
	readonly panelId?: string;

	/**
	 * Session ID for internal data resolution.
	 * AgentPanel uses granular accessors to fetch session data.
	 */
	readonly sessionId?: string | null;

	/**
	 * Current panel width in pixels.
	 */
	readonly width: number;

	/**
	 * Whether the panel is showing project selection UI.
	 */
	readonly pendingProjectSelection: boolean;

	/**
	 * Whether the panel is waiting for a session to load.
	 * True when the panel has a sessionId but the session data hasn't been loaded yet.
	 * Used to show loading state instead of project selection.
	 */
	readonly isWaitingForSession?: boolean;

	/**
	 * Total count of projects in the database.
	 * null = not yet loaded, 0+ = actual count.
	 */
	readonly projectCount: number | null;

	/**
	 * All projects from the database.
	 */
	readonly allProjects: readonly Project[];

	/**
	 * Project for the current session.
	 * Determined from sessionData.projectPath.
	 */
	readonly project: Project | null;

	/**
	 * Selected agent ID for this panel.
	 */
	readonly selectedAgentId: string | null;

	/**
	 * Available agents for selection.
	 */
	readonly availableAgents: AgentInfo[];

	/**
	 * Callback when agent selection changes.
	 */
	readonly onAgentChange: (agentId: string) => void;

	/**
	 * Effective theme (light or dark) for UI elements.
	 */
	readonly effectiveTheme: "light" | "dark";

	/**
	 * Callback when the panel close button is clicked.
	 */
	readonly onClose?: () => void;

	/**
	 * Callback when a project is selected for creating a new session.
	 */
	readonly onCreateSessionForProject?: (project: Project) => void;

	/**
	 * Callback when a session is created.
	 */
	readonly onSessionCreated?: (sessionId: string) => void;

	/**
	 * Callback when the panel edge is dragged to resize.
	 *
	 * @param panelId - ID of the panel being resized
	 * @param delta - Pixel delta for the resize operation
	 */
	readonly onResizePanel?: (panelId: string, delta: number) => void;

	/**
	 * Callback when the fullscreen toggle is clicked.
	 */
	readonly onToggleFullscreen?: () => void;

	/**
	 * Whether the panel is currently in fullscreen mode.
	 */
	readonly isFullscreen?: boolean;

	/**
	 * Whether the panel is currently focused.
	 */
	readonly isFocused?: boolean;

	/**
	 * When true, suppress the project badge in the header.
	 * Used when the panel is inside a ProjectCard that already shows the badge.
	 */
	readonly hideProjectBadge?: boolean;

	/**
	 * Callback when the panel is focused.
	 */
	readonly onFocus?: () => void;

	/**
	 * Whether the panel is in review mode.
	 */
	readonly reviewMode?: boolean;

	/**
	 * Modified files state for review mode.
	 */
	readonly reviewFilesState?: ModifiedFilesState | null;

	/**
	 * Selected file index in review mode.
	 */
	readonly reviewFileIndex?: number;

	/**
	 * Callback to enter review mode.
	 */
	readonly onEnterReviewMode?: (
		modifiedFilesState: ModifiedFilesState,
		initialFileIndex: number
	) => void;

	/**
	 * Callback to exit review mode.
	 */
	readonly onExitReviewMode?: () => void;

	/**
	 * Callback to change the selected file in review mode.
	 */
	readonly onReviewFileIndexChange?: (fileIndex: number) => void;

	/**
	 * Optional callback to open the full-screen review overlay.
	 * When provided, shows an expand icon in the modified files header.
	 */
	readonly onOpenFullscreenReview?: (sessionId: string, fileIndex: number) => void;

	/**
	 * Attached file panels owned by this agent panel.
	 */
	readonly attachedFilePanels?: readonly FilePanel[];

	/**
	 * Active attached file panel id.
	 */
	readonly activeAttachedFilePanelId?: string | null;

	/**
	 * Callback to select active attached file tab.
	 */
	readonly onSelectAttachedFilePanel?: (ownerPanelId: string, filePanelId: string) => void;

	/**
	 * Callback to close an attached file panel.
	 */
	readonly onCloseAttachedFilePanel?: (filePanelId: string) => void;

	/**
	 * Callback to resize an attached file panel.
	 */
	readonly onResizeAttachedFilePanel?: (filePanelId: string, delta: number) => void;

	/**
	 * Callback when the user wants to create a GitHub issue from an agent error.
	 * The draft contains a prefilled title, body, and category for the issue dialog.
	 */
	readonly onCreateIssueReport?: (draft: { title: string; body: string; category: string }) => void;
}
