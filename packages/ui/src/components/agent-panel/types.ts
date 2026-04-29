/**
 * Presentational types for the shared AgentPanel components.
 * No Tauri, store, or desktop dependencies.
 */

export type AgentSessionStatus =
	| "empty"
	| "warming"
	| "connected"
	| "error"
	| "idle"
	| "running"
	| "done";
export type AgentToolStatus =
	| "pending"
	| "running"
	| "done"
	| "error"
	| "blocked"
	| "cancelled"
	| "degraded";
export type AgentToolPresentationState =
	| "resolved"
	| "pending_operation"
	| "degraded_operation";

/**
 * Canonical tool kind — maps to icon + label in agent-tool-row.
 * Mirrors the desktop's ToolKind union.
 */
export type AgentToolKind =
	| "read"
	| "edit"
	| "delete"
	| "write"
	| "execute"
	| "search"
	| "fetch"
	| "web_search"
	| "think"
	| "skill"
	| "task"
	| "task_output"
	| "browser"
	| "sql"
	| "unclassified"
	| "other";

export interface AgentUserEntry {
	id: string;
	type: "user";
	text: string;
}

export interface AgentAssistantEntry {
	id: string;
	type: "assistant";
	markdown: string;
	isStreaming?: boolean;
}

/** One file/replace hunk in an edit tool — used by {@link AgentToolEdit}. */
export interface AgentToolEditDiffEntry {
	filePath?: string | null;
	fileName?: string | null;
	additions?: number;
	deletions?: number;
	oldString?: string | null;
	newString?: string | null;
}

export interface AgentToolEntry {
	id: string;
	type: "tool_call";
	kind?: AgentToolKind;
	title: string;
	subtitle?: string;
	detailsText?: string | null;
	scriptText?: string | null;
	/** Populated for `kind === "edit"` from session tool arguments (drives {@link AgentToolEdit}). */
	editDiffs?: readonly AgentToolEditDiffEntry[];
	/** Absolute or relative file path — used to render a FilePathBadge */
	filePath?: string;
	sourceExcerpt?: string | null;
	sourceRangeLabel?: string | null;
	status: AgentToolStatus;
	// Execute-specific
	command?: string | null;
	stdout?: string | null;
	stderr?: string | null;
	exitCode?: number;
	// Search-specific
	query?: string | null;
	searchPath?: string;
	searchFiles?: string[];
	searchResultCount?: number;
	// Fetch-specific
	url?: string | null;
	resultText?: string | null;
	// Web search-specific
	webSearchLinks?: AgentWebSearchLink[];
	webSearchSummary?: string | null;
	skillName?: string | null;
	skillArgs?: string | null;
	skillDescription?: string | null;
	// Task-specific
	taskDescription?: string | null;
	taskPrompt?: string | null;
	taskResultText?: string | null;
	taskChildren?: AnyAgentEntry[];
	presentationState?: AgentToolPresentationState;
	degradedReason?: string | null;
	todos?: AgentTodoItem[];
	question?: AgentQuestion | null;
	lintDiagnostics?: LintDiagnostic[];
}

export interface AgentThinkingEntry {
	id: string;
	type: "thinking";
	durationMs?: number | null;
}

export type AnyAgentEntry =
	| AgentUserEntry
	| AgentAssistantEntry
	| AgentToolEntry
	| AgentThinkingEntry;

/** Web search link for display */
export interface AgentWebSearchLink {
	title: string;
	url: string;
	domain: string;
	pageAge?: string;
}

/** Todo item status */
export type AgentTodoStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "cancelled";

/** Normalized todo item for display */
export interface AgentTodoItem {
	content: string;
	activeForm?: string | null;
	status: AgentTodoStatus;
	duration?: number | null;
}

export interface AgentPanelQueuedMessageAttachment {
	id: string;
	displayName: string;
	extension?: string | null;
	kind: "file" | "image" | "folder" | "other";
}

export interface AgentPanelQueuedMessage {
	id: string;
	content: string;
	attachmentCount: number;
	attachments?: readonly AgentPanelQueuedMessageAttachment[];
}

/** Normalized question option */
export interface AgentQuestionOption {
	label: string;
	description?: string | null;
}

/** Normalized question for display */
export interface AgentQuestion {
	question: string;
	header?: string | null;
	options?: AgentQuestionOption[] | null;
	multiSelect?: boolean;
}

