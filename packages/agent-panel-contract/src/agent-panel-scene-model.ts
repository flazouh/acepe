import type { AgentPanelActionDescriptor } from "./agent-panel-action-contract.js";
import type { AgentPanelComposerModel } from "./agent-panel-composer-model.js";
import type { AgentPanelConversationModel } from "./agent-panel-conversation-model.js";
import type { AgentPanelSidebarModel } from "./agent-panel-sidebar-model.js";

export type AgentPanelSessionStatus =
	| "empty"
	| "warming"
	| "connected"
	| "error"
	| "idle"
	| "running"
	| "done";

export type AgentPanelLifecycleStatus =
	| "reserved"
	| "activating"
	| "ready"
	| "reconnecting"
	| "detached"
	| "failed"
	| "archived";

export type AgentPanelRecommendedAction =
	| "send"
	| "resume"
	| "retry"
	| "archive"
	| "wait"
	| "none";

export type AgentPanelRecoveryPhase =
	| "none"
	| "activating"
	| "reconnecting"
	| "detached"
	| "failed"
	| "archived";

export interface AgentPanelActionabilityModel {
	canSend: boolean;
	canResume: boolean;
	canRetry: boolean;
	canArchive: boolean;
	canConfigure: boolean;
	recommendedAction: AgentPanelRecommendedAction;
	recoveryPhase: AgentPanelRecoveryPhase;
	compactStatus: AgentPanelLifecycleStatus;
}

export interface AgentPanelLifecycleModel {
	status: AgentPanelLifecycleStatus;
	detachedReason?: string | null;
	failureReason?: string | null;
	errorMessage?: string | null;
	actionability: AgentPanelActionabilityModel;
}

export interface AgentPanelBadge {
	id: string;
	label: string;
	tone?: "neutral" | "info" | "success" | "warning" | "danger";
}

export interface AgentPanelMetaItem {
	id: string;
	label: string;
	value?: string | null;
}

export interface AgentPanelHeaderModel {
	title: string;
	subtitle?: string | null;
	status: AgentPanelSessionStatus;
	agentIconSrc?: string | null;
	agentLabel?: string | null;
	projectLabel?: string | null;
	projectColor?: string | null;
	sequenceId?: number | null;
	branchLabel?: string | null;
	badges?: readonly AgentPanelBadge[];
	actions: readonly AgentPanelActionDescriptor[];
}

export type AgentPanelStripKind =
	| "modified_files"
	| "queue"
	| "todo_header"
	| "permission_bar"
	| "plan_header";

export interface AgentPanelStripModel {
	id: string;
	kind: AgentPanelStripKind;
	title: string;
	description?: string | null;
	items?: readonly AgentPanelMetaItem[];
	actions: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelCardModel {
	id: string;
	kind: "review" | "pr_status" | "worktree_setup" | "install" | "error";
	title: string;
	description?: string | null;
	meta?: readonly AgentPanelMetaItem[];
	actions: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelChromeModel {
	isFullscreen?: boolean;
	isFocused?: boolean;
	showScrollToBottom?: boolean;
	showTerminalDrawer?: boolean;
}

export interface AgentPanelFooterModel {
	branchLabel?: string | null;
	showBrowserToggle?: boolean;
	browserActive?: boolean;
	showTerminalToggle?: boolean;
	terminalActive?: boolean;
	terminalDisabled?: boolean;
}

export interface AgentPanelTerminalTab {
	id: string;
	label: string;
	isActive: boolean;
}

export interface AgentPanelTerminalModel {
	tabs: readonly AgentPanelTerminalTab[];
	height?: number | null;
}

export interface AgentPanelReviewFileTab {
	id: string;
	label: string;
	isActive: boolean;
}

export interface AgentPanelReviewModel {
	fileTabs: readonly AgentPanelReviewFileTab[];
	currentFileIndex: number;
	totalFiles: number;
	currentHunkIndex?: number | null;
	totalHunks?: number | null;
}

export interface AgentPanelSceneModel {
	panelId: string;
	status: AgentPanelSessionStatus;
	lifecycle?: AgentPanelLifecycleModel | null;
	header: AgentPanelHeaderModel;
	conversation: AgentPanelConversationModel;
	composer?: AgentPanelComposerModel | null;
	strips?: readonly AgentPanelStripModel[];
	cards?: readonly AgentPanelCardModel[];
	sidebars?: AgentPanelSidebarModel | null;
	chrome?: AgentPanelChromeModel | null;
	footer?: AgentPanelFooterModel | null;
	terminal?: AgentPanelTerminalModel | null;
	review?: AgentPanelReviewModel | null;
}
