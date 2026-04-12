<script lang="ts">
	import { AppWindow, CaretRight } from "phosphor-svelte";

	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		title: string;
		subtitle?: string | null;
		detailsText?: string | null;
		status?: AgentToolStatus;
		durationLabel?: string;
		detailsLabel?: string;
	}

	let {
		title,
		subtitle = null,
		detailsText = null,
		status = "done",
		durationLabel,
		detailsLabel = "Result",
	}: Props = $props();

	let isExpanded = $state(false);

	const hasDetails = $derived(Boolean(detailsText && detailsText.trim().length > 0));
	const preview = $derived.by(() => {
		if (!detailsText) return null;
		const compact = detailsText.replace(/\s+/g, " ").trim();
		if (!compact) return null;
		return compact.length > 140 ? `${compact.slice(0, 140)}...` : compact;
	});
</script>

<AgentToolCard>
	<div
		class="flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-xs"
		class:border-b={hasDetails}
		class:border-border={hasDetails}
	>
		<AppWindow weight="duotone" size={14} class="shrink-0 text-muted-foreground/70" />
		<ToolLabel {status}>{title}</ToolLabel>

		{#if subtitle}
			<span class="min-w-0 truncate text-muted-foreground/70">{subtitle}</span>
		{/if}

		{#if preview}
			<span class="min-w-0 truncate text-muted-foreground/55">{preview}</span>
		{/if}

		{#if durationLabel}
			<span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
				{durationLabel}
			</span>
		{/if}
	</div>

	{#if hasDetails && detailsText}
		<div>
			<button
				type="button"
				onclick={() => {
					isExpanded = !isExpanded;
				}}
				class="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/30 cursor-pointer"
				aria-label={isExpanded ? "Collapse result" : "Expand result"}
			>
				<CaretRight
					size={10}
					weight="bold"
					class="shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
				/>
				<span class="shrink-0 font-medium">{detailsLabel}</span>
				{#if !isExpanded && preview}
					<span class="min-w-0 truncate text-left text-muted-foreground/70">{preview}</span>
				{/if}
			</button>

			{#if isExpanded}
				<div class="border-t border-border bg-muted/20 px-2.5 py-2">
					<pre class="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{detailsText}</pre>
				</div>
			{/if}
		</div>
	{/if}
</AgentToolCard>
