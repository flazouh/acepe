import type { AgentPanelActionDescriptor } from "./agent-panel-action-contract";
import type { AgentPanelComposerModel } from "./agent-panel-composer-model";
import type { AgentPanelConversationModel } from "./agent-panel-conversation-model";
import type { AgentPanelSidebarModel } from "./agent-panel-sidebar-model";

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
}
