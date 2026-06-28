<script lang="ts">
import { Button } from "@acepe/ui/button";
import { Plus, Trash } from "phosphor-svelte";

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
		size="icon-xs"
		class="rounded-md"
		aria-label="Remove project"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onUndo();
		}}
	>
		<Trash weight="fill" class="text-destructive" />
	</Button>
{:else}
	<Button
		variant="default"
		size="icon-xs"
		class="rounded-md"
		aria-label="Import project"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onImport();
		}}
	>
		<Plus weight="bold" />
	</Button>
{/if}
