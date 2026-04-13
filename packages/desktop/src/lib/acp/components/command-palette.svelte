<script lang="ts">
import * as Dialog from "$lib/components/ui/dialog/index.js";
import * as Kbd from "$lib/components/ui/kbd/index.js";
import * as m from "$lib/messages.js";
import { TIMING } from "../constants/timing.js";
import type { UseCommandPalette } from "../hooks/use-command-palette.svelte.js";

interface Props {
	/**
	 * Whether the command palette is open
	 */
	open: boolean;
	/**
	 * Callback when the open state changes
	 */
	onOpenChange: (open: boolean) => void;
	/**
	 * Command palette hook instance
	 */
	commandPalette: UseCommandPalette;
}

let { open = $bindable(), onOpenChange, commandPalette }: Props = $props();

let inputRef: HTMLInputElement | null = $state(null);

// Track previous open state to detect opening
let wasOpen = false;

// Focus input and reset state when opened - uses $effect
$effect(() => {
	const isOpen = open;
	if (isOpen && !wasOpen) {
		// Dialog just opened - reset query and selection
		commandPalette.resetForOpen();

		// Small delay to ensure dialog is rendered
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

	// Handle number keys 1-9 for quick selection
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
	// Close the palette after executing command
	open = false;
	onOpenChange(false);
}

const filteredCommands = $derived(commandPalette.getFilteredCommands());
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-md w-full p-0 gap-0 border-none shadow-xl" showCloseButton={false}>
		<div class="flex flex-col">
			<!-- Input -->
			<div class="flex items-center gap-2 px-3 py-2 border-b">
				<span class="text-muted-foreground text-sm">></span>
				<input
					bind:this={inputRef}
					type="text"
					placeholder={m.command_palette_placeholder()}
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					class="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
					value={commandPalette.state.query}
					oninput={handleInput}
					onkeydown={handleKeyDown}
				/>
			</div>

			<!-- Commands List -->
			<div class="max-h-64 overflow-y-auto overflow-hidden rounded-b-lg">
				{#each filteredCommands as command, index (index)}
					{@const Icon = command.icon}
					{@const isSelected = index === commandPalette.state.selectedIndex}
					{@const isLast = index === filteredCommands.length - 1}
					<button
						type="button"
						class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors group {isSelected
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
	</Dialog.Content>
</Dialog.Root>
