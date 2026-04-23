<script lang="ts">
import type { ActivityEntryQuestion } from "@acepe/ui";
import { ActivityEntry, ProjectLetterBadge, RichTokenText } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconChevronDown } from "@tabler/icons-svelte";
import { IconChevronRight } from "@tabler/icons-svelte";
import { IconDotsVertical } from "@tabler/icons-svelte";
import { Archive } from "phosphor-svelte";
import { Tree } from "phosphor-svelte";
import { COLOR_NAMES, Colors } from "$lib/acp/utils/colors.js";
import { tick } from "svelte";
import { buildQueueItemQuestionUiState } from "$lib/acp/components/queue/queue-item-question-ui-state.js";
import { buildSessionOperationInteractionSnapshot } from "$lib/acp/store/operation-association.js";
import PrStateIcon from "$lib/acp/components/pr-state-icon.svelte";
import { toast } from "svelte-sonner";
import CopyButton from "$lib/acp/components/messages/copy-button.svelte";
import { getSessionListHighlightContext } from "$lib/acp/components/session-list/session-list-highlight-context.js";
import {
	extractPermissionCommand,
	extractPermissionFilePath,
} from "$lib/acp/components/tool-calls/permission-display.js";
import {
	AGENT_ICON_BASE_CLASS,
	getAgentIcon,
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
import {
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
} from "$lib/acp/store/live-session-work.js";
import {
	formatRichSessionTitle,
	formatSessionTitleForDisplay,
} from "$lib/acp/store/session-title-policy.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { extractTodoProgressFromToolCall } from "$lib/acp/components/session-list/session-list-logic.js";
import {
	isActiveCompactActivityKind,
	projectSessionPreviewActivity,
} from "$lib/acp/components/activity-entry/activity-entry-projection.js";
import { selectSessionWorkBucket } from "$lib/acp/store/session-work-projection.js";
import { sectionColor, type SectionedFeedSectionId } from "@acepe/ui/attention-queue";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { makeWorkspaceRelative } from "$lib/acp/utils/path-utils.js";
import { tauriClient } from "$lib/utils/tauri-client/index.js";
import type { SessionDisplayItem as BaseSessionDisplayItem } from "$lib/acp/types/thread-display-item.js";
import SessionPrLinkMenu from "$lib/acp/components/shared/session-pr-link-menu.svelte";

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
	onExportMarkdown?: (sessionId: string) => void | Promise<void>;
	onExportJson?: (sessionId: string) => void | Promise<void>;
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
	onExportMarkdown,
	onExportJson,
	onOpenPr,
}: Props = $props();

const themeState = useTheme();
const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const interactionStore = getInteractionStore();
const questionStore = getQuestionStore();
const selectionStore = getQuestionSelectionStore();
const unseenStore = getUnseenStore();
const operationStore = sessionStore.getOperationStore();
const worktreeDeleted = $derived(session.worktreeDeleted ?? false);
const QUESTION_COLORS = [
	Colors[COLOR_NAMES.GREEN],
	Colors[COLOR_NAMES.RED],
	Colors[COLOR_NAMES.PINK],
	Colors[COLOR_NAMES.ORANGE],
];

function getThemedAgentIcon(agentId?: string): string {
	return getAgentIcon(agentId ?? "claude-code", themeState.effectiveTheme);
}

function getAgentIconClass(): string {
	return AGENT_ICON_BASE_CLASS;
}

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
}

async function handleExportMarkdown() {
	await onExportMarkdown?.(session.id);
}

async function handleExportJson() {
	await onExportJson?.(session.id);
}

async function handleOpenStreamingLog() {
	await tauriClient.shell.openStreamingLog(session.id).match(
		() => undefined,
		(err) => toast.error(`Failed to open streaming log: ${err.message}`)
	);
}

