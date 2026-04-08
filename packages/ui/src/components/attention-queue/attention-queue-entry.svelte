<script lang="ts">
import { IconSquare } from "@tabler/icons-svelte";
import type { Snippet } from "svelte";

import AgentToolTask from "../agent-panel/agent-tool-task.svelte";
import type { AgentToolEntry, AgentToolKind, AgentToolStatus } from "../agent-panel/types.js";
import { TextShimmer } from "../text-shimmer/index.js";
import { DiffPill } from "../diff-pill/index.js";
import { SegmentedProgress } from "../segmented-progress/index.js";
import AttentionQueueQuestionCard from "./attention-queue-question-card.svelte";
import FeedItem from "./attention-queue-item.svelte";
import type {
	ActivityEntryMode,
	ActivityEntryQuestion,
	ActivityEntryQuestionOption,
	ActivityEntryQuestionProgress,
	ActivityEntryTodoProgress,
} from "./types.js";

interface Props {
	latestTaskSubagentTool?: {
		id: string;
		kind?: AgentToolKind;
		title: string;
		filePath?: string;
		status: AgentToolStatus;
	} | null;
	taskSubagentTools?: readonly AgentToolEntry[];
	selected?: boolean;
	onSelect: () => void;
	mode: ActivityEntryMode;
	title: string;
	timeAgo: string | null;
	insertions: number;
	deletions: number;
	projectBadge?: Snippet;
	agentBadge?: Snippet;
	titleContent?: Snippet;
	trailingAction?: Snippet;
	isStreaming: boolean;
	taskDescription: string | null;
	taskSubagentSummaries: readonly string[];
	showTaskSubagentList: boolean;
	fileToolDisplayText: string | null;
	toolContent: string | null;
	showToolShimmer: boolean;
	statusText: string | null;
	showStatusShimmer: boolean;
	todoProgress: ActivityEntryTodoProgress | null;
	currentQuestion: ActivityEntryQuestion | null;
	totalQuestions: number;
	hasMultipleQuestions: boolean;
	currentQuestionIndex: number;
	questionId: string;
	questionProgress: readonly ActivityEntryQuestionProgress[];
	currentQuestionAnswered: boolean;
	currentAnswerDisplay: string;
	currentQuestionOptions: readonly ActivityEntryQuestionOption[];
	otherText: string;
	otherPlaceholder: string;
	showOtherInput?: boolean;
	showSubmitButton: boolean;
	canSubmit: boolean;
	submitLabel: string;
	onOptionSelect: (optionLabel: string) => void;
	onOtherInput: (value: string) => void;
	onOtherKeydown: (key: string) => void;
	onSubmitAll: () => void;
	onPrevQuestion: () => void;
	onNextQuestion: () => void;
	/** When true, FeedItem uses no bg/hover; parent provides sliding highlight (e.g. session list). */
	slidingHighlight?: boolean;
	/** When true, use smaller px/py (e.g. sidebar session list). */
	compactPadding?: boolean;
	/** When true, sidebar is collapsed — show only agent badge, hide all text. */
	collapsed?: boolean;
}

let {
	selected = false,
	latestTaskSubagentTool = null,
	taskSubagentTools = [],
	onSelect,
	mode,
	title,
	timeAgo,
	insertions,
	deletions,
	projectBadge,
	agentBadge,
	titleContent,
	trailingAction,
	isStreaming,
	taskDescription,
	taskSubagentSummaries,
	showTaskSubagentList,
	fileToolDisplayText,
	toolContent,
	showToolShimmer,
	statusText,
	showStatusShimmer,
	todoProgress,
	currentQuestion,
	totalQuestions,
	hasMultipleQuestions,
	currentQuestionIndex,
	questionId,
	questionProgress,
	currentQuestionAnswered,
	currentAnswerDisplay,
	currentQuestionOptions,
	otherText,
	otherPlaceholder,
	showOtherInput = true,
	showSubmitButton,
	canSubmit,
	submitLabel,
	onOptionSelect,
	onOtherInput,
	onOtherKeydown,
	onSubmitAll,
	onPrevQuestion,
	onNextQuestion,
	slidingHighlight = false,
	compactPadding = false,
	collapsed = false,
}: Props = $props();

