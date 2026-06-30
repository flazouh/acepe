<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import { scrollToEnd } from "./agent-tool-execute-effects.js";
	import {
		getExecuteCommandSegments,
		getExecuteDisplayHtmls,
		getExecuteHeaderText,
		getExecuteStderrColor,
		getFallbackCommandHtmls,
		hasExecuteOutput,
		isExecuteError,
		isExecutePending,
		isExecuteSuccess,
		shouldUseCommandHtmls,
		shouldUseOutputHtml,
	} from "./agent-tool-execute-state.js";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import AgentToolDurationLabel from "./agent-tool-duration-label.svelte";
	import type { ToolDurationTiming } from "./tool-duration.js";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		command: string | null;
		stdout?: string | null;
		stderr?: string | null;
		exitCode?: number;
		status?: AgentToolStatus;
		durationTiming?: ToolDurationTiming;
		/** Pre-highlighted HTML per command segment (e.g. from Shiki). Overrides built-in tokenizer. */
		commandHtmls?: readonly string[];
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
		durationTiming,
		commandHtmls,
		stdoutHtml,
		stderrHtml,
		runningLabel = "Executing…",
		finishedLabel = "Executed",
		ariaCollapseOutput = "Collapse output",
		ariaExpandOutput = "Expand output",
	}: Props = $props();

	let isExpanded = $state(false);

	const isPending = $derived(isExecutePending(status));
	const isSuccess = $derived(isExecuteSuccess(exitCode));
	const isError = $derived(isExecuteError(exitCode));
	const hasOutput = $derived(
		hasExecuteOutput({ stdout, stderr, stdoutHtml, stderrHtml })
	);
	const segments = $derived(getExecuteCommandSegments(command));
	const fallbackHtmls = $derived(getFallbackCommandHtmls(segments));
	const useShiki = $derived(shouldUseCommandHtmls(commandHtmls));
	const displayHtmls = $derived(
		getExecuteDisplayHtmls({ commandHtmls, fallbackHtmls })
	);
	const headerText = $derived(
		getExecuteHeaderText({
			status,
			runningLabel,
			finishedLabel,
		})
	);
	const stderrColor = $derived(getExecuteStderrColor(exitCode));
	const useStdoutShiki = $derived(shouldUseOutputHtml(stdoutHtml));
	const useStderrShiki = $derived(shouldUseOutputHtml(stderrHtml));
</script>

<AgentToolCard dataTestid="agent-tool-execute-card">
	<!-- ── Header ── -->
	<div class="flex h-6 items-center justify-between gap-1.5 px-2">
		<div class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
			<ToolHeaderLeading kind="execute" {status}>
				{headerText}
			</ToolHeaderLeading>
		</div>

		<div class="ml-auto flex shrink-0 items-center gap-1">
			<AgentToolDurationLabel
				timing={durationTiming}
				class="font-sans text-xs"
			/>

			{#if isSuccess}
				<RoundedIcon name="check-circle" class="size-[11px] text-success" />
			{:else if isError}
				<RoundedIcon name="x-circle" class="size-[11px] text-destructive" />
			{/if}

			{#if !isPending && hasOutput}
				<button
					type="button"
					onclick={() => {
						isExpanded = !isExpanded;
					}}
					class="flex items-center justify-center rounded-lg border-none bg-transparent p-0.5 text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:scale-95"
					aria-label={isExpanded ? ariaCollapseOutput : ariaExpandOutput}
				>
					<RoundedIcon name="chevron-down" class="size-3 shrink-0 transition-transform duration-150 {isExpanded ? 'rotate-180' : ''}"
					/>
				</button>
			{/if}
		</div>
	</div>

	<!-- ── Command code ── -->
	{#if displayHtmls.length > 0}
		<div class="execute-blocks">
			{#each displayHtmls as html, index}
				<pre class="execute-block" class:shiki={useShiki}><span class="execute-line-number">{index + 1}</span><code>{@html html}</code></pre>
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
	/* ── Command code ── */
	.execute-blocks {
		padding: 2px 4px;
		border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
		max-height: 7.5rem;
		overflow-y: auto;
	}

	.execute-block {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		column-gap: 0.375rem;
		margin: 0;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.75rem;
		line-height: 1.35;
		white-space: pre-wrap;
		word-break: break-all;
		padding: 1px 6px;
	}

	.execute-line-number {
		user-select: none;
		text-align: right;
		color: color-mix(in srgb, var(--muted-foreground) 55%, transparent);
		border-right: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
		padding-right: 0.375rem;
		min-width: 1ch;
	}

	.execute-block code {
		font: inherit;
		min-width: 0;
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

	/* ── Output area ── */
	.execute-output-area {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: color-mix(in srgb, var(--card) 80%, var(--muted));
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
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.75rem;
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
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
		font-size: 0.75rem;
		line-height: 1.5;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.execute-output-shiki :global(.line) {
		display: block;
		min-height: 1.5em;
	}

	/* Shiki dual-theme token coloring */
	.execute-block :global(span),
	.execute-output-shiki :global(span) {
		color: var(--shiki-light);
	}

	:global(.dark) .execute-block :global(span),
	:global(.dark) .execute-output-shiki :global(span) {
		color: var(--shiki-dark);
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
