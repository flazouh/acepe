<script lang="ts">
import type {
	ActivityEntryMode,
	ActivityEntryQuestion,
	ActivityEntryTodoProgress,
} from "@acepe/ui";
import {
	ActivityEntry,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
	PermissionFeedItem,
	ProjectLetterBadge,
} from "@acepe/ui";
import { PlanCard } from "@acepe/ui/plan-card";
import { CheckCircle, FileCode, XCircle } from "phosphor-svelte";
import type { QueueItem } from "$lib/acp/store/queue/types.js";
import { replyToPlanApprovalRequest } from "../../logic/interaction-reply.js";
import { getInteractionStore } from "../../store/interaction-store.svelte.js";
import { getQuestionSelectionStore } from "../../store/question-selection-store.svelte.js";
import { getQuestionStore } from "../../store/question-store.svelte.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { normalizeTitleForDisplay } from "../../store/session-title-policy.js";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";
import { formatTimeAgo } from "../../utils/time-utils.js";
import AgentIcon from "../agent-icon.svelte";
import PermissionActionBar from "../tool-calls/permission-action-bar.svelte";
import { getExitPlanDisplayPlan } from "../tool-calls/exit-plan-helpers.js";
import { isExitPlanPermission } from "../../utils/exit-plan-permission.js";
import { projectQueueItemActivity } from "./queue-item-display.js";
import {
	getQueueItemStatusText,
	getQueueItemTodoProgress,
	getQueuePermissionDisplay,
	getQueuePlanApprovalPrompt,
	getQueuePlanApprovalToolCall,
	shouldShowQueueItemShimmer,
} from "./queue-item-display-state.js";
import {
	buildQueueItemQuestionUiState,
	type QuestionSelectionReader,
} from "./queue-item-question-ui-state.js";
import { buildQueueExitPlanCard } from "./queue-exit-plan-card.js";
import PlanDialog from "../plan-dialog.svelte";

const QUESTION_COLORS = [
	Colors[COLOR_NAMES.GREEN],
	Colors[COLOR_NAMES.RED],
	Colors[COLOR_NAMES.PINK],
	Colors[COLOR_NAMES.ORANGE],
];

interface Props {
	item: QueueItem;
	isSelected?: boolean;
	onSelect: (item: QueueItem) => void;
}

let { item, isSelected = false, onSelect }: Props = $props();

const interactionStore = getInteractionStore();
const questionStore = getQuestionStore();
const selectionStore = getQuestionSelectionStore();
const permissionStore = getPermissionStore();
let planDialogPlan = $state<{ title: string; content: string; summary: null } | null>(null);

const selectionReader: QuestionSelectionReader = {
	hasSelections(questionId, questionIndex) {
		return selectionStore.hasSelections(questionId, questionIndex);
	},
	isOptionSelected(questionId, questionIndex, optionLabel) {
		return selectionStore.isOptionSelected(questionId, questionIndex, optionLabel);
	},
	isOtherActive(questionId, questionIndex) {
		return selectionStore.isOtherActive(questionId, questionIndex);
	},
	getOtherText(questionId, questionIndex) {
		return selectionStore.getOtherText(questionId, questionIndex);
	},
};

const pendingQuestion = $derived.by(() => {
	if (!item.pendingQuestion) {
		return null;
	}

	return interactionStore.questionsPending.get(item.pendingQuestion.id) ?? null;
});
const hasPendingQuestion = $derived(pendingQuestion !== null);

const pendingPermission = $derived.by(() => {
	const snapshotPermission =
		item.state.pendingInput.kind === "permission" ? item.state.pendingInput.request : null;
	if (!snapshotPermission) {
		return null;
	}

	return interactionStore.permissionsPending.get(snapshotPermission.id) ?? null;
});
const hasPendingPermission = $derived(pendingPermission !== null);

