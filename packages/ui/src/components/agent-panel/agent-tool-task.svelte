<script lang="ts">
	import { IconCircleCheckFilled } from "../icons/index.js";
	import { CaretRight } from "../icons/index.js";
	import type { AgentToolStatus, AnyAgentEntry } from "./types.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import ToolTally from "./tool-tally.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import {
		createTaskPreview,
		getLastTaskToolCall,
		getTaskHeaderBorderClass,
		getTaskTitle,
		getTaskToolChildren,
		getTaskUiClasses,
		hasTaskPrompt,
		hasTaskResult,
	} from "./agent-tool-task-state.js";

	interface Props {
		description: string | null;
		prompt?: string | null;
		resultText?: string | null;
		children?: readonly AnyAgentEntry[];
		status?: AgentToolStatus;
		showDoneIcon?: boolean;
		compact?: boolean;
		durationTiming?: ToolDurationTiming;
		iconBasePath?: string;
		runningFallback?: string;
		doneFallback?: string;
		resultLabel?: string;
	}

	let {
		description,
		prompt,
		resultText,
		children = [],
		status = "done",
		showDoneIcon = false,
		compact = false,
		durationTiming,
		iconBasePath = "",
		runningFallback = "Running task…",
		doneFallback = "Task",
		resultLabel = "Result",
	}: Props = $props();

	let isPromptCollapsed = $state(true);
	let isResultCollapsed = $state(true);

	const isDone = $derived(status === "done");
	const titleText = $derived(
		getTaskTitle({
			description,
			status,
			runningFallback,
			doneFallback,
		})
	);

	const taskChildren = $derived(Array.from(children));

	/** Child tool entries only (tool_call type) for the Tool calls section. */
	const toolCallChildren = $derived(getTaskToolChildren(taskChildren));

	const lastToolCall = $derived(getLastTaskToolCall(toolCallChildren));

	const hasPrompt = $derived(hasTaskPrompt(prompt));
	const hasResult = $derived(hasTaskResult({ status, resultText }));
	const hasChildren = $derived(toolCallChildren.length > 0);

	const hasBorder = $derived(hasPrompt || hasResult);
	const shouldShowDoneIcon = $derived(showDoneIcon && isDone);
	const taskClasses = $derived(getTaskUiClasses(compact));
	const cardClass = $derived(taskClasses.card);
	const headerClass = $derived(taskClasses.header);
	const headerBorderClass = $derived(getTaskHeaderBorderClass({ compact, hasBorder }));
	const headerContentClass = $derived(taskClasses.headerContent);
	const promptButtonClass = $derived(taskClasses.promptButton);
	const promptBodyClass = $derived(taskClasses.promptBody);
	const promptContentClass = $derived(taskClasses.promptContent);
	const resultSectionClass = $derived(taskClasses.resultSection);
	const resultButtonClass = $derived(taskClasses.resultButton);
	const resultBodyClass = $derived(taskClasses.resultBody);
	const resultContentClass = $derived(taskClasses.resultContent);
	const rowSectionClass = $derived(taskClasses.rowSection);
	const showLiveToolRow = $derived(!compact && hasChildren && lastToolCall !== null);
	const tallyInline = $derived(false);
	const tallyWrapperClass = $derived("");
	const promptPreview = $derived(prompt ? createTaskPreview({ text: prompt, limit: 80 }) : "");
	const resultPreview = $derived(
		resultText ? createTaskPreview({ text: resultText, limit: 100 }) : ""
	);
</script>

<AgentToolCard class={cardClass} dataTestid="agent-tool-task-card">
	<!-- Header: fixed h-7 height -->
	<div class="{headerClass} {headerBorderClass}">
		<div class={headerContentClass}>
			<ToolHeaderLeading kind="task" {status}>
				{titleText}
			</ToolHeaderLeading>
		</div>
		<AgentToolDurationLabel
			timing={durationTiming}
			class="shrink-0 font-sans text-xs"
		/>
		{#if shouldShowDoneIcon}
			<IconCircleCheckFilled
				size={12}
				class="shrink-0 text-success"
				data-testid="agent-tool-task-success-icon"
			/>
		{/if}
	</div>

	<!-- Prompt section (collapsible) -->
	{#if hasPrompt && prompt}
		<button
			type="button"
			onclick={() => { isPromptCollapsed = !isPromptCollapsed; }}
			class={promptButtonClass}
		>
			<CaretRight
				size={10}
				weight="bold"
				class="shrink-0 transition-transform duration-150 {isPromptCollapsed ? '' : 'rotate-90'}"
			/>
			<span class="flex-1 truncate text-left">
				{promptPreview}
			</span>
		</button>

		{#if !isPromptCollapsed}
			<div class={promptBodyClass}>
				<div class={promptContentClass}>
					{prompt}
				</div>
			</div>
		{/if}
	{/if}

	<!-- Result section (collapsible) -->
	{#if hasResult && resultText}
		<div class={resultSectionClass}>
			<button
				type="button"
				onclick={() => { isResultCollapsed = !isResultCollapsed; }}
				class={resultButtonClass}
			>
				<CaretRight
					size={10}
					weight="bold"
					class="shrink-0 transition-transform duration-150 {isResultCollapsed ? '' : 'rotate-90'}"
				/>
				<span>{resultLabel}</span>
				{#if isResultCollapsed}
					<span class="flex-1 truncate text-left">
						{resultPreview}
					</span>
				{/if}
			</button>

			{#if !isResultCollapsed}
				<div class={resultBodyClass}>
					<div class={resultContentClass}>
						{resultText}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Last tool used + tool tally strip -->
	{#if showLiveToolRow && lastToolCall}
		<div class={rowSectionClass}>
			<AgentToolRow
				title={lastToolCall.title}
				subtitle={lastToolCall.subtitle}
				filePath={lastToolCall.filePath}
				status={lastToolCall.status}
				kind={lastToolCall.kind}
				padded={true}
				{iconBasePath}
			/>
		</div>
	{/if}
	{#if hasChildren}
		<div class={tallyWrapperClass}>
			<ToolTally toolCalls={toolCallChildren} inline={tallyInline} compact={compact} />
		</div>
	{/if}

</AgentToolCard>
