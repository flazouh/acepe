<script lang="ts">
import { Button } from "@acepe/ui/button";
import { PlusIcon } from "@acepe/ui";
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
		variant="ghost"
		size="icon"
		class="rounded-md hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive hover:[&_svg]:text-destructive focus-visible:[&_svg]:text-destructive"
		aria-label="Remove project"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onUndo();
		}}
	>
		<RoundedIcon
			name="trash"
			class="size-3.5"
			data-testid="remove-project-icon"
		/>
	</Button>
{:else}
	<Button
		variant="ghost"
		size="icon"
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