function handleOpenPr(event: MouseEvent) {
	event.stopPropagation();
	onOpenPr?.();
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

const basePadding = 1;
const paddingLeft = $derived(`${basePadding + depth * 16}px`);

const runtimeState = $derived(sessionStore.getSessionRuntimeState(session.id));
const hotState = $derived(sessionStore.getHotState(session.id));
const currentStreamingToolCall = $derived(operationStore.getCurrentStreamingToolCall(session.id));
const lastToolCall = $derived(operationStore.getLastToolCall(session.id));
const lastTodoToolCall = $derived(operationStore.getLastTodoToolCall(session.id));
const currentToolKind = $derived(operationStore.getCurrentToolKind(session.id));
const lastToolKind = $derived(lastToolCall ? (lastToolCall.kind ?? "other") : null);
const activePanel = $derived(panelStore.getPanelBySessionId(session.id));
const interactionSnapshot = $derived.by(() =>
	buildSessionOperationInteractionSnapshot(session.id, operationStore, interactionStore)
);
const hasUnseenCompletion = $derived(activePanel ? unseenStore.isUnseen(activePanel.id) : false);
const liveSessionState = $derived.by(() =>
	deriveLiveSessionState({
		runtimeState,
		hotState,
		currentStreamingToolCall,
		interactionSnapshot,
		hasUnseenCompletion,
	})
);
const sessionWorkProjection = $derived.by(() =>
	deriveLiveSessionWorkProjection({
		runtimeState,
		hotState,
		currentStreamingToolCall,
		interactionSnapshot,
		hasUnseenCompletion,
	})
);
const previewActivityKind = $derived(sessionWorkProjection.compactActivityKind);
const pendingQuestion = $derived(interactionSnapshot.pendingQuestion);
const pendingPermission = $derived(interactionSnapshot.pendingPermission);
const pendingPlanApproval = $derived(interactionSnapshot.pendingPlanApproval);
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
		return hotState.connectionError ?? "Connection error";
	}

	if (previewActivityKind === "thinking") {
		return "Planning next moves";
	}

	if (liveSessionState.attention.hasUnseenCompletion) {
		return "Ready for review";
	}

	return null;
});
const showStatusShimmer = $derived(
	previewActivityKind === "thinking" && !pendingQuestion && !pendingPlanApproval
);
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
const richTitleResult = $derived(formatRichSessionTitle(session.title, session.projectName));
const displayTitle = $derived(richTitleResult.plainText);
const richTitle = $derived(richTitleResult.richText);

