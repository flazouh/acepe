<script lang="ts">
import { CommandPaletteShell, type PaletteMode } from "@acepe/ui/command-palette";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { TIMING } from "../../constants/timing.js";
import { getAgentIcon } from "../../constants/thread-list-constants.js";
import type { UseAdvancedCommandPalette } from "../../hooks/use-advanced-command-palette.svelte.js";

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
const themeState = useTheme();

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

function handleQueryChange(query: string) {
	commandPalette.setQuery(query);
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

function getSessionAgentIcon(agentId: string): string {
	return getAgentIcon(agentId, themeState.effectiveTheme);
}

// Get state from hook
const paletteState = $derived(commandPalette.state);
</script>

<CommandPaletteShell
	bind:open
	bind:inputRef
	onOpenChange={handleOpenChange}
	placeholder={commandPalette.placeholder}
	query={paletteState.query}
	mode={paletteState.mode}
	modes={commandPalette.modes}
	items={paletteState.results}
	selectedIndex={paletteState.selectedIndex}
	hasRecentSection={commandPalette.hasRecentSection}
	recentSectionEndIndex={commandPalette.recentSectionEndIndex}
	onQueryChange={handleQueryChange}
	onKeyDown={handleKeyDown}
	onModeChange={handleModeChange}
	onSelect={handleSelect}
	onHover={handleItemHover}
	getAgentIconSrc={getSessionAgentIcon}
/>
