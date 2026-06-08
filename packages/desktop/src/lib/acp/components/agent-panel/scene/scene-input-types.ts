import type {
	AgentPanelActionDescriptor,
	AgentPanelChromeModel,
} from "@acepe/ui/agent-panel/types";
import type { SessionPlanResponse } from "../../../../services/claude-history.js";
import type { SessionStatus } from "../../../application/dto/session-status.js";
import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";

export interface DesktopAgentPanelHeaderInput {
	title: string;
	subtitle?: string | null;
	agentLabel?: string | null;
	projectLabel?: string | null;
	projectColor?: string | null;
	branchLabel?: string | null;
	badges?: readonly {
		id: string;
		label: string;
		tone?: "neutral" | "info" | "success" | "warning" | "danger";
	}[];
	actions?: readonly AgentPanelActionDescriptor[];
}

export interface DesktopComposerInput {
	draftText: string;
	placeholder: string;
	submitLabel: string;
	canSubmit: boolean;
	disabledReason?: string | null;
	isWaitingForSession?: boolean;
	isStreaming?: boolean;
	selectedModelId?: string | null;
	selectedModelLabel?: string | null;
	selectedModelSubtitle?: string | null;
	projectLabel?: string | null;
	attachments?: readonly {
		id: string;
		label: string;
		kind: "file" | "folder" | "image" | "other";
		detail?: string | null;
	}[];
	showStop?: boolean;
}

export interface DesktopPrCardInput {
	description: string;
	filesChanged?: number | null;
	checksLabel?: string | null;
	isBusy?: boolean;
}

export interface DesktopWorktreeCardInput {
	description: string;
	stageLabel?: string | null;
	progressLabel?: string | null;
}

export interface DesktopInstallCardInput {
	description: string;
	stageLabel?: string | null;
	progressLabel?: string | null;
}

export interface DesktopErrorCardInput {
	title: string;
	description: string;
	details?: string | null;
}

export interface BuildDesktopAgentPanelSceneOptions {
	panelId: string;
	sessionStatus: SessionStatus | null | undefined;
	entries: readonly SessionEntry[];
	turnState?: TurnState;
	header: DesktopAgentPanelHeaderInput;
	composer?: DesktopComposerInput | null;
	modifiedFilesState?: ModifiedFilesState | null;
	plan?: SessionPlanResponse | null;
	showPlanSidebar?: boolean;
	prCard?: DesktopPrCardInput | null;
	worktreeCard?: DesktopWorktreeCardInput | null;
	installCard?: DesktopInstallCardInput | null;
	errorCard?: DesktopErrorCardInput | null;
	chrome?: AgentPanelChromeModel | null;
}