const queueTimeAgo = $derived(formatTimeAgoSafe(session.updatedAt ?? session.createdAt));
const sessionBoardStatus = $derived(selectSessionWorkBucket(sessionWorkProjection));
const sessionStatusSectionId = $derived<SectionedFeedSectionId | null>(
	sessionBoardStatus === "idle" ? null : sessionBoardStatus
);
const sessionStatusIconColor = $derived.by((): string | null => {
	if (!sessionStatusSectionId) return null;
	if (sessionStatusSectionId === "needs_review") return Colors[COLOR_NAMES.PURPLE];
	return sectionColor(sessionStatusSectionId);
});
let isRowHovered = $state(false);
let isActionsMenuOpen = $state(false);
let isRenaming = $state(false);
let renameDraft = $state("");
let renameInputRef = $state<HTMLInputElement | null>(null);
let rowElement: HTMLDivElement | null = null;
const actionsVisible = $derived(isRowHovered || isActionsMenuOpen);
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

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
		<div
			{...props}
			bind:this={rowElement}
			class="group relative z-10 flex items-stretch gap-1 py-0"
			style="padding-left: {paddingLeft}; padding-right: {paddingLeft}"
			data-session-id={session.id}
			onpointerenter={(e) => {
				isRowHovered = true;
				highlightCtx?.updateHighlight(e.currentTarget as HTMLElement);
			}}
			onpointerleave={() => {
				isRowHovered = false;
				highlightCtx?.clearHighlight();
			}}
		>
			{#if hasChildren}
				<button
					type="button"
					class="shrink-0 self-start mt-1 p-0.5 hover:bg-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onclick={handleChevronClick}
					aria-label={isExpanded ? "Collapse" : "Expand"}
				>
					{#if isExpanded}
						<IconChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
					{:else}
						<IconChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
					{/if}
				</button>
			{/if}

			<div class="flex-1 min-w-0">
			{#snippet agentBadge()}
				<img
					src={getThemedAgentIcon(session.agentId)}
					alt={"Agent"}
					class="{getAgentIconClass()} shrink-0 m-0.5"
					width="12"
					height="12"
				/>
				{#if session.sequenceId != null && session.projectName != null && session.projectColor != null}
					<ProjectLetterBadge
						name={session.projectName}
						color={session.projectColor}
						iconSrc={session.projectIconSrc}
						size={12}
						sequenceId={session.sequenceId}
						showLetter={false}
						class="font-mono"
					/>
				{/if}
					{#if session.worktreePath}
						<Tree
							size={12}
							weight="fill"
							class="shrink-0 m-0.5 {worktreeDeleted ? 'text-destructive' : 'text-success'}"
							color="currentColor"
							aria-label={worktreeDeleted ? "Worktree deleted" : "Worktree session"}
						/>
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
							<span class="text-[10px] font-mono leading-none text-muted-foreground">
								#{session.prNumber}
							</span>
						</button>
					{/if}
				{/snippet}

				{#snippet rowActions()}
					<div class="flex items-center shrink-0">
						{#if onArchive}
							<button
								type="button"
								class="shrink-0 h-5 w-5 flex items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:[&_svg]:text-foreground"
								onclick={(e) => {
									e.stopPropagation();
									void handleArchive();
								}}
								aria-label="Archive session"
								title="Archive"
							>
								<Archive
									class="h-3.5 w-3.5 text-muted-foreground transition-colors"
									weight="fill"
									color="currentColor"
									aria-hidden="true"
								/>
							</button>
						{/if}
						<DropdownMenu.Root bind:open={isActionsMenuOpen}>
							<DropdownMenu.Trigger
								class="shrink-0 h-5 w-4 flex items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:text-foreground"
								onclick={(e: MouseEvent) => e.stopPropagation()}
							>
								<IconDotsVertical class="h-3.5 w-3.5" aria-hidden="true" />
								<span class="sr-only">Session actions</span>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								align="end"
								class="min-w-[180px]"
								onclick={(e: MouseEvent) => e.stopPropagation()}
							>
								<DropdownMenu.Item class="cursor-pointer">
									<CopyButton
										text={session.id}
										variant="menu"
										label={"Copy session ID"}
										hideIcon
										size={16}
									/>
								</DropdownMenu.Item>
								{#if onRename}
									<DropdownMenu.Item onSelect={openRenameEditor} class="cursor-pointer">
										{"Rename"}
									</DropdownMenu.Item>
								{/if}
								<SessionPrLinkMenu
									sessionId={session.id}
									projectPath={session.projectPath}
									linkedPr={session.linkedPr ?? null}
									prLinkMode={session.prLinkMode ?? "automatic"}
								/>
								{#if onExportMarkdown || onExportJson}
									<DropdownMenu.Separator />
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger class="cursor-pointer">
											{"Export"}
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="min-w-[160px]">
											{#if onExportMarkdown}
												<DropdownMenu.Item onSelect={handleExportMarkdown} class="cursor-pointer">
													{"Export as Markdown"}
												</DropdownMenu.Item>
											{/if}
											{#if onExportJson}
												<DropdownMenu.Item onSelect={handleExportJson} class="cursor-pointer">
													{"Export as JSON"}
												</DropdownMenu.Item>
											{/if}
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
								{/if}
								{#if isDev}
									<DropdownMenu.Separator />
									<DropdownMenu.Item onSelect={handleOpenStreamingLog} class="cursor-pointer">
										{"Open Streaming Log"}
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{/snippet}

				{#snippet titleContent()}
					{#if isRenaming}
						<Input
							bind:ref={renameInputRef}
							bind:value={renameDraft}
							type="text"
							class="h-6 border-0 bg-transparent px-0 !text-xs font-medium shadow-none focus-visible:ring-0 md:!text-xs"
							onkeydown={handleRenameKeydown}
							onblur={submitRename}
							onclick={(event: MouseEvent) => event.stopPropagation()}
							aria-label="Rename session"
						/>
					{:else if richTitle}
						<div class="truncate" title={displayTitle}>
							<RichTokenText text={richTitle} class="text-xs font-medium" />
						</div>
					{:else}
						<div class="text-xs font-medium truncate" title={displayTitle}>
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
					statusSectionId={sessionStatusSectionId}
					statusIconColor={sessionStatusIconColor}
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
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side="right" sideOffset={8} class="max-w-60">
		{displayTitle}
	</Tooltip.Content>
</Tooltip.Root>
