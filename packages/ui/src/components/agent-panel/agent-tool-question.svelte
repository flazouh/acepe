<script lang="ts">
	import type { AgentQuestion, AgentToolStatus } from "./types.js";
	import {
		formatQuestionAnswerLabels,
		isQuestionOptionSelected,
		shouldShowQuestionFooter,
	} from "./agent-tool-question-state.js";
	import AgentToolQuestionFooter from "./agent-tool-question-footer.svelte";
	import AgentToolQuestionHeader from "./agent-tool-question-header.svelte";
	import AgentToolQuestionOtherInput from "./agent-tool-question-other-input.svelte";
	import AgentToolQuestionOptionRow from "./agent-tool-question-option-row.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";

	interface Props {
		/** Questions to display */
		questions?: AgentQuestion[] | null;
		/** Whether this question is currently interactive (pending answer) */
		isInteractive?: boolean;
		/** Whether this question has been answered */
		isAnswered?: boolean;
		/** Whether the question was cancelled */
		isCancelled?: boolean;
		/** Answered labels per question index */
		answeredLabels?: Record<number, string[]>;
		/** Selected option labels per question index (for interactive mode) */
		selectedLabels?: Record<number, string[]>;
		/** Other text values per question index */
		otherText?: Record<number, string>;
		/** Tool status */
		status?: AgentToolStatus;
		/** Optional elapsed label shown in the header (e.g. "for 2.34s") */
		durationTiming?: ToolDurationTiming;
		/** Callback when an option is selected */
		onSelect?: (questionIndex: number, label: string, multiSelect?: boolean) => void;
		/** Callback when "Other" text input changes */
		onOtherInput?: (questionIndex: number, text: string, multiSelect?: boolean) => void;
		/** Callback when a key is pressed inside the "Other" input */
		onOtherKeydown?: (questionIndex: number, key: string, multiSelect?: boolean) => void;
		/** Callback when submit button is clicked */
		onSubmit?: () => void;
		/** Callback when cancel button is clicked */
		onCancel?: () => void;
		/** Whether submit button should be enabled */
		hasSelections?: boolean;
		/** Label shown while waiting for question to stream in */
		waitingLabel?: string;
		/** Header label for interactive/pending question */
		questionLabel?: string;
		/** Label shown when question is cancelled */
		cancelledLabel?: string;
		/** Description shown when question is cancelled */
		cancelledDescription?: string;
		/** Fallback shown when no answer is recorded */
		noAnswerLabel?: string;
		/** Placeholder for the "Other" text input */
		otherPlaceholder?: string;
		/** Label for the cancel button */
		cancelLabel?: string;
		/** Label for the submit button */
		submitLabel?: string;
	}

	let {
		questions,
		isInteractive = false,
		isAnswered = false,
		isCancelled = false,
		answeredLabels = {},
		selectedLabels = {},
		otherText = {},
		status = "done",
		durationTiming,
		onSelect,
		onOtherInput,
		onOtherKeydown,
		onSubmit,
		onCancel,
		hasSelections = false,
		waitingLabel = "Waiting for question...",
		questionLabel = "Question",
		cancelledLabel = "Cancelled",
		cancelledDescription = "Question was cancelled without an answer.",
		noAnswerLabel = "No answer",
		otherPlaceholder = "Other...",
		cancelLabel = "Cancel",
		submitLabel = "Submit",
	}: Props = $props();

	const isPending = $derived(status === "pending" || status === "running");

	const showFooter = $derived(
		shouldShowQuestionFooter({
			isInteractive,
			questions,
			otherText,
		})
	);

	function isSelected(questionIndex: number, label: string): boolean {
		return isQuestionOptionSelected({
			selectedLabels,
			questionIndex,
			label,
		});
	}

	function formatAnswerLabels(questionIndex: number): string {
		return formatQuestionAnswerLabels({
			answeredLabels,
			questionIndex,
			noAnswerLabel,
		});
	}

</script>

{#if isAnswered || isCancelled}
	<!-- Answered / Cancelled: compact embedded card -->
	<div class="question-card text-sm">
		<AgentToolQuestionHeader
			state={isCancelled ? "cancelled" : "answered"}
			title={isCancelled ? cancelledLabel : (questions?.[0]?.header || questionLabel)}
			{durationTiming}
		/>

		<div class="question-body">
			{#if isCancelled}
				<div class="text-sm">{cancelledDescription}</div>
			{:else if questions}
				{#each questions as question, qIndex (qIndex)}
					{#if qIndex > 0}
						<div class="border-t border-border/50 my-2"></div>
					{/if}
					<div class="mb-0.5 text-sm">{question.question}</div>
					<div class="text-sm">{formatAnswerLabels(qIndex)}</div>
				{/each}
			{/if}
		</div>
	</div>
{:else if questions}
	<!-- Interactive / Display question UI: embedded card -->
	<div class="question-card text-sm">
		<!-- Header bar -->
		<AgentToolQuestionHeader
			state="interactive"
			title={questionLabel}
			badge={questions[0]?.header ?? null}
			{durationTiming}
		/>

		<!-- Question content -->
		<div class="question-body">
			{#each questions as question, qIndex (qIndex)}
				{#if qIndex > 0}
					<div class="border-t border-border/50 my-2"></div>
				{/if}

				<div class="mb-2 text-sm">{question.question}</div>
				<div class="space-y-1">
					{#if question.options && question.options.length > 0}
						{#each question.options as option, i (i)}
							{@const selected = isSelected(qIndex, option.label)}
							<AgentToolQuestionOptionRow
								{option}
								questionIndex={qIndex}
								multiSelect={question.multiSelect}
								{selected}
								{isInteractive}
								{onSelect}
							/>
						{/each}
					{/if}

					{#if isInteractive}
						<AgentToolQuestionOtherInput
							questionIndex={qIndex}
							multiSelect={question.multiSelect}
							text={otherText[qIndex] ?? ""}
							placeholder={otherPlaceholder}
							{onOtherInput}
							{onOtherKeydown}
						/>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Footer actions (plan-card style) -->
		{#if showFooter}
			<AgentToolQuestionFooter
				{hasSelections}
				{cancelLabel}
				{submitLabel}
				{onCancel}
				{onSubmit}
			/>
		{/if}
	</div>
{:else if isPending}
	<!-- Loading state while questions stream in -->
	<div class="flex w-full items-center justify-between gap-2">
		<span class="text-sm">{waitingLabel}</span>
		<AgentToolDurationLabel timing={durationTiming} class="shrink-0 text-sm" />
	</div>
{/if}

<style>
	.question-card {
		border-radius: 0.375rem;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
		overflow: hidden;
	}

	.question-body {
		padding: 8px 12px;
	}

</style>
