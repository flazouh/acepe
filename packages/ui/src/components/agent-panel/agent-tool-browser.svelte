<script lang="ts">
	import { Button } from "../button/index.js";
	import { HugeiconsIcon } from "../icons/index.js";

	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { AgentCodeHighlighter, AgentToolStatus } from "./types.js";
	import {
		getBrowserScriptLines,
		hasBrowserToolDetails,
		resolveBrowserScriptBody,
		resolveBrowserScriptHtml,
		shouldUseBrowserScriptHtml,
	} from "./agent-tool-browser-state.js";

	interface Props {
		title: string;
		subtitle?: string | null;
		detailsText?: string | null;
		scriptText?: string | null;
		/** Pre-highlighted HTML for the script body (tests / overrides). */
		scriptHtml?: string | null;
		/** Lazily highlights JS/TS script; re-run via $derived when highlighter ready flips. */
		highlightScript?: AgentCodeHighlighter | null;
		status?: AgentToolStatus;
		durationTiming?: ToolDurationTiming;
		ariaCollapseOutput?: string;
		ariaExpandOutput?: string;
	}

	let {
		title,
		subtitle = null,
		detailsText = null,
		scriptText = null,
		scriptHtml = null,
		highlightScript = null,
		status = "done",
		durationTiming,
		ariaCollapseOutput = "Collapse result",
		ariaExpandOutput = "Expand result",
	}: Props = $props();

	let isExpanded = $state(false);

	const bodyScript = $derived(
		resolveBrowserScriptBody({
			scriptText,
			subtitle,
		})
	);
	const scriptLines = $derived(getBrowserScriptLines(bodyScript));
	const resolvedScriptHtml = $derived(
		resolveBrowserScriptHtml({
			scriptText: bodyScript,
			scriptHtml,
			highlightScript,
		})
	);
	const useScriptShiki = $derived(shouldUseBrowserScriptHtml(resolvedScriptHtml));
	const hasScript = $derived(scriptLines.length > 0 || useScriptShiki);
	const hasDetails = $derived(hasBrowserToolDetails(detailsText));
	const isPending = $derived(status === "pending" || status === "running");
</script>

<AgentToolCard dataTestid="agent-tool-browser-card">
	<!-- ── Header ── -->
	<div
		class="flex h-6 items-center justify-between gap-1.5 pl-2 pr-0.5 text-sm"
		data-testid="browser-tool-header"
	>
		<div class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
			<ToolHeaderLeading kind="browser" {status} class="shrink-0">
				{title}
			</ToolHeaderLeading>
		</div>

		<div class="ml-auto flex shrink-0 items-center gap-1">
			<AgentToolDurationLabel timing={durationTiming} class="font-sans text-xs" />

			{#if !isPending && hasDetails}
				<Button
					variant="ghost"
					size="icon-sm"
					data-header-control
					class="text-muted-foreground"
					onclick={() => {
						isExpanded = !isExpanded;
					}}
					aria-label={isExpanded ? ariaCollapseOutput : ariaExpandOutput}
					title={isExpanded ? ariaCollapseOutput : ariaExpandOutput}
				>
					{#snippet children()}
						<HugeiconsIcon
							name="chevron-down"
							class="transition-transform duration-150 {isExpanded ? 'rotate-180' : ''}"
						/>
					{/snippet}
				</Button>
			{/if}
		</div>
	</div>

	<!-- ── Script body (execute-style) ── -->
	{#if hasScript}
		<div class="browser-blocks" data-testid="browser-script-body">
			{#if useScriptShiki}
				<pre class="browser-block browser-block-shiki"><code>{@html resolvedScriptHtml}</code></pre>
			{:else}
				{#each scriptLines as line, index}
					<pre class="browser-block"><span class="browser-line-number">{index + 1}</span><code
							>{line.length > 0 ? line : " "}</code
						></pre>
				{/each}
			{/if}
		</div>
	{/if}

	<!-- ── Result output ── -->
	{#if hasDetails && detailsText}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			onclick={() => {
				if (!isExpanded) isExpanded = true;
			}}
			class="browser-output-area
				{isExpanded ? 'browser-output-expanded' : 'browser-output-collapsed'}
				{!isExpanded ? 'cursor-pointer' : ''}"
			data-testid="browser-result-output"
		>
			<pre class="browser-output">{detailsText}</pre>
		</div>
	{/if}
</AgentToolCard>

<style>
	.browser-blocks {
		padding: 2px 4px;
		border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		max-height: 7.5rem;
		overflow-y: auto;
	}

	.browser-block {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		column-gap: 0.375rem;
		margin: 0;
		font-family: var(
			--font-mono,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			monospace
		);
		font-size: 0.75rem;
		line-height: 1.35;
		white-space: pre-wrap;
		word-break: break-all;
		padding: 1px 6px;
	}

	.browser-block-shiki {
		display: block;
	}

	.browser-line-number {
		user-select: none;
		text-align: right;
		color: color-mix(in srgb, var(--muted-foreground) 55%, transparent);
		border-right: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		padding-right: 0.375rem;
		min-width: 1ch;
	}

	.browser-block code {
		font: inherit;
		min-width: 0;
	}

	.browser-block-shiki :global(.line) {
		display: block;
		min-height: 1.35em;
	}

	.browser-block-shiki :global(span) {
		color: var(--shiki-light);
	}

	:global(.dark) .browser-block-shiki :global(span) {
		color: var(--shiki-dark);
	}

	.browser-output-area {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: color-mix(in srgb, var(--card) 80%, var(--muted));
		border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
		padding: 6px 10px;
		transition: max-height 0.15s ease-out;
	}

	.browser-output-collapsed {
		max-height: 52px;
		overflow-y: auto;
	}

	.browser-output-expanded {
		max-height: 200px;
		overflow-y: auto;
	}

	.browser-output {
		font-family: var(
			--font-mono,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			monospace
		);
		font-size: 0.75rem;
		line-height: 1.5;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	:global(.dark) .browser-output {
		color: color-mix(in srgb, var(--foreground) 50%, transparent);
	}
</style>
