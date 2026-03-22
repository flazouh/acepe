<script lang="ts">
	import IconSquare from "@tabler/icons-svelte/icons/square";
	import IconCheck from "@tabler/icons-svelte/icons/check";
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import CaretLeft from "phosphor-svelte/lib/CaretLeft";
	import type { Snippet } from "svelte";

	import { TextShimmer } from "../text-shimmer/index.js";
	import { DiffPill } from "../diff-pill/index.js";
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

<FeedItem selected={selected} onSelect={onSelect} {slidingHighlight} {compactPadding}>
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
					<svg viewBox="0 0 20 20" class="size-3 shrink-0 text-primary">
						<circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2" opacity="0.2" />
						<circle
							cx="10"
							cy="10"
							r="8"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-dasharray="50.265"
							stroke-dashoffset={50.265 - (todoProgress.current / todoProgress.total) * 50.265}
						/>
					</svg>
					<span class="tabular-nums text-foreground/70 shrink-0">{todoProgress.current}/{todoProgress.total}</span>
					<span class="truncate text-foreground/70">{todoProgress.label}</span>
				</div>
			{/if}
		</div>
	{/if}

	{#if currentQuestion}
		<div class="flex flex-col gap-1">
			<div class="flex items-center gap-1">
				{#if hasMultipleQuestions}
					<button
						type="button"
						class="p-0.5 rounded hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed"
						disabled={currentQuestionIndex === 0}
						onclick={(e) => {
							e.stopPropagation();
							onPrevQuestion();
						}}
					>
						<CaretLeft class="w-3 h-3 text-muted-foreground" />
					</button>
					<span class="text-[10px] text-muted-foreground tabular-nums">
						{currentQuestionIndex + 1}/{totalQuestions}
					</span>
					<button
						type="button"
						class="p-0.5 rounded hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed"
						disabled={currentQuestionIndex === totalQuestions - 1}
						onclick={(e) => {
							e.stopPropagation();
							onNextQuestion();
						}}
					>
						<CaretRight class="w-3 h-3 text-muted-foreground" />
					</button>
					<div class="flex gap-0.5 ml-1">
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

			<div class="text-[10px] text-muted-foreground leading-tight">
				{currentQuestion.question}
				{#if currentQuestionAnswered && currentAnswerDisplay}
					<span class="text-primary ml-1">({currentAnswerDisplay})</span>
				{/if}
			</div>

			{#if currentQuestion.options && currentQuestion.options.length > 0}
				<div class="flex flex-col gap-0.5">
					{#each currentQuestionOptions as option, i (`${option.label}-${i}`)}
						<button
							type="button"
							class="relative flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 text-[10px] rounded-sm transition-colors text-left {option.selected
								? 'bg-primary/10'
								: 'bg-muted/30 hover:bg-muted'}"
							onclick={(e) => {
								e.stopPropagation();
								onOptionSelect(option.label);
							}}
						>
							<span
								class="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-sm"
								style="background-color: {option.color};"
							></span>
							{#if currentQuestion.multiSelect}
								{#if option.selected}
									<IconCheck class="w-3 h-3 text-primary shrink-0" />
								{:else}
									<IconSquare class="w-3 h-3 text-muted-foreground/70 shrink-0" />
								{/if}
							{/if}
							<span class="text-foreground">{option.label}</span>
						</button>
					{/each}

					{#if showOtherInput}
						<div class="relative flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-sm bg-muted/30">
							<span
								class="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-sm bg-muted-foreground/30"
							></span>
							<input
								type="text"
								class="flex-1 px-1.5 py-0.5 text-[10px] rounded-sm border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
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
				<div class="flex justify-end mt-1">
					<button
						type="button"
						class="px-2 py-0.5 text-[10px] rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
</FeedItem>
