<script lang="ts">
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import Check from "phosphor-svelte/lib/Check";
	import X from "phosphor-svelte/lib/X";
	import { TextShimmer } from "../text-shimmer/index.js";
	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		command: string | null;
		stdout?: string | null;
		stderr?: string | null;
		exitCode?: number;
		status?: AgentToolStatus;
		durationLabel?: string;
		/** Label when running with no command yet */
		runningNoCmdLabel?: string;
		/** Label when running with command */
		runningLabel?: string;
		/** Label when done */
		doneLabel?: string;
		/** Label for success exit */
		successLabel?: string;
		/** Label for failed exit */
		failedLabel?: string;
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
		runningNoCmdLabel = "Running command…",
		runningLabel = "Running command:",
		doneLabel = "Ran command:",
		successLabel = "Success",
		failedLabel = "Failed",
		ariaCollapseOutput = "Collapse output",
		ariaExpandOutput = "Expand output",
	}: Props = $props();

	let isExpanded = $state(false);

	const isPending = $derived(status === "pending" || status === "running");
	const isSuccess = $derived(exitCode === 0);
	const isError = $derived(exitCode !== undefined && exitCode !== 0);
	const hasOutput = $derived(Boolean(stdout || stderr));

	function extractCommandSummary(cmd: string): string {
		const normalizedCommand = cmd.replace(/\\\s*\n\s*/g, " ");
		const parts = normalizedCommand.split(/\s*(?:&&|\|\||;|\|)\s*/);
		const firstWords = parts.map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
		const limited = firstWords.slice(0, 4);
		if (firstWords.length > 4) {
			return limited.join(", ") + "...";
		}
		return limited.join(", ");
	}

	const commandSummary = $derived(command ? extractCommandSummary(command) : "");

	const stderrColorClass = $derived(
		exitCode === 0 || exitCode === undefined
			? "text-amber-600 dark:text-amber-400"
			: "text-rose-500 dark:text-rose-400"
	);
</script>

<AgentToolCard>
	<!-- Header: fixed h-7 height -->
	{#if isPending && !command}
		<div class="flex h-7 items-center justify-between gap-2 px-2.5">
			<ToolLabel {status}>
				{runningNoCmdLabel}
			</ToolLabel>
			{#if durationLabel}
				<span class="shrink-0 font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
			{/if}
		</div>
	{:else}
		<div class="flex h-7 items-center justify-between px-2.5">
			<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
				{#if isPending}
					<TextShimmer class="inline-flex items-center text-xs leading-none">
						{runningLabel}
					</TextShimmer>
				{:else}
					{doneLabel}
				{/if}
				{commandSummary}
			</span>

			<div class="ml-2 flex shrink-0 items-center gap-2">
				{#if durationLabel}
					<span class="font-mono text-[10px] text-muted-foreground/70">{durationLabel}</span>
				{/if}
				<!-- Exit status indicator -->
				<div class="flex min-w-[60px] items-center justify-end gap-1 text-xs text-muted-foreground">
					{#if isSuccess}
						<Check size={12} weight="bold" class="text-green-500" />
						<span>{successLabel}</span>
					{:else if isError}
						<X size={12} weight="bold" class="text-rose-500" />
						<span>{failedLabel}</span>
					{/if}
				</div>

				<!-- Expand/collapse toggle: only when not pending and has output -->
				{#if !isPending && hasOutput}
					<button
						type="button"
						onclick={() => { isExpanded = !isExpanded; }}
						class="flex items-center justify-center p-1 rounded-md bg-transparent border-none text-muted-foreground cursor-pointer transition-colors hover:bg-accent active:scale-95 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
						aria-label={isExpanded ? ariaCollapseOutput : ariaExpandOutput}
					>
						<CaretRight
							size={10}
							weight="bold"
							class="text-muted-foreground transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}"
						/>
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Content: collapsible, click-to-expand when collapsed -->
	{#if command || stdout || stderr}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			onclick={() => {
				if (hasOutput && !isExpanded) isExpanded = true;
			}}
			class="border-t border-border px-2.5 py-1.5 transition-colors duration-150 {isExpanded
				? 'max-h-[200px] overflow-y-auto'
				: 'max-h-[72px] overflow-hidden'} {hasOutput && !isExpanded
				? 'cursor-pointer hover:bg-muted/50'
				: ''}"
		>
			{#if command}
				<div class="font-mono text-xs">
					<span class="text-amber-600 dark:text-amber-400">$ </span>
					<span class="whitespace-pre-wrap break-all text-foreground">{command}</span>
				</div>
			{/if}

			{#if stdout}
				<div class="mt-1.5 font-mono text-xs text-muted-foreground">
					<pre class="whitespace-pre-wrap break-all m-0">{stdout}</pre>
				</div>
			{/if}

			{#if stderr}
				<div class="mt-1.5 font-mono text-xs {stderrColorClass}">
					<pre class="whitespace-pre-wrap break-all m-0">{stderr}</pre>
				</div>
			{/if}
		</div>
	{/if}
</AgentToolCard>
