<script lang="ts">
	import { CaretLeft } from "phosphor-svelte";

	interface Props {
		label: string;
		closeButtonLabel?: string;
		onClose?: () => void;
	}

	let { label, closeButtonLabel = "Back", onClose }: Props = $props();
</script>

<div
	class="flex items-center gap-3 border-b border-border bg-background px-3 py-2.5 shrink-0"
	data-testid="review-workspace-header"
>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		onclick={() => onClose?.()}
		data-testid="review-workspace-close"
	>
		<CaretLeft size={12} weight="bold" class="shrink-0" />
		{closeButtonLabel}
	</button>

	<h2 class="min-w-0 truncate text-sm font-medium text-foreground" data-testid="review-workspace-title">
		{label}
	</h2>
</div>
