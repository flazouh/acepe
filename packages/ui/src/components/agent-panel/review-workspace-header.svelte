<script lang="ts">
	import { CaretLeft, Files } from "phosphor-svelte";

	interface Props {
		label: string;
		closeButtonLabel?: string;
		fileCount?: number;
		onClose?: () => void;
	}

	let { label, closeButtonLabel = "Back", fileCount, onClose }: Props = $props();
</script>

<div
	class="flex w-full shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-input/30 pl-1 pr-3 py-1"
	data-testid="review-workspace-header"
>
	<div class="flex min-w-0 items-center gap-2">
		<button
			type="button"
			class="inline-flex h-6 items-center gap-1 rounded px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			onclick={() => onClose?.()}
			data-testid="review-workspace-close"
		>
			<CaretLeft size={11} weight="bold" class="shrink-0" />
			{closeButtonLabel}
		</button>

		<div class="h-4 w-px bg-border/70" aria-hidden="true"></div>

		<span class="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
			<Files size={13} weight="duotone" class="text-muted-foreground" />
		</span>

		<h2
			class="min-w-0 truncate text-sm font-medium text-foreground"
			data-testid="review-workspace-title"
		>
			{label}
		</h2>
	</div>

	{#if typeof fileCount === "number" && fileCount > 0}
		<span class="shrink-0 text-sm tabular-nums text-muted-foreground">
			{fileCount}
		</span>
	{/if}
</div>
