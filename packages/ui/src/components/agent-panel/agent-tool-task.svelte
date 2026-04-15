<script lang="ts">
	import { IconCircleCheckFilled } from "@tabler/icons-svelte";
	import { CaretRight, Robot } from "phosphor-svelte";
	import { Colors } from "../../lib/colors.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import type { AgentToolStatus, AnyAgentEntry, AgentToolEntry } from "./types.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import AgentToolRow from "./agent-tool-row.svelte";
	import ToolTally from "./tool-tally.svelte";

	interface Props {
		description: string | null;
		prompt?: string | null;
		resultText?: string | null;
		children?: readonly AnyAgentEntry[];
		status?: AgentToolStatus;
		showDoneIcon?: boolean;
		compact?: boolean;
		durationLabel?: string;
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
		durationLabel,
		iconBasePath = "",
		runningFallback = "Running task…",
		doneFallback = "Task",
		resultLabel = "Result",
	}: Props = $props();

	let isPromptCollapsed = $state(true);
	let isResultCollapsed = $state(true);

	const isPending = $derived(status === "pending" || status === "running");
	const isDone = $derived(status === "done");

	const taskChildren = $derived(Array.from(children));

	/** Child tool entries only (tool_call type) for the Tool calls section. */
	const toolCallChildren = $derived(
		taskChildren.filter((e): e is AgentToolEntry => e.type === "tool_call"),
	);

	const lastToolCall = $derived(
		toolCallChildren.length > 0 ? toolCallChildren[toolCallChildren.length - 1] : null,
	);

	const hasPrompt = $derived(Boolean(prompt));
	const hasResult = $derived(isDone && Boolean(resultText));
	const hasChildren = $derived(toolCallChildren.length > 0);

	const hasBorder = $derived(hasPrompt || hasResult);
	const shouldShowDoneIcon = $derived(showDoneIcon && isDone);
	const cardClass = $derived(compact ? "bg-accent/30 border-border/60" : "");
	const headerClass = $derived(compact
		? "flex min-w-0 items-center justify-between gap-1 px-1 py-0.5 text-[10px]"
		: "flex h-7 items-center justify-between gap-1 px-2 text-xs");
	const headerBorderClass = $derived(hasBorder
		? compact
			? "border-b border-border/60"
			: "border-b border-border"
		: "");
	const headerContentClass = $derived(compact
		? "flex min-w-0 flex-1 items-center justify-start gap-1"
		: "flex min-w-0 flex-1 items-center justify-start gap-2");
	const titleClass = $derived(compact ? "font-mono text-[10px]" : "font-mono text-[11px]");
	const promptButtonClass = $derived(compact
		? "w-full flex items-center gap-1 px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer"
		: "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer");
	const promptBodyClass = $derived(compact ? "px-1 pb-0.5" : "px-3 pb-2");
	const promptContentClass = $derived(compact
		? "text-[10px] text-muted-foreground whitespace-pre-wrap break-words leading-relaxed"
		: "text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed");
	const resultSectionClass = $derived(compact ? "border-t border-border/60" : "border-t border-border");
	const resultButtonClass = $derived(compact
		? "w-full flex items-center gap-1 px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer"
		: "w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors border-none bg-transparent cursor-pointer");
	const resultBodyClass = $derived(compact ? "px-1 pb-1" : "px-3 pb-3");
	const resultContentClass = $derived(compact
		? "text-[10px] bg-muted/30 rounded-sm p-1 whitespace-pre-wrap break-words leading-relaxed"
		: "text-xs bg-muted/30 rounded-md p-3 whitespace-pre-wrap break-words leading-relaxed");
	const rowSectionClass = $derived(compact ? "border-t border-border/60 py-0.5" : "border-t border-border py-1.5");
	const showLiveToolRow = $derived(!compact && hasChildren && lastToolCall !== null);
	const tallyInline = $derived(false);
	const tallyWrapperClass = $derived("");
</script>

<AgentToolCard class={cardClass} dataTestid="agent-tool-task-card">
	<!-- Header: fixed h-7 height -->
	<div class="{headerClass} {headerBorderClass}">
		<div class={headerContentClass}>
			<Robot size={12} weight="fill" style="color: {Colors.purple}" class="shrink-0" />
			<span class={titleClass}>
				{#if isPending}
					<TextShimmer class="font-medium text-muted-foreground">
						{description ?? runningFallback}
					</TextShimmer>
				{:else}
					<span class="font-medium text-muted-foreground">{description ?? doneFallback}</span>
				{/if}
			</span>
		</div>
		{#if durationLabel}
			<span class="shrink-0 font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
		{/if}
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
			<span class="truncate flex-1 text-left text-muted-foreground/80">
				{prompt.slice(0, 80)}{prompt.length > 80 ? "..." : ""}
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
				<span class="font-medium">{resultLabel}</span>
				{#if isResultCollapsed}
					<span class="text-muted-foreground/60 truncate flex-1 text-left">
						{resultText.slice(0, 100)}{resultText.length > 100 ? "..." : ""}
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
