import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { AgentInfo } from "../../../logic/agent-manager.js";
import type { PanelViewState } from "../../../logic/panel-visibility";
import type { Project } from "../../../logic/project-manager.svelte";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";

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
	readonly sessionEntries?: readonly SessionEntry[];
	readonly sceneEntries?: readonly AgentPanelSceneEntryModel[];
	readonly sessionProjectPath: string | null;
	readonly allProjects?: readonly Project[];
	scrollContainer?: HTMLDivElement | null;
	scrollViewport?: HTMLElement | null;
	isAtBottom?: boolean;
	isAtTop?: boolean;
	isStreaming?: boolean;
	readonly onProjectSelected?: (project: Project) => void;
	readonly onRetryConnection?: () => void;
	readonly onCancelConnection?: () => void;
	readonly agentIconSrc?: string;
	readonly isFullscreen?: boolean;
	readonly availableAgents?: AgentInfo[];
	readonly effectiveTheme?: "light" | "dark";
	readonly modifiedFilesState?: ModifiedFilesState | null;
	readonly turnState?: TurnState;
	readonly isWaitingForResponse?: boolean;
}
