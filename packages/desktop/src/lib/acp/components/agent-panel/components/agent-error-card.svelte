<script lang="ts">
import WarningCircle from "phosphor-svelte/lib/WarningCircle";
import AnimatedChevron from "../../animated-chevron.svelte";

interface Props {
	title: string;
	summary: string;
	details: string;
	onRetry: () => void;
	onDismiss: () => void;
	onCreateIssue: () => void;
}

let { title, summary, details, onRetry, onDismiss, onCreateIssue }: Props = $props();

let isExpanded = $state(false);
</script>

<div class="w-full px-5 mb-2">
	{#if isExpanded}
		<div class="rounded-t-lg bg-accent/50 overflow-hidden">
			<div class="max-h-[220px] overflow-y-auto px-3 py-2">
				<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{details}</pre>
			</div>
		</div>
	{/if}

	<div
		class="w-full rounded-lg bg-accent hover:bg-accent/80 transition-colors {isExpanded
			? 'rounded-t-none'
			: ''}"
	>
		<button
			type="button"
			class="w-full flex items-center justify-between px-3 py-1"
			onclick={() => (isExpanded = !isExpanded)}
		>
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
				<span class="font-medium text-foreground shrink-0">{title}</span>
				<span class="truncate text-muted-foreground">{summary}</span>
				<span class="shrink-0 text-muted-foreground/60 ml-0.5">Details</span>
			</div>
			<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground shrink-0" />
		</button>
		<div class="flex items-center justify-end gap-1 px-2 pb-2">
			<button
				type="button"
				class="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded transition-colors cursor-pointer"
				onclick={onDismiss}
			>
				Dismiss
			</button>
			<button
				type="button"
				class="h-6 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/60 rounded transition-colors cursor-pointer"
				onclick={onCreateIssue}
			>
				Create issue
			</button>
			<button
				type="button"
				class="h-6 px-2 text-[10px] font-mono font-medium text-foreground bg-accent/60 hover:bg-accent/80 rounded transition-colors cursor-pointer"
				onclick={onRetry}
			>
				Retry
			</button>
		</div>
	</div>
</div>
