<script lang="ts">
import type { AvailableCommand } from "../../../types/available-command.js";

import CommandItem from "./command-item.svelte";

interface Props {
	commands: ReadonlyArray<AvailableCommand>;
	selectedIndex: number;
	itemRefs: Record<number, HTMLDivElement>;
	onSelect: (command: AvailableCommand) => void;
	onHover: (index: number) => void;
}

let { commands, selectedIndex, itemRefs = $bindable(), onSelect, onHover }: Props = $props();
</script>

<div class="max-h-64 overflow-y-auto flex flex-col">
	{#each commands as command, index (`${command.name}-${index}`)}
		{@const isSelected = index === selectedIndex}
		<CommandItem
			{command}
			{isSelected}
			bind:itemRef={itemRefs[index]}
			{onSelect}
			onHover={() => onHover(index)}
		/>
	{/each}
</div>
