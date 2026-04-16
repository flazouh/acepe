<script lang="ts">
	import { stripAnsiCodes } from "../../../../utils/ansi-utils.js";

/**
 * Strip the "Exited with code X.Final output:\n\n" or "New output:\n\n" prefix
 * that the ACP server adds to bash tool results.
 */
function stripOutputPrefix(text: string): string {
	// Match patterns like "Exited with code 0.Final output:\n\n" or "New output:\n\n"
	return text.replace(
		/^(Exited with code \d+\.(Signal `[^`]+`\. )?Final output:\n\n|New output:\n\n)/s,
		""
	);
}

interface ExecuteToolContentProps {
	/**
	 * The command that was executed.
	 */
	command: string | null;

	/**
	 * Stdout output from command execution.
	 */
	stdout: string | null;

	/**
	 * Stderr output from command execution.
	 */
	stderr: string | null;

	/**
	 * Exit code from command execution.
	 */
	exitCode?: number;

	fallbackOutput: string | null;

	/**
	 * Whether the content is expanded.
	 */
	isExpanded?: boolean;

	/**
	 * Callback when content is clicked (for click-to-expand).
	 */
	onClickExpand?: () => void;
}

let {
	command,
	stdout,
	stderr,
	exitCode,
	fallbackOutput,
	isExpanded = false,
	onClickExpand,
}: ExecuteToolContentProps = $props();

// Get the stdout to display
const displayStdout = $derived.by(() => {
	if (stdout) {
		return stripOutputPrefix(stripAnsiCodes(stdout));
	}

	if (fallbackOutput) {
		return stripOutputPrefix(stripAnsiCodes(fallbackOutput));
	}

	return null;
});

const displayStderr = $derived(stderr ? stripAnsiCodes(stderr) : null);

const hasOutput = $derived(displayStdout || displayStderr);

// Determine stderr color based on exit code (like 1code)
// exitCode 0 = warning (amber), non-zero = error (rose)
const stderrColorClass = $derived(
	exitCode === 0 || exitCode === undefined
		? "text-amber-600 dark:text-amber-400"
		: "text-rose-500 dark:text-rose-400"
);

let contentEl: HTMLDivElement | undefined = $state();

// When collapsed, scroll to bottom so end of output (e.g. test summary) is visible.
// overflow: hidden still allows programmatic scrollTop changes.
$effect(() => {
	const _stdout = displayStdout;
	const _stderr = displayStderr;
	if (contentEl && !isExpanded) {
		contentEl.scrollTop = contentEl.scrollHeight;
	}
});
</script>

<!-- Content - always visible, clickable to expand (only when collapsed) (1code style) -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	onclick={() => {
		if (hasOutput && !isExpanded) onClickExpand?.();
	}}
	data-scrollable={isExpanded ? "" : undefined}
	class="border-t border-border px-2.5 py-1.5 transition-colors duration-150 {isExpanded
		? 'max-h-[200px] overflow-y-auto'
		: 'flex flex-col justify-end max-h-[72px] overflow-hidden'} {hasOutput && !isExpanded
		? 'cursor-pointer hover:bg-muted/50'
		: ''}"
>
	<!-- Command -->
	{#if command}
		<div class="font-mono text-xs">
			<span class="text-amber-600 dark:text-amber-400">$ </span>
			<span class="whitespace-pre-wrap break-all text-foreground">{command}</span>
		</div>
	{/if}

	<!-- Stdout -->
	{#if displayStdout}
		<div class="execute-output mt-1.5 font-mono text-xs text-muted-foreground">
			<pre class="whitespace-pre-wrap break-all">{displayStdout}</pre>
		</div>
	{/if}

	<!-- Stderr -->
	{#if displayStderr}
		<div class="execute-output mt-1.5 font-mono text-xs {stderrColorClass}">
			<pre class="whitespace-pre-wrap break-all">{displayStderr}</pre>
		</div>
	{/if}
</div>

<style>
	/* Execute output styling - preserve monospace and whitespace for command output */
	.execute-output {
		overflow-wrap: break-word;
		word-break: break-word;

		& pre {
			margin: 0;
			font-family: inherit;
			font-size: inherit;
		}
	}
</style>