/** Single diagnostic entry for Read Lints tool display */
export interface LintDiagnostic {
	filePath?: string | null;
	line?: number | null;
	message?: string | null;
	severity?: string | null;
}

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

export type AgentPanelSessionStatus = AgentSessionStatus;

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

export interface AgentPanelComposerAttachment {
	id: string;
	label: string;
	kind: "file" | "folder" | "image" | "other";
	detail?: string | null;
}

export interface AgentPanelComposerSelectedModel {
	id: string;
	label: string;
	subtitle?: string | null;
	projectLabel?: string | null;
}

export interface AgentPanelComposerCopy {
	attachLabel?: string | null;
	modelLabel?: string | null;
	submitLabel?: string | null;
	stopLabel?: string | null;
}

export interface AgentPanelComposerModel {
	draftText: string;
	placeholder: string;
	submitLabel: string;
	canSubmit: boolean;
	disabledReason?: string | null;
	isWaitingForSession?: boolean;
	isStreaming?: boolean;
	selectedModel?: AgentPanelComposerSelectedModel | null;
	attachments?: readonly AgentPanelComposerAttachment[];
	actions: readonly AgentPanelActionDescriptor[];
	copy?: AgentPanelComposerCopy | null;
}

import type { PrChecksItem } from "../pr-checks/types.js";

export interface AgentPanelPrCommitItem {
	sha: string;
	message: string;
	insertions?: number;
	deletions?: number;
	onClick?: (event: MouseEvent) => void;
}

export interface AgentPanelPrCardModel {
	mode: "pr" | "streaming" | "creating" | "pending";
	number?: number | null;
	title?: string | null;
	state?: "OPEN" | "CLOSED" | "MERGED" | null;
	additions?: number;
	deletions?: number;
	descriptionHtml?: string | null;
	commits?: readonly AgentPanelPrCommitItem[];
	checks?: readonly PrChecksItem[];
	isChecksLoading?: boolean;
	hasResolvedChecks?: boolean;
	checksCollapseThreshold?: number;
	onOpenCheck?: (check: PrChecksItem, event: MouseEvent) => void;
	isStreaming?: boolean;
	generatingLabel?: string;
	creatingLabel?: string;
	onOpen?: (event: MouseEvent) => void;
}

export type AgentPanelFileReviewStatus =
	| "accepted"
	| "partial"
	| "denied"
	| "unreviewed";

export interface AgentPanelModifiedFileItem {
	id: string;
	filePath: string;
	fileName?: string | null;
	reviewStatus?: AgentPanelFileReviewStatus;
	additions: number;
	deletions: number;
	onSelect?: () => void;
}

export type ReviewWorkspaceFileItem = AgentPanelModifiedFileItem;

export function getReviewWorkspaceDefaultIndex(
	files: readonly ReviewWorkspaceFileItem[],
): number | null {
	if (files.length === 0) {
		return null;
	}

	for (let index = 0; index < files.length; index += 1) {
		const reviewStatus = files[index].reviewStatus ?? "unreviewed";
		if (reviewStatus !== "accepted") {
			return index;
		}
	}

	return 0;
}

export function resolveReviewWorkspaceSelectedIndex(
	files: readonly ReviewWorkspaceFileItem[],
	selectedIndex?: number | null,
): number | null {
	if (files.length === 0) {
		return null;
	}

	if (selectedIndex === undefined || selectedIndex === null) {
		return getReviewWorkspaceDefaultIndex(files);
	}

	if (selectedIndex < 0 || selectedIndex >= files.length) {
		return getReviewWorkspaceDefaultIndex(files);
	}

	return selectedIndex;
}

export interface AgentPanelModifiedFilesTrailingModel {
	reviewLabel: string;
	onReview?: () => void;
	keepState: "enabled" | "disabled" | "applied";
	keepLabel: string;
	appliedLabel?: string;
	onKeep?: () => void;
	reviewedCount: number;
	totalCount: number;
}

export type AgentPanelConversationEntry = AnyAgentEntry;

export interface AgentPanelConversationModel {
	entries: readonly AgentPanelConversationEntry[];
	isStreaming: boolean;
	isAtTop?: boolean;
	isAtBottom?: boolean;
}

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
	selectActionId?: AgentPanelActionId | null;
	closeActionId?: AgentPanelActionId | null;
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

export type AgentPanelSceneEntryModel = AgentPanelConversationEntry;

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
