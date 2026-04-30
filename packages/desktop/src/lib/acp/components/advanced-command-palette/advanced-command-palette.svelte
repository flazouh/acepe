<script lang="ts">
import { MagnifyingGlass } from "phosphor-svelte";
import * as Dialog from "@acepe/ui/dialog";
import * as Kbd from "$lib/components/ui/kbd/index.js";
import { TIMING } from "../../constants/timing.js";
import type { UseAdvancedCommandPalette } from "../../hooks/use-advanced-command-palette.svelte.js";
import type { PaletteMode } from "../../types/palette-mode.js";
import PaletteResults from "./palette-results.svelte";
import PaletteTabs from "./palette-tabs.svelte";

interface Props {
	/** Whether the command palette is open */
	open: boolean;
	/** Callback when the open state changes */
	onOpenChange: (open: boolean) => void;
	/** Command palette hook instance */
	commandPalette: UseAdvancedCommandPalette;
}

let { open = $bindable(), onOpenChange, commandPalette }: Props = $props();

let inputRef: HTMLInputElement | null = $state(null);

// Track previous open state to detect opening
let wasOpen = false;

// Focus input and reset state when opened
$effect(() => {
	const isOpen = open;
	if (isOpen && !wasOpen) {
		// Dialog just opened - reset state
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

function handleModeChange(mode: PaletteMode) {
	commandPalette.setMode(mode);
	// Refocus input after mode change
	inputRef?.focus();
}

function handleKeyDown(event: KeyboardEvent) {
	if (!open) return;

	// Handle mode switching with Cmd/Ctrl + number
	if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
		const numKey = Number.parseInt(event.key, 10);
		if (numKey >= 1 && numKey <= 3) {
			event.preventDefault();
			const modes: PaletteMode[] = ["commands", "sessions", "files"];
			commandPalette.setMode(modes[numKey - 1]);
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
	// Close the palette after executing
	open = false;
	onOpenChange(false);
}

function handleItemHover(index: number) {
	commandPalette.selectIndex(index);
}

// Get state from hook
const paletteState = $derived(commandPalette.state);
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="max-w-lg w-full p-0 gap-0 border border-border/40 shadow-2xl overflow-hidden rounded-xl"
		showCloseButton={false}
	>
		<div class="flex flex-col">
			<!-- Search Input -->
			<div class="flex items-center gap-2 px-3 py-2 border-b border-border/30">
				<MagnifyingGlass class="size-3.5 text-muted-foreground/50 shrink-0" weight="bold" />
				<input
					bind:this={inputRef}
					type="text"
					placeholder={commandPalette.placeholder}
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					class="flex-1 bg-transparent border-none outline-none text-[13px] placeholder:text-muted-foreground/40"
					value={paletteState.query}
					oninput={handleInput}
					onkeydown={handleKeyDown}
				/>
			</div>

			<!-- Mode Tabs -->
			<PaletteTabs
				mode={paletteState.mode}
				modes={commandPalette.modes}
				onModeChange={handleModeChange}
			/>

			<!-- Results -->
			<PaletteResults
				items={paletteState.results}
				query={paletteState.query}
				selectedIndex={paletteState.selectedIndex}
				hasRecentSection={commandPalette.hasRecentSection}
				recentSectionEndIndex={commandPalette.recentSectionEndIndex}
				onSelect={handleSelect}
				onHover={handleItemHover}
			/>

			<!-- Footer -->
			<div
				class="flex items-center justify-between px-3 py-1 border-t border-border/20 text-[9px] text-muted-foreground/40"
			>
				<div class="flex items-center gap-3">
					<span class="flex items-center gap-1">
						<Kbd.Group>
							<Kbd.Root class="text-[9px]">↑</Kbd.Root>
							<Kbd.Root class="text-[9px]">↓</Kbd.Root>
						</Kbd.Group>
						<span>navigate</span>
					</span>
					<span class="flex items-center gap-1">
						<Kbd.Root class="text-[9px]">↵</Kbd.Root>
						<span>select</span>
					</span>
				</div>
				<span class="flex items-center gap-1">
					<Kbd.Root class="text-[9px]">esc</Kbd.Root>
					<span>close</span>
				</span>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
