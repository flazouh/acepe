<script lang="ts">
	import Check from "phosphor-svelte/lib/Check";
	import Square from "phosphor-svelte/lib/Square";
	import XCircle from "phosphor-svelte/lib/XCircle";
	import DotsThree from "phosphor-svelte/lib/DotsThree";
	import IconHelpCircleFilled from "@tabler/icons-svelte/icons/help-circle-filled";
	import { TextShimmer } from "../text-shimmer/index.js";
	import type { AgentQuestion, AgentToolStatus } from "./types.js";
	import {
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";

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
		durationLabel?: string;
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
		durationLabel,
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

	const isSingleQuestionSingleSelect = $derived.by(() => {
		if (!questions?.[0]) return false;
		return questions.length === 1 && !questions[0].multiSelect;
	});

	const hasOtherActive = $derived.by(() => {
		for (const text of Object.values(otherText)) {
			if (text.trim().length > 0) return true;
		}
		return false;
	});

	const showFooter = $derived(
		isInteractive && questions && (!isSingleQuestionSingleSelect || hasOtherActive)
	);

	function isSelected(questionIndex: number, label: string): boolean {
		return selectedLabels[questionIndex]?.includes(label) ?? false;
	}

	function formatAnswerLabels(questionIndex: number): string {
		const labels = answeredLabels[questionIndex];
		if (!labels || labels.length === 0) return noAnswerLabel;
		return labels.join(", ");
	}
</script>

{#if isAnswered || isCancelled}
	<!-- Answered / Cancelled: compact embedded card -->
	<div class="question-card">
		<EmbeddedPanelHeader class="bg-accent/40">
			<HeaderTitleCell compactPadding>
				{#if isCancelled}
					<XCircle size={14} weight="fill" class="shrink-0 mr-1 text-muted-foreground" />
					<span class="question-title text-muted-foreground">{cancelledLabel}</span>
				{:else}
					<IconHelpCircleFilled class="h-3.5 w-3.5 shrink-0 mr-1 text-success" />
					<span class="question-title">
						{questions?.[0]?.header || questionLabel}
					</span>
				{/if}
			</HeaderTitleCell>
			{#if durationLabel}
				<HeaderActionCell>
					<span class="inline-flex items-center px-2 font-mono text-[10px] text-muted-foreground/70">
						{durationLabel}
					</span>
				</HeaderActionCell>
			{/if}
		</EmbeddedPanelHeader>

		<div class="question-body">
			{#if isCancelled}
				<div class="text-xs text-muted-foreground">{cancelledDescription}</div>
			{:else if questions}
				{#each questions as question, qIndex (qIndex)}
					{#if qIndex > 0}
						<div class="border-t border-border/50 my-2"></div>
					{/if}
					<div class="text-xs text-foreground mb-0.5">{question.question}</div>
					<div class="text-xs text-muted-foreground">{formatAnswerLabels(qIndex)}</div>
				{/each}
			{/if}
		</div>
	</div>
{:else if questions}
	<!-- Interactive / Display question UI: embedded card -->
	<div class="question-card">
		<!-- Header bar -->
		<EmbeddedPanelHeader class="bg-accent/40">
			<HeaderTitleCell compactPadding>
				<IconHelpCircleFilled class="h-3.5 w-3.5 shrink-0 mr-1 text-primary" />
				<span class="question-title">{questionLabel}</span>
				{#if questions[0]?.header}
					<span class="question-badge ml-1.5">{questions[0].header}</span>
				{/if}
			</HeaderTitleCell>
			{#if durationLabel}
				<HeaderActionCell>
					<span class="inline-flex items-center px-2 font-mono text-[10px] text-muted-foreground/70">
						{durationLabel}
					</span>
				</HeaderActionCell>
			{/if}
		</EmbeddedPanelHeader>

		<!-- Question content -->
		<div class="question-body">
			{#each questions as question, qIndex (qIndex)}
				{#if qIndex > 0}
					<div class="border-t border-border/50 my-2"></div>
				{/if}

				<div class="text-xs text-foreground mb-2">{question.question}</div>
				<div class="space-y-1">
					{#if question.options && question.options.length > 0}
						{#each question.options as option, i (i)}
							{@const selected = isSelected(qIndex, option.label)}
							{@const optionClasses = [
								"flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors overflow-hidden",
								selected ? "bg-accent" : "bg-muted/50",
								isInteractive ? "cursor-pointer" : "",
								isInteractive && !selected ? "hover:bg-muted" : "",
								isInteractive && selected ? "hover:bg-accent/80" : "",
							]
								.filter(Boolean)
								.join(" ")}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class={optionClasses}
								role={isInteractive ? "button" : undefined}
								tabindex={isInteractive ? 0 : -1}
								onclick={() =>
									isInteractive && onSelect?.(qIndex, option.label, question.multiSelect)}
								onkeydown={(e) =>
									isInteractive &&
									e.key === "Enter" &&
									onSelect?.(qIndex, option.label, question.multiSelect)}
							>
								<div class="flex items-start gap-2 w-full">
									{#if question.multiSelect}
										{#if selected}
											<Check size={14} class="text-foreground shrink-0 mt-0.5" />
										{:else}
											<Square size={14} class="text-muted-foreground/70 shrink-0 mt-0.5" />
										{/if}
									{:else if selected}
										<Check size={14} class="text-foreground shrink-0 mt-0.5" />
									{/if}
									<div class="flex flex-col min-w-0">
										<span class="text-xs text-foreground">{option.label}</span>
										{#if option.description}
											<span class="text-xs text-muted-foreground mt-0.5">{option.description}</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					{/if}

					<!-- "Other" text input (only in interactive mode) -->
					{#if isInteractive}
						{@const currentOtherText = otherText[qIndex] ?? ""}
						{@const hasOtherText = currentOtherText.trim().length > 0}
						<div class="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-muted/50 overflow-hidden">
							<div class="flex items-center gap-2 w-full">
								{#if hasOtherText}
									<Check size={14} class="text-foreground shrink-0" />
								{:else}
									<DotsThree size={14} weight="bold" class="text-muted-foreground shrink-0" />
								{/if}
								<input
									type="text"
									class="flex-1 px-2 py-1 text-xs rounded-sm border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
									placeholder={otherPlaceholder}
									value={currentOtherText}
									oninput={(e) =>
										onOtherInput?.(qIndex, e.currentTarget.value, question.multiSelect)}
									onkeydown={(e) =>
										onOtherKeydown?.(qIndex, e.key, question.multiSelect)}
								/>
								<kbd
									aria-label="Press Enter to submit"
									class="pointer-events-none inline-flex h-5 shrink-0 items-center justify-center rounded border border-border/60 bg-background/70 px-1.5 font-mono text-[10px] text-muted-foreground/80"
								>
									Enter
								</kbd>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Footer actions (plan-card style) -->
		{#if showFooter}
			<div class="question-footer">
				<div class="question-footer-left"></div>
				<div class="question-footer-right">
					<button
						type="button"
						class="question-footer-btn"
						onclick={onCancel}
					>
						<XCircle size={12} weight="fill" class="shrink-0" />
						{cancelLabel}
					</button>
					<button
						type="button"
						class="question-footer-btn question-footer-btn--submit"
						disabled={!hasSelections}
						onclick={onSubmit}
					>
						<Check size={12} weight="bold" class="shrink-0" />
						{submitLabel}
					</button>
				</div>
			</div>
		{/if}
	</div>
{:else if isPending}
	<!-- Loading state while questions stream in -->
	<div class="flex w-full items-center justify-between gap-2">
		<TextShimmer class="text-xs text-muted-foreground font-medium">{waitingLabel}</TextShimmer>
		{#if durationLabel}
			<span class="shrink-0 font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
		{/if}
	</div>
{/if}

<style>
	.question-card {
		border-radius: 0.375rem;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
		overflow: hidden;
	}

	.question-title {
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: var(--font-mono, ui-monospace, monospace);
		color: var(--foreground);
		user-select: none;
		line-height: 1;
	}

	.question-badge {
		font-size: 0.625rem;
		padding: 1px 6px;
		border-radius: 0.25rem;
		background: var(--muted);
		color: var(--muted-foreground);
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.question-body {
		padding: 8px 12px;
	}

	.question-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1px;
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.question-footer-left,
	.question-footer-right {
		display: flex;
		align-items: center;
		gap: 1px;
	}

	.question-footer-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 4px 8px;
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

	.question-footer-btn:hover:not(:disabled) {
		color: var(--foreground);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}

	.question-footer-btn:disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.question-footer-btn--submit {
		color: var(--foreground);
	}

	.question-footer-btn--submit:hover:not(:disabled) {
		color: var(--foreground);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}
</style>
