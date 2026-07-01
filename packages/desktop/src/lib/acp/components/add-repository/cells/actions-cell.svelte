<script lang="ts">
import { Button } from "@acepe/ui/button";
import { RoundedIcon } from "@acepe/ui";

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
		size="icon-chrome"
		class="rounded-md hover:bg-destructive/10 hover:text-destructive hover:[&_svg]:text-destructive"
		aria-label="Remove project"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onUndo();
		}}
	>
		<RoundedIcon name="trash" class="size-3.5" data-testid="remove-project-icon" />
	</Button>
{:else}
	<Button
		variant="ghost"
		size="icon-chrome"
		class="rounded-md"
		aria-label="Import project"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onImport();
		}}
	>
		<RoundedIcon name="add" class="size-3.5" data-testid="import-project-icon" />
	</Button>
{/if}
