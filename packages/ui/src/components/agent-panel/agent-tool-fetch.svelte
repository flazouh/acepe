<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import {
		getFetchResultLabel,
		getFetchResultPreview,
		getFetchTargetText,
		getFetchTitle,
		hasFetchResult,
	} from "./agent-tool-fetch-state.js";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		url?: string | null;
		domain?: string | null;
		resultText?: string | null;
		status?: AgentToolStatus;
		durationTiming?: ToolDurationTiming;
		/** Label when tool is running (e.g. "Fetching") */
		fetchingLabel?: string;
		/** Label when tool failed (e.g. "Fetch failed") */
		fetchFailedLabel?: string;
		/** Label when tool is done (e.g. "Fetched") */
		fetchedLabel?: string;
		/** Label for the result section (e.g. "Result") */
		resultLabel?: string;
		/** Label for the error section (e.g. "Error") */
		errorLabel?: string;
	}

	let {
		url = null,
		domain = null,
		resultText = null,
		status = "done",
		durationTiming,
		fetchingLabel = "Fetching",
		fetchFailedLabel = "Fetch failed",
		fetchedLabel = "Fetched",
		resultLabel: resultLabelProp = "Result",
		errorLabel = "Error",
	}: Props = $props();

	let isExpanded = $state(false);

	const hasResult = $derived(hasFetchResult(resultText));
	const title = $derived(
		getFetchTitle(status, { fetchingLabel, fetchFailedLabel, fetchedLabel })
	);
	const targetText = $derived(getFetchTargetText({ domain, url }));
	const preview = $derived(getFetchResultPreview(resultText));
	const derivedResultLabel = $derived(
		getFetchResultLabel(status, { resultLabel: resultLabelProp, errorLabel })
	);
</script>

<AgentToolCard>
	<div
		class="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-sm"
		class:border-b={hasResult}
		class:border-border={hasResult}
	>
		<ToolHeaderLeading kind="fetch" {status}>
			{title}
		</ToolHeaderLeading>

		{#if targetText}
			<span class="min-w-0 truncate text-muted-foreground/70">{targetText}</span>
		{/if}

		<AgentToolDurationLabel
			timing={durationTiming}
			class="ml-auto shrink-0 font-sans text-sm"
		/>
	</div>

	{#if hasResult && resultText}
		<div>
			<button
				type="button"
				onclick={() => { isExpanded = !isExpanded; }}
				class="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/30 cursor-pointer"
			>
				<HugeiconsIcon name="chevron-right" class="size-3 shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
				/>
				<span class="shrink-0 font-medium">{derivedResultLabel}</span>
				{#if !isExpanded && preview}
					<span class="min-w-0 truncate text-left text-muted-foreground/70">{preview}</span>
				{/if}
			</button>

			{#if isExpanded}
				<div class="border-t border-border bg-muted/20 px-2.5 py-2">
					<pre class="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{resultText}</pre>
				</div>
		{/if}
	</div>
{/if}
</AgentToolCard>
