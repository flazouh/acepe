<script lang="ts">
	import { SegmentedProgress } from "../segmented-progress/index.js";

	interface Props {
		completed: number;
		total: number;
	}

	let { completed, total }: Props = $props();

	const currentStep = $derived(completed + 1 <= total ? completed + 1 : total);
	const label = $derived(`Permission ${currentStep} of ${total}`);
</script>

{#if total > 1}
	<div aria-label={label} title={label}>
		<SegmentedProgress
			current={currentStep}
			total={total}
			segmentClass="w-[3px] h-[9px] rounded-full transition-[background-color,opacity,transform] duration-150"
			filledClass="opacity-100"
			emptyClass="bg-border/55 h-[6px] opacity-[0.7]"
		/>
	</div>
{/if}
