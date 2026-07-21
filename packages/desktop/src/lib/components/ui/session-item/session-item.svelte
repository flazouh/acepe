<script lang="ts">
import type { ActivityEntryQuestion } from "@acepe/ui";
import {
	ActivityEntry,
	HugeiconsIcon,
	LoadingIcon,
	PrChecksSummary,
	ProjectLetterBadge,
	Selector,
} from "@acepe/ui";
import {
	SESSION_PROJECT_BADGE_CLASS,
	SESSION_PROJECT_BADGE_SIZE,
	shouldShowSessionProjectBadge,
} from "@acepe/ui/project-letter-badge";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ResultAsync } from "neverthrow";
import { tick } from "svelte";
import { buildQueueItemQuestionUiState } from "$lib/acp/components/session-attention/question-ui-state.js";
import PrStateIcon from "$lib/acp/components/pr-state-icon.svelte";
import { toast } from "svelte-sonner";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import { getSessionListHighlightContext } from "$lib/acp/components/session-list/session-list-highlight-context.js";
import {
	extractPermissionCommand,
	extractPermissionFilePath,
} from "$lib/acp/components/tool-calls/permission-display.js";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import {
	AGENT_ICON_BASE_CLASS,
	UNKNOWN_TIME_TEXT,
} from "$lib/acp/constants/thread-list-constants.js";
import { formatTimeAgo } from "$lib/acp/logic/thread-list-date-utils.js";
import {
	getPanelStore,
	getInteractionStore,
	getQuestionSelectionStore,
	getQuestionStore,
	getUnseenStore,
} from "$lib/acp/store/index.js";
import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";
import { formatSessionTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { extractTodoProgressFromToolCall } from "$lib/acp/components/session-list/session-list-logic.js";
import {
	isActiveCompactActivityKind,
	projectSessionPreviewActivity,
} from "$lib/acp/components/activity-entry/activity-entry-projection.js";
import { Input } from "$lib/components/ui/input/index.js";
import { makeWorkspaceRelative } from "$lib/acp/utils/path-utils.js";
import { revealInFinder, tauriClient } from "$lib/utils/tauri-client/index.js";
import type { SessionDisplayItem as BaseSessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import PrChecksSurface from "$lib/acp/components/shared/pr-checks-surface.svelte";

const logger = createLogger({ id: "session-item", name: "Session Item" });

const isDev = import.meta.env.DEV;

type SessionDisplayItem = BaseSessionDisplayItem & {
	worktreeDeleted?: boolean;
};

interface Props {
	thread: SessionDisplayItem;
	selected?: boolean;
	isOpen?: boolean;
	onSelect?: (session: SessionDisplayItem) => void;
	depth?: number;
	hasChildren?: boolean;
	isExpanded?: boolean;
	onToggleExpand?: () => void;
	onArchive?: (session: SessionDisplayItem) => void | Promise<void>;
	onRename?: (title: string) => void | Promise<void>;
	onCopyTranscriptMarkdown?: (sessionId: string) => void | Promise<void>;
	onCopyTranscriptJson?: (sessionId: string) => void | Promise<void>;
	onOpenTranscriptInAcepe?: (session: SessionDisplayItem) => void | Promise<void>;
	onOpenPr?: () => void;
}

let {
	thread: session,
	selected = false,
	isOpen = false,
	onSelect,
	depth = 0,
	hasChildren = false,
	isExpanded = false,
	onToggleExpand,
	onArchive,
	onRename,
	onCopyTranscriptMarkdown,
	onCopyTranscriptJson,
	onOpenTranscriptInAcepe,
	onOpenPr,
}: Props = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const interactionStore = getInteractionStore();
const questionStore = getQuestionStore();
const selectionStore = getQuestionSelectionStore();
const unseenStore = getUnseenStore();
const worktreeDeleted = $derived(session.worktreeDeleted ?? false);
const QUESTION_COLORS = [
	Colors[COLOR_NAMES.GREEN],
	Colors[COLOR_NAMES.RED],
	Colors[COLOR_NAMES.PINK],
	Colors[COLOR_NAMES.ORANGE],
];
let archiveConfirmOpen = $state(false);

const agentIconBaseClass = AGENT_ICON_BASE_CLASS;

function formatTimeAgoSafe(date: Date): string {
	const result = formatTimeAgo(date);
	return result.isOk() ? result.value : UNKNOWN_TIME_TEXT;
}

function getSessionDisplayName(item: SessionDisplayItem): string {
	const rawTitle = item.title || "";

	logger.debug("getSessionDisplayName", {
		raw: rawTitle.substring(0, 100),
		formatted: formatSessionTitleForDisplay(item.title, item.projectName).substring(0, 100),
	});

	return formatSessionTitleForDisplay(item.title, item.projectName);
}

function handleSelect() {
	if (isRenaming) {
		return;
	}
	onSelect?.(session);
}

function handleChevronClick(event: MouseEvent) {
	event.stopPropagation();
	onToggleExpand?.();
}

async function handleArchive() {
	await onArchive?.(session);
	archiveConfirmOpen = false;
}

function handleArchiveClick(event: MouseEvent) {
	event.stopPropagation();
	archiveConfirmOpen = true;
}

function handleCancelArchive(event: MouseEvent) {
	event.stopPropagation();
	archiveConfirmOpen = false;
}

function handleConfirmArchive(event: MouseEvent) {
	event.stopPropagation();
	void handleArchive();
}

async function handleCopyText(text: string, description: string) {
	await copyTextToClipboard(text).match(
		() => toast.success("Copied to clipboard"),
		(err) => toast.error(`Failed to copy ${description}: ${err.message}`)
	);
}

async function handleCopyTitle() {
	await handleCopyText(displayTitle, "title");
}

async function handleCopySessionId() {
	await handleCopyText(session.id, "session ID");
}

async function handleCopyTranscriptMarkdown() {
	await onCopyTranscriptMarkdown?.(session.id);
}

async function handleCopyTranscriptJson() {
	await onCopyTranscriptJson?.(session.id);
}

async function handleOpenTranscriptInAcepe() {
	await onOpenTranscriptInAcepe?.(session);
}

async function handleRevealRawTranscriptFile() {
	const sourcePath = session.sourcePath?.trim();
	if (sourcePath) {
		await revealInFinder(sourcePath).match(
			() => undefined,
			(err) => toast.error(`Failed to reveal transcript: ${err.message}`)
		);
		return;
	}

	await tauriClient.shell
		.getSessionFilePath(session.id, session.projectPath)
		.andThen((path) => revealInFinder(path))
		.match(
			() => undefined,
			(err) => toast.error(`Failed to reveal transcript: ${err.message}`)
		);
}

async function handleRevealWorktreeFolder() {
	const worktreePath = session.worktreePath?.trim();
	if (!worktreePath) {
		return;
	}

	await revealInFinder(worktreePath).match(
		() => undefined,
		(err) => toast.error(`Failed to reveal worktree: ${err.message}`)
	);
}

async function handleOpenStreamingLog() {
	await tauriClient.shell.openStreamingLog(session.id).match(
		() => undefined,
		(err) => toast.error(`Failed to open streaming log: ${err.message}`)
	);
}

async function handleOpenPullRequest() {
	const prUrl = session.linkedPr?.url?.trim();
	if (prUrl) {
		await ResultAsync.fromPromise(
			openUrl(prUrl),
			(error) => new Error(error instanceof Error ? error.message : String(error))
		).match(
			() => undefined,
			(err) => toast.error(`Failed to open pull request: ${err.message}`)
		);
		return;
	}

	onOpenPr?.();
}

function handleOpenPr(event: MouseEvent) {
	event.stopPropagation();
	onOpenPr?.();
}

function handleRowFocusIn(event: FocusEvent) {
	isRowHovered = true;
	highlightCtx?.updateHighlight(event.currentTarget as HTMLElement);
}

function handleRowFocusOut(event: FocusEvent) {
	const nextTarget = event.relatedTarget;
	if (nextTarget instanceof Node && rowElement?.contains(nextTarget)) {
		return;
	}
	isRowHovered = false;
	highlightCtx?.clearHighlight();
}

function openRenameEditor() {
	if (!onRename) {
		return;
	}

	renameDraft = displayTitle;
	isRenaming = true;
	isActionsMenuOpen = false;
	void tick().then(() => {
		if (renameInputRef) {
			renameInputRef.focus();
			renameInputRef.select();
		}
	});
}

function closeRenameEditor() {
	isRenaming = false;
	renameDraft = "";
}

function submitRename() {
	if (!onRename) {
		closeRenameEditor();
		return;
	}

	const trimmedTitle = renameDraft.trim();
	const currentTitle = displayTitle;
	if (trimmedTitle === "" || trimmedTitle === currentTitle) {
		closeRenameEditor();
		return;
	}

	closeRenameEditor();
	void onRename(trimmedTitle);
}

function handleRenameKeydown(event: KeyboardEvent) {
	if (event.key === "Enter") {
		event.preventDefault();
		submitRename();
		return;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		closeRenameEditor();
	}
}

const basePadding = 0;
const paddingLeft = $derived(`${basePadding + depth * 16}px`);

const activePanel = $derived(panelStore?.getPanelBySessionId(session.id) ?? null);
const hasUnseenCompletion = $derived(activePanel ? unseenStore.isUnseen(activePanel.id) : false);
const sessionListPresentation = $derived.by(() =>
	sessionStore.presentation.getSessionListItemPresentation({
		sessionId: session.id,
		interactionStore,
		hasUnseenCompletion,
		active: isOpen,
	})
);
const sessionConnectionError = $derived(sessionListPresentation.connectionError);
const currentModeId = $derived(sessionListPresentation.currentModeId);
const currentStreamingToolCall = $derived(sessionListPresentation.currentStreamingToolCall);
const lastToolCall = $derived(sessionListPresentation.lastToolCall);
const lastTodoToolCall = $derived(sessionListPresentation.lastTodoToolCall);
const currentToolKind = $derived(sessionListPresentation.currentToolKind);
const lastToolKind = $derived(sessionListPresentation.lastToolKind);
const liveSessionState = $derived(sessionListPresentation.liveSessionState);
const sessionWorkProjection = $derived(sessionListPresentation.sessionWorkProjection);
const previewActivityKind = $derived(sessionListPresentation.previewActivityKind);
const pendingQuestion = $derived(sessionListPresentation.pendingQuestion);
const pendingPermission = $derived(sessionListPresentation.pendingPermission);
const pendingPlanApproval = $derived(sessionListPresentation.pendingPlanApproval);
const questionId = $derived(pendingQuestion?.tool?.callID ?? pendingQuestion?.id ?? "");
let currentQuestionIndex = $state(0);
let lastQuestionId = "";

$effect(() => {
	const pendingQuestionId = pendingQuestion?.id;

	if (!pendingQuestionId) {
		lastQuestionId = "";
		currentQuestionIndex = 0;
		return;
	}

	if (pendingQuestionId === lastQuestionId) {
		return;
	}

	lastQuestionId = pendingQuestionId;
	currentQuestionIndex = 0;
});

const questionUiState = $derived.by(() =>
	buildQueueItemQuestionUiState({
		pendingQuestion,
		questionId,
		currentQuestionIndex,
		questionColors: QUESTION_COLORS,
		selectionReader: {
			hasSelections(questionIdValue, questionIndex) {
				return selectionStore.hasSelections(questionIdValue, questionIndex);
			},
			isOptionSelected(questionIdValue, questionIndex, optionLabel) {
				return selectionStore.isOptionSelected(questionIdValue, questionIndex, optionLabel);
			},
			isOtherActive(questionIdValue, questionIndex) {
				return selectionStore.isOtherActive(questionIdValue, questionIndex);
			},
			getOtherText(questionIdValue, questionIndex) {
				return selectionStore.getOtherText(questionIdValue, questionIndex);
			},
		},
	})
);
const totalQuestions = $derived(questionUiState.totalQuestions);
const hasMultipleQuestions = $derived(questionUiState.hasMultipleQuestions);
const currentQuestion = $derived(questionUiState.currentQuestion);
const currentQuestionAnswered = $derived(questionUiState.currentQuestionAnswered);
const questionProgress = $derived(questionUiState.questionProgress);
const currentQuestionOptions = $derived(questionUiState.currentQuestionOptions);
const isSingleQuestionSingleSelect = $derived(questionUiState.isSingleQuestionSingleSelect);
const showOtherInput = $derived(questionUiState.showOtherInput);
const otherText = $derived(questionUiState.otherText);
const canSubmit = $derived(questionUiState.canSubmit);
const showSubmitButton = $derived(questionUiState.showSubmitButton);
const currentAnswerDisplay = $derived.by(() => {
	if (!currentQuestion || !questionId) {
		return "";
	}

	return selectionStore
		.getAnswers(questionId, currentQuestionIndex, currentQuestion.multiSelect)
		.join(", ");
});
const permissionDisplay = $derived.by(() => {
	if (!pendingPermission) {
		return null;
	}

	const command = extractPermissionCommand(pendingPermission);
	const filePath = extractPermissionFilePath(pendingPermission);
	const relativePath = filePath ? makeWorkspaceRelative(filePath, session.projectPath) : null;
	const permissionVerb = pendingPermission.permission.split(" ")[0] ?? pendingPermission.permission;

	if (relativePath) {
		return `${permissionVerb} ${relativePath}`;
	}

	if (command) {
		return `${permissionVerb} ${command}`;
	}

	return pendingPermission.permission;
});
const statusText = $derived.by(() => {
	if (pendingQuestion) {
		return null;
	}

	if (pendingPermission) {
		return permissionDisplay;
	}

	if (pendingPlanApproval) {
		return pendingPlanApproval.source === "exit_plan_mode"
			? "Review plan before building"
			: "Plan approval needed";
	}

	if (sessionWorkProjection.hasError) {
		return sessionConnectionError ?? "Connection error";
	}

	return null;
});
const showStatusShimmer = $derived(false);
const uiCurrentQuestion = $derived<ActivityEntryQuestion | null>(
	currentQuestion
		? {
				question: currentQuestion.question,
				multiSelect: currentQuestion.multiSelect,
				options: currentQuestion.options.map((option) => ({ label: option.label })),
			}
		: null
);
const todoProgress = $derived.by(() => {
	const todoProgressInfo = extractTodoProgressFromToolCall(lastTodoToolCall);
	return todoProgressInfo
		? {
				current: todoProgressInfo.current,
				total: todoProgressInfo.total,
				label: todoProgressInfo.label,
			}
		: null;
});
const activityProjection = $derived.by(() => {
	if (!isActiveCompactActivityKind(previewActivityKind)) {
		return null;
	}

	return projectSessionPreviewActivity({
		activityKind: previewActivityKind,
		currentStreamingToolCall,
		currentToolKind,
		lastToolCall,
		lastToolKind,
		todoProgress,
	});
});
const suppressPlanApprovalToolPreview = $derived(pendingPlanApproval !== null);
const projectedIsStreaming = $derived(
	suppressPlanApprovalToolPreview
		? false
		: (activityProjection?.isStreaming ?? previewActivityKind === "streaming")
);
const showSessionWorkingIndicator = $derived(
	!pendingQuestion &&
		!pendingPermission &&
		!pendingPlanApproval &&
		!sessionWorkProjection.hasError &&
		(projectedIsStreaming ||
			previewActivityKind === "thinking" ||
			session.activity?.isStreaming === true)
);
const showSessionFinishedIndicator = $derived(
	!showSessionWorkingIndicator &&
		!pendingQuestion &&
		!pendingPermission &&
		!pendingPlanApproval &&
		!sessionWorkProjection.hasError &&
		sessionWorkProjection.needsReview
);
const activityEntryLatestToolDisplay = $derived(
	suppressPlanApprovalToolPreview ? null : (activityProjection?.latestToolEntry ?? null)
);
const activityEntryFileToolDisplayText = $derived(
	suppressPlanApprovalToolPreview ? null : (activityProjection?.fileToolDisplayText ?? null)
);
const activityEntryToolContent = $derived(
	suppressPlanApprovalToolPreview
		? null
		: activityProjection?.isFileTool
			? null
			: (activityProjection?.toolContent ?? null)
);
const activityEntryShowToolShimmer = $derived(
	suppressPlanApprovalToolPreview ? false : (activityProjection?.showToolShimmer ?? false)
);
const displayTitle = $derived(formatSessionTitleForDisplay(session.title, session.projectName));

const queueTimeAgo = $derived(formatTimeAgoSafe(session.updatedAt ?? session.createdAt));
let isRowHovered = $state(false);
let isActionsMenuOpen = $state(false);
let isRenaming = $state(false);
let renameDraft = $state("");
let renameInputRef = $state<HTMLInputElement | null>(null);
let rowElement: HTMLDivElement | null = null;
const hasCopyTranscriptActions = $derived(
	onCopyTranscriptMarkdown !== undefined || onCopyTranscriptJson !== undefined
);
const canRevealWorktreeFolder = $derived(Boolean(session.worktreePath?.trim()) && !worktreeDeleted);
const canOpenPullRequest = $derived(
	typeof session.prNumber === "number" &&
		((session.linkedPr?.url !== undefined && session.linkedPr.url !== null) ||
			onOpenPr !== undefined)
);
const actionsVisible = $derived(isRowHovered || isActionsMenuOpen || selected || isOpen);
const _actionsVisibilityClass = $derived(
	actionsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
);

$effect(() => {
	if (!actionsVisible || rowElement === null) {
		return;
	}

	const currentRow = rowElement;
	let rafId = 0;

	const tick = () => {
		// Defensive sync for flaky/missed pointerleave events.
		if (!isActionsMenuOpen && !currentRow.matches(":hover")) {
			isRowHovered = false;
			return;
		}
		rafId = window.requestAnimationFrame(tick);
	};

	rafId = window.requestAnimationFrame(tick);
	return () => {
		window.cancelAnimationFrame(rafId);
	};
});

const highlightCtx = getSessionListHighlightContext();

function submitAllAnswers() {
	if (!pendingQuestion || !questionId) return;

	const answers = pendingQuestion.questions.map((question, questionIndex) => ({
		questionIndex,
		answers: selectionStore.getAnswers(questionId, questionIndex, question.multiSelect),
	}));

	selectionStore.clearQuestion(questionId);
	questionStore.reply(pendingQuestion.id, answers, pendingQuestion.questions);
}

function handleOptionSelect(optionLabel: string) {
	if (!pendingQuestion || !questionId || !currentQuestion) return;

	if (currentQuestion.multiSelect) {
		selectionStore.toggleOption(questionId, currentQuestionIndex, optionLabel);
		return;
	}

	selectionStore.setSingleOption(questionId, currentQuestionIndex, optionLabel);

	if (isSingleQuestionSingleSelect) {
		requestAnimationFrame(() => {
			submitAllAnswers();
		});
		return;
	}

	if (hasMultipleQuestions && currentQuestionIndex < totalQuestions - 1) {
		currentQuestionIndex += 1;
	}
}

function handleOtherInput(value: string) {
	if (!questionId) return;
	selectionStore.setOtherText(questionId, currentQuestionIndex, value);

	if (value.trim() && !selectionStore.isOtherActive(questionId, currentQuestionIndex)) {
		selectionStore.setOtherModeActive(questionId, currentQuestionIndex, true);
		if (!currentQuestion?.multiSelect) {
			selectionStore.clearSelections(questionId, currentQuestionIndex);
		}
	}

	if (!value.trim() && selectionStore.isOtherActive(questionId, currentQuestionIndex)) {
		selectionStore.setOtherModeActive(questionId, currentQuestionIndex, false);
	}
}

function handleOtherKeydown(key: string) {
	if (!questionId) return;

	const otherValue = selectionStore.getOtherText(questionId, currentQuestionIndex).trim();

	if (key === "Enter" && otherValue && pendingQuestion) {
		if (totalQuestions === 1) {
			submitAllAnswers();
		} else if (currentQuestionIndex < totalQuestions - 1) {
			currentQuestionIndex += 1;
		} else {
			submitAllAnswers();
		}
	}

	if (key === "Escape") {
		selectionStore.setOtherModeActive(questionId, currentQuestionIndex, false);
	}
}

function handlePrevQuestion() {
	if (currentQuestionIndex > 0) {
		currentQuestionIndex -= 1;
	}
}

function handleNextQuestion() {
	if (currentQuestionIndex < totalQuestions - 1) {
		currentQuestionIndex += 1;
	}
}
</script>

{#if session.linkedPr}
	{#key `${session.projectPath}:${session.linkedPr.prNumber}`}
		<PrChecksSurface
			projectPath={session.projectPath}
			prNumber={session.linkedPr.prNumber}
			surfaceId={`session-item:${session.id}`}
		/>
	{/key}
{/if}

<div
	role="none"
	bind:this={rowElement}
	class="group relative z-10 flex cursor-pointer items-stretch gap-1 overflow-hidden py-0 transition-opacity {isOpen
		? 'opacity-100'
		: 'opacity-55'}"
	style="padding-left: {paddingLeft}; padding-right: {paddingLeft}"
	data-testid="session-list-item"
	data-session-id={session.id}
	onpointerenter={(e) => {
		isRowHovered = true;
		highlightCtx?.updateHighlight(e.currentTarget as HTMLElement);
	}}
	onpointerleave={() => {
		isRowHovered = false;
		highlightCtx?.clearHighlight();
	}}
	onfocusin={handleRowFocusIn}
	onfocusout={handleRowFocusOut}
>
			{#if hasChildren}
				<button
					type="button"
					class="shrink-0 self-start mt-1 p-0.5 hover:bg-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onclick={handleChevronClick}
					aria-label={isExpanded ? "Collapse" : "Expand"}
				>
					{#if isExpanded}
						<HugeiconsIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground" />
					{:else}
						<HugeiconsIcon name="chevron-right" class="size-3 shrink-0 text-muted-foreground" />
					{/if}
				</button>
			{/if}

			<div class="flex-1 min-w-0">
				{#snippet agentBadge()}
					{#if showSessionWorkingIndicator}
						<span
							class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-foreground"
							aria-label="Working"
							title="Working"
							data-testid="session-item-working-indicator"
						>
							<LoadingIcon class="shrink-0" size={12} />
						</span>
					{:else if showSessionFinishedIndicator}
						<span
							class="inline-flex h-4 w-4 shrink-0 items-center justify-center"
							style="color: var(--cursor-status-success)"
							aria-label="Ready for review"
							title="Ready for review"
							data-testid="session-item-finished-indicator"
						>
							<HugeiconsIcon name="check-circle-filled" class="size-3 shrink-0" />
						</span>
					{/if}
					<AgentIcon
						agentId={session.agentId ?? "historical-session"}
						class="{agentIconBaseClass} shrink-0 m-0.5"
						size={12}
					/>
					{#if shouldShowSessionProjectBadge(session)}
						<ProjectLetterBadge
							name={session.projectName}
							color={session.projectColor}
							iconSrc={session.projectIconSrc}
							size={SESSION_PROJECT_BADGE_SIZE}
							sequenceId={session.sequenceId}
							showLetter={false}
							class={SESSION_PROJECT_BADGE_CLASS}
						/>
					{/if}
					{#if session.worktreePath}
						<span
							role="img"
							aria-label={worktreeDeleted ? "Worktree deleted" : "Worktree session"}
							class="inline-flex shrink-0 m-0.5 {worktreeDeleted ? 'text-destructive' : 'text-success'}"
						>
							<HugeiconsIcon name="worktree" class="size-3" />
						</span>
					{/if}
					{#if session.prNumber != null}
						<button
							type="button"
							class="inline-flex items-center gap-0.5 rounded-sm pl-0.5 pr-1 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							aria-label={`Open PR #${session.prNumber}`}
							title={`Open PR #${session.prNumber}`}
							onclick={handleOpenPr}
						>
							<PrStateIcon
								state={session.prState ?? "OPEN"}
								size={11}
							/>
							{#if session.linkedPr}
								<PrChecksSummary
									checks={session.linkedPr.checks}
									isLoading={session.linkedPr.isChecksLoading}
									hasResolved={session.linkedPr.hasResolvedChecks}
								/>
							{/if}
							<span class="text-[10px] font-mono leading-none text-muted-foreground">
								#{session.prNumber}
							</span>
						</button>
					{/if}
				{/snippet}

				{#snippet rowActions()}
					<div class="flex items-center shrink-0">
						{#if onArchive}
							{#if archiveConfirmOpen}
								<div class="flex items-center gap-1">
									<button
										type="button"
										class="shrink-0 h-5 w-5 flex items-center justify-center rounded bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										onclick={handleConfirmArchive}
										aria-label="Confirm archive session"
										title="Confirm archive"
									>
										<HugeiconsIcon name="check" class="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										class="shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground/35 transition-colors hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-muted-foreground/35 [&_svg]:transition-colors hover:[&_svg]:text-foreground focus-visible:[&_svg]:text-foreground"
										onclick={handleCancelArchive}
										aria-label="Cancel archive session"
										title="Cancel"
									>
										<HugeiconsIcon name="close" class="h-3.5 w-3.5" />
									</button>
								</div>
							{:else}
								<button
									type="button"
									class="shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground/35 transition-colors hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-muted-foreground/35 [&_svg]:transition-colors hover:[&_svg]:text-foreground focus-visible:[&_svg]:text-foreground"
									onclick={handleArchiveClick}
									aria-label="Archive session"
									title="Archive"
								>
									<HugeiconsIcon name="archive" class="h-3.5 w-3.5" />
								</button>
							{/if}
						{/if}
						<div onclick={(e: MouseEvent) => e.stopPropagation()} role="none">
							<Selector
								bind:open={isActionsMenuOpen}
								align="end"
								variant="ghost"
								triggerSize="icon"
								triggerClass="size-5 [&_svg]:!size-3.5"
								showChevron={false}
								tooltipLabel="Session actions"
								triggerAriaLabel="Session actions"
							>
								{#snippet renderButton()}
									<HugeiconsIcon name="more" />
								{/snippet}

								{#if onRename}
									<DropdownMenu.Item
										onSelect={openRenameEditor}
										class="cursor-pointer"
										data-testid="session-action-rename"
									>
										<HugeiconsIcon name="edit" class="size-3.5 shrink-0" />
										<span class="min-w-0 flex-1 truncate">{"Rename..."}</span>
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
								{/if}
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger
										class="cursor-pointer"
										data-testid="session-action-copy"
									>
										<HugeiconsIcon name="copy" class="size-3.5 shrink-0" />
										<span class="min-w-0 flex-1 truncate">{"Copy"}</span>
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent class="min-w-[210px]">
										<DropdownMenu.Item
											onSelect={handleCopyTitle}
											class="cursor-pointer"
											data-testid="session-action-copy-title"
										>
											<HugeiconsIcon name="file-text" class="size-3.5 shrink-0" />
											<span class="min-w-0 flex-1 truncate">{"Title"}</span>
										</DropdownMenu.Item>
										<DropdownMenu.Item
											onSelect={handleCopySessionId}
											class="cursor-pointer"
											data-testid="session-action-copy-id"
										>
											<HugeiconsIcon name="copy-id" class="size-3.5 shrink-0" />
											<span class="min-w-0 flex-1 truncate">{"Session ID"}</span>
										</DropdownMenu.Item>
										{#if hasCopyTranscriptActions}
											<DropdownMenu.Separator />
											{#if onCopyTranscriptMarkdown}
												<DropdownMenu.Item
													onSelect={handleCopyTranscriptMarkdown}
													class="cursor-pointer"
													data-testid="session-action-copy-markdown"
												>
													<HugeiconsIcon name="file-text" class="size-3.5 shrink-0" />
													<span class="min-w-0 flex-1 truncate">{"Transcript as Markdown"}</span>
												</DropdownMenu.Item>
											{/if}
											{#if onCopyTranscriptJson}
												<DropdownMenu.Item
													onSelect={handleCopyTranscriptJson}
													class="cursor-pointer"
													data-testid="session-action-copy-json"
												>
													<HugeiconsIcon name="code" class="size-3.5 shrink-0" />
													<span class="min-w-0 flex-1 truncate">{"Transcript as JSON"}</span>
												</DropdownMenu.Item>
											{/if}
										{/if}
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>
								{#if onOpenTranscriptInAcepe}
									<DropdownMenu.Item
										onSelect={handleOpenTranscriptInAcepe}
										class="cursor-pointer"
										data-testid="session-action-open-in-acepe"
									>
										<HugeiconsIcon name="app-window" class="size-3.5 shrink-0" />
										<span class="min-w-0 flex-1 truncate">{"View Transcript File"}</span>
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger
										class="cursor-pointer"
										data-testid="session-action-reveal"
									>
										<HugeiconsIcon name="folder" class="size-3.5 shrink-0" />
										<span class="min-w-0 flex-1 truncate">{"Reveal in Finder"}</span>
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent class="min-w-[190px]">
										<DropdownMenu.Item
											onSelect={handleRevealRawTranscriptFile}
											class="cursor-pointer"
											data-testid="session-action-reveal-transcript"
										>
											<HugeiconsIcon name="document" class="size-3.5 shrink-0" />
											<span class="min-w-0 flex-1 truncate">{"Raw Transcript File"}</span>
										</DropdownMenu.Item>
										{#if canRevealWorktreeFolder}
											<DropdownMenu.Item
												onSelect={handleRevealWorktreeFolder}
												class="cursor-pointer"
												data-testid="session-action-reveal-worktree"
											>
												<HugeiconsIcon name="worktree" class="size-3.5 shrink-0" />
												<span class="min-w-0 flex-1 truncate">{"Worktree Folder"}</span>
											</DropdownMenu.Item>
										{/if}
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>
								{#if canOpenPullRequest}
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										onSelect={handleOpenPullRequest}
										class="cursor-pointer"
										data-testid="session-action-open-pr"
									>
										<HugeiconsIcon name="pull-request" class="size-3.5 shrink-0" />
										<span class="min-w-0 flex-1 truncate">
											{`Open Pull Request #${session.prNumber}`}
										</span>
									</DropdownMenu.Item>
								{/if}
								{#if isDev}
									<DropdownMenu.Separator />
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger
											class="cursor-pointer"
											data-testid="session-action-developer"
										>
											<HugeiconsIcon name="terminal" class="size-3.5 shrink-0" />
											<span class="min-w-0 flex-1 truncate">{"Developer"}</span>
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="min-w-[180px]">
											<DropdownMenu.Item
												onSelect={handleOpenStreamingLog}
												class="cursor-pointer"
												data-testid="session-action-open-streaming-log"
											>
												<HugeiconsIcon name="terminal" class="size-3.5 shrink-0" />
												<span class="min-w-0 flex-1 truncate">{"Open Streaming Log"}</span>
											</DropdownMenu.Item>
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
								{/if}
							</Selector>
						</div>
					</div>
				{/snippet}

				{#snippet titleContent()}
					{#if isRenaming}
						<Input
							bind:ref={renameInputRef}
							bind:value={renameDraft}
							type="text"
							class="h-6 border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0"
							onkeydown={handleRenameKeydown}
							onblur={submitRename}
							onclick={(event: MouseEvent) => event.stopPropagation()}
							aria-label="Rename session"
						/>
					{:else}
						<div class="font-medium truncate">
							{displayTitle}
						</div>
					{/if}
				{/snippet}

				<ActivityEntry
					selected={selected || isOpen}
					onSelect={handleSelect}
					slidingHighlight={!!highlightCtx}
					compactPadding={!!highlightCtx}
					mode={null}
					title={displayTitle}
					timeAgo={queueTimeAgo}
					insertions={session.insertions ?? 0}
					deletions={session.deletions ?? 0}
					{titleContent}
					{agentBadge}
					isStreaming={projectedIsStreaming}
					trailingAction={actionsVisible ? rowActions : undefined}
					taskDescription={activityProjection?.taskDescription ?? null}
					taskSubagentSummaries={activityProjection?.taskSubagentSummaries ?? []}
					taskSubagentTools={activityProjection?.taskSubagentTools ?? []}
					latestTaskSubagentTool={activityProjection?.latestTaskSubagentTool ?? null}
					showTaskSubagentList={activityProjection?.showTaskSubagentList ?? false}
					latestToolDisplay={activityEntryLatestToolDisplay}
					fileToolDisplayText={activityEntryFileToolDisplayText}
					toolContent={activityEntryToolContent}
					showToolShimmer={activityEntryShowToolShimmer}
					hideToolPreview={true}
					{statusText}
					{showStatusShimmer}
					todoProgress={activityProjection?.todoProgress ?? null}
					currentQuestion={uiCurrentQuestion}
					{totalQuestions}
					{hasMultipleQuestions}
					{currentQuestionIndex}
					{questionId}
					{questionProgress}
					{currentQuestionAnswered}
					{currentAnswerDisplay}
					{currentQuestionOptions}
					{otherText}
					otherPlaceholder={"Type your answer..."}
					{showOtherInput}
					{showSubmitButton}
					{canSubmit}
					submitLabel={"Submit"}
					onOptionSelect={handleOptionSelect}
					onOtherInput={handleOtherInput}
					onOtherKeydown={handleOtherKeydown}
					onSubmitAll={submitAllAnswers}
					onPrevQuestion={handlePrevQuestion}
					onNextQuestion={handleNextQuestion}
				/>
			</div>
		</div>
