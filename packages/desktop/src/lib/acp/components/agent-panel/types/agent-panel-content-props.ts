import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelReviewActionEvent,
	AgentPanelSceneEntryModel,
	AgentUserFileSelectEvent,
	AgentToolFileSelectEvent,
} from "@acepe/ui/agent-panel";
import type { AgentInfo } from "../../../logic/agent-manager.js";
import type { PanelViewState } from "../../../logic/panel-visibility";
import type { Project } from "../../../logic/project-manager.svelte";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { TranscriptRowsState } from "../../../store/transcript-rows-store.js";

/**
 * Props for the AgentPanelContent component.
 *
 * Receives a single `viewState` discriminated union instead of boolean props.
 * Template switches on `viewState.kind` — no boolean soup, no impossible states.
 */
export interface AgentPanelContentProps {
	readonly panelId: string;
	readonly viewState: PanelViewState;
	readonly sessionId: string | null;
	readonly sceneEntries?: readonly AgentPanelSceneEntryModel[];
	readonly rowsProjectionOverride?: TranscriptRowsState | null;
	readonly pendingUserRevealRequestKey?: string | null;
	readonly showLocalPlanningIndicator?: boolean;
	readonly sessionProjectPath: string | null;
	readonly allProjects?: readonly Project[];
	scrollContainer?: HTMLDivElement | null;
	scrollViewport?: HTMLElement | null;
	isAtBottom?: boolean;
	isAtTop?: boolean;
	hasUnreadBelow?: boolean;
	isStreaming?: boolean;
	readonly onProjectSelected?: (project: Project) => void;
	readonly onRetryConnection?: () => void;
	readonly onCancelConnection?: () => void;
	readonly agentIconSrc?: string;
	/** When true, the transcript's planning placeholder shows the Claude working spark. */
	readonly showWorkingSpark?: boolean;
	readonly planningPlaceholderPresentation?: {
		readonly label: string;
		readonly agentIconSrc: string | null;
		readonly showWorkingSpark: boolean;
	} | null;
	readonly isFullscreen?: boolean;
	readonly availableAgents?: AgentInfo[];
	readonly effectiveTheme?: "light" | "dark";
	readonly modifiedFilesState?: ModifiedFilesState | null;
	readonly onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	readonly onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	readonly onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	readonly onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	readonly onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	readonly onReview?: (event: AgentPanelReviewActionEvent) => void;
	readonly isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
}
