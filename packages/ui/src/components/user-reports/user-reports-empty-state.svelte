<script lang="ts">
	import { Notepad } from 'phosphor-svelte';

	interface Props {
		title?: string;
		description?: string;
		actionLabel?: string;
		onAction?: () => void;
	}

	let {
		title = 'No reports yet',
		description = 'Be the first to share feedback',
		actionLabel,
		onAction
	}: Props = $props();
</script>

<div class="flex flex-col items-center justify-center min-h-full py-16 gap-3">
	<Notepad size={40} weight="duotone" class="text-muted-foreground/20" />
	<div class="text-center">
		<p class="text-[12px] text-muted-foreground/60 font-medium">{title}</p>
		<p class="text-[11px] text-muted-foreground/40 mt-0.5">{description}</p>
	</div>
	{#if actionLabel && onAction}
		<button
			type="button"
			class="mt-1 px-3 py-1 text-[11px] font-medium text-primary bg-primary/10 hover:bg-primary/15 rounded-full transition-colors cursor-pointer"
			onclick={onAction}
		>
			{actionLabel}
		</button>
	{/if}
</div>
