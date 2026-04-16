<script lang="ts">
	import { Terminal, CheckCircle, XCircle, CaretDown } from "phosphor-svelte";
	import { TextShimmer } from "../text-shimmer/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import { Colors } from "../../lib/colors.js";
	import type { AgentToolStatus } from "./types.js";
	import {
		splitCommandSegments,
		highlightBashSegment,
	} from "../../lib/bash-tokenizer.js";

	interface Props {
		command: string | null;
		stdout?: string | null;
		stderr?: string | null;
		exitCode?: number;
		status?: AgentToolStatus;
		durationLabel?: string;
		/** Pre-highlighted HTML per command segment (e.g. from Shiki). Overrides built-in tokenizer. */
		commandHtmls?: string[];
		/** Pre-highlighted HTML for stdout (e.g. Shiki log). When a string, replaces plain stdout. */
		stdoutHtml?: string | null;
		/** Pre-highlighted HTML for stderr (e.g. Shiki log). When a string, replaces plain stderr. */
		stderrHtml?: string | null;
		/** Label shown while command is running (shimmer) */
		runningLabel?: string;
		/** Label shown after command finishes */
		finishedLabel?: string;
		/** Aria label to collapse output */
		ariaCollapseOutput?: string;
		/** Aria label to expand output */
		ariaExpandOutput?: string;
	}

	let {
		command,
		stdout,
		stderr,
		exitCode,
		status = "done",
		durationLabel,
		commandHtmls,
		stdoutHtml,
		stderrHtml,
		runningLabel = "Executing…",
		finishedLabel = "Executed",
		ariaCollapseOutput = "Collapse output",
		ariaExpandOutput = "Expand output",
	}: Props = $props();

	let isExpanded = $state(true);

	const isPending = $derived(status === "pending" || status === "running");
	const isSuccess = $derived(exitCode === 0);
	const isError = $derived(exitCode !== undefined && exitCode !== 0);
	const hasOutput = $derived(
		Boolean(stdout || stderr || stdoutHtml || stderrHtml)
	);

	const segments = $derived(command ? splitCommandSegments(command) : []);
	const fallbackHtmls = $derived(
		segments.map((s) => highlightBashSegment(s))
	);

	const useShiki = $derived(
		commandHtmls !== undefined && commandHtmls.length > 0
	);
	const displayHtmls = $derived(useShiki ? commandHtmls! : fallbackHtmls);

	const headerText = $derived.by(() => {
		if (isPending) {
			return durationLabel ? `Executing for ${durationLabel}` : runningLabel;
		}
		return durationLabel ? `Executed in ${durationLabel}` : finishedLabel;
	});

	const stderrColor = $derived(
		exitCode === 0 || exitCode === undefined
			? "execute-stderr-warn"
			: "execute-stderr-err"
	);

	const useStdoutShiki = $derived(typeof stdoutHtml === "string");
	const useStderrShiki = $derived(typeof stderrHtml === "string");

	/** Svelte action: scroll element to bottom on mount and content changes */
	function scrollToEnd(node: HTMLElement) {
		node.scrollTop = node.scrollHeight;
		const observer = new MutationObserver(() => {
			node.scrollTop = node.scrollHeight;
		});
		observer.observe(node, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		return { destroy() { observer.disconnect(); } };
	}
</script>

<AgentToolCard>
	<!-- ── Header ── -->
	<div class="flex h-7 items-center gap-1.5 px-2.5">
		<Terminal weight="fill" size={12} class="shrink-0" style="color: {Colors.purple}" />

		{#if isPending}
			<TextShimmer class="flex-1 text-xs leading-none">
				{headerText}
			</TextShimmer>
		{:else}
			<span class="flex-1 text-xs text-muted-foreground">
				{headerText}
			</span>
		{/if}

		<div class="ml-auto flex shrink-0 items-center gap-1.5">

			{#if isSuccess}
				<CheckCircle weight="fill" size={12} class="text-success" />
			{:else if isError}
				<XCircle weight="fill" size={12} class="text-destructive" />
			{/if}

			{#if !isPending && hasOutput}
				<button
					type="button"
					onclick={() => {
						isExpanded = !isExpanded;
					}}
					class="flex items-center justify-center rounded-md border-none bg-transparent p-0.5 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:scale-95"
					aria-label={isExpanded ? ariaCollapseOutput : ariaExpandOutput}
				>
					<CaretDown
						weight="fill"
						size={10}
						class="transition-transform duration-150 {isExpanded
							? 'rotate-180'
							: ''}"
					/>
				</button>
			{/if}
		</div>
	</div>

	<!-- ── Command blocks ── -->
	{#if displayHtmls.length > 0}
		<div class="execute-blocks">
			{#each displayHtmls as html}
				<div class="execute-block" class:shiki={useShiki}>
					{@html html}
				</div>
			{/each}
		</div>
	{/if}

	<!-- ── Output ── -->
	{#if hasOutput}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			use:scrollToEnd
			onclick={() => {
				if (!isExpanded) isExpanded = true;
			}}
			class="execute-output-area
				{isExpanded ? 'execute-output-expanded' : 'execute-output-collapsed'}
				{!isExpanded ? 'cursor-pointer' : ''}"
		>
			{#if stdout || stdoutHtml}
				{#if useStdoutShiki}
					<div class="execute-output-shiki">{@html stdoutHtml}</div>
				{:else}
					<pre class="execute-output">{stdout}</pre>
				{/if}
			{/if}
			{#if stderr || stderrHtml}
				{#if useStderrShiki}
					<div
						class="execute-output-shiki execute-output-stderr {stderrColor}"
					>
						{@html stderrHtml}
					</div>
				{:else}
					<pre class="execute-output {stderrColor}">{stderr}</pre>
				{/if}
			{/if}
		</div>
	{/if}
</AgentToolCard>

<style>
	/* ── Command blocks ── */
	.execute-blocks {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 6px;
		border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
	}

	.execute-block {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		line-height: 1.4;
		white-space: pre-wrap;
		word-break: break-all;
		padding: 2px 6px;
		border-radius: 3px;
		background: var(--muted);
	}

	/* ── Syntax highlight tokens ── */
	.execute-block :global(.sh-cmd) {
		color: var(--success);
		font-weight: 500;
	}

	.execute-block :global(.sh-flg) {
		color: color-mix(in srgb, var(--primary) 70%, var(--muted-foreground));
	}

	.execute-block :global(.sh-str) {
		color: var(--primary);
	}

	.execute-block :global(.sh-var) {
		color: color-mix(in srgb, #4ad0ff 65%, var(--foreground));
	}

	.execute-block :global(.sh-op) {
		color: var(--muted-foreground);
	}

	.execute-block :global(.sh-cmt) {
		color: var(--muted-foreground);
		opacity: 0.6;
		font-style: italic;
	}

	/* ── Output area — matches card surface ── */
	.execute-output-area {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: var(--card);
		border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
		padding: 6px 10px;
		transition: max-height 0.15s ease-out;
	}

	.execute-output-collapsed {
		max-height: 52px;
		overflow-y: auto;
	}

	.execute-output-expanded {
		max-height: 200px;
		overflow-y: auto;
	}

	.execute-output {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
		line-height: 1.5;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	:global(.dark) .execute-output {
		color: color-mix(in srgb, var(--foreground) 50%, transparent);
	}

	pre.execute-output.execute-stderr-warn {
		color: color-mix(in srgb, var(--primary) 80%, var(--foreground));
	}

	pre.execute-output.execute-stderr-err {
		color: var(--destructive);
	}

	/* Shiki-highlighted streams (log grammar, dual-theme spans) */
	.execute-output-shiki {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
		line-height: 1.5;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.execute-output-shiki :global(.line) {
		display: block;
		min-height: 1.5em;
	}

	.execute-output-shiki.execute-output-stderr.execute-stderr-warn {
		box-shadow: inset 2px 0 0
			color-mix(in srgb, var(--primary) 45%, transparent);
		padding-left: 0.5rem;
	}

	.execute-output-shiki.execute-output-stderr.execute-stderr-err {
		box-shadow: inset 2px 0 0 var(--destructive);
		padding-left: 0.5rem;
	}
</style>
