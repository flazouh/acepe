<script lang="ts">
import { Button } from "@acepe/ui/button";
import { DownloadSimple } from "phosphor-svelte";
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
		variant="default"
		size="xs"
		class="gap-1"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onUndo();
		}}
	>
		{"Remove"}
		<Trash weight="fill" size={12} class="text-destructive" />
	</Button>
{:else}
	<Button
		variant="secondary"
		size="xs"
		class="gap-1"
		onclick={(event: MouseEvent) => {
			event.stopPropagation();
			onImport();
		}}
	>
		{"Import"}
		<DownloadSimple size={12} />
	</Button>
{/if}
