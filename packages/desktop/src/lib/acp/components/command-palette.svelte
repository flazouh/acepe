<script lang="ts">
import * as Kbd from "$lib/components/ui/kbd/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { TIMING } from "../constants/timing.js";
import type { UseCommandPalette } from "../hooks/use-command-palette.svelte.js";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	commandPalette: UseCommandPalette;
}

let { open = $bindable(), onOpenChange, commandPalette }: Props = $props();

let inputRef: HTMLInputElement | null = $state(null);
let wasOpen = false;

$effect(() => {
	const isOpen = open;
	if (isOpen && !wasOpen) {
		commandPalette.resetForOpen();
		if (inputRef) {
			setTimeout(() => {
				inputRef?.focus();
			}, TIMING.FOCUS_DELAY_MS);
		}
	}
	wasOpen = isOpen;
});

function handleOpenChange(newOpen: boolean) {
	open = newOpen;
	onOpenChange(newOpen);
}

function handleInput(event: Event) {
	const target = event.target as HTMLInputElement;
	commandPalette.setQuery(target.value);
}

function handleKeyDown(event: KeyboardEvent) {
	if (!open) return;

	const numKey = Number.parseInt(event.key, 10);
	if (numKey >= 1 && numKey <= 9) {
		const targetIndex = numKey - 1;
		const commands = commandPalette.getFilteredCommands();
		if (targetIndex < commands.length) {
			event.preventDefault();
			commandPalette.selectIndex(targetIndex);
			handleSelect();
			return;
		}
	}

	switch (event.key) {
		case "ArrowDown":
			event.preventDefault();
			commandPalette.navigateNext();
			break;
		case "ArrowUp":
			event.preventDefault();
			commandPalette.navigatePrevious();
			break;
		case "Enter":
			event.preventDefault();
			handleSelect();
			break;
		case "Escape":
			event.preventDefault();
			open = false;
			break;
	}
}

async function handleSelect() {
	await commandPalette.executeSelected();
	open = false;
	onOpenChange(false);
}

const filteredCommands = $derived(commandPalette.getFilteredCommands());
</script>

<DialogFrame
	bind:open
	title="Command palette"
	closeLabel="Close command palette"
	size="palette"
	hideHeader={true}
	contentClass="border-none shadow-xl"
	{onOpenChange}
>
	<div class="flex flex-col">
		<div class="flex items-center gap-2 border-b px-3 py-2">
			<span class="text-sm text-muted-foreground">&gt;</span>
			<input
				bind:this={inputRef}
				type="text"
				placeholder={"Type a command..."}
				autocomplete="off"
				autocapitalize="off"
				spellcheck={false}
				class="flex-1 border-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				value={commandPalette.state.query}
				oninput={handleInput}
				onkeydown={handleKeyDown}
			/>
		</div>

		<div class="max-h-64 overflow-y-auto overflow-hidden rounded-b-lg">
			{#each filteredCommands as command, index (index)}
				{@const Icon = command.icon}
				{@const isSelected = index === commandPalette.state.selectedIndex}
				{@const isLast = index === filteredCommands.length - 1}
				<button
					type="button"
					class="group flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors {isSelected
						? 'bg-accent text-accent-foreground'
						: 'hover:bg-accent/50'} {isLast ? 'rounded-b-lg' : ''}"
					onclick={handleSelect}
					onmouseenter={() => commandPalette.selectIndex(index)}
				>
					<Icon
						class="h-3.5 w-3.5 shrink-0 transition-all {isSelected
							? '-rotate-3 text-primary'
							: 'text-muted-foreground group-hover:-rotate-3 group-hover:text-primary'}"
					/>
					<span class="flex-1">{command.label}</span>
					{#if index < 9}
						<Kbd.Root>{index + 1}</Kbd.Root>
					{/if}
				</button>
			{/each}
		</div>
	</div>
</DialogFrame>
