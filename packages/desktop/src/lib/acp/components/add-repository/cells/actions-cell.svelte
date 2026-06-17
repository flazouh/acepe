<script lang="ts">
import { Button } from "@acepe/ui/button";
import { Trash } from "phosphor-svelte";

interface Props {
	isAdded: boolean;
	onImport: () => void;
	onUndo: () => void;
}

let { isAdded, onImport, onUndo }: Props = $props();
</script>

{#if isAdded}
	<Button
		variant="secondary"
		size="2xs"
		class="gap-0.5 rounded-md"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onUndo();
		}}
	>
		{"Remove"}
		<Trash weight="fill" size={10} class="text-destructive" />
	</Button>
{:else}
	<Button
		variant="default"
		size="2xs"
		class="gap-0.5 rounded-md"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onImport();
		}}
	>
		{"Import"}
	</Button>
{/if}
