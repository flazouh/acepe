<script lang="ts">
	import { CaretRight } from "phosphor-svelte";
	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		url?: string | null;
		domain?: string | null;
		resultText?: string | null;
		status?: AgentToolStatus;
		durationLabel?: string;
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
		durationLabel,
		fetchingLabel = "Fetching",
		fetchFailedLabel = "Fetch failed",
		fetchedLabel = "Fetched",
		resultLabel: resultLabelProp = "Result",
		errorLabel = "Error",
	}: Props = $props();

	let isExpanded = $state(false);

	const isPending = $derived(status === "pending" || status === "running");
	const isDone = $derived(status === "done");
	const isError = $derived(status === "error");
	const hasResult = $derived(Boolean(resultText && resultText.trim().length > 0));

	const title = $derived.by(() => {
		if (isPending) return fetchingLabel;
		if (isError) return fetchFailedLabel;
		return fetchedLabel;
	});

	const preview = $derived.by(() => {
		if (!resultText) return null;
		const compact = resultText.replace(/\s+/g, " ").trim();
		if (!compact) return null;
		return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
	});
	const derivedResultLabel = $derived(isError ? errorLabel : resultLabelProp);
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

		{#if domain}
			<span class="min-w-0 truncate text-muted-foreground/70">{domain}</span>
		{:else if url}
			<span class="min-w-0 truncate text-muted-foreground/70">{url}</span>
		{/if}

		{#if durationLabel}
			<span class="ml-auto shrink-0 font-mono text-sm text-muted-foreground/70">
				{durationLabel}
			</span>
		{/if}
	</div>

	{#if hasResult && resultText}
		<div>
			<button
				type="button"
				onclick={() => { isExpanded = !isExpanded; }}
				class="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/30 cursor-pointer"
			>
				<CaretRight
					size={10}
					weight="bold"
					class="shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
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