const pendingPlanApproval = $derived.by(() => {
	const snapshotApproval =
		item.state.pendingInput.kind === "plan_approval" ? item.state.pendingInput.request : null;
	if (!snapshotApproval) {
		return null;
	}

	const liveApproval =
		interactionStore.planApprovalsPending.get(snapshotApproval.id) ?? snapshotApproval;
	return liveApproval.status === "pending" ? liveApproval : null;
});
const hasPendingPlanApproval = $derived(pendingPlanApproval !== null);

// Detect ExitPlanMode permissions for custom plan card rendering
const isExitPlanMode = $derived.by(() => {
	if (!hasPendingPermission || !pendingPermission) return false;
	return isExitPlanPermission(pendingPermission);
});
const exitPlanDisplayTitle = $derived.by(() => {
	if (!isExitPlanMode || !pendingPermission) return "Plan";
	const toolCall = effectiveToolCall;
	if (!toolCall) return "Plan";
	const plan = getExitPlanDisplayPlan(toolCall, pendingPermission, null);
	return plan ? plan.title : "Plan";
});
const exitPlanCard = $derived.by(() => {
	if (!isExitPlanMode || !pendingPermission) return null;
	return buildQueueExitPlanCard(effectiveToolCall, pendingPermission);
});

const permissionDisplay = $derived.by(() => {
	if (!pendingPermission) return null;
	return getQueuePermissionDisplay({
		permission: pendingPermission,
		projectPath: item.projectPath,
	});
});
const displayTitle = $derived(normalizeTitleForDisplay(item.title || "") || "New Thread");

const questionId = $derived(pendingQuestion?.tool?.callID ?? pendingQuestion?.id ?? "");

let currentQuestionIndex = $state(0);
let lastQuestionId = "";

