<script lang="ts">
import { IconPencil } from "@tabler/icons-svelte";
import { IconX } from "@tabler/icons-svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import type { Keybinding } from "$lib/keybindings/types.js";
import { formatKeyStringToArray } from "$lib/keybindings/utils/formatter.js";
interface Props {
	binding: Keybinding | undefined;
	actionId: string;
	isCustom: boolean;
	isLoading: boolean;
	onEdit: (actionId: string) => void;
	onReset: (actionId: string) => void;
}

let { binding, actionId, isCustom, isLoading, onEdit, onReset }: Props = $props();
</script>

<div class="flex items-center justify-end gap-2">
	{#if binding}
		<KbdGroup>
			{#each formatKeyStringToArray(binding.key) as key, index (key + index)}
				<Kbd>{key}</Kbd>
			{/each}
		</KbdGroup>
	{:else}
		<span class="text-xs text-muted-foreground/60">{"Not bound"}</span>
	{/if}

	<Button
		variant="ghost"
		size="icon"
		class="h-6 w-6"
		onclick={() => onEdit(actionId)}
		disabled={isLoading}
		title={"Edit keybinding"}
	>
		<IconPencil class="h-3.5 w-3.5" />
	</Button>
	{#if isCustom}
		<Button
			variant="ghost"
			size="icon"
			class="h-6 w-6 text-muted-foreground hover:text-destructive"
			onclick={() => onReset(actionId)}
			disabled={isLoading}
			title={"Reset to default"}
		>
			<IconX class="h-3.5 w-3.5" />
		</Button>
	{/if}
</div>
