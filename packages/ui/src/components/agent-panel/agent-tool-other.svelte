<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";

	import AgentToolCard from "./agent-tool-card.svelte";
	import {
		getOtherToolDetailsPreview,
		hasOtherToolDetails,
	} from "./agent-tool-other-state.js";
	import ToolLabel from "./tool-label.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		title: string;
		subtitle?: string | null;
		detailsText?: string | null;
		status?: AgentToolStatus;
		durationTiming?: ToolDurationTiming;
		detailsLabel?: string;
		ariaExpandDetails?: string;
		ariaCollapseDetails?: string;
	}

	let {
		title,
		subtitle = null,
		detailsText = null,
		status = "done",
		durationTiming,
		detailsLabel = "Tool payload",
		ariaExpandDetails = "Expand tool payload",
		ariaCollapseDetails = "Collapse tool payload",
	}: Props = $props();

	let isExpanded = $state(false);

	const hasDetails = $derived(hasOtherToolDetails(detailsText));
	const preview = $derived(getOtherToolDetailsPreview(detailsText));
</script>

<AgentToolCard>
	<div
		class="flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-sm"
		class:border-b={hasDetails}
		class:border-border={hasDetails}
	>
		<ToolLabel {status}>{title}</ToolLabel>

		{#if subtitle}
			<span class="min-w-0 truncate text-muted-foreground/70">{subtitle}</span>
		{/if}

		<AgentToolDurationLabel
			timing={durationTiming}
			class="ml-auto shrink-0 font-sans text-sm"
		/>
	</div>

	{#if hasDetails && detailsText}
		<div>
			<button
				type="button"
				onclick={() => {
					isExpanded = !isExpanded;
				}}
				class="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/30 cursor-pointer"
				aria-label={isExpanded ? ariaCollapseDetails : ariaExpandDetails}
			>
				<RoundedIcon name="chevron-right" class="size-3 shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
				/>
				<span class="shrink-0 font-medium">{detailsLabel}</span>
				{#if !isExpanded && preview}
					<span class="min-w-0 truncate text-left text-muted-foreground/70">{preview}</span>
				{/if}
			</button>

			{#if isExpanded}
				<div class="border-t border-border bg-muted/20 px-2.5 py-2">
					<pre class="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{detailsText}</pre>
				</div>
			{/if}
		</div>
	{/if}
</AgentToolCard>
