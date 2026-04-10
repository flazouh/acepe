import type { AgentPanelActionDescriptor } from "./agent-panel-action-contract";

export interface AgentPanelPlanSidebarItem {
	id: string;
	label: string;
	status?: "pending" | "in_progress" | "done" | "blocked";
	description?: string | null;
}

export interface AgentPanelPlanSidebarModel {
	title: string;
	items: readonly AgentPanelPlanSidebarItem[];
	actions: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelAttachedFileTab {
	id: string;
	title: string;
	path?: string | null;
	language?: string | null;
	contentPreview?: string | null;
	isActive: boolean;
	selectActionId?: import("./agent-panel-action-contract").AgentPanelActionId | null;
	closeActionId?: import("./agent-panel-action-contract").AgentPanelActionId | null;
}

export interface AgentPanelAttachedFilePaneModel {
	tabs: readonly AgentPanelAttachedFileTab[];
	actions: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelBrowserSidebarModel {
	url: string;
	title?: string | null;
	actions: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelSidebarModel {
	plan?: AgentPanelPlanSidebarModel | null;
	attachedFiles?: AgentPanelAttachedFilePaneModel | null;
	browser?: AgentPanelBrowserSidebarModel | null;
}
