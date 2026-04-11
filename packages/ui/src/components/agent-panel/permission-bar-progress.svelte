<script lang="ts">
	interface Props {
		completed: number;
		total: number;
	}

	let { completed, total }: Props = $props();

	const currentStep = $derived(completed + 1 <= total ? completed + 1 : total);
	const label = $derived(`Permission ${currentStep} of ${total}`);
	const segments = $derived(
		Array.from({ length: total }, (_, i) => i < completed + 1)
	);
</script>

{#if total > 0}
	<div class="flex items-center gap-[2px]" aria-label={label} title={label}>
		{#each segments as filled, i (i)}
			<div
				class="rounded-full transition-all duration-150 {filled
					? 'h-[9px] w-[3px] bg-foreground'
					: 'h-[6px] w-[3px] bg-foreground/25'}"
			></div>
		{/each}
	</div>
{/if}
