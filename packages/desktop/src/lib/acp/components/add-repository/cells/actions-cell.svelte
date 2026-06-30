<script lang="ts">
import { Button } from "@acepe/ui/button";
import { PlusIcon, RoundedIcon } from "@acepe/ui";

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
		<RoundedIcon name="trash" class="size-3.5 text-destructive" />
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
		<PlusIcon />
	</Button>
{/if}