$effect(() => {
	const pendingQuestionId = pendingQuestion?.id;

	if (!pendingQuestionId) {
		lastQuestionId = "";
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
		selectionReader,
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

	const answers = selectionStore.getAnswers(
		questionId,
		currentQuestionIndex,
		currentQuestion.multiSelect
	);
	return answers.join(", ");
});

const isThinking = $derived(item.state.activity.kind === "thinking");
const hasError = $derived(item.state.connection === "error" || item.connectionError !== null);

const statusText = $derived.by(() => {
	return getQueueItemStatusText({
		hasPendingQuestion,
		hasPendingPlanApproval,
		isThinking,
		pendingText: item.pendingText,
		hasError,
		urgencyDetail: item.urgency.detail,
	});
});

const showShimmer = $derived(
	shouldShowQueueItemShimmer({ isThinking, hasPendingQuestion, hasPendingPlanApproval })
);

const todoProgress = $derived<ActivityEntryTodoProgress | null>(
	getQueueItemTodoProgress(item.todoProgress)
);

const activityProjection = $derived.by(() =>
	projectQueueItemActivity({
		activityKind: item.state.activity.kind,
		currentStreamingToolCall: item.currentStreamingToolCall,
		currentToolKind: item.currentToolKind,
		lastToolCall: item.lastToolCall,
		lastToolKind: item.lastToolKind,
		todoProgress,
	})
);
const displayedToolIsStreaming = $derived(activityProjection.isStreaming);
const effectiveToolCall = $derived(activityProjection.toolCall);
const effectiveToolKind = $derived(activityProjection.toolKind);
const planApprovalToolCall = $derived.by(() => {
	return getQueuePlanApprovalToolCall({
		pendingPlanApproval,
		effectiveToolCall,
		currentStreamingToolCall: item.currentStreamingToolCall,
		lastToolCall: item.lastToolCall,
	});
});
const planApprovalPrompt = $derived(getQueuePlanApprovalPrompt(planApprovalToolCall));

const toolContent = $derived(activityProjection.toolContent);
const isFileTool = $derived(activityProjection.isFileTool);
const showToolShimmer = $derived(activityProjection.showToolShimmer);

const mode = $derived<ActivityEntryMode>(null);

const taskDescription = $derived(activityProjection.taskDescription);
const taskSubagentSummaries = $derived(activityProjection.taskSubagentSummaries);
const taskSubagentTools = $derived(activityProjection.taskSubagentTools);
const latestTaskSubagentTool = $derived(activityProjection.latestTaskSubagentTool);
const showTaskSubagentList = $derived(activityProjection.showTaskSubagentList);

let now = $state(Date.now());
$effect(() => {
	const interval = setInterval(() => {
		now = Date.now();
	}, 60_000);
	return () => clearInterval(interval);
});
const timeAgo = $derived(formatTimeAgo(item.lastActivityAt, now));
const fileToolDisplayText = $derived(activityProjection.fileToolDisplayText);
const uiCurrentQuestion = $derived<ActivityEntryQuestion | null>(
	currentQuestion
		? {
				question: currentQuestion.question,
				multiSelect: currentQuestion.multiSelect,
				options: currentQuestion.options.map((option) => ({ label: option.label })),
			}
		: null
);

function handleSelect() {
	onSelect(item);
}

function handlePlanApprove() {
	if (!pendingPlanApproval) return;
	const approval = pendingPlanApproval;
	interactionStore.setPlanApprovalStatus(approval.id, "approved");
	void replyToPlanApprovalRequest(approval, true, false).match(
		() => {},
		() => {
			interactionStore.setPlanApprovalStatus(approval.id, "pending");
		}
	);
}

function handlePlanReject() {
	if (!pendingPlanApproval) return;
	const approval = pendingPlanApproval;
	interactionStore.setPlanApprovalStatus(approval.id, "rejected");
	void replyToPlanApprovalRequest(approval, false, false).match(
		() => {},
		() => {
			interactionStore.setPlanApprovalStatus(approval.id, "pending");
		}
	);
}

function handleExitPlanBuild() {
	if (!pendingPermission) return;
	permissionStore.reply(pendingPermission.id, "once");
}

function handleExitPlanCancel() {
	if (!pendingPermission) return;
	permissionStore.reply(pendingPermission.id, "reject");
}

function handleExitPlanViewFull(): void {
	const card = exitPlanCard;
	planDialogPlan = {
		title: card?.title ?? exitPlanDisplayTitle,
		content: card?.content ?? "",
		summary: null,
	};
}

function handlePlanDialogOpenChange(open: boolean): void {
	if (open) {
		return;
	}
	planDialogPlan = null;
}

const redColor = Colors[COLOR_NAMES.RED];

function submitAllAnswers() {
	if (!pendingQuestion || !questionId) return;

	const answers = pendingQuestion.questions.map((q, questionIndex) => ({
		questionIndex,
		answers: selectionStore.getAnswers(questionId, questionIndex, q.multiSelect),
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
		currentQuestionIndex++;
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
			currentQuestionIndex++;
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
		currentQuestionIndex--;
	}
}

function handleNextQuestion() {
	if (currentQuestionIndex < totalQuestions - 1) {
		currentQuestionIndex++;
	}
}
</script>

{#snippet projectBadge()}
	<ProjectLetterBadge
		name={item.projectName}
		color={item.projectColor}
		iconSrc={item.projectIconSrc}
		size={16}
	/>
{/snippet}

{#snippet agentBadge()}
	<AgentIcon agentId={item.agentId} size={14} class="block shrink-0 rounded" />
{/snippet}

{#if isExitPlanMode && pendingPermission}
	<!-- ExitPlanMode: custom plan card with Build/Cancel actions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex flex-col overflow-hidden cursor-pointer transition-colors hover:bg-accent/40 {isSelected ? '!bg-accent/40' : ''}"
		onclick={handleSelect}
		role="button"
		tabindex="0"
	>
		<div class="flex items-center gap-1.5 px-2 py-1.5">
			{@render projectBadge()}
			{@render agentBadge()}
			<span class="flex-1 min-w-0 text-xs font-medium truncate">{displayTitle}</span>
			{#if timeAgo}
				<span class="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{timeAgo}</span>
			{/if}
		</div>
		<div class="border-t border-border/50 p-1" onclick={(e) => e.stopPropagation()}>
			<PlanCard
				title={exitPlanCard?.title ?? exitPlanDisplayTitle}
				content={exitPlanCard?.content ?? ""}
				status="interactive"
				onBuild={handleExitPlanBuild}
				onCancel={handleExitPlanCancel}
				onViewFull={handleExitPlanViewFull}
				class="rounded-sm border-border/70 bg-background/60"
			/>
		</div>
	</div>
{:else if hasPendingPermission && pendingPermission}
	<PermissionFeedItem
		selected={isSelected}
		onSelect={handleSelect}
		title={displayTitle}
		{timeAgo}
		insertions={item.insertions}
		deletions={item.deletions}
		permissionLabel={permissionDisplay?.verb ?? pendingPermission.permission}
		command={permissionDisplay?.command ?? null}
		filePath={permissionDisplay?.filePath ?? null}
		{projectBadge}
		{agentBadge}
	>
		{#snippet actionBar()}
			<PermissionActionBar permission={pendingPermission} compact hideHeader />
		{/snippet}
	</PermissionFeedItem>
{:else if hasPendingPlanApproval && pendingPlanApproval}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex flex-col rounded-md border border-border/50 bg-accent/20 overflow-hidden cursor-pointer transition-colors hover:bg-accent/40 {isSelected ? '!bg-accent/40' : ''}"
		onclick={handleSelect}
		role="button"
		tabindex="0"
	>
		<div class="flex items-center gap-1.5 px-2 py-1.5">
			{@render projectBadge()}
			{@render agentBadge()}
			<span class="flex-1 min-w-0 text-xs font-medium truncate">{displayTitle}</span>
			{#if timeAgo}
				<span class="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{timeAgo}</span>
			{/if}
		</div>
		<div class="border-t border-border/50" onclick={(e) => e.stopPropagation()}>
			<EmbeddedPanelHeader>
				<HeaderTitleCell compactPadding>
					<FileCode class="mr-1 size-3 shrink-0" weight="fill" />
					<span
						class="text-[10px] font-mono text-muted-foreground select-none truncate leading-none"
					>
						{planApprovalPrompt}
					</span>
				</HeaderTitleCell>
				<HeaderActionCell withDivider={false}>
					<button type="button" class="plan-queue-action" onclick={handlePlanReject}>
						<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
						Cancel
					</button>
				</HeaderActionCell>
				<HeaderActionCell>
					<button type="button" class="plan-queue-action" onclick={handlePlanApprove}>
						<CheckCircle weight="fill" class="size-3 shrink-0" />
						{"Approve"}
					</button>
				</HeaderActionCell>
			</EmbeddedPanelHeader>
		</div>
	</div>
{:else}
	<ActivityEntry
		selected={isSelected}
		onSelect={handleSelect}
		{mode}
		title={displayTitle}
		{timeAgo}
		insertions={item.insertions}
		deletions={item.deletions}
		{projectBadge}
		{agentBadge}
		isStreaming={displayedToolIsStreaming}
		{taskDescription}
		{taskSubagentSummaries}
		{taskSubagentTools}
		{latestTaskSubagentTool}
		{showTaskSubagentList}
		{fileToolDisplayText}
		toolContent={isFileTool ? null : toolContent}
		{showToolShimmer}
		{statusText}
		showStatusShimmer={showShimmer}
		{todoProgress}
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
{/if}

{#if planDialogPlan}
	<PlanDialog
		plan={planDialogPlan}
		open={planDialogPlan !== null}
		onOpenChange={handlePlanDialogOpenChange}
		projectPath={item.projectPath}
	/>
{/if}

<style>
	.plan-queue-action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 100%;
		font: inherit;
		font-size: 0.625rem;
		font-weight: 500;
		font-family: var(--font-mono, ui-monospace, monospace);
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.plan-queue-action:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}
</style>
