<script lang="ts">
interface Props {
	current: number;
	total: number;
	segmentClass?: string;
	filledClass?: string;
	emptyClass?: string;
}

let {
	current,
	total,
	segmentClass =
		"w-[3px] h-[10px] rounded-full transition-[background-color,opacity,transform] duration-150 opacity-[0.55]",
	filledClass = "bg-[#f9c396] opacity-100",
	emptyClass = "bg-border/55 h-[5px]",
}: Props = $props();

const segments = $derived.by(() => {
	const safeTotal = total > 0 ? total : 0;
	const safeCurrent = current > 0 ? Math.min(current, safeTotal) : 0;

	return Array.from({ length: safeTotal }, (_, index) => index < safeCurrent);
});
</script>

<div class="flex items-center gap-0.5 shrink-0" aria-hidden="true">
	{#each segments as isFilled, index (index)}
		<div
			data-testid="todo-progress-segment"
			data-filled={isFilled ? "true" : "false"}
			class="{segmentClass} {isFilled ? filledClass : emptyClass}"
		></div>
	{/each}
</div>
