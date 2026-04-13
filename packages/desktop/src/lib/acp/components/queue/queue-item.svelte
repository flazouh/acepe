<script lang="ts">
import type {
	ActivityEntryMode,
	ActivityEntryQuestion,
	ActivityEntryTodoProgress,
} from "@acepe/ui";
import {
	ActivityEntry,
	BuildIcon,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
	PermissionFeedItem,
	PlanIcon,
	ProjectLetterBadge,
} from "@acepe/ui";
import { XCircle } from "phosphor-svelte";
import type { QueueItem } from "$lib/acp/store/queue/types.js";
import * as m from "$lib/paraglide/messages.js";
import { replyToPlanApprovalRequest } from "../../logic/interaction-reply.js";
import { getInteractionStore } from "../../store/interaction-store.svelte.js";
import { getQuestionSelectionStore } from "../../store/question-selection-store.svelte.js";
import { getQuestionStore } from "../../store/question-store.svelte.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import { normalizeTitleForDisplay } from "../../store/session-title-policy.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { COLOR_NAMES, Colors } from "../../utils/colors.js";
import { makeWorkspaceRelative } from "../../utils/path-utils.js";
import { formatTimeAgo } from "../../utils/time-utils.js";
import AgentIcon from "../agent-icon.svelte";
import PermissionActionBar from "../tool-calls/permission-action-bar.svelte";
import {
	extractPermissionCommand,
	extractPermissionFilePath,
} from "../tool-calls/permission-display.js";
import { getExitPlanDisplayPlan } from "../tool-calls/exit-plan-helpers.js";
import { isExitPlanPermission } from "../../utils/exit-plan-permission.js";
import { projectActivityEntry } from "../activity-entry/activity-entry-projection.js";
import {
	buildQueueItemQuestionUiState,
	type QuestionSelectionReader,
} from "./queue-item-question-ui-state.js";

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

const permissionCommand = $derived.by(() => {
	if (!pendingPermission) return null;
	return extractPermissionCommand(pendingPermission);
});
const permissionFilePath = $derived.by(() => {
	if (!pendingPermission) return null;
	const path = extractPermissionFilePath(pendingPermission);
	return path ? makeWorkspaceRelative(path, item.projectPath) : null;
});
const permissionVerb = $derived.by(() => {
	if (!pendingPermission) return null;
	if (permissionFilePath || permissionCommand) {
		return pendingPermission.permission.split(" ")[0] ?? pendingPermission.permission;
	}
	return pendingPermission.permission;
});
const displayTitle = $derived(
	normalizeTitleForDisplay(item.title || "") || m.agent_panel_new_thread()
);

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
	if (hasPendingQuestion || hasPendingPlanApproval) return null;
	if (isThinking) {
		return m.waiting_planning_next_moves();
	}
	if (item.pendingText) {
		return item.pendingText;
	}
	// Show error message in attention queue when session has error
	if (hasError && item.urgency.detail) {
		return item.urgency.detail;
	}
	return null;
});

const showShimmer = $derived(isThinking && !hasPendingQuestion && !hasPendingPlanApproval);

const todoProgress = $derived<ActivityEntryTodoProgress | null>(
	item.todoProgress
		? {
				current: item.todoProgress.current,
				total: item.todoProgress.total,
				label: item.todoProgress.label,
			}
		: null
);

const activityProjection = $derived.by(() =>
	projectActivityEntry({
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
	if (!pendingPlanApproval) {
		return null;
	}

	if (effectiveToolCall?.id === pendingPlanApproval.tool.callID) {
		return effectiveToolCall;
	}

	if (item.currentStreamingToolCall?.id === pendingPlanApproval.tool.callID) {
		return item.currentStreamingToolCall;
	}

	if (item.lastToolCall?.id === pendingPlanApproval.tool.callID) {
		return item.lastToolCall;
	}

	return null;
});
const planApprovalPrompt = $derived(
	planApprovalToolCall?.normalizedQuestions?.[0]?.question ?? m.tool_create_plan_running()
);

const toolContent = $derived(activityProjection.toolContent);
const isFileTool = $derived(activityProjection.isFileTool);
const showToolShimmer = $derived(activityProjection.showToolShimmer);

const mode = $derived<ActivityEntryMode>(
	item.currentModeId === CanonicalModeId.PLAN
		? CanonicalModeId.PLAN
		: item.currentModeId
			? CanonicalModeId.BUILD
			: null
);

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
	<ProjectLetterBadge name={item.projectName} color={item.projectColor} size={16} />
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
		<div class="border-t border-border/50" onclick={(e) => e.stopPropagation()}>
			<EmbeddedPanelHeader class="!border-b-0">
				<HeaderTitleCell compactPadding>
					<PlanIcon size="sm" class="shrink-0 mr-1" />
					<span
						class="text-[10px] font-mono text-muted-foreground select-none truncate leading-none"
					>
						{exitPlanDisplayTitle}
					</span>
				</HeaderTitleCell>
				<HeaderActionCell withDivider={false}>
					<button type="button" class="plan-queue-action" onclick={handleExitPlanCancel}>
						<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
						Cancel
					</button>
				</HeaderActionCell>
				<HeaderActionCell>
					<button type="button" class="plan-queue-action" onclick={handleExitPlanBuild}>
						<BuildIcon size="sm" />
						{m.plan_sidebar_build()}
					</button>
				</HeaderActionCell>
			</EmbeddedPanelHeader>
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
		permissionLabel={permissionVerb ?? pendingPermission.permission}
		command={permissionCommand}
		filePath={permissionFilePath}
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
					<PlanIcon size="sm" class="shrink-0 mr-1" />
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
						<BuildIcon size="sm" />
						{m.plan_sidebar_build()}
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
		otherPlaceholder={m.question_other_placeholder()}
		{showOtherInput}
		{showSubmitButton}
		{canSubmit}
		submitLabel={m.common_submit()}
		onOptionSelect={handleOptionSelect}
		onOtherInput={handleOtherInput}
		onOtherKeydown={handleOtherKeydown}
		onSubmitAll={submitAllAnswers}
		onPrevQuestion={handlePrevQuestion}
		onNextQuestion={handleNextQuestion}
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