const taskWidgetSummary = $derived.by(() => {
	if (taskDescription && taskDescription.trim().length > 0) {
		return taskDescription;
	}

	if (taskSubagentSummaries.length > 0) {
		return taskSubagentSummaries[taskSubagentSummaries.length - 1] ?? null;
	}

	return null;
});
const taskWidgetToolCalls = $derived.by((): AgentToolEntry[] => {
	if (taskSubagentTools.length > 0) {
		return [...taskSubagentTools];
	}

	if (!showTaskSubagentList || taskSubagentSummaries.length === 0) {
		return [];
	}

	return taskSubagentSummaries.map((summary, index) => ({
		id: `queue-task-${index}-${summary}`,
		type: "tool_call",
		title: summary,
		status: index === taskSubagentSummaries.length - 1 && isStreaming ? "running" : "done",
	}));
});

const showMainRow = $derived(!currentQuestion);
const hasMainRowContent = $derived(
	Boolean(
			taskWidgetSummary ||
			fileToolDisplayText ||
			toolContent ||
			statusText ||
			todoProgress ||
			taskWidgetToolCalls.length > 0
	)
);
const showTaskWidget = $derived(taskWidgetSummary !== null);
</script>

<FeedItem selected={selected} onSelect={onSelect} {slidingHighlight} {compactPadding} {collapsed}>
	{#if collapsed}
		<div class="flex items-center gap-1">
			{#if agentBadge}
				{@render agentBadge()}
			{/if}
			{#if trailingAction}
				<div class="ml-auto shrink-0">
					{@render trailingAction()}
				</div>
			{/if}
		</div>
	{:else}
		<div class="flex items-center gap-1.5">
			{#if projectBadge}
				{@render projectBadge()}
			{/if}
			{#if agentBadge}
				{@render agentBadge()}
			{/if}

			<div class="flex-1 min-w-0">
				{#if titleContent}
					{@render titleContent()}
				{:else}
					<div class="text-xs font-medium truncate">{title}</div>
				{/if}
			</div>

			{#if trailingAction}
				{@render trailingAction()}
			{:else}
				{#if timeAgo}
					<span class="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{timeAgo}</span>
				{/if}

				<div class="text-[10px] shrink-0 tabular-nums text-muted-foreground/70">
					<DiffPill {insertions} {deletions} variant="plain" />
				</div>
			{/if}
		</div>

		{#if showMainRow && hasMainRowContent}
			{#if showTaskWidget && taskWidgetSummary}
				<div class="flex w-full min-w-0 flex-col gap-1">
					<div class="flex w-full min-w-0 flex-col gap-1">
						<AgentToolTask
							description={taskWidgetSummary}
							status={isStreaming ? "running" : "done"}
							children={taskWidgetToolCalls}
							compact={true}
							iconBasePath="/svgs/icons"
						/>
					</div>

					{#if todoProgress}
						<div class="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
							<SegmentedProgress current={todoProgress.current} total={todoProgress.total} />
							<span class="truncate text-foreground/70">{todoProgress.label}</span>
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex items-start gap-1.5">
					{#if fileToolDisplayText}
						<div class="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[60%]">
							{#if isStreaming}
								<TextShimmer class="truncate">{fileToolDisplayText}</TextShimmer>
							{:else}
								<span class="truncate">{fileToolDisplayText}</span>
							{/if}
						</div>
					{:else if toolContent}
						<div class="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[60%]">
							{#if showToolShimmer}
								<TextShimmer class="truncate">{toolContent}</TextShimmer>
							{:else}
								<span class="truncate">{toolContent}</span>
							{/if}
						</div>
					{:else if statusText}
						<div class="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[60%]">
							{#if showStatusShimmer}
								<TextShimmer class="truncate">{statusText}</TextShimmer>
							{:else}
								<span class="truncate">{statusText}</span>
							{/if}
						</div>
					{/if}

					<div class="flex-1"></div>

					{#if todoProgress}
						<div class="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0 shrink-0">
							<SegmentedProgress current={todoProgress.current} total={todoProgress.total} />
							<span class="truncate text-foreground/70">{todoProgress.label}</span>
						</div>
					{/if}
				</div>
			{/if}
		{/if}

	{#if currentQuestion}
		<AttentionQueueQuestionCard
			{currentQuestion}
			{totalQuestions}
			{hasMultipleQuestions}
			{currentQuestionIndex}
			{questionId}
			{questionProgress}
			{currentQuestionAnswered}
			{currentQuestionOptions}
			{otherText}
			{otherPlaceholder}
			{showOtherInput}
			{showSubmitButton}
			{canSubmit}
			{submitLabel}
			onOptionSelect={onOptionSelect}
			onOtherInput={onOtherInput}
			onOtherKeydown={onOtherKeydown}
			onSubmitAll={onSubmitAll}
			onPrevQuestion={onPrevQuestion}
			onNextQuestion={onNextQuestion}
		/>
	{/if}
	{/if}
</FeedItem>
