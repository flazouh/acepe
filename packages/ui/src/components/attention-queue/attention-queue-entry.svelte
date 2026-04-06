<script lang="ts">
import IconSquare from "@tabler/icons-svelte/icons/square";
import IconCheck from "@tabler/icons-svelte/icons/check";
import CaretRight from "phosphor-svelte/lib/CaretRight";
import CaretLeft from "phosphor-svelte/lib/CaretLeft";
import Question from "phosphor-svelte/lib/Question";
import type { Snippet } from "svelte";

import { TextShimmer } from "../text-shimmer/index.js";
import { DiffPill } from "../diff-pill/index.js";
import { SegmentedProgress } from "../segmented-progress/index.js";
import FeedItem from "./attention-queue-item.svelte";
import type {
	ActivityEntryMode,
	ActivityEntryQuestion,
	ActivityEntryQuestionOption,
	ActivityEntryQuestionProgress,
	ActivityEntryTodoProgress,
} from "./types.js";

interface Props {
	selected?: boolean;
	onSelect: () => void;
	mode: ActivityEntryMode;
	title: string;
	timeAgo: string | null;
	insertions: number;
	deletions: number;
	projectBadge?: Snippet;
	agentBadge?: Snippet;
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
	onSelect,
	mode,
	title,
	timeAgo,
	insertions,
	deletions,
	projectBadge,
	agentBadge,
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

const showMainRow = $derived(!currentQuestion);
const hasMainRowContent = $derived(
	Boolean(
		taskDescription ||
			showTaskSubagentList ||
			fileToolDisplayText ||
			toolContent ||
			statusText ||
			todoProgress
	)
);
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
			<div class="text-xs font-medium truncate">{title}</div>
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
		<div class="flex items-center gap-1.5">
			{#if taskDescription}
				<div class="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[60%]">
					{#if isStreaming}
						<TextShimmer class="truncate">{taskDescription}</TextShimmer>
					{:else}
						<span class="truncate">{taskDescription}</span>
					{/if}
				</div>
			{:else if showTaskSubagentList}
				<div class="flex flex-col gap-0.5 text-[10px] text-muted-foreground max-w-[60%] min-w-0">
					{#each taskSubagentSummaries as subagentSummary, subagentIndex (`${subagentSummary}-${subagentIndex}`)}
						<span class="truncate">{subagentSummary}</span>
					{/each}
				</div>
			{:else if fileToolDisplayText}
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

	{#if currentQuestion}
		<div class="mt-2 flex flex-col rounded-md border border-border/60 bg-muted/20 overflow-hidden shadow-sm">
			<!-- Header -->
			<div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/60 bg-muted/40">
				<Question weight="fill" class="size-3.5 text-primary shrink-0" />
				<div class="flex-1 min-w-0 text-xs text-foreground font-medium leading-tight">
					{currentQuestion.question}
				</div>

				{#if hasMultipleQuestions}
					<div class="flex items-center gap-0.5 shrink-0">
						<button
							type="button"
							class="p-0.5 rounded hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed"
							disabled={currentQuestionIndex === 0}
							onclick={(e) => {
								e.stopPropagation();
								onPrevQuestion();
							}}
						>
							<CaretLeft class="w-3 h-3 text-muted-foreground" />
						</button>
						<span class="text-xs text-muted-foreground tabular-nums font-mono px-0.5">
							{currentQuestionIndex + 1}/{totalQuestions}
						</span>
						<button
							type="button"
							class="p-0.5 rounded hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed"
							disabled={currentQuestionIndex === totalQuestions - 1}
							onclick={(e) => {
								e.stopPropagation();
								onNextQuestion();
							}}
						>
							<CaretRight class="w-3 h-3 text-muted-foreground" />
						</button>
					</div>
					<div class="flex gap-0.5 ml-1 shrink-0">
						{#each questionProgress as dot (dot.questionIndex)}
							<div
								class="w-1.5 h-1.5 rounded-full {questionId && dot.answered
									? 'bg-primary'
									: 'bg-muted-foreground/30'}"
							></div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Options -->
			{#if currentQuestion.options && currentQuestion.options.length > 0}
				<div class="flex flex-col divide-y divide-border/40 bg-background/20">
					{#each currentQuestionOptions as option, i (`${option.label}-${i}`)}
						<button
							type="button"
							class="flex items-center gap-2 px-2.5 py-1.5 text-xs transition-all text-left {option.selected
								? 'bg-primary/10 text-foreground font-medium'
								: 'text-foreground/80 hover:bg-muted/50 hover:text-foreground'}"
							onclick={(e) => {
								e.stopPropagation();
								onOptionSelect(option.label);
							}}
						>
							{#if currentQuestion.multiSelect}
								{#if option.selected}
									<div class="flex items-center justify-center size-3 rounded-sm bg-primary text-primary-foreground shrink-0 border border-transparent">
										<IconCheck class="size-2.5" />
									</div>
								{:else}
									<div class="size-3 rounded-sm border border-border/80 shrink-0 bg-background/50"></div>
								{/if}
							{/if}
							<span>{option.label}</span>
						</button>
					{/each}

					{#if showOtherInput}
						<div class="flex items-center gap-2 px-2.5 py-1.5 text-xs transition-all {otherText.trim() ? 'bg-primary/5' : 'focus-within:bg-muted/30'}">
							<input
								type="text"
								class="flex-1 w-full bg-transparent border-none outline-none focus:ring-0 p-0 {otherText.trim() ? 'text-foreground font-medium' : 'text-foreground/80'} placeholder:text-muted-foreground/60"
								placeholder={otherPlaceholder}
								value={otherText}
								oninput={(e) => {
									e.stopPropagation();
									onOtherInput((e.target as HTMLInputElement).value);
								}}
								onkeydown={(e) => {
									e.stopPropagation();
									onOtherKeydown(e.key);
								}}
								onclick={(e) => e.stopPropagation()}
							/>
						</div>
					{/if}
				</div>
			{/if}

			{#if showSubmitButton}
				<div class="flex items-center justify-end px-2 py-1.5 border-t border-border/50 bg-muted/30">
					<button
						type="button"
						class="px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
						disabled={!canSubmit}
						onclick={(e) => {
							e.stopPropagation();
							onSubmitAll();
						}}
					>
						{submitLabel}
					</button>
				</div>
			{/if}
		</div>
	{/if}
	{/if}
</FeedItem>
