<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";
import * as Kbd from "$lib/components/ui/kbd/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import { TIMING } from "../../constants/timing.js";
import type { UseAdvancedCommandPalette } from "../../hooks/use-advanced-command-palette.svelte.js";
import type { PaletteMode } from "../../types/palette-mode.js";
import PaletteResults from "./palette-results.svelte";
import PaletteTabs from "./palette-tabs.svelte";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	commandPalette: UseAdvancedCommandPalette;
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

function handleModeChange(mode: PaletteMode) {
	commandPalette.setMode(mode);
	inputRef?.focus();
}

function handleKeyDown(event: KeyboardEvent) {
	if (!open) return;

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
	open = false;
	onOpenChange(false);
}

function handleItemHover(index: number) {
	commandPalette.selectIndex(index);
}

const paletteState = $derived(commandPalette.state);
</script>

<DialogFrame
	bind:open
	title="Command palette"
	closeLabel="Close command palette"
	size="palette-lg"
	hideHeader={true}
	contentClass="mx-auto w-full max-w-[40rem] overflow-hidden rounded-xl border border-border/40 shadow-2xl"
	{onOpenChange}
>
	<div class="flex flex-col">
		<div class="flex items-center gap-2 border-b border-border/30 px-3 py-2">
			<HugeiconsIcon name="search" class="size-3.5 shrink-0 text-muted-foreground/50" />
			<input
				bind:this={inputRef}
				type="text"
				placeholder={commandPalette.placeholder}
				autocomplete="off"
				autocapitalize="off"
				spellcheck={false}
				class="flex-1 border-none bg-transparent outline-none placeholder:text-muted-foreground/40"
				value={paletteState.query}
				oninput={handleInput}
				onkeydown={handleKeyDown}
			/>
		</div>

		<PaletteTabs
			mode={paletteState.mode}
			modes={commandPalette.modes}
			onModeChange={handleModeChange}
		/>

		<PaletteResults
			items={paletteState.results}
			query={paletteState.query}
			selectedIndex={paletteState.selectedIndex}
			hasRecentSection={commandPalette.hasRecentSection}
			recentSectionEndIndex={commandPalette.recentSectionEndIndex}
			onSelect={handleSelect}
			onHover={handleItemHover}
		/>

		<div
			class="flex items-center justify-between border-t border-border/20 px-3 py-1 text-[9px] text-muted-foreground/40"
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
</DialogFrame>
