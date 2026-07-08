<script lang="ts">
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import StreamingReproLab from "./debug-panel/streaming-repro-lab.svelte";

interface Props {
	open?: boolean;
}

let { open = $bindable(false) }: Props = $props();
</script>

<DialogFrame
	bind:open
	title="Debug Panel"
	closeLabel="Close debug panel"
	size="debug"
	contentOverflow="hidden"
>
	{#if import.meta.env.DEV}
		<div class="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-3">
			<StreamingReproLab />
		</div>
	{/if}
</DialogFrame>
