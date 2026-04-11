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
	agentLabel?: string | null;
	projectLabel?: string | null;
	projectColor?: string | null;
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
