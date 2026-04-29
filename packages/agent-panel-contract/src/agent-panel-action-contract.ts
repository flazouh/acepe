type ValueOf<T> = T[keyof T];

export const AGENT_PANEL_ACTION_IDS = {
	header: {
		copySessionMarkdown: "header.copySessionMarkdown",
		openInFinder: "header.openInFinder",
		toggleFullscreen: "header.toggleFullscreen",
		closePanel: "header.closePanel",
		createIssueReport: "header.createIssueReport",
	},
	composer: {
		submit: "composer.submit",
		attachFile: "composer.attachFile",
		stop: "composer.stop",
		selectModel: "composer.selectModel",
	},
	review: {
		nextFile: "review.nextFile",
		previousFile: "review.previousFile",
		openFullscreen: "review.openFullscreen",
		exitReview: "review.exitReview",
	},
	worktree: {
		create: "worktree.create",
		close: "worktree.close",
		remove: "worktree.remove",
		toggleDefault: "worktree.toggleDefault",
	},
	plan: {
		openDialog: "plan.openDialog",
		toggleSidebar: "plan.toggleSidebar",
		refresh: "plan.refresh",
	},
	permission: {
		allow: "permission.allow",
		deny: "permission.deny",
		answerQuestion: "permission.answerQuestion",
	},
	queue: {
		openItem: "queue.openItem",
		dismissItem: "queue.dismissItem",
	},
	attachment: {
		selectTab: "attachment.selectTab",
		closeTab: "attachment.closeTab",
		resizePane: "attachment.resizePane",
	},
	browser: {
		openSidebar: "browser.openSidebar",
		closeSidebar: "browser.closeSidebar",
		refresh: "browser.refresh",
	},
	status: {
		resume: "status.resume",
		retry: "status.retry",
		archive: "status.archive",
		install: "status.install",
	},
} as const;

type HeaderActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.header>;
type ComposerActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.composer>;
type ReviewActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.review>;
type WorktreeActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.worktree>;
type PlanActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.plan>;
type PermissionActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.permission>;
type QueueActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.queue>;
type AttachmentActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.attachment>;
type BrowserActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.browser>;
type StatusActionId = ValueOf<typeof AGENT_PANEL_ACTION_IDS.status>;
type AttachmentScopedActionId = `${AttachmentActionId}:${string}`;

export type AgentPanelActionId =
	| HeaderActionId
	| ComposerActionId
	| ReviewActionId
	| WorktreeActionId
	| PlanActionId
	| PermissionActionId
	| QueueActionId
	| AttachmentActionId
	| AttachmentScopedActionId
	| BrowserActionId
	| StatusActionId;

export type AgentPanelActionState = "enabled" | "disabled" | "busy" | "hidden";

export interface AgentPanelActionDescriptor {
	id: AgentPanelActionId;
	label?: string;
	description?: string | null;
	state?: AgentPanelActionState;
	disabledReason?: string | null;
	destructive?: boolean;
}

export type AgentPanelActionCallbacks = Partial<
	Record<AgentPanelActionId, () => void>
>;
